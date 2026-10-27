import { notFound, type Entry, type Fs } from '@shared/fs';

// Not in TypeScript's DOM types yet (File System Access API, Chrome/Edge).
declare global {
  interface FileSystemHandle {
    queryPermission(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
    requestPermission(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  }
  interface Window { showDirectoryPicker?(o?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: string }): Promise<FileSystemDirectoryHandle> }
}

const isNotFound = (e: unknown) => e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError');
const parts = (p: string) => p.split('/').filter(Boolean);

/** The store's file interface on a folder handle: a folder on disk the user picked, or the browser's private storage. */
export function browserFs(root: FileSystemDirectoryHandle, label: string): Fs {
  async function dir(path: string, create = false) {
    let d = root;
    for (const seg of parts(path)) d = await d.getDirectoryHandle(seg, { create });
    return d;
  }
  async function file(path: string, create = false) {
    const ps = parts(path);
    const name = ps.pop()!;
    return (await dir(ps.join('/'), create)).getFileHandle(name, { create });
  }
  async function getFile(path: string) {
    try { return await (await file(path)).getFile(); }
    catch (e) { if (isNotFound(e)) throw notFound(); throw e; }
  }

  const fs: Fs = {
    label,
    read: async p => (await getFile(p)).text(),
    readBlob: p => getFile(p),
    async write(p, data) {
      const w = await (await file(p, true)).createWritable();
      await w.write(data);
      await w.close(); // the browser swaps the file in only now, so a crash never leaves half a file
    },
    async list(path) {
      let d: FileSystemDirectoryHandle;
      try { d = await dir(path); } catch (e) { if (isNotFound(e)) return []; throw e; }
      const out: Entry[] = [];
      for await (const h of d.values()) {
        if (h.kind === 'directory') out.push({ name: h.name, kind: 'dir', size: 0, mtime: 0 });
        else { const f = await (h as FileSystemFileHandle).getFile(); out.push({ name: h.name, kind: 'file', size: f.size, mtime: f.lastModified }); }
      }
      return out;
    },
    async exists(p) {
      const ps = parts(p);
      const name = ps.pop();
      if (!name) return true;
      try {
        const d = await dir(ps.join('/'));
        for await (const k of d.keys()) if (k === name) return true;
        return false;
      } catch (e) { if (isNotFound(e)) return false; throw e; }
    },
    async mkdir(p) { await dir(p, true); },
    async remove(p) {
      const ps = parts(p);
      const name = ps.pop()!;
      try { await (await dir(ps.join('/'))).removeEntry(name, { recursive: true }); }
      catch (e) { if (!isNotFound(e)) throw e; }
    },
    async move(from, to) {
      await fs.write(to, await getFile(from));
      const ps = parts(from);
      const name = ps.pop()!;
      await (await dir(ps.join('/'))).removeEntry(name);
    },
  };
  return fs;
}
