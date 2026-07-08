// 课堂本地存储（IndexedDB）：候课预载的课件 blob + 待回传事件 outbox + seq 水位。
// IndexedDB 在非安全上下文（局域网 HTTP）可用，这是离线课的存储底座。

const DB_NAME = "mathin-classroom";
const DB_VERSION = 1;

export const STORE_ASSETS = "assets"; // key = storage path, value = Blob
export const STORE_OUTBOX = "outbox"; // key = event id, value = SessionEvent 行；索引 sessionId
export const STORE_META = "meta";     // key = `${sessionId}:${deviceId}`, value = 最后 seq

let dbPromise: Promise<IDBDatabase> | null = null;

export function openClassroomDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_ASSETS)) db.createObjectStore(STORE_ASSETS);
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        const outbox = db.createObjectStore(STORE_OUTBOX);
        outbox.createIndex("sessionId", "sessionId", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error("IDB_OPEN_FAILED"));
    };
  });
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IDB_REQUEST_FAILED"));
  });
}

export async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openClassroomDb();
  return requestToPromise(db.transaction(store, "readonly").objectStore(store).get(key));
}

export async function idbPut(store: string, key: string, value: unknown): Promise<void> {
  const db = await openClassroomDb();
  await requestToPromise(db.transaction(store, "readwrite").objectStore(store).put(value, key));
}

export async function idbDelete(store: string, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const db = await openClassroomDb();
  const tx = db.transaction(store, "readwrite");
  const objectStore = tx.objectStore(store);
  await Promise.all(keys.map((key) => requestToPromise(objectStore.delete(key))));
}

export async function idbListByIndex<T>(store: string, index: string, value: string): Promise<T[]> {
  const db = await openClassroomDb();
  const idx = db.transaction(store, "readonly").objectStore(store).index(index);
  return requestToPromise(idx.getAll(value) as IDBRequest<T[]>);
}
