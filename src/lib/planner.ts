import type { Activity, ActivityInput, Completion, DayTask, PlannerData, PlannerTask, RepeatRule, TaskInput, TaskRevision } from "./planner-types.ts";

export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
const MAX_TASKS = 2000;
const MAX_REVISIONS = 20000;
const MAX_RECORDS = 50000;
const REPEAT_RULES: RepeatRule[] = ["none", "daily", "weekdays", "weekly"];

function fail(message: string): never { throw new Error(message); }
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max: number, required = false): string {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) fail(`${label} is missing or too long.`);
  return value;
}
function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,200}$/.test(value) || ["__proto__", "constructor", "prototype"].includes(value)) fail(`${label} is invalid.`);
  return value;
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail(`${label} must be true or false.`);
  return value;
}
function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) fail(`${label} must be a whole number between ${min} and ${max}.`);
  return value;
}
function list(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(`${label} is not a valid list.`);
  return value;
}
export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year! < 1970 || month! < 1 || month! > 12 || day! < 1 || day! > 31) return false;
  const date = new Date(Date.UTC(year!, month! - 1, day!, 12));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}
function dateKey(value: unknown, label = "Date"): string {
  if (!isDateKey(value)) fail(`${label} must be a real YYYY-MM-DD date.`);
  return value;
}
export function isTime(value: unknown): value is string {
  return typeof value === "string" && (value === "" || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value));
}
function time(value: unknown): string {
  if (!isTime(value)) fail("Time must use HH:mm, or be empty for an untimed task.");
  return value;
}
function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) fail(`${label} must be an ISO timestamp.`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) fail(`${label} is invalid.`);
  return value;
}
function sizeCheck(value: unknown): void {
  let serialized: string | undefined;
  try { serialized = JSON.stringify(value); } catch { fail("The planner is not valid JSON data."); }
  if (serialized === undefined || new TextEncoder().encode(serialized).length > MAX_BACKUP_BYTES) fail("The planner is too large. The backup limit is 5 MiB.");
}
export function localDateKey(now = new Date()): string {
  if (!Number.isFinite(now.getTime())) fail("The current date is invalid.");
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
export function addLocalDays(key: string, delta: number): string {
  dateKey(key);
  if (!Number.isInteger(delta) || Math.abs(delta) > 100000) fail("The day offset is invalid.");
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year!, month! - 1, day!, 12);
  date.setDate(date.getDate() + delta);
  return dateKey(localDateKey(date));
}
export function occurrenceKey(taskId: string, date: string): string { return `${identifier(taskId, "Task ID")}@${dateKey(date)}`; }
export function validateTaskInput(raw: unknown): TaskInput {
  const value = object(raw, "Task");
  if (!REPEAT_RULES.includes(value.repeat as RepeatRule)) fail("Choose a supported repeat schedule.");
  const result: TaskInput = {
    title: text(value.title, "Task title", 300, true), notes: text(value.notes, "Task notes", 20000),
    date: dateKey(value.date), time: time(value.time), durationMinutes: integer(value.durationMinutes, "Planned minutes", 1, 1440),
    repeat: value.repeat as RepeatRule, reminder: boolean(value.reminder, "Reminder setting"),
  };
  if (result.reminder && !result.time) fail("Choose a time for this reminder.");
  return result;
}
export function validateActivityInput(raw: unknown): ActivityInput {
  const value = object(raw, "Activity");
  return { title: text(value.title, "Activity title", 300, true), date: dateKey(value.date), minutes: integer(value.minutes, "Activity minutes", 1, 1440), notes: text(value.notes, "Activity notes", 20000) };
}
function validateCompletion(raw: unknown): Completion {
  const value = object(raw, "Completion");
  return { taskId: identifier(value.taskId, "Completed task ID"), date: dateKey(value.date, "Completion date"), title: text(value.title, "Completed task title", 300, true), scheduledTime: time(value.scheduledTime), completedAt: value.completedAt === null ? null : timestamp(value.completedAt, "Completion timestamp") };
}
/** getRandomValues also works in HTTP previews and older Android WebViews. */
export function createPlannerId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createEmptyPlanner(generation: string = createPlannerId()): PlannerData {
  return { version: 2, generation: identifier(generation, "Dataset generation"), tasks: [], completions: {}, activities: [], notes: {}, settings: { theme: "light", remindersEnabled: false } };
}
export function validatePlannerData(raw: unknown): PlannerData {
  sizeCheck(raw);
  const value = object(raw, "Planner backup");
  if (value.version !== 2) fail("This backup version is not supported.");
  const generation = identifier(value.generation, "Dataset generation");
  const taskIds = new Set<string>();
  let revisionsTotal = 0;
  const tasks = list(value.tasks, "Tasks", MAX_TASKS).map((rawTask): PlannerTask => {
    const task = object(rawTask, "Task");
    const id = identifier(task.id, "Task ID");
    if (taskIds.has(id)) fail("The backup contains duplicate task IDs.");
    taskIds.add(id);
    const entries = list(task.revisions, "Task revisions", MAX_REVISIONS);
    revisionsTotal += entries.length;
    if (!entries.length || revisionsTotal > MAX_REVISIONS) fail("Task revision history is empty or too large.");
    let previous = "";
    const revisions = entries.map((rawRevision): TaskRevision => {
      const revision = object(rawRevision, "Task revision");
      const effectiveFrom = dateKey(revision.effectiveFrom, "Revision date");
      if (effectiveFrom <= previous) fail("Task revisions must have unique dates in ascending order.");
      previous = effectiveFrom;
      return { ...validateTaskInput(revision), effectiveFrom, archived: boolean(revision.archived, "Archived status") };
    });
    return { id, revisions };
  });
  const completions: Record<string, Completion> = {};
  const completionEntries = Object.entries(object(value.completions, "Completions"));
  if (completionEntries.length > MAX_RECORDS) fail("There are too many completion records.");
  for (const [key, entry] of completionEntries) {
    const completion = validateCompletion(entry);
    if (key !== occurrenceKey(completion.taskId, completion.date)) fail("A completion key does not match its task and date.");
    completions[key] = completion;
  }
  const activityIds = new Set<string>();
  const activities = list(value.activities, "Activities", MAX_RECORDS).map((entry): Activity => {
    const activity = object(entry, "Activity");
    const id = identifier(activity.id, "Activity ID");
    if (activityIds.has(id)) fail("The backup contains duplicate activity IDs.");
    activityIds.add(id);
    return { ...validateActivityInput(activity), id, createdAt: timestamp(activity.createdAt, "Activity timestamp") };
  });
  const notes: PlannerData["notes"] = {};
  const noteEntries = Object.entries(object(value.notes, "Daily notes"));
  if (noteEntries.length > MAX_RECORDS) fail("There are too many daily notes.");
  for (const [key, entry] of noteEntries) {
    const note = object(entry, "Daily note");
    const date = dateKey(note.date, "Note date");
    if (key !== date) fail("A note key does not match its date.");
    notes[date] = { date, text: text(note.text, "Daily note", 50000), updatedAt: timestamp(note.updatedAt, "Note timestamp") };
  }
  const settings = object(value.settings, "Settings");
  if (settings.theme !== "light" && settings.theme !== "dark") fail("Choose a supported theme.");
  return { version: 2, generation, tasks, completions, activities, notes, settings: { theme: settings.theme, remindersEnabled: boolean(settings.remindersEnabled, "Reminder setting") } };
}
export function parsePlannerBackup(json: string): PlannerData {
  if (typeof json !== "string" || new TextEncoder().encode(json).length > MAX_BACKUP_BYTES) fail("The backup is too large. The limit is 5 MiB.");
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { fail("The backup file does not contain valid JSON."); }
  return validatePlannerData(raw);
}
export function revisionForDate(task: PlannerTask, day: string): TaskRevision | undefined {
  let revision: TaskRevision | undefined;
  for (const entry of task.revisions) { if (entry.effectiveFrom > day) break; revision = entry; }
  return revision;
}
function dayNumber(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Math.floor(Date.UTC(year!, month! - 1, date!) / 86400000);
}
export function taskOccursOn(revision: TaskRevision, day: string): boolean {
  if (revision.archived || day < revision.date) return false;
  if (revision.repeat === "none") return day === revision.date;
  if (revision.repeat === "daily") return true;
  if (revision.repeat === "weekly") return (dayNumber(day) - dayNumber(revision.date)) % 7 === 0;
  const weekday = new Date(dayNumber(day) * 86400000).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}
