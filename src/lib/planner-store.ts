import { create } from "zustand";
import type { ActivityInput, Completion, PlannerData, TaskInput, ThemeName } from "./planner-types.ts";
import { addPlannerActivity, addPlannerTask, archivePlannerTask, completePlannerTask, createEmptyPlanner, importPlannerNativeCompletion, isDateKey, localDateKey, MAX_BACKUP_BYTES, migrateLegacyRoutine, parsePlannerBackup, togglePlannerCompletion, updatePlannerTask, validatePlannerData } from "./planner.ts";

export const PLANNER_STORAGE_KEY = "dayline.planner.v2";
export const LEGACY_STORAGE_KEY = "dayline.routine.v1";
export type PlannerStorage = Pick<Storage, "getItem" | "setItem">;
export type PlannerState = {
  data: PlannerData; hydrated: boolean; storageError: string | null;
  hydrate(): void;
  addTask(input: TaskInput): string; updateTask(id: string, input: TaskInput): void; archiveTask(id: string): void;
  toggleComplete(id: string, day: string): void; completeTask(id: string, day: string, completedAt?: string): void;
  importNativeCompletion(snapshot: Completion, generation: string): void;
  addActivity(input: ActivityInput): string; deleteActivity(id: string): void; saveNote(day: string, text: string): void;
  setTheme(theme: ThemeName): void; setRemindersEnabled(enabled: boolean): void;
  exportBackup(): string; restoreBackup(json: string): void;
};
type StoreOptions = { storage?: PlannerStorage | null; now?: () => Date; createId?: () => string };
export function applyPlannerTheme(theme: ThemeName) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#141311" : "#f3eee6");
}
function storageMessage(reason: unknown): string {
  if (reason instanceof Error && reason.name === "QuotaExceededError") return "Device storage is full. Free some space and try again. Your previous saved data was kept.";
  return reason instanceof Error ? reason.message : "Device storage could not be accessed.";
}
export function createPlannerStore(options: StoreOptions = {}) {
  const now = options.now ?? (() => new Date()), createId = options.createId ?? (() => crypto.randomUUID());
  const getStorage = (): PlannerStorage | null | undefined => Object.hasOwn(options, "storage") ? options.storage : typeof localStorage === "undefined" ? null : localStorage;
  let loadedSafely = false;
  return create<PlannerState>((set, get) => {
    function persist(next: PlannerData, recovery = false) {
      if (!get().hydrated) throw new Error("The planner is still loading.");
      if (!loadedSafely && !recovery) throw new Error("Saved data could not be read. Restore a valid backup before making changes.");
      const validated = validatePlannerData(next);
      try {
        const storage = getStorage();
        if (!storage) throw new Error("Device storage is unavailable. Enable storage to save your planner.");
        storage.setItem(PLANNER_STORAGE_KEY, JSON.stringify(validated));
      } catch (reason) {
        const message = storageMessage(reason); set({ storageError: message }); throw new Error(message);
      }
      loadedSafely = true;
      set({ data: validated, storageError: null });
      applyPlannerTheme(validated.settings.theme);
    }
    return {
      data: createEmptyPlanner(), hydrated: false, storageError: null,
      hydrate() {
        if (get().hydrated) return;
        let data = createEmptyPlanner();
        try {
          const storage = getStorage();
          if (!storage) {
            if (typeof window === "undefined" && !Object.hasOwn(options, "storage")) return;
            throw new Error("Device storage is unavailable. Enable storage to save your planner.");
          }
          const current = storage.getItem(PLANNER_STORAGE_KEY);
          if (current !== null) data = parsePlannerBackup(current);
          else {
            const legacy = storage.getItem(LEGACY_STORAGE_KEY);
            if (legacy !== null) {
              if (new TextEncoder().encode(legacy).length > MAX_BACKUP_BYTES) throw new Error("The previous routine is too large to migrate safely.");
              data = migrateLegacyRoutine(JSON.parse(legacy), localDateKey(now()));
              storage.setItem(PLANNER_STORAGE_KEY, JSON.stringify(data));
            }
          }
          loadedSafely = true;
          set({ data, hydrated: true, storageError: null });
          applyPlannerTheme(data.settings.theme);
        } catch (reason) {
          loadedSafely = false;
          set({ data, hydrated: true, storageError: `Saved data was not replaced. ${storageMessage(reason)}` });
          applyPlannerTheme(data.settings.theme);
        }
      },
      addTask(input) { const id = createId(); persist(addPlannerTask(get().data, input, id, now())); return id; },
      updateTask(id, input) { persist(updatePlannerTask(get().data, id, input, now())); },
      archiveTask(id) { const next = archivePlannerTask(get().data, id, now()); if (next !== get().data) persist(next); },
      toggleComplete(id, day) { persist(togglePlannerCompletion(get().data, id, day, now())); },
      completeTask(id, day, completedAt) {
        const when = completedAt === undefined ? now() : new Date(completedAt);
        if (!Number.isFinite(when.getTime()) || (completedAt !== undefined && when.toISOString() !== completedAt)) throw new Error("The completion timestamp is invalid.");
        const next = completePlannerTask(get().data, id, day, when);
        if (next !== get().data) persist(next);
      },
      importNativeCompletion(snapshot, generation) {
        const next = importPlannerNativeCompletion(get().data, snapshot, generation, now());
        if (next !== get().data) persist(next);
      },
      addActivity(input) { const id = createId(); persist(addPlannerActivity(get().data, input, id, now())); return id; },
      deleteActivity(id) { persist({ ...get().data, activities: get().data.activities.filter((activity) => activity.id !== id) }); },
      saveNote(day, text) {
        if (!isDateKey(day) || typeof text !== "string" || text.length > 50000) throw new Error("Choose a valid date and a note up to 50,000 characters.");
        const notes = { ...get().data.notes };
        if (!text.trim()) delete notes[day]; else notes[day] = { date: day, text, updatedAt: now().toISOString() };
        persist({ ...get().data, notes });
      },
      setTheme(theme) { persist({ ...get().data, settings: { ...get().data.settings, theme } }); },
      setRemindersEnabled(remindersEnabled) { persist({ ...get().data, settings: { ...get().data.settings, remindersEnabled } }); },
      exportBackup() {
        if (!get().hydrated || !loadedSafely) throw new Error("Saved data could not be loaded. Restore a valid backup before exporting.");
        const json = JSON.stringify(validatePlannerData(get().data), null, 2);
        if (new TextEncoder().encode(json).length > MAX_BACKUP_BYTES) return JSON.stringify(get().data);
        return json;
      },
      restoreBackup(json) {
        const restored = parsePlannerBackup(json);
        let generation = createId();
        if (generation === restored.generation || generation === get().data.generation) generation = crypto.randomUUID();
        persist({ ...restored, generation }, true);
      },
    };
  });
}
export const usePlannerStore = createPlannerStore();
