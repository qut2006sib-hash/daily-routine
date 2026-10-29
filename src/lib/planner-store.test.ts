import test from "node:test";
import assert from "node:assert/strict";
import type { Completion, TaskInput } from "./planner-types.ts";
import { createEmptyPlanner, occurrenceKey } from "./planner.ts";
import { createPlannerStore, LEGACY_STORAGE_KEY, PLANNER_STORAGE_KEY, type PlannerStorage } from "./planner-store.ts";

const today = "2026-10-29", now = new Date(2026, 9, 29, 12);
const input: TaskInput = { title: "Study", notes: "Arrays", date: today, time: "18:00", durationMinutes: 30, repeat: "daily", reminder: true };
function fixture(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  let failRead = false, failWrite = false, ids = 0;
  const storage: PlannerStorage = {
    getItem(key) { if (failRead) throw new Error("Read blocked"); return values.get(key) ?? null; },
    setItem(key, value) { if (failWrite) throw Object.assign(new Error("Full"), { name: "QuotaExceededError" }); values.set(key, value); },
  };
  const store = createPlannerStore({ storage, now: () => now, createId: () => `generated-${++ids}` });
  return { store, values, failRead: () => { failRead = true; }, failWrite: (value: boolean) => { failWrite = value; } };
}

test("empty hydrated store has no fake data and persists before subscribers observe changes", () => {
  const { store, values } = fixture(); store.getState().hydrate();
  assert.equal(store.getState().hydrated, true);
  assert.equal(store.getState().data.tasks.length, 0);
  store.subscribe((state) => {
    assert.deepEqual(JSON.parse(values.get(PLANNER_STORAGE_KEY)!), state.data);
  });
  const id = store.getState().addTask(input);
  assert.equal(id, "generated-1");
});

test("failed writes leave both previous bytes and visible saved state unchanged", () => {
  const f = fixture(); f.store.getState().hydrate(); f.store.getState().addTask(input);
  const oldData = f.store.getState().data, bytes = f.values.get(PLANNER_STORAGE_KEY);
  f.failWrite(true);
  assert.throws(() => f.store.getState().saveNote(today, "Not saved"), /storage is full/);
  assert.equal(f.store.getState().data, oldData);
  assert.equal(f.values.get(PLANNER_STORAGE_KEY), bytes);
  assert.match(f.store.getState().storageError!, /storage is full/);
  f.failWrite(false); f.store.getState().saveNote(today, "Saved now");
  assert.equal(f.store.getState().storageError, null);
});

test("unreadable saved data is never replaced with an empty planner", () => {
  const broken = '{"version":2,"tasks":';
  const f = fixture({ [PLANNER_STORAGE_KEY]: broken }); f.store.getState().hydrate();
  assert.equal(f.values.get(PLANNER_STORAGE_KEY), broken);
  assert.match(f.store.getState().storageError!, /not replaced/);
  assert.throws(() => f.store.getState().addTask(input), /could not be read/);
  assert.throws(() => f.store.getState().exportBackup(), /could not be loaded/);
});

test("storage access denied is visible and does not silently reset existing data", () => {
  const f = fixture({ [PLANNER_STORAGE_KEY]: "saved bytes" }); f.failRead(); f.store.getState().hydrate();
  assert.equal(f.values.get(PLANNER_STORAGE_KEY), "saved bytes");
  assert.match(f.store.getState().storageError!, /Read blocked/);
});

test("legacy migration writes v2 once and preserves exact v1 bytes", () => {
  const original = JSON.stringify({ state: { habits: [{ id: "legacy", title: "Walk", period: "morning", time: "07:00" }], done: { [today]: ["legacy"] }, theme: "dark" } });
  const f = fixture({ [LEGACY_STORAGE_KEY]: original }); f.store.getState().hydrate();
  assert.equal(f.values.get(LEGACY_STORAGE_KEY), original);
  assert.equal(f.store.getState().data.completions[`legacy@${today}`]?.completedAt, null);
  assert.ok(f.values.get(PLANNER_STORAGE_KEY));
  f.store.getState().hydrate();
  assert.equal(f.store.getState().data.tasks.length, 1);
});

test("failed migration save retains v1 and blocks unpersisted modifications", () => {
  const original = JSON.stringify({ habits: [], done: {}, theme: "light" });
  const f = fixture({ [LEGACY_STORAGE_KEY]: original }); f.failWrite(true); f.store.getState().hydrate();
  assert.equal(f.values.get(LEGACY_STORAGE_KEY), original);
  assert.equal(f.values.has(PLANNER_STORAGE_KEY), false);
  assert.ok(f.store.getState().storageError);
  assert.throws(() => f.store.getState().addTask(input));
});

test("existing v2 always wins over v1 and keeps its generation", () => {
  const data = createEmptyPlanner("current-dataset");
  const f = fixture({ [PLANNER_STORAGE_KEY]: JSON.stringify(data), [LEGACY_STORAGE_KEY]: "invalid legacy bytes" });
  f.store.getState().hydrate();
  assert.equal(f.store.getState().data.generation, "current-dataset");
  assert.equal(f.store.getState().storageError, null);
});

