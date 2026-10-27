import { join, type Fs } from './fs';

/*
  Backup = every file of the app's folder (profile, CVs and letters, extras, applications with their
  versions) in a zip. Restore adds and replaces files and never deletes; a file it would overwrite is first
  moved to .trash/restore-<time>/, so restoring can't destroy current work.
  A backup zip is untrusted input: only paths inside the app's own folders are accepted, and sizes are capped
  (a few KB of zip can unpack to gigabytes).
*/
const TOP = new Set(['profile', 'templates', 'extras', 'jobs']);
export const MARKER = 'easy-apply-backup.json';
export const LIMITS = { files: 20_000, bytes: 1024 * 1024 * 1024 }; // 1 GB unpacked

export async function collectFiles(fs: Fs, dir = ''): Promise<{ path: string; data: Blob }[]> {
  const out: { path: string; data: Blob }[] = [];
  for (const e of await fs.list(dir)) {
    const p = join(dir, e.name);
    if (!dir && !TOP.has(e.name)) continue; // .trash and anything else stays out
    if (e.kind === 'dir') out.push(...await collectFiles(fs, p));
    else out.push({ path: p, data: await fs.readBlob(p) });
  }
  return out;
}

/** a path from a backup, or null if it may not be restored */
export function safeBackupPath(raw: string): string | null {
  if (/\\|\0/.test(raw) || raw.startsWith('/') || /^[a-z]:/i.test(raw)) return null;
  const parts = raw.split('/').filter(Boolean);
  if (!parts.length || raw.endsWith('/')) return null;
  if (parts.some(p => p === '.' || p === '..' || p.startsWith('.') || /[<>:"|?*\u0000-\u001f]/.test(p))) return null;
  if (!TOP.has(parts[0]) || parts.length < 2) return null;
  return parts.join('/');
}

export interface RestorePlan { files: { path: string; data: Uint8Array }[]; skipped: string[]; bytes: number }

/** checks a backup's entries before anything is written */
export function planRestore(entries: Record<string, Uint8Array>): RestorePlan {
  const names = Object.keys(entries);
  if (names.length > LIMITS.files + 1) throw new Error(`This backup has too many files (${names.length}).`);
  const files: RestorePlan['files'] = []; const skipped: string[] = []; let bytes = 0;
  for (const n of names) {
    if (n === MARKER || n.endsWith('/')) continue;
    const p = safeBackupPath(n);
    if (!p) { skipped.push(n); continue; }
    bytes += entries[n].byteLength;
    if (bytes > LIMITS.bytes) throw new Error('This backup is too large to restore (over 1 GB unpacked).');
    files.push({ path: p, data: entries[n] });
  }
  if (!files.length) throw new Error('This file is not an Easy Apply backup (no profile, CVs, extras or applications in it).');
  return { files, skipped, bytes };
}

/** writes the plan; files that would be overwritten go to .trash/restore-<stamp>/ first */
export async function applyRestore(fs: Fs, plan: RestorePlan, stamp = new Date().toISOString().replace(/[:.]/g, '-')): Promise<{ written: number; replaced: number; savedTo: string }> {
  const savedTo = join('.trash', `restore-${stamp}`);
  let replaced = 0;
  for (const f of plan.files) {
    if (await fs.exists(f.path)) {
      const old = await fs.readBlob(f.path);
      if (old.size === f.data.byteLength && new Uint8Array(await old.arrayBuffer()).every((b, i) => b === f.data[i])) continue; // identical
      await fs.write(join(savedTo, f.path), old);
      replaced++;
    }
    await fs.write(f.path, new Blob([f.data as BlobPart]));
  }
  return { written: plan.files.length, replaced, savedTo };
}
