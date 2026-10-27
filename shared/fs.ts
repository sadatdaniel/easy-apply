import YAML from 'yaml';

/*
  The store only talks to this small interface, so the same code runs on a folder the browser
  was given access to, on the browser's private storage, or on Node's fs (desktop app later).
  Paths are relative to the root folder and use "/".
*/
export interface Entry { name: string; kind: 'file' | 'dir'; size: number; mtime: number }

export interface Fs {
  /** a short label for where the files live, e.g. the folder name */
  label: string;
  read(path: string): Promise<string>;            // throws NotFound
  readBlob(path: string): Promise<Blob>;          // throws NotFound
  write(path: string, data: string | Blob): Promise<void>; // creates parent folders
  list(dir: string): Promise<Entry[]>;            // [] when the folder is missing
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  /** removes a file, or a folder with everything in it */
  remove(path: string): Promise<void>;
}

export const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
export const notFound = (what = 'File') => httpError(404, `${what} not found`);

export const join = (...parts: string[]) => parts.filter(Boolean).join('/').replace(/\/+/g, '/');
export const basename = (p: string, ext = '') => { const b = p.slice(p.lastIndexOf('/') + 1); return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b; };
export const dirname = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf('/')));
export const extname = (p: string) => { const b = basename(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; };

export async function readJson<T>(fs: Fs, p: string, fallback: T): Promise<T> {
  try { return JSON.parse(await fs.read(p)) as T; } catch { return fallback; }
}
export const writeJson = (fs: Fs, p: string, data: unknown) => fs.write(p, JSON.stringify(data, null, 2) + '\n');

export async function copy(fs: Fs, from: string, to: string) { await fs.write(to, await fs.readBlob(from)); }

/** copies a folder with everything in it */
export async function copyTree(fs: Fs, from: string, to: string) {
  await fs.mkdir(to);
  for (const e of await fs.list(from))
    e.kind === 'dir' ? await copyTree(fs, join(from, e.name), join(to, e.name)) : await copy(fs, join(from, e.name), join(to, e.name));
}

/** Markdown file with optional YAML frontmatter. */
export function splitFrontmatter(text: string): { meta: Record<string, unknown>; body: string } {
  const m = text.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  return { meta: (YAML.parse(m[1]) as Record<string, unknown>) ?? {}, body: m[2].replace(/^(\r?\n)+/, '') };
}

export function joinFrontmatter(meta: Record<string, unknown>, body: string) {
  meta = Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined));
  return `---\n${YAML.stringify(meta).trimEnd()}\n---\n\n${body.replace(/^\n+/, '')}`;
}

export function slugify(s: string, max = 40) {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, max).replace(/-$/, '') || 'untitled';
}

/** Only plain file names inside a folder — never paths. */
export function safeName(name: string) {
  if (!name || /[/\\]/.test(name) || name.startsWith('.') || name === '..') throw httpError(400, 'Invalid file name');
  return name;
}

/**
  A name typed or uploaded by the user, made safe as a file name on every system: no path parts,
  none of < > : " / \ | ? * or control characters, no trailing dots/spaces, no Windows device names.
*/
export function cleanFileName(name: string, fallback = 'file') {
  const ext = (name.match(/\.[A-Za-z0-9]{1,8}$/)?.[0] ?? '').toLowerCase();
  let base = name.slice(0, name.length - ext.length)
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').replace(/\s+/g, ' ').slice(0, 100);
  if (!base) base = fallback;
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) base = '_' + base;
  return base + ext;
}

export async function uniquePath(fs: Fs, dir: string, base: string, ext: string) {
  let p = join(dir, base + ext), n = 2;
  while (await fs.exists(p)) p = join(dir, `${base}-${n++}${ext}`);
  return p;
}
