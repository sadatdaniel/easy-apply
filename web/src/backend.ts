import { createStore, type Store } from '@shared/store';
import { browserFs } from './fs-browser';
import { kv } from './idb';

/*
  Where the documents live, remembered in IndexedDB:
  - folder:  a folder on disk the user picked (Chrome, Edge). The browser asks again for access
             after a restart unless the user chose "allow on every visit".
  - browser: the browser's private storage (works everywhere, but files are only reachable through the app).
*/
type Saved = { kind: 'folder'; handle: FileSystemDirectoryHandle } | { kind: 'browser' };
export type Conn =
  | { status: 'none' }
  | { status: 'locked'; name: string }              // folder known, permission needed (one click)
  | { status: 'ready'; kind: Saved['kind']; label: string };

export const canPickFolder = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
/** Brave has folder access too, but switched off by default (brave://flags/#file-system-access-api) */
export const isBrave = typeof navigator !== 'undefined' && 'brave' in navigator;

let store: Store | null = null;

export function current(): Store {
  if (!store) throw new Error('No folder connected.');
  return store;
}

async function open(saved: Saved): Promise<Conn> {
  if (saved.kind === 'folder') {
    store = createStore(browserFs(saved.handle, saved.handle.name));
  } else {
    const root = await navigator.storage.getDirectory();
    await navigator.storage.persist?.(); // ask the browser not to evict it under storage pressure
    store = createStore(browserFs(await root.getDirectoryHandle('easy-cv', { create: true }), 'this browser'));
  }
  await store.ensureRoot();
  return { status: 'ready', kind: saved.kind, label: store.fs.label };
}

/** On start: reopen what was used last time, if the browser still allows it. */
export async function connect(): Promise<Conn> {
  const saved = await kv.get<Saved>('root');
  if (!saved) return { status: 'none' };
  if (saved.kind === 'folder' && (await saved.handle.queryPermission({ mode: 'readwrite' })) !== 'granted')
    return { status: 'locked', name: saved.handle.name };
  return open(saved);
}

/** Must run from a click: asks for access to the folder used last time. */
export async function unlock(): Promise<Conn> {
  const saved = await kv.get<Saved>('root');
  if (saved?.kind !== 'folder') return connect();
  if ((await saved.handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return { status: 'locked', name: saved.handle.name };
  return open(saved);
}

/** Must run from a click. Returns null when the user cancels the picker. */
export async function pickFolder(): Promise<Conn | null> {
  let handle: FileSystemDirectoryHandle;
  try { handle = await window.showDirectoryPicker!({ id: 'easy-cv-root', mode: 'readwrite', startIn: 'documents' }); }
  catch (e) { if ((e as DOMException).name === 'AbortError') return null; throw e; }
  const saved: Saved = { kind: 'folder', handle };
  await kv.set('root', saved);
  return open(saved);
}

export async function useBrowserStorage(): Promise<Conn> {
  const saved: Saved = { kind: 'browser' };
  await kv.set('root', saved);
  return open(saved);
}
