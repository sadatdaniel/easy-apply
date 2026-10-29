import { extractJob, listModels, PRESETS, testConnection } from '@shared/ai';
import { chainAsk, providerLabel, suggestedLimits, type UsageStore } from '@shared/chain';
import { parsePosting, type FetchedPosting } from '@shared/posting';
import { tailorBlock } from '@shared/tailor';
import type { AiSettings, AppState, DocMeta, JobFields, Profile, ProviderEntry, Status, Usage } from '@shared/types';
import { setAiStatus } from './aiStatus';
import { applyRestore, collectFiles, LIMITS, MARKER, planRestore, safeBackupPath } from '@shared/backup';
import { current } from './backend';
import { kv } from './idb';

/*
  Everything runs in the browser: the store reads and writes the connected folder, AI calls go
  straight to the provider. Only fetching a posting from a link needs the optional local helper,
  because browsers may not read other sites.
*/
export const HELPER = 'http://127.0.0.1:4317';

export interface Doc { name: string; meta: DocMeta; body: string }
export interface JobDetail { job: Awaited<ReturnType<ReturnType<typeof current>['getJob']>>; posting: string; docs: Doc[] }
export type { FetchedPosting };
export interface Preset { label: string; provider: AiSettings['provider']; baseURL: string; needsKey: boolean; model: string }

const s = () => current();
/* ---------- AI providers: an ordered fallback chain, kept in this browser (keys never go to the folder) ---------- */
async function getProviders(): Promise<ProviderEntry[]> {
  const list = await kv.get<ProviderEntry[]>('providers');
  if (list) return list;
  // earlier versions kept one provider under 'ai'
  const old = await kv.get<AiSettings>('ai');
  const migrated = old?.model ? [{ ...old, id: newId(), enabled: true, ...pickLimits(old.preset, old.model) }] : [];
  await kv.set('providers', migrated);
  return migrated;
}
const newId = () => Math.random().toString(36).slice(2, 10);
const pickLimits = (preset: string, model: string) => { const l = suggestedLimits(preset, model); return { perMinute: l.perMinute, perDay: l.perDay, timeoutSec: l.timeoutSec }; };
// read-modify-write in one queue, so parallel AI requests never lose each other's counts
let usageQueue: Promise<unknown> = Promise.resolve();
const usage: UsageStore = {
  load: async () => (await kv.get<Usage>('usage')) ?? {},
  update: fn => {
    const next = usageQueue.then(async () => { const u = (await kv.get<Usage>('usage')) ?? {}; fn(u); await kv.set('usage', u); });
    usageQueue = next.catch(() => {});
    return next;
  },
};
async function ask() { return chainAsk(await getProviders(), usage, setAiStatus); }
const mask = (k: string) => (k ? '••••' + k.slice(-4) : '');
/** the settings screen only ever sees masked keys; put the real one back before using or saving */
async function withKey<T extends AiSettings & { id?: string }>(x: T): Promise<T> {
  if (!x.apiKey.startsWith('••••')) return { ...x, apiKey: x.apiKey.trim() };
  const saved = (await getProviders()).find(p => p.id === x.id);
  return { ...x, apiKey: saved?.apiKey ?? '' };
}

