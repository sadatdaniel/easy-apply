import { notFound, type Entry, type Fs } from '../../shared/fs';

/** The store's file interface in memory, so store logic is tested exactly as the browser runs it. */
export function memFs(): Fs & { files: Map<string, Blob>; failNextWrite?: Error } {
  const files = new Map<string, Blob>();
  const dirs = new Set<string>(['']);
  const norm = (p: string) => p.split('/').filter(Boolean).join('/');
  const parent = (p: string) => p.split('/').slice(0, -1).join('/');
  const ensureDirs = (p: string) => { for (let d = p; d; d = parent(d)) dirs.add(d); };
  const self: ReturnType<typeof memFs> = {
    label: 'memory',
    files,
    async read(p) { const b = files.get(norm(p)); if (!b) throw notFound(); return b.text(); },
    async readBlob(p) { const b = files.get(norm(p)); if (!b) throw notFound(); return b; },
    async write(p, data) {
      if (self.failNextWrite) { const e = self.failNextWrite; self.failNextWrite = undefined; throw e; }
      p = norm(p); ensureDirs(parent(p)); files.set(p, typeof data === 'string' ? new Blob([data]) : data);
    },
    async list(dir) {
      dir = norm(dir);
      if (!dirs.has(dir)) return [];
      const pre = dir ? dir + '/' : '';
      const out = new Map<string, Entry>();
      for (const d of dirs) if (d.startsWith(pre) && d !== dir && !d.slice(pre.length).includes('/')) out.set(d.slice(pre.length), { name: d.slice(pre.length), kind: 'dir', size: 0, mtime: 0 });
      for (const [f, b] of files) if (f.startsWith(pre) && !f.slice(pre.length).includes('/')) out.set(f.slice(pre.length), { name: f.slice(pre.length), kind: 'file', size: b.size, mtime: Date.now() });
      return [...out.values()];
    },
    async exists(p) { p = norm(p); return files.has(p) || dirs.has(p); },
    async mkdir(p) { ensureDirs(norm(p)); },
    async move(from, to) { const b = await self.readBlob(from); await self.write(to, b); files.delete(norm(from)); },
    async remove(p) {
      p = norm(p);
      files.delete(p); dirs.delete(p);
      for (const f of [...files.keys()]) if (f.startsWith(p + '/')) files.delete(f);
      for (const d of [...dirs]) if (d.startsWith(p + '/')) dirs.delete(d);
    },
  };
  return self;
}
