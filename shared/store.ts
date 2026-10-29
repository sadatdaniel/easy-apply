import { fillPlaceholders } from './blocks';
import { EXAMPLES } from './examples';
import { STARTERS } from './starters';
import { basename, cleanFileName, copy, copyTree, extname, httpError, join, joinFrontmatter, notFound, readJson, safeName, slugify, splitFrontmatter, uniquePath, writeJson, type Fs } from './fs';
import { CLOSED, STATUSES, type DocMeta, type DocStyle, type ExtraFile, type Job, type JobFields, type Profile, type Status, type TemplateInfo, type VersionInfo } from './types';

/*
  <root>/
    profile/profile.json      placeholder values: {{name}}, {{email}} …
    templates/*.md            frontmatter: title, kind, lang, theme
    extras/*                  certificates, references …
    jobs/<date>_<company>_<title>/
      job.json  posting.md  posting.html  *.md  <extras>  versions/
  AI keys are never stored in the root, so a synced root never carries them.
*/

const VERSION_GAP_MS = 10 * 60 * 1000; // autosaves within 10 minutes share one snapshot

const DEFAULT_PROFILE: Profile = {
  fields: [
    { key: 'name', label: 'Full name', value: '' },
    { key: 'tagline', label: 'Headline', value: '' },
    { key: 'email', label: 'Email', value: '' },
    { key: 'phone', label: 'Phone', value: '' },
    { key: 'website', label: 'Website / GitHub', value: '' },
    { key: 'location', label: 'Location', value: '' },
  ],
};


const EMPTY_FIELDS: JobFields = { title: '', company: '', location: '', salary: '', deadline: '', language: '', url: '', keywords: [], contact: '', notes: '' };

