import test from "node:test";
import assert from "node:assert/strict";
import type { Completion, TaskInput } from "./planner-types.ts";
import { addLocalDays, addPlannerActivity, addPlannerTask, archivePlannerTask, completePlannerTask, createEmptyPlanner, getDayTasks, importPlannerNativeCompletion, isDateKey, localDateKey, MAX_BACKUP_BYTES, migrateLegacyRoutine, occurrenceKey, parsePlannerBackup, togglePlannerCompletion, updatePlannerTask, validatePlannerData, validateTaskInput } from "./planner.ts";

const today = "2026-10-29";
const now = new Date(2026, 9, 29, 12);
const input: TaskInput = { title: "Study NumPy", notes: "Broadcasting", date: today, time: "18:00", durationMinutes: 45, repeat: "daily", reminder: true };
const plan = () => addPlannerTask(createEmptyPlanner("dataset-original"), input, "task-1", now);

test("new planner is empty and has a durable generation", () => {
  const data = createEmptyPlanner();
  assert.match(data.generation, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.deepEqual(data.tasks, []);
  assert.deepEqual(data.activities, []);
  assert.equal(data.settings.remindersEnabled, false);
});

test("calendar validation rejects impossible dates and time values", () => {
  assert.equal(isDateKey("2024-02-29"), true);
  for (const day of ["2026-02-29", "2026-04-31", "2026-13-01", "1969-12-31", "2026-1-2"]) assert.equal(isDateKey(day), false);
  assert.throws(() => validateTaskInput({ ...input, time: "24:00" }));
  assert.throws(() => validateTaskInput({ ...input, time: "", reminder: true }));
  assert.throws(() => validateTaskInput({ ...input, durationMinutes: NaN }));
});

test("local date keys and date arithmetic do not use UTC midnight", () => {
  const original = process.env.TZ;
  try {
    process.env.TZ = "Asia/Damascus";
    assert.equal(localDateKey(new Date("2026-10-28T22:30:00.000Z")), today);
    assert.equal(addLocalDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addLocalDays("2024-02-28", 1), "2024-02-29");
    process.env.TZ = "America/New_York";
    assert.equal(addLocalDays("2026-03-08", 1), "2026-03-09");
  } finally {
    if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
  }
});

test("dated one-off tasks appear only once and future tasks do not appear early", () => {
  const data = addPlannerTask(createEmptyPlanner(), { ...input, repeat: "none", date: "2026-10-31" }, "once", now);
  assert.equal(getDayTasks(data.tasks, today).length, 0);
  assert.equal(getDayTasks(data.tasks, "2026-10-31").length, 1);
  assert.equal(getDayTasks(data.tasks, "2026-11-01").length, 0);
});

test("daily, weekday and weekly recurrence stay anchored to local dates", () => {
  let data = plan();
  data = addPlannerTask(data, { ...input, repeat: "weekdays" }, "workdays", now);
  data = addPlannerTask(data, { ...input, repeat: "weekly" }, "weekly", now);
  assert.deepEqual(getDayTasks(data.tasks, "2026-10-31").map((task) => task.id), ["task-1"]);
  assert.equal(getDayTasks(data.tasks, "2026-11-02").length, 2);
  assert.equal(getDayTasks(data.tasks, "2026-11-05").length, 3);
});

test("day schedules sort timed tasks before untimed tasks", () => {
  let data = plan();
  data = addPlannerTask(data, { ...input, title: "Walk", time: "07:00" }, "early", now);
  data = addPlannerTask(data, { ...input, title: "Read", time: "", reminder: false }, "anytime", now);
  assert.deepEqual(getDayTasks(data.tasks, today).map((task) => task.id), ["early", "task-1", "anytime"]);
});

test("later edits preserve earlier planned title, time and denominator", () => {
  const data = plan();
  const tomorrow = new Date(2026, 9, 30, 12);
  const changed = updatePlannerTask(data, "task-1", { ...input, title: "Study arrays", time: "19:00" }, tomorrow);
  assert.equal(getDayTasks(changed.tasks, today)[0]?.title, "Study NumPy");
  assert.equal(getDayTasks(changed.tasks, today)[0]?.time, "18:00");
  assert.equal(getDayTasks(changed.tasks, "2026-10-30")[0]?.title, "Study arrays");
  assert.equal(changed.tasks[0]?.revisions.length, 2);
});

test("same-day edits replace one revision, and archive preserves earlier days", () => {
  let data = updatePlannerTask(plan(), "task-1", { ...input, title: "Edited today" }, now);
  assert.equal(data.tasks[0]?.revisions.length, 1);
  data = archivePlannerTask(data, "task-1", new Date(2026, 9, 30, 12));
  assert.equal(getDayTasks(data.tasks, today).length, 1);
  assert.equal(getDayTasks(data.tasks, "2026-10-30").length, 0);
});

test("completion snapshots survive later edits and archives", () => {
  let data = completePlannerTask(plan(), "task-1", today, now);
  data = updatePlannerTask(data, "task-1", { ...input, title: "Changed title" }, now);
  data = archivePlannerTask(data, "task-1", now);
  assert.equal(data.completions[occurrenceKey("task-1", today)]?.title, "Study NumPy");
  assert.equal(data.completions[occurrenceKey("task-1", today)]?.completedAt, now.toISOString());
});

test("completion replay is idempotent while an explicit toggle can undo", () => {
  const first = completePlannerTask(plan(), "task-1", today, now);
  assert.equal(completePlannerTask(first, "task-1", today, now), first);
  assert.deepEqual(togglePlannerCompletion(first, "task-1", today, now).completions, {});
});

test("past new tasks and future actual work are rejected", () => {
  assert.throws(() => addPlannerTask(createEmptyPlanner(), { ...input, date: "2026-10-28" }, "past", now), /past/);
  assert.throws(() => completePlannerTask(plan(), "task-1", "2026-10-30", now), /future/);
  assert.throws(() => addPlannerActivity(createEmptyPlanner(), { title: "Worked", date: "2026-10-30", minutes: 20, notes: "" }, "activity", now), /future/);
});

test("native Done snapshot imports after same-day archive and remains immutable", () => {
  const data = archivePlannerTask(plan(), "task-1", now);
  const snapshot: Completion = { taskId: "task-1", date: today, title: "Original phone title", scheduledTime: "18:00", completedAt: now.toISOString() };
  const next = importPlannerNativeCompletion(data, snapshot, data.generation, now);
  assert.deepEqual(next.completions[occurrenceKey("task-1", today)], snapshot);
  assert.equal(importPlannerNativeCompletion(next, { ...snapshot, title: "Repeated later" }, data.generation, now), next);
});

test("native Done rejects old dataset, unknown task and fabricated unknown timestamp", () => {
  const data = plan();
  const snapshot: Completion = { taskId: "task-1", date: today, title: "Study", scheduledTime: "18:00", completedAt: now.toISOString() };
  assert.throws(() => importPlannerNativeCompletion(data, snapshot, "previous-dataset", now), /previous/);
  assert.throws(() => importPlannerNativeCompletion(data, { ...snapshot, taskId: "missing" }, data.generation, now), /unknown/);
  assert.throws(() => importPlannerNativeCompletion(data, { ...snapshot, completedAt: null }, data.generation, now), /recorded/);
});

test("native Done keeps its original occurrence date after travelling to an earlier timezone", () => {
  const original = process.env.TZ;
  try {
    const data = plan();
    process.env.TZ = "America/Los_Angeles";
    const received = new Date("2026-10-29T00:01:00.000Z");
    assert.equal(localDateKey(received), "2026-10-28");
    const snapshot: Completion = { taskId: "task-1", date: today, title: "Study NumPy",
      scheduledTime: "09:00", completedAt: "2026-10-29T00:00:00.000Z" };
    const imported = importPlannerNativeCompletion(data, snapshot, data.generation, received);
    assert.deepEqual(imported.completions[occurrenceKey("task-1", today)], snapshot);
    assert.throws(() => completePlannerTask(data, "task-1", today, received), /future/);
  } finally {
    if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
  }
});

test("strict backup rejects duplicate IDs, bad keys, malformed revisions and nonfinite duration", () => {
  const data = plan();
  assert.throws(() => validatePlannerData({ ...data, tasks: [...data.tasks, data.tasks[0]] }), /duplicate/);
  assert.throws(() => validatePlannerData({ ...data, generation: "" }), /generation/);
  assert.throws(() => validatePlannerData({ ...data, tasks: [{ id: "task-1", revisions: [...data.tasks[0]!.revisions, ...data.tasks[0]!.revisions] }] }), /ascending/);
  assert.throws(() => validatePlannerData({ ...data, completions: { wrong: { taskId: "task-1", date: today, title: "Study", scheduledTime: "18:00", completedAt: null } } }), /key/);
  assert.throws(() => validatePlannerData({ ...data, notes: { [today]: { date: "2026-10-28", text: "Note", updatedAt: now.toISOString() } } }), /key/);
  assert.throws(() => validatePlannerData({ ...data, tasks: [{ id: "task-1", revisions: [{ ...data.tasks[0]!.revisions[0], durationMinutes: Infinity }] }] }), /minutes/);
});

test("backups round-trip all actual work, notes and settings", () => {
  let data = addPlannerActivity(plan(), { title: "TrafficTrack", date: today, minutes: 70, notes: "Reviewed footage" }, "activity-1", now);
  data = { ...data, notes: { [today]: { date: today, text: "Review tomorrow", updatedAt: now.toISOString() } }, settings: { theme: "dark", remindersEnabled: true } };
  assert.deepEqual(parsePlannerBackup(JSON.stringify(data)), data);
  assert.throws(() => parsePlannerBackup('{"version":2'), /valid JSON/);
  assert.throws(() => parsePlannerBackup(" ".repeat(MAX_BACKUP_BYTES + 1)), /too large/);
});

test("legacy migration preserves known and orphan completions without inventing a time", () => {
  const data = migrateLegacyRoutine({ state: { habits: [{ id: "h-read", title: "Read", period: "evening", time: "20:00" }], done: { "2026-10-27": ["h-read", "h-deleted"] }, theme: "dark" } }, today);
  assert.equal(data.settings.theme, "dark");
  assert.equal(data.tasks[0]?.revisions[0]?.date, "2026-10-27");
  assert.equal(data.completions["h-read@2026-10-27"]?.completedAt, null);
  assert.equal(data.completions["h-deleted@2026-10-27"]?.title, "Archived habit");
  assert.equal(data.tasks[0]?.revisions[0]?.reminder, false);
});
