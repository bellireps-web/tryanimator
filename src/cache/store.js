/**
 * Content-addressed blob cache with LRU eviction (Slice 3).
 *
 * MotionCache holds no storage itself: every backend implements
 * { get, put, del, list }. MemoryBackend is used in tests; IndexedDBBackend
 * is the browser backend (needs a real browser to verify — pending).
 * Eviction is by tracked byte size against quotaBytes (default 500MB).
 */

export class MemoryBackend {
  constructor() {
    this.entries = new Map();
  }

  async get(key) {
    return this.entries.get(key) || null;
  }

  async put(entry) {
    this.entries.set(entry.key, { ...entry });
  }

  async del(key) {
    this.entries.delete(key);
  }

  async list() {
    return [...this.entries.values()].map(({ key, bytes, at }) => ({ key, bytes, at }));
  }
}

export class IndexedDBBackend {
  constructor(dbName = "motion-cache") {
    this.dbName = dbName;
    this.db = null;
  }

  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("blobs", { keyPath: "key" });
      };
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
      request.onerror = () => reject(request.error);
    });
  }

  request(storeName, mode, run) {
    return this.open().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, mode);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          run(tx.objectStore(storeName), resolve, reject);
        }),
    );
  }

  get(key) {
    return this.open().then(
      (db) =>
        new Promise((resolve, reject) => {
          const request = db.transaction("blobs", "readonly").objectStore("blobs").get(key);
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error);
        }),
    );
  }

  put(entry) {
    return this.request("blobs", "readwrite", (store) => {
      store.put({ ...entry });
    });
  }

  del(key) {
    return this.request("blobs", "readwrite", (store) => {
      store.delete(key);
    });
  }

  list() {
    return this.open().then(
      (db) =>
        new Promise((resolve, reject) => {
          const items = [];
          const tx = db.transaction("blobs", "readonly");
          tx.oncomplete = () => resolve(items);
          tx.onerror = () => reject(tx.error);
          const cursor = tx.objectStore("blobs").openCursor();
          cursor.onsuccess = () => {
            const current = cursor.result;
            if (!current) return;
            const { key, bytes, at } = current.value;
            items.push({ key, bytes, at });
            current.continue();
          };
        }),
    );
  }
}

export class MotionCache {
  constructor(backend, { quotaBytes = 500_000_000 } = {}) {
    this.backend = backend;
    this.quotaBytes = quotaBytes;
  }

  /** Fetch a blob and refresh its recency. Returns null on miss. */
  async get(key) {
    const entry = await this.backend.get(key);
    if (!entry) return null;
    await this.backend.put({ ...entry, at: Date.now() });
    return entry.blob;
  }

  /** Store a blob, evicting least-recently-used entries until it fits. */
  async put(key, blob, bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) {
      throw new Error("bytes must be a non-negative number");
    }
    const existing = await this.backend.get(key);
    if (existing) await this.backend.del(key);
    const entries = await this.backend.list();
    let used = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    const lru = entries.sort((a, b) => a.at - b.at);
    for (const entry of lru) {
      if (used + bytes <= this.quotaBytes) break;
      await this.backend.del(entry.key);
      used -= entry.bytes;
    }
    // A single blob larger than quota still stores (evicts everything else).
    await this.backend.put({ key, blob, bytes, at: Date.now() });
  }

  async invalidate(key) {
    await this.backend.del(key);
  }
}
