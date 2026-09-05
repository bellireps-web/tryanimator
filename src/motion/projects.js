/**
 * Saved motion compositions ("projects").
 *
 * Every finished motion job is snapshotted here: prompt, plan (with doc
 * ids), the rendered MP4 bytes, usage and chat history. Projects survive
 * reloads via IndexedDB; the module only talks to an injected store with
 * async { get, put, del, list } over full records, so it is unit-testable
 * with a plain Map (see projects.test.js).
 *
 * Notes:
 * - Authored doc HTML lives in the in-memory docs Map, NOT in the record:
 *   reopening an old comp plays its saved bytes instantly, but patching it
 *   re-authors scenes from their briefs (graceful, documented).
 * - Video bytes are embedded in the record (MP4s here are ~1MB per 5s).
 */

export function compId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `comp-${Date.now().toString(36)}-${rand}`;
}

/** Short display name derived from the prompt. Pure. */
export function compNameForPrompt(prompt) {
  const text = String(prompt || "").trim().replace(/\s+/g, " ");
  if (!text) return "Untitled";
  return text.length > 30 ? `${text.slice(0, 30)}…` : text;
}

function asVideoBytes(video) {
  if (video instanceof Uint8Array) return new Uint8Array(video);
  if (video && video.buffer instanceof ArrayBuffer) return new Uint8Array(video);
  if (Array.isArray(video)) return Uint8Array.from(video);
  return null;
}

/**
 * Build a comp record from a finished motion job. Pure (no I/O): pass the
 * chat history and composition version explicitly.
 */
export function buildCompRecord({ job, chat = [], version = 1, name, id, createdAt } = {}) {
  const result = (job && job.result) || {};
  const plan = result.plan || job.plan || null;
  const input = job.input || {};
  const now = Date.now();
  return {
    id: id || compId(),
    name: name || compNameForPrompt(input.prompt),
    prompt: String(input.prompt || ""),
    ratio: input.ratio || "9:16",
    durationSecs: Number.isFinite(plan && plan.duration) ? plan.duration : 0,
    createdAt: createdAt || now,
    updatedAt: now,
    version,
    input: JSON.parse(JSON.stringify(input || {})),
    plan: plan ? JSON.parse(JSON.stringify(plan)) : null,
    video: asVideoBytes(result.video),
    usage: result.usage ? { ...result.usage } : null,
    chat: Array.isArray(chat)
      ? chat.map((m) => ({
          kind: m.kind,
          text: String(m.text ?? ""),
          ...(m.thinking ? { thinking: String(m.thinking) } : {}),
          ...(m.trace ? { trace: String(m.trace) } : {}),
          ...(Array.isArray(m.steps) && m.steps.length
            ? { steps: m.steps.filter((s) => s && typeof s.state === "string").slice(0, 60).map((s) => ({ state: s.state, progress: Number(s.progress) || 0, at: Number(s.at) || 0 })) }
            : {}),
          ...(Array.isArray(m.ops) && m.ops.length ? { ops: m.ops.slice(0, 20) } : {}),
        }))
      : [],
  };
}

export class MotionProjects {
  constructor(store) {
    if (!store) throw new Error("MotionProjects needs a store");
    this.store = store;
  }

  async save(record) {
    if (!record || !record.id) throw new Error("record needs an id");
    await this.store.put(record);
    return record.id;
  }

  async list() {
    const records = (await this.store.list()) || [];
    return records.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  async get(id) {
    return (await this.store.get(id)) || null;
  }

  async update(id, patch = {}) {
    const current = await this.get(id);
    if (!current) throw new Error(`unknown comp: ${id}`);
    const next = { ...current, ...patch, id, updatedAt: Date.now() };
    await this.store.put(next);
    return next;
  }

  async remove(id) {
    await this.store.del(id);
  }
}

/**
 * Union two chat histories by (kind, text), preserving order. Two turns
 * racing on the same comp (two mounts, reload in between, two operators)
 * must never delete each other's messages: last-writer-wins on the whole
 * array loses turns, union keeps every turn. Pure.
 */
export function mergeChatTurn(existing, incoming) {
  const key = (m) => `${m && m.kind}\n${m && m.text}`;
  const seen = new Set((existing || []).map(key));
  return [...(existing || []), ...(incoming || []).filter((m) => !seen.has(key(m)))];
}

/**
 * Persist a finished patch turn over a possibly-stale record: re-read,
 * union chats, bump to at least the intended version. Returns the saved
 * record. Pure store logic (race-safe for messages; video bytes stay
 * last-writer-wins by design).
 */
export async function persistCompTurn(projects, compId, { version, plan, video, usage, chat }) {
  const current = await projects.get(compId);
  if (!current) throw new Error(`unknown comp: ${compId}`);
  return projects.update(compId, {
    version: Math.max((current.version || 0) + 1, version || 0),
    plan,
    video,
    usage,
    chat: mergeChatTurn(current.chat, chat),
  });
}

/**
 * IndexedDB project store (browser). Separate database from the blob cache
 * so comps never compete with render artifacts (and no migration needed).
 */
export function createIndexedDBProjectStore(dbName = "motion-projects") {
  let db = null;
  const open = () => {
    if (db) return Promise.resolve(db);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("comps")) {
          request.result.createObjectStore("comps", { keyPath: "id" });
        }
      };
      request.onsuccess = () => {
        db = request.result;
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    });
  };
  const tx = (mode, run) =>
    open().then(
      (database) =>
        new Promise((resolve, reject) => {
          const transaction = database.transaction("comps", mode);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          run(transaction.objectStore("comps"), resolve, reject);
        }),
    );
  return {
    async get(id) {
      const database = await open();
      return new Promise((resolve, reject) => {
        const request = database.transaction("comps", "readonly").objectStore("comps").get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    },
    async put(record) {
      await tx("readwrite", (store) => {
        store.put(record);
      });
    },
    async del(id) {
      await tx("readwrite", (store) => {
        store.delete(id);
      });
    },
    async list() {
      const database = await open();
      return new Promise((resolve, reject) => {
        const request = database.transaction("comps", "readonly").objectStore("comps").getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    },
  };
}

let sharedProjects = null;
/** Process-wide projects backed by IndexedDB (browser only). */
export function getMotionProjects() {
  if (!sharedProjects) {
    sharedProjects = new MotionProjects(createIndexedDBProjectStore());
  }
  return sharedProjects;
}