export function getDayTasks(tasks: PlannerTask[], day: string): DayTask[] {
  dateKey(day);
  return tasks.flatMap((task) => {
    const revision = revisionForDate(task, day);
    if (!revision || !taskOccursOn(revision, day)) return [];
    const { effectiveFrom: _from, archived: _archived, ...input } = revision;
    return [{ ...input, id: task.id, occurrenceKey: occurrenceKey(task.id, day) }];
  }).sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99") || a.title.localeCompare(b.title));
}
function replaceRevision(task: PlannerTask, revision: TaskRevision): PlannerTask {
  return { ...task, revisions: [...task.revisions.filter((entry) => entry.effectiveFrom < revision.effectiveFrom), revision] };
}
export function addPlannerTask(data: PlannerData, raw: TaskInput, taskId: string, now = new Date()): PlannerData {
  const input = validateTaskInput(raw), today = localDateKey(now);
  identifier(taskId, "Task ID");
  if (input.date < today) fail("New tasks cannot start in the past. Record an activity instead.");
  if (data.tasks.some((task) => task.id === taskId)) fail("This task ID already exists.");
  return { ...data, tasks: [...data.tasks, { id: taskId, revisions: [{ ...input, effectiveFrom: today, archived: false }] }] };
}
export function updatePlannerTask(data: PlannerData, taskId: string, raw: TaskInput, now = new Date()): PlannerData {
  const input = validateTaskInput(raw), today = localDateKey(now);
  const old = data.tasks.find((task) => task.id === taskId);
  if (!old) fail("This task could not be found.");
  const current = revisionForDate(old, today) ?? old.revisions.at(-1)!;
  if (input.date < today && !(input.repeat !== "none" && current.repeat !== "none" && input.date === current.date)) fail("Choose today or a future date for this task.");
  return { ...data, tasks: data.tasks.map((task) => task.id === taskId ? replaceRevision(task, { ...input, effectiveFrom: today, archived: false }) : task) };
}
export function archivePlannerTask(data: PlannerData, taskId: string, now = new Date()): PlannerData {
  const today = localDateKey(now), task = data.tasks.find((entry) => entry.id === taskId);
  if (!task) fail("This task could not be found.");
  const current = revisionForDate(task, today) ?? task.revisions.at(-1)!;
  if (current.archived) return data;
  return { ...data, tasks: data.tasks.map((entry) => entry.id === taskId ? replaceRevision(entry, { ...current, effectiveFrom: today, archived: true }) : entry) };
}
export function completePlannerTask(data: PlannerData, taskId: string, day: string, now = new Date()): PlannerData {
  const key = occurrenceKey(taskId, day);
  if (data.completions[key]) return data;
  if (day > localDateKey(now)) fail("A future task cannot be completed yet.");
  const task = getDayTasks(data.tasks, day).find((entry) => entry.id === taskId);
  if (!task) fail("This task is not planned for the selected day.");
  return { ...data, completions: { ...data.completions, [key]: { taskId, date: day, title: task.title, scheduledTime: task.time, completedAt: now.toISOString() } } };
}
export function togglePlannerCompletion(data: PlannerData, taskId: string, day: string, now = new Date()): PlannerData {
  const key = occurrenceKey(taskId, day);
  if (day > localDateKey(now)) fail("A future task cannot be completed yet.");
  if (!data.completions[key]) return completePlannerTask(data, taskId, day, now);
  const completions = { ...data.completions }; delete completions[key];
  return { ...data, completions };
}
export function importPlannerNativeCompletion(data: PlannerData, raw: Completion, generation: string, _now = new Date()): PlannerData {
  if (generation !== data.generation) fail("This notification belongs to a previous planner.");
  const snapshot = validateCompletion(raw), key = occurrenceKey(snapshot.taskId, snapshot.date);
  if (snapshot.completedAt === null || !snapshot.scheduledTime) fail("The phone action has no recorded completion time.");
  // A queued action retains the calendar date where it happened. After travel or a
  // timezone correction that date may be tomorrow in the phone's current zone.
  if (!data.tasks.some((task) => task.id === snapshot.taskId)) fail("This phone action refers to an unknown task.");
  if (data.completions[key]) return data;
  return { ...data, completions: { ...data.completions, [key]: snapshot } };
}
export function addPlannerActivity(data: PlannerData, raw: ActivityInput, activityId: string, now = new Date()): PlannerData {
  const input = validateActivityInput(raw);
  identifier(activityId, "Activity ID");
  if (input.date > localDateKey(now)) fail("Actual activities cannot be recorded in the future.");
  if (data.activities.some((entry) => entry.id === activityId)) fail("This activity ID already exists.");
  return { ...data, activities: [...data.activities, { ...input, id: activityId, createdAt: now.toISOString() }] };
}

