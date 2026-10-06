// Persistance locale (IndexedDB) : tournois, configurations, jeux de positions, analyses.
// Tout est exportable / importable en JSON pour la reproductibilité.

const DB_NAME = 'chess-truk-lab';
const DB_VERSION = 1;
export const STORES = ['tournaments', 'configs', 'datasets', 'datasetRuns', 'analyses'] as const;
export type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

export function putItem<T extends { id: string }>(store: StoreName, item: T): Promise<void> {
  return tx<IDBValidKey>(store, 'readwrite', (s) => s.put(JSON.parse(JSON.stringify(item)))).then(() => undefined);
}

export function getItem<T>(store: StoreName, id: string): Promise<T | undefined> {
  return tx<T | undefined>(store, 'readonly', (s) => s.get(id));
}

export function listItems<T>(store: StoreName): Promise<T[]> {
  return tx<T[]>(store, 'readonly', (s) => s.getAll());
}

export function deleteItem(store: StoreName, id: string): Promise<void> {
  return tx<undefined>(store, 'readwrite', (s) => s.delete(id)).then(() => undefined);
}

export interface ExportBundle {
  format: 'chess-truk-lab-export';
  version: 1;
  exportedAt: string;
  data: Partial<Record<StoreName, unknown[]>>;
}

export async function exportAll(): Promise<ExportBundle> {
  const data: Partial<Record<StoreName, unknown[]>> = {};
  for (const s of STORES) data[s] = await listItems(s);
  return { format: 'chess-truk-lab-export', version: 1, exportedAt: new Date().toISOString(), data };
}

export async function importBundle(bundle: ExportBundle): Promise<number> {
  if (bundle?.format !== 'chess-truk-lab-export') throw new Error('Fichier d’export non reconnu.');
  let n = 0;
  for (const s of STORES) {
    for (const item of bundle.data[s] ?? []) {
      if (item && typeof item === 'object' && 'id' in item) {
        await putItem(s, item as { id: string });
        n++;
      }
    }
  }
  return n;
}

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFileText(file: File): Promise<string> {
  return file.text();
}