test("successful restore atomically replaces data and commits a fresh generation", () => {
  const f = fixture(); f.store.getState().hydrate(); f.store.getState().addTask(input);
  const previous = f.store.getState().data.generation;
  const restored = createEmptyPlanner("backup-dataset"); restored.settings.theme = "dark";
  f.store.getState().restoreBackup(JSON.stringify(restored));
  const result = f.store.getState().data;
  assert.notEqual(result.generation, previous);
  assert.notEqual(result.generation, restored.generation);
  assert.equal(result.tasks.length, 0);
  assert.equal(result.settings.theme, "dark");
  assert.equal(JSON.parse(f.values.get(PLANNER_STORAGE_KEY)!).generation, result.generation);
});

test("invalid or unsavable restore keeps old data, bytes and generation", () => {
  const f = fixture(); f.store.getState().hydrate(); f.store.getState().addTask(input);
  const previous = f.store.getState().data, bytes = f.values.get(PLANNER_STORAGE_KEY);
  assert.throws(() => f.store.getState().restoreBackup('{"version":999}'));
  assert.equal(f.store.getState().data, previous);
  assert.equal(f.values.get(PLANNER_STORAGE_KEY), bytes);
  f.failWrite(true);
  assert.throws(() => f.store.getState().restoreBackup(JSON.stringify(createEmptyPlanner())));
  assert.equal(f.store.getState().data.generation, previous.generation);
  assert.equal(f.values.get(PLANNER_STORAGE_KEY), bytes);
});

test("a valid restore can recover after corrupted saved data", () => {
  const f = fixture({ [PLANNER_STORAGE_KEY]: "broken" }); f.store.getState().hydrate();
  f.store.getState().restoreBackup(JSON.stringify(createEmptyPlanner()));
  f.store.getState().addTask(input);
  assert.equal(f.store.getState().data.tasks.length, 1);
  assert.equal(f.store.getState().storageError, null);
});

test("actual activity and notes round-trip through a freshly hydrated store", () => {
  const f = fixture(); f.store.getState().hydrate();
  f.store.getState().addActivity({ title: "TrafficTrack", date: today, minutes: 70, notes: "Camera review" });
  f.store.getState().saveNote(today, "Try the short clip tomorrow");
  const next = createPlannerStore({ storage: { getItem: (key) => f.values.get(key) ?? null, setItem: (key, value) => { f.values.set(key, value); } } });
  next.getState().hydrate();
  assert.equal(next.getState().data.activities[0]?.minutes, 70);
  assert.equal(next.getState().data.notes[today]?.text, "Try the short clip tomorrow");
  assert.deepEqual(JSON.parse(next.getState().exportBackup()), next.getState().data);
});

test("idempotent completion never toggles a replayed Done back off", () => {
  const f = fixture(); f.store.getState().hydrate(); const id = f.store.getState().addTask(input);
  f.store.getState().completeTask(id, today, now.toISOString());
  f.store.getState().completeTask(id, today, now.toISOString());
  assert.equal(Object.keys(f.store.getState().data.completions).length, 1);
  f.store.getState().toggleComplete(id, today);
  assert.equal(Object.keys(f.store.getState().data.completions).length, 0);
});

test("archived native Done is persisted before ACK eligibility and rejects old generation", () => {
  const f = fixture(); f.store.getState().hydrate(); const id = f.store.getState().addTask(input);
  const generation = f.store.getState().data.generation;
  f.store.getState().archiveTask(id);
  const snapshot: Completion = { taskId: id, date: today, title: "Phone title", scheduledTime: "18:00", completedAt: now.toISOString() };
  f.failWrite(true);
  assert.throws(() => f.store.getState().importNativeCompletion(snapshot, generation));
  assert.equal(f.store.getState().data.completions[occurrenceKey(id, today)], undefined);
  f.failWrite(false); f.store.getState().importNativeCompletion(snapshot, generation);
  const bytes = f.values.get(PLANNER_STORAGE_KEY);
  f.store.getState().importNativeCompletion(snapshot, generation);
  assert.equal(f.values.get(PLANNER_STORAGE_KEY), bytes);
  assert.equal(JSON.parse(bytes!).completions[occurrenceKey(id, today)].title, "Phone title");
  assert.throws(() => f.store.getState().importNativeCompletion(snapshot, "old-generation"), /previous/);
});

test("restore generation remains fresh even when the injected ID generator repeats", () => {
  const data = createEmptyPlanner("same-generation"), values = new Map([[PLANNER_STORAGE_KEY, JSON.stringify(data)]]);
  const store = createPlannerStore({ storage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } }, now: () => now, createId: () => "same-generation" });
  store.getState().hydrate(); store.getState().restoreBackup(JSON.stringify(data));
  assert.notEqual(store.getState().data.generation, data.generation);
});