/** v1 never recorded creation or completion times; migration preserves what is known. */
export function migrateLegacyRoutine(raw: unknown, today: string): PlannerData {
  dateKey(today);
  let source = object(raw, "Previous routine");
  if (Object.hasOwn(source, "state")) source = object(source.state, "Previous routine state");
  const habits = list(source.habits, "Previous habits", MAX_TASKS);
  const done = object(source.done, "Previous completions");
  const days = Object.keys(done).map((day) => dateKey(day, "Previous completion date")).sort();
  const first = days.length && days[0]! < today ? days[0]! : today;
  const data = createEmptyPlanner();
  if (source.theme !== undefined && source.theme !== "light" && source.theme !== "dark") fail("The previous theme is invalid.");
  data.settings.theme = source.theme === "dark" ? "dark" : "light";
  const seen = new Set<string>();
  for (const rawHabit of habits) {
    const habit = object(rawHabit, "Previous habit"), id = identifier(habit.id, "Previous habit ID");
    if (seen.has(id)) fail("The previous routine has duplicate habit IDs.");
    seen.add(id);
    if (!["morning", "afternoon", "evening"].includes(habit.period as string)) fail("The previous habit period is invalid.");
    data.tasks.push({ id, revisions: [{ title: text(habit.title, "Previous habit title", 300, true), notes: "", date: first, time: time(habit.time), durationMinutes: 30, repeat: "daily", reminder: false, effectiveFrom: first, archived: false }] });
  }
  for (const day of days) {
    const ids = list(done[day], "Previous completed habits", MAX_TASKS);
    for (const value of ids) {
      const id = identifier(value, "Previous completed habit ID"), task = data.tasks.find((entry) => entry.id === id);
      data.completions[occurrenceKey(id, day)] = { taskId: id, date: day, title: task?.revisions[0]?.title ?? "Archived habit", scheduledTime: task?.revisions[0]?.time ?? "", completedAt: null };
    }
  }
  return validatePlannerData(data);
}