const NEXT_FOR: Partial<Record<Status, (note: string) => string>> = {
  applied: () => `Follow up ${new Date(Date.now() + 7 * 864e5).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
  interview: n => `Interview ${n || '(set date)'}`,
  offer: n => `Reply by ${n || '?'}`,
};

function toMeta(meta: Record<string, unknown>, fallbackTitle: string): DocMeta {
  return {
    title: String(meta.title ?? fallbackTitle),
    kind: (['cv', 'cover', 'other'].includes(String(meta.kind)) ? meta.kind : 'cv') as DocMeta['kind'],
    lang: String(meta.lang ?? 'en'),
    theme: String(meta.theme ?? 'classic'),
    ...(meta.template ? { template: String(meta.template) } : {}),
    ...(meta.style && typeof meta.style === 'object' ? { style: cleanStyle(meta.style as DocStyle) } : {}),
    ...(meta.main === true ? { main: true } : {}),
  };
}

function cleanStyle(s: DocStyle): DocStyle {
  const out: DocStyle = {};
  if (typeof s.size === 'number' && s.size >= 70 && s.size <= 140) out.size = Math.round(s.size);
  if (typeof s.lineHeight === 'number' && s.lineHeight >= 1 && s.lineHeight <= 2) out.lineHeight = s.lineHeight;
  if (s.align === 'left' || s.align === 'justify') out.align = s.align;
  if (s.margins === 'narrow' || s.margins === 'wide') out.margins = s.margins;
  return out;
}

function cleanFields(f: Partial<JobFields>): Partial<JobFields> {
  const out: Partial<JobFields> = {};
  for (const k of Object.keys(EMPTY_FIELDS) as (keyof JobFields)[]) {
    if (f[k] === undefined) continue;
    (out as Record<string, unknown>)[k] = k === 'keywords'
      ? [...new Set((f.keywords ?? []).map(s => String(s).trim()).filter(Boolean))]
      : String(f[k] ?? '').trim();
  }
  return out;
}

export type Store = ReturnType<typeof createStore>;

export type MainKind = 'cv' | 'cover';

/**
  The main CV or cover letter for a language: the one marked main; if none is marked, the only one in that
  language. A CV may fall back to another language (any main CV, then any CV): better a start than nothing.
  A cover letter never does: a German letter in an English application would be wrong.
*/
export function mainOf(templates: TemplateInfo[], kind: MainKind, lang: string): TemplateInfo | undefined {
  const all = templates.filter(t => t.kind === kind);
  const same = all.filter(t => t.lang === lang);
  const own = same.find(t => t.main) ?? (same.length === 1 ? same[0] : undefined);
  if (own || kind === 'cover') return own;
  return all.find(t => t.main) ?? same[0] ?? all[0];
}
export const mainCvOf = (templates: TemplateInfo[], lang: string) => mainOf(templates, 'cv', lang);

/** the CVs and letters that count as main for their language (for the ★ badge) */
export function mainIds(templates: TemplateInfo[]): Set<string> {
  const ids = new Set<string>();
  for (const kind of ['cv', 'cover'] as const) {
    const all = templates.filter(t => t.kind === kind);
    for (const lang of new Set(all.map(c => c.lang))) {
      const same = all.filter(c => c.lang === lang);
      const pick = same.find(c => c.main) ?? (same.length === 1 ? same[0] : undefined);
      if (pick) ids.add(pick.id);
    }
  }
  return ids;
}

/** the posting's language as a document language code */
export const docLang = (postingLanguage: string) => (/german|deutsch/i.test(postingLanguage) ? 'de' : 'en');

export function createStore(fs: Fs) {
  const D = { profile: 'profile', templates: 'templates', extras: 'extras', jobs: 'jobs' };
  const PROFILE = join(D.profile, 'profile.json');

  async function ensureRoot() {
    for (const p of Object.values(D)) await fs.mkdir(p);
    if (!(await fs.exists(PROFILE))) await writeJson(fs, PROFILE, DEFAULT_PROFILE);
    await fillPersonalPlaceholders();
  }

  /**
    Earlier versions wrote your details as {{name}}, {{email}} … into CVs and letters, filled from the profile.
    Your details are now plain text in your documents; this writes them in once, everywhere they are used.
    The job's placeholders ({{company}} …) stay: they are what makes one letter reusable.
  */
  async function fillPersonalPlaceholders() {
    const profile = await readJson<Profile & { placeholdersFilled?: string }>(fs, PROFILE, DEFAULT_PROFILE);
    if (profile.placeholdersFilled) return;
    const values = Object.fromEntries(profile.fields.filter(f => f.value.trim()).map(f => [f.key, f.value]));
    const personal = new RegExp(`\\{\\{\\s*(${Object.keys(values).map(k => k.replace(/[^\w.-]/g, '')).join('|') || '(?!)'})\\s*\\}\\}`, 'g');
    const fix = async (path: string) => {
      const text = await fs.read(path).catch(() => null);
      if (text === null) return;
      const next = text.replace(personal, (_, k: string) => values[k]);
      if (next !== text) await fs.write(path, next);
    };
    for (const f of await fs.list(D.templates)) if (f.kind === 'file' && f.name.endsWith('.md')) await fix(join(D.templates, f.name));
    for (const j of await fs.list(D.jobs)) if (j.kind === 'dir') {
      for (const f of await fs.list(join(D.jobs, j.name)).catch(() => [])) if (f.kind === 'file' && f.name.endsWith('.md') && f.name !== 'posting.md') await fix(join(D.jobs, j.name, f.name));
    }
    await writeJson(fs, PROFILE, { ...profile, placeholdersFilled: new Date().toISOString() });
  }

  /** onboarding: copy the chosen starter templates in, in the chosen theme (existing files are kept) */
  async function addStarters(ids: string[], theme: string) {
    for (const st of STARTERS.filter(x => ids.includes(x.id))) {
      const p = join(D.templates, st.id + '.md');
      if (!(await fs.exists(p))) await fs.write(p, joinFrontmatter({ ...st.meta, theme }, st.body));
    }
  }

  /* ---------- profile ---------- */
  const getProfile = () => readJson<Profile>(fs, PROFILE, DEFAULT_PROFILE);
  async function saveProfile(p: Profile) {
    const fields = p.fields.filter(f => f.key.trim()).map(f => ({ ...f, key: slugify(f.key, 30).replace(/-/g, '_') }));
    await writeJson(fs, PROFILE, { fields });
    return { fields };
  }
  const profileValues = async () => Object.fromEntries((await getProfile()).fields.map(f => [f.key, f.value]));

  /* ---------- templates ---------- */
  async function listTemplates(): Promise<TemplateInfo[]> {
    const files = (await fs.list(D.templates)).filter(f => f.kind === 'file' && f.name.endsWith('.md'));
    const out = await Promise.all(files.map(async f => {
      const id = f.name.slice(0, -3);
      return { id, ...toMeta(splitFrontmatter(await fs.read(join(D.templates, f.name))).meta, id), updatedAt: new Date(f.mtime).toISOString() };
    }));
    return out.sort((a, b) => a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title));
  }
  const templatePath = (id: string) => join(D.templates, safeName(id + '.md'));
  async function getTemplate(id: string) {
    const p = templatePath(id);
    if (!(await fs.exists(p))) throw notFound('Template');
    const { meta, body } = splitFrontmatter(await fs.read(p));
    return { id, meta: toMeta(meta, id), body };
  }
  async function saveTemplate(id: string, meta: DocMeta, body: string) {
    // "main" is only changed by setMain: an editor holding an older copy must not undo it
    // a deleted one stays deleted (an autosave may still be on its way)
    if (!(await fs.exists(templatePath(id)))) throw notFound('Template');
    const main = (await getTemplate(id)).meta.main;
    await fs.write(templatePath(id), joinFrontmatter({ ...toMeta(meta as never, id), main: main || undefined }, body));
    return getTemplate(id);
  }
  /** Makes a CV (or cover letter) the main one for its language: one main CV and one main letter per language. */
  async function setMain(id: string) {
    const t = await getTemplate(id);
    if (t.meta.kind !== 'cv' && t.meta.kind !== 'cover') throw httpError(400, 'Only a CV or a cover letter can be the main one.');
    for (const x of await listTemplates()) {
      if (x.kind !== t.meta.kind || x.lang !== t.meta.lang) continue;
      const cur = await getTemplate(x.id);
      const main = x.id === id;
      if (!!cur.meta.main !== main) await fs.write(templatePath(x.id), joinFrontmatter({ ...cur.meta, main: main || undefined }, cur.body));
    }
  }

  /**
    The main CV for a language: the one marked main; if none is marked, the only CV in that language;
    then any main CV; then the first CV. null when there are no CVs.
  */
  async function mainCv(lang: string) {
    const pick = mainCvOf(await listTemplates(), lang);
    return pick ? getTemplate(pick.id) : null;
  }

  /** Deleting a template moves it to <root>/.trash/templates. Jobs keep their own copies, so nothing else changes. */
  async function trashTemplate(id: string) {
    const from = templatePath(id);
    if (!(await fs.exists(from))) throw notFound('Template');
    const to = await uniquePath(fs, join('.trash', 'templates'), id, '.md');
    await fs.move(from, to);
    return to;
  }
  async function createTemplate(meta: DocMeta, body?: string, from?: string) {
    const src = from ? await getTemplate(from) : null;
    const p = await uniquePath(fs, D.templates, slugify(meta.title), '.md');
    await fs.write(p, joinFrontmatter({ ...meta }, body ?? src?.body ?? STARTERS.find(x => x.meta.kind === meta.kind && x.meta.lang === meta.lang)?.body ?? STARTERS.find(x => x.meta.kind === meta.kind)?.body ?? '# {{name}}\n'));
    return getTemplate(basename(p, '.md'));
  }

  /* ---------- extras library ---------- */
  async function listFiles(dir: string, filter = (_: string) => true): Promise<ExtraFile[]> {
    return (await fs.list(dir))
      .filter(f => f.kind === 'file' && !f.name.startsWith('.') && filter(f.name))
      .map(f => ({ name: f.name, size: f.size, updatedAt: new Date(f.mtime).toISOString() }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  const listExtras = () => listFiles(D.extras);
  const extraFile = (name: string) => fs.readBlob(join(D.extras, safeName(name)));
  async function addExtra(rawName: string, data: Blob) {
    const name = cleanFileName(rawName);
    const ext = extname(name);
    const p = await uniquePath(fs, D.extras, basename(name, ext), ext);
    await fs.write(p, data);
    return basename(p);
  }

  /* ---------- jobs ---------- */
  async function jobDir(id: string) {
    const p = join(D.jobs, safeName(id));
    if (!(await fs.exists(join(p, 'job.json')))) throw notFound('Job');
    return p;
  }
  async function getJob(id: string): Promise<Job> {
    const dir = await jobDir(id);
    // older or hand-edited job.json files may miss fields; fill them with defaults
    const job = await readJson<Partial<Job>>(fs, join(dir, 'job.json'), {});
    return { ...EMPTY_FIELDS, docs: [], extras: [], bucket: [], history: [], exportName: '', next: '', postingComplete: null, status: 'saved', createdAt: '', updatedAt: '', ...job, id } as Job;
  }
  async function saveJob(job: Job) {
    job.updatedAt = new Date().toISOString();
    await writeJson(fs, join(await jobDir(job.id), 'job.json'), job);
    return job;
  }
  async function listJobs(): Promise<Job[]> {
    const ids = (await fs.list(D.jobs)).filter(d => d.kind === 'dir').map(d => d.name);
    const jobs = await Promise.all(ids.map(id => getJob(id).catch(() => null)));
    return jobs.filter((j): j is Job => !!j).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async function createJob(fields: Partial<JobFields>, posting = '', postingHtml = '', postingComplete: boolean | null = null) {
    const f = { ...EMPTY_FIELDS, ...cleanFields(fields) };
    const now = new Date();
    const role = f.title.replace(/\(\s*[mwfdxi](\s*[/|,]\s*[mwfdxi])+\s*\)/gi, ''); // drop "(m/w/d)" from folder names
    const base = `${now.toISOString().slice(0, 10)}_${slugify(f.company || 'company', 30)}_${slugify(role || 'role', 40)}`;
    const dir = await uniquePath(fs, D.jobs, base, '');
    await fs.mkdir(join(dir, 'versions'));
    const id = basename(dir);
    const job: Job = {
      ...f, id, status: 'saved', history: [{ status: 'saved', at: now.toISOString() }], next: '',
      createdAt: now.toISOString(), updatedAt: now.toISOString(), postingComplete,
      docs: [], extras: [], bucket: [], exportName: '',
    };
    await writeJson(fs, join(dir, 'job.json'), job);
    await fs.write(join(dir, 'posting.md'), posting);
    if (postingHtml) await fs.write(join(dir, 'posting.html'), postingHtml);
    return job;
  }
  async function updateJob(id: string, patch: Partial<JobFields> & { next?: string; exportName?: string; postingComplete?: boolean | null }) {
    const job = await getJob(id);
    Object.assign(job, cleanFields(patch));
    if (patch.next !== undefined) job.next = String(patch.next);
    if (patch.exportName !== undefined) job.exportName = String(patch.exportName);
    if (patch.postingComplete !== undefined) job.postingComplete = patch.postingComplete;
    return saveJob(job);
  }
  async function setStatus(id: string, status: Status, note = '') {
    if (!STATUSES.includes(status)) throw httpError(400, 'Unknown status');
    const job = await getJob(id);
    job.status = status;
    job.history.push({ status, at: new Date().toISOString(), ...(note ? { note } : {}) });
    job.next = NEXT_FOR[status]?.(note) ?? (CLOSED.includes(status) ? '' : job.next);
    return saveJob(job);
  }
  /** Deleting an application moves its folder to <root>/.trash/jobs, so a slip can be undone by moving it back. */
  async function trashJob(id: string) {
    const dir = await jobDir(id);
    const to = await uniquePath(fs, join('.trash', 'jobs'), basename(dir), '');
    await copyTree(fs, dir, to);
    await fs.remove(dir);
    return to;
  }
  const getPosting = async (id: string) => fs.read(join(await jobDir(id), 'posting.md')).catch(() => '');
  const savePosting = async (id: string, text: string) => fs.write(join(await jobDir(id), 'posting.md'), text);

  /* ---------- job documents ---------- */
  async function docPath(id: string, name: string) {
    const n = safeName(name);
    if (!n.endsWith('.md')) throw httpError(400, 'Documents are .md files');
    return join(await jobDir(id), n);
  }
  /** copies a document into the job's folder, with the profile's and the job's details filled in */
  async function addDoc(id: string, src: { meta: DocMeta; body: string }, base: string, source: string) {
    const job = await getJob(id);
    const p = await uniquePath(fs, await jobDir(id), slugify(base, 30), '.md');
    const jobValues = {
      company: job.company, job_title: job.title, job_location: job.location,
      today: new Date().toLocaleDateString(src.meta.lang.startsWith('de') ? 'de-DE' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    };
    const body = fillPlaceholders(src.body, { ...(await profileValues()), ...jobValues });
    const { main: _main, ...meta } = src.meta; // a job's copy is never the main CV
    await fs.write(p, joinFrontmatter({ ...meta, template: source }, body));
    const name = basename(p);
    job.docs.push(name);
    job.bucket.push(name);
    job.sources = { ...job.sources, [name]: source };
    await saveJob(job);
    return name;
  }
  const addDocFromTemplate = async (id: string, templateId: string) => addDoc(id, await getTemplate(templateId), templateId, templateId);
  async function addDocFromExample(id: string, exampleId: string) {
    const ex = EXAMPLES.find(e => e.id === exampleId);
    if (!ex) throw notFound('Example');
    return addDoc(id, ex, ex.meta.kind === 'cover' ? 'cover-letter' : ex.meta.kind === 'cv' ? 'cv' : ex.id, 'example:' + ex.id);
  }
  /** Taking a document out of an application moves its file into .removed/ (its versions stay), never deletes it. */
  async function removeDoc(id: string, name: string) {
    const job = await getJob(id);
    const n = safeName(name);
    const p = await docPath(id, n);
    if (await fs.exists(p)) await fs.move(p, await uniquePath(fs, join(await jobDir(id), '.removed'), basename(n, '.md'), '.md'));
    job.docs = job.docs.filter(d => d !== n);
    job.bucket = job.bucket.filter(d => d !== n);
    if (job.sources) delete job.sources[n];
    return saveJob(job);
  }
  async function getDoc(id: string, name: string) {
    const p = await docPath(id, name);
    if (!(await fs.exists(p))) throw notFound('Document');
    const { meta, body } = splitFrontmatter(await fs.read(p));
    return { name, meta: toMeta(meta, name), body };
  }
  async function listVersions(id: string, name: string): Promise<VersionInfo[]> {
    const stem = safeName(name).slice(0, -3);
    const files = await listFiles(join(await jobDir(id), 'versions'), f => f.startsWith(stem + '.') && f.endsWith('.md') && /^\d{4}-/.test(f.slice(stem.length + 1)));
    return files.map(f => {
      const stamp = f.name.slice(stem.length + 1, -3);
      const iso = stamp.replace(/^(\d{4}-\d\d-\d\dT\d\d)-(\d\d)-(\d\d)-(\d+)Z$/, '$1:$2:$3.$4Z');
      return { id: stamp, at: iso, size: f.size };
    }).sort((a, b) => b.at.localeCompare(a.at));
  }
  async function snapshot(id: string, name: string, force = false) {
    const p = await docPath(id, name);
    if (!force) {
      const latest = (await listVersions(id, name))[0];
      if (latest && Date.now() - Date.parse(latest.at) < VERSION_GAP_MS) return null;
    }
    // two snapshots in the same millisecond must not overwrite each other: step the stamp forward
    const vdir = join(await jobDir(id), 'versions');
    let t = Date.now(), stamp = '', file = '';
    do { stamp = new Date(t++).toISOString().replace(/[:.]/g, '-'); file = join(vdir, `${name.slice(0, -3)}.${stamp}.md`); } while (await fs.exists(file));
    await copy(fs, p, file);
    return stamp;
  }
  /** Saves the document; the previous content becomes a version (at most one per 10 minutes unless forced). */
  async function saveDoc(id: string, name: string, body: string, meta?: Partial<DocMeta>, forceVersion = false) {
    const cur = await getDoc(id, name);
    if (cur.body !== body || forceVersion) await snapshot(id, name, forceVersion);
    await fs.write(await docPath(id, name), joinFrontmatter({ ...cur.meta, ...meta }, body));
    return getDoc(id, name);
  }
  async function getVersion(id: string, name: string, version: string) {
    const p = join(await jobDir(id), 'versions', safeName(`${safeName(name).slice(0, -3)}.${version}.md`));
    return splitFrontmatter(await fs.read(p)).body;
  }
  async function restoreVersion(id: string, name: string, version: string) {
    return saveDoc(id, name, await getVersion(id, name, version), undefined, true);
  }

  /* ---------- job extras + bucket ---------- */
  async function attachExtra(id: string, libraryName: string) {
    const job = await getJob(id);
    const dir = await jobDir(id);
    if (!job.extras.includes(libraryName)) {
      if (!(await fs.exists(join(dir, libraryName)))) await copy(fs, join(D.extras, safeName(libraryName)), join(dir, libraryName));
      job.extras.push(libraryName);
      job.bucket.push(libraryName);
    }
    return saveJob(job);
  }
  /** Detaching moves the job's copy into .removed/ rather than deleting it. */
  async function detachExtra(id: string, name: string) {
    const job = await getJob(id);
    const dir = await jobDir(id);
    const n = safeName(name);
    if (await fs.exists(join(dir, n))) {
      const ext = extname(n);
      await fs.move(join(dir, n), await uniquePath(fs, join(dir, '.removed'), basename(n, ext), ext));
    }
    job.extras = job.extras.filter(x => x !== n);
    job.bucket = job.bucket.filter(x => x !== n);
    return saveJob(job);
  }
  async function setBucket(id: string, order: string[]) {
    const job = await getJob(id);
    const known = new Set([...job.docs, ...job.extras]);
    job.bucket = [...new Set(order)].filter(n => known.has(n));
    return saveJob(job);
  }
  const jobFile = async (id: string, name: string) => fs.readBlob(join(await jobDir(id), safeName(name)));

  return {
    fs, ensureRoot, addStarters, getProfile, saveProfile,
    listTemplates, getTemplate, saveTemplate, createTemplate, trashTemplate, setMain, mainCv,
    listExtras, extraFile, addExtra,
    getJob, listJobs, createJob, updateJob, setStatus, trashJob, getPosting, savePosting,
    addDocFromTemplate, addDocFromExample, removeDoc, getDoc, saveDoc, listVersions, getVersion, restoreVersion,
    attachExtra, detachExtra, setBucket, jobFile,
  };
}