/** open a stored file (PDF, image …) in a new tab */
function openBlob(b: Blob) {
  const url = URL.createObjectURL(b);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function helperRunning() {
  try { return (await fetch(`${HELPER}/api/helper`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}

/** last backup download, per device (shown in Settings; browser storage gets a reminder) */
export const lastBackup = () => kv.get<string>('lastBackup');

export const api = {
  async state(): Promise<AppState> {
    const st = s();
    const [profile, templates, extras, jobs, providers] = await Promise.all([st.getProfile(), st.listTemplates(), st.listExtras(), st.listJobs(), getProviders()]);
    const on = providers.filter(p => p.enabled && p.model);
    return { root: st.fs.label, profile, templates, extras, jobs, ai: { configured: on.length > 0, label: on[0] ? providerLabel(on[0]) : '', count: on.length } };
  },
  saveProfile: (p: Profile) => s().saveProfile(p),

  /** every file of the app's folder in one zip; remembers when, for the reminder */
  async backup(): Promise<Blob> {
    const { zipSync, strToU8 } = await import('fflate');
    const entries: Record<string, Uint8Array> = { [MARKER]: strToU8(JSON.stringify({ app: 'easy-apply', created: new Date().toISOString(), from: s().fs.label }, null, 2)) };
    for (const f of await collectFiles(s().fs)) entries[f.path] = new Uint8Array(await f.data.arrayBuffer());
    const zip = new Blob([zipSync(entries, { level: 6 }) as BlobPart], { type: 'application/zip' });
    await kv.set('lastBackup', new Date().toISOString());
    return zip;
  },
  /** puts a backup's files back: adds and replaces, never deletes; replaced files are kept in .trash */
  async restoreBackup(file: File) {
    const { unzipSync } = await import('fflate');
    let total = 0, count = 0;
    let entries: Record<string, Uint8Array>;
    try {
      // check sizes before unpacking, so a "zip bomb" can't fill the memory
      entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
        filter: f => {
          if (++count > LIMITS.files + 1) throw new Error('This backup has too many files.');
          total += f.originalSize;
          if (total > LIMITS.bytes) throw new Error('This backup is too large to restore (over 1 GB unpacked).');
          return f.name === MARKER || safeBackupPath(f.name) !== null;
        },
      });
    } catch (e) {
      throw /too (many|large)/.test((e as Error).message) ? e : new Error('This file is not a readable zip. Choose a backup made with "Download backup".');
    }
    return applyRestore(s().fs, planRestore(entries));
  },
  addStarters: (ids: string[], theme: string) => s().addStarters(ids, theme),

  template: (id: string) => s().getTemplate(id),
  saveTemplate: (id: string, meta: DocMeta, body: string) => s().saveTemplate(id, meta, body),
  createTemplate: (meta: DocMeta, from?: string) => s().createTemplate(meta, undefined, from),
  importTemplate: (meta: DocMeta, body: string) => s().createTemplate(meta, body),
  trashTemplate: (id: string) => s().trashTemplate(id),
  setMain: (id: string) => s().setMain(id),

  uploadExtra: async (file: File) => ({ name: await s().addExtra(file.name, file) }),
  openExtra: async (name: string) => openBlob(await s().extraFile(name)),
  extraBlob: (name: string) => s().extraFile(name),

  async fetchPosting(url: string): Promise<FetchedPosting> {
    url = url.trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('Enter a full link starting with http:// or https://');
    // 1. the local helper, when it runs
    if (await helperRunning()) {
      const r = await fetch(`${HELPER}/api/fetch-posting`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data as { error?: string }).error ?? `The helper failed (${r.status})`);
      return data as FetchedPosting;
    }
    // 2. straight from the browser: works only for the few sites that allow it
    let html: string;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(`The site answered ${r.status}. Paste the posting text instead.`);
      html = await r.text();
    } catch (e) {
      if ((e as Error).message.startsWith('The site')) throw e;
      throw new Error('This site does not let the browser read it. Paste the posting text below, or run the local helper (npm start) to fetch links.');
    }
    return parsePosting(html, url, h => new DOMParser().parseFromString(h, 'text/html'));
  },
  extract: async (text: string) => extractJob(await ask(), text),

  createJob: (fields: Partial<JobFields>, posting: string, postingHtml = '', postingComplete: boolean | null = null) => s().createJob(fields, posting, postingHtml, postingComplete),
  async job(id: string): Promise<JobDetail> {
    const job = await s().getJob(id);
    const [posting, docs] = await Promise.all([s().getPosting(id), Promise.all(job.docs.map(d => s().getDoc(id, d).catch(() => null)))]);
    return { job, posting, docs: docs.filter((d): d is Doc => !!d) };
  },
  updateJob: (id: string, patch: Partial<JobFields> & { next?: string; exportName?: string; postingComplete?: boolean | null }) => s().updateJob(id, patch),
  setStatus: (id: string, status: Status, note = '') => s().setStatus(id, status, note),
  trashJob: (id: string) => s().trashJob(id),
  savePosting: (id: string, text: string) => s().savePosting(id, text),
  /** browsers can't open Explorer; say where the files are instead */
  folderOf: (id: string) => `${s().fs.label} › jobs › ${id}`,
  setBucket: (id: string, order: string[]) => s().setBucket(id, order),
  attachExtra: (id: string, name: string) => s().attachExtra(id, name),
  detachExtra: (id: string, name: string) => s().detachExtra(id, name),
  openFile: async (id: string, name: string) => openBlob(await s().jobFile(id, name)),
  fileBlob: (id: string, name: string) => s().jobFile(id, name),

  async addDoc(id: string, template: string) {
    const name = await s().addDocFromTemplate(id, template);
    return { name, job: await s().getJob(id) };
  },
  async addExample(id: string, example: string) {
    const name = await s().addDocFromExample(id, example);
    return { name, job: await s().getJob(id) };
  },
  removeDoc: (id: string, name: string) => s().removeDoc(id, name),
  /** swaps a document or file for another one, in the same place of the send order */
  async replaceIn(id: string, old: string, add: () => Promise<string>) {
    const before = await s().getJob(id);
    const at = before.bucket.indexOf(old);
    const name = await add();
    if (old.endsWith('.md')) await s().removeDoc(id, old); else await s().detachExtra(id, old);
    const job = await s().getJob(id);
    if (at >= 0) await s().setBucket(id, [...job.bucket.filter(n => n !== name).slice(0, at), name, ...job.bucket.filter(n => n !== name).slice(at)]);
    return name;
  },
  doc: (id: string, name: string) => s().getDoc(id, name),
  saveDoc: (id: string, name: string, body: string, meta?: Partial<DocMeta>, version = false) => s().saveDoc(id, name, body, meta, version),
  rewrite: async (id: string, name: string, body: string, block: number, instruction = '', avoid: string[] = []) =>
    tailorBlock(s(), await ask(), id, name, body, block, instruction, avoid),
  versions: (id: string, name: string) => s().listVersions(id, name),
  version: async (id: string, name: string, v: string) => ({ body: await s().getVersion(id, name, v) }),
  restore: (id: string, name: string, version: string) => s().restoreVersion(id, name, version),

  async providers() {
    const [list, u] = await Promise.all([getProviders(), usage.load()]);
    return { providers: list.map(p => ({ ...p, apiKey: mask(p.apiKey) })), usage: u, presets: PRESETS as Record<string, Preset> };
  },
  /** a new, unsaved entry with the preset's address and suggested limits */
  newProvider(preset: string): ProviderEntry {
    const p = PRESETS[preset];
    return { id: newId(), enabled: true, provider: p.provider, preset, baseURL: p.baseURL, apiKey: '', model: p.model, ...pickLimits(preset, p.model) };
  },
  async saveProvider(x: ProviderEntry) {
    const list = await getProviders();
    const full = await withKey(x);
    const i = list.findIndex(p => p.id === x.id);
    if (i < 0) list.push(full); else list[i] = full;
    await kv.set('providers', list);
    return { ok: true as const };
  },
  async removeProvider(id: string) { await kv.set('providers', (await getProviders()).filter(p => p.id !== id)); },
  async orderProviders(ids: string[]) {
    const list = await getProviders();
    await kv.set('providers', ids.map(id => list.find(p => p.id === id)).filter((p): p is ProviderEntry => !!p));
  },
  resetUsage: (id: string) => usage.update(u => { delete u[id]; }),
  aiModels: async (x: ProviderEntry) => ({ models: await listModels(await withKey(x)) }),
  /** one provider alone, no fallback; it counts toward that provider's limits like any request */
  async aiTest(x: ProviderEntry) {
    const full = await withKey(x);
    await usage.update(u => { (u[x.id] ??= { at: [] }).at.push(Date.now()); });
    return testConnection(full);
  },
};
