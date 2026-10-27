// A tiny key-value store in IndexedDB. It keeps what must not live in the documents folder:
// the folder handle itself, AI settings and keys, and app preferences.
let db: Promise<IDBDatabase> | null = null;

function open() {
  return db ??= new Promise((resolve, reject) => {
    const r = indexedDB.open('easy-cv', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const s = (await open()).transaction('kv', mode).objectStore('kv');
  return new Promise((resolve, reject) => { const r = fn(s); r.onsuccess = () => resolve(r.result as T); r.onerror = () => reject(r.error); });
}

export const kv = {
  get: <T>(key: string) => tx<T | undefined>('readonly', s => s.get(key)),
  set: (key: string, value: unknown) => tx<void>('readwrite', s => s.put(value, key)),
  del: (key: string) => tx<void>('readwrite', s => s.delete(key)),
};
