import test from "node:test";
import assert from "node:assert/strict";
import { compId, compNameForPrompt, buildCompRecord, mergeChatTurn, persistCompTurn, MotionProjects } from "./projects.js";

function memStore() {
  const map = new Map();
  return {
    map,
    async get(id) {
      return map.get(id) || null;
    },
    async put(record) {
      map.set(record.id, record);
    },
    async del(id) {
      map.delete(id);
    },
    async list() {
      return [...map.values()];
    },
  };
}

function finishedJob(overrides = {}) {
  return {
    id: "motion-test",
    type: "motion",
    state: "done",
    progress: 1,
    input: { prompt: "  gato astronauta en la luna  ", ratio: "9:16", duration: 5, seed: 7 },
    result: {
      plan: { duration: 5, scenes: [{ duration_secs: 5 }], seed: 7 },
      video: new Uint8Array([1, 2, 3]),
      usage: { prompt_tokens: 1, completion_tokens: 2, reasoning_tokens: 0 },
    },
    error: null,
    ...overrides,
  };
}

test("compNameForPrompt trims and truncates", () => {
  assert.equal(compNameForPrompt("  hola mundo  "), "hola mundo");
  assert.equal(compNameForPrompt(""), "Untitled");
  assert.equal(compNameForPrompt("x".repeat(50)), `${"x".repeat(30)}…`);
  assert.ok(compId().startsWith("comp-"));
});

test("buildCompRecord snapshots job, chat and version", () => {
  const record = buildCompRecord({
    job: finishedJob(),
    chat: [{ kind: "user", text: "hola" }],
    version: 3,
  });
  assert.ok(record.id.startsWith("comp-"));
  assert.equal(record.name, "gato astronauta en la luna");
  assert.equal(record.prompt, "  gato astronauta en la luna  ");
  assert.equal(record.ratio, "9:16");
  assert.equal(record.durationSecs, 5);
  assert.equal(record.version, 3);
  assert.deepEqual([...record.video], [1, 2, 3]);
  assert.deepEqual(record.chat, [{ kind: "user", text: "hola" }]);
  assert.ok(record.createdAt > 0 && record.updatedAt >= record.createdAt);
});

test("buildCompRecord keeps steps and ops for the activity feed", () => {
  const record = buildCompRecord({
    job: finishedJob(),
    chat: [{ kind: "ai", text: "Listo.", thinking: "t", trace: "v2", steps: [{ state: "rendering", progress: 50, at: 1 }, { nope: 1 }], ops: [{ op: "set_seed", seed: 5 }] }],
    version: 2,
  });
  assert.deepEqual(record.chat[0].steps, [{ state: "rendering", progress: 50, at: 1 }]);
  assert.deepEqual(record.chat[0].ops, [{ op: "set_seed", seed: 5 }]);
});

test("mergeChatTurn unions concurrent turns without losing any", () => {
  const base = [
    { kind: "user", text: "hola" },
    { kind: "ai", text: "Listo v1." },
  ];
  const turnA = [...base, { kind: "user", text: "más brillo" }, { kind: "ai", text: "Brillo subido." }];
  const turnB = [...base, { kind: "user", text: "más contraste" }, { kind: "ai", text: "Contraste subido." }];
  const merged = mergeChatTurn(turnA, turnB);
  assert.deepEqual(merged.map((m) => m.text), ["hola", "Listo v1.", "más brillo", "Brillo subido.", "más contraste", "Contraste subido."]);
  assert.deepEqual(mergeChatTurn(base, base), base);
  assert.deepEqual(mergeChatTurn(null, turnA), turnA);
});

test("persistCompTurn merges chat and bumps version monotonically", async () => {
  const projects = new MotionProjects(memStore());
  const record = buildCompRecord({ job: finishedJob(), version: 1 });
  await projects.save(record);
  const turnA = [...record.chat, { kind: "user", text: "A" }, { kind: "ai", text: "a-hecho" }];
  const turnB = [...record.chat, { kind: "user", text: "B" }, { kind: "ai", text: "b-hecho" }];
  const savedA = await persistCompTurn(projects, record.id, { version: 2, plan: record.plan, video: record.video, usage: null, chat: turnA });
  assert.equal(savedA.version, 2);
  // Stale writer based on v1 still lands on v3 with the full union.
  const savedB = await persistCompTurn(projects, record.id, { version: 2, plan: record.plan, video: record.video, usage: null, chat: turnB });
  assert.equal(savedB.version, 3);
  assert.deepEqual(savedB.chat.map((m) => m.text), [...record.chat.map((m) => m.text), "A", "a-hecho", "B", "b-hecho"]);
  await assert.rejects(persistCompTurn(projects, "missing", { version: 1, chat: [] }), /unknown comp/);
});

test("MotionProjects saves, lists newest-first, updates and removes", async () => {
  const projects = new MotionProjects(memStore());
  const a = buildCompRecord({ job: finishedJob(), version: 1 });
  await new Promise((r) => setTimeout(r, 2));
  const b = buildCompRecord({ job: finishedJob(), version: 1 });
  await projects.save(a);
  await projects.save(b);
  assert.deepEqual((await projects.list()).map((r) => r.id), [b.id, a.id]);

  const updated = await projects.update(a.id, { version: 2, name: "renamed" });
  assert.equal(updated.version, 2);
  assert.equal(updated.name, "renamed");
  assert.equal((await projects.get(a.id)).version, 2);
  assert.deepEqual((await projects.list()).map((r) => r.id), [a.id, b.id], "update bumps recency");

  await projects.remove(b.id);
  assert.equal(await projects.get(b.id), null);
  assert.equal((await projects.list()).length, 1);

  await assert.rejects(projects.save({}), /needs an id/);
  await assert.rejects(projects.update("missing", {}), /unknown comp/);
  assert.throws(() => new MotionProjects(null), /needs a store/);
});
