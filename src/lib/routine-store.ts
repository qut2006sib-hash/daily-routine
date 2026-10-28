import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Habit, Period } from "@/lib/routine";

export type ThemeName = "light" | "dark";

type RoutineState = {
  habits: Habit[];
  done: Record<string, string[]>;
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  toggleDone: (id: string, day: string) => void;
  addHabit: (habit: Omit<Habit, "id">) => string;
  updateHabit: (id: string, patch: Omit<Habit, "id">) => void;
  deleteHabit: (id: string) => { habit: Habit; index: number } | null;
  restoreHabit: (habit: Habit, index: number) => void;
};

export const ROUTINE_STORAGE_KEY = "dayline.routine.v1";

const SEED: Habit[] = [
  { id: "h-curtains", title: "Open the curtains", period: "morning", time: "07:00" },
  { id: "h-water", title: "Water before coffee", period: "morning", time: "07:10" },
  { id: "h-walk", title: "A short walk", period: "morning", time: "07:30" },
  { id: "h-lunch", title: "Eat away from the desk", period: "afternoon", time: "12:30" },
  { id: "h-pause", title: "One real pause", period: "afternoon", time: "15:30" },
  { id: "h-inbox", title: "Leave the inbox", period: "evening", time: "18:30" },
  { id: "h-pages", title: "Read ten pages", period: "evening", time: "21:00" },
  { id: "h-lights", title: "Lights out", period: "evening", time: "22:30" },
];

function isPeriod(value: unknown): value is Period {
  return value === "morning" || value === "afternoon" || value === "evening";
}

function isHabit(value: unknown): value is Habit {
  if (!value || typeof value !== "object") return false;
  const habit = value as Record<string, unknown>;
  return (
    typeof habit.id === "string" &&
    typeof habit.title === "string" &&
    isPeriod(habit.period) &&
    typeof habit.time === "string"
  );
}

function readDone(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object") return {};
  const done: Record<string, string[]> = {};
  for (const [key, ids] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !Array.isArray(ids)) continue;
    done[key] = ids.filter((id): id is string => typeof id === "string");
  }
  return done;
}

export function mergePersisted(
  raw: unknown,
  current: { habits: Habit[]; done: Record<string, string[]>; theme: ThemeName },
): { habits: Habit[]; done: Record<string, string[]>; theme: ThemeName } {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const theme: ThemeName = source.theme === "dark" || source.theme === "light" ? source.theme : current.theme;
  const habits = Array.isArray(source.habits) ? source.habits.filter(isHabit) : current.habits;
  const done = source.done === undefined ? current.done : readDone(source.done);
  return { habits, done, theme };
}

let didHydrate = false;

export function hydrateRoutineSync() {
  if (typeof window === "undefined" || didHydrate) return;
  didHydrate = true;
  try {
    const raw = localStorage.getItem(ROUTINE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { state?: unknown };
      const next = mergePersisted(parsed.state ?? parsed, useRoutineStore.getState());
      useRoutineStore.setState(next);
    }
  } catch {
    // Keep the in-memory routine if storage is unreadable.
  } finally {
    applyTheme(useRoutineStore.getState().theme);
  }
}

export function applyTheme(theme: ThemeName) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#141311" : "#f3eee6");
}

export const useRoutineStore = create<RoutineState>()(
  persist(
    (set, get) => ({
      habits: SEED,
      done: {},
      theme: "light",
      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },
      toggleDone: (id, day) => {
        const current = get().done[day] ?? [];
        const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
        set({ done: { ...get().done, [day]: next } });
      },
      addHabit: (habit) => {
        const id = crypto.randomUUID();
        set({ habits: [...get().habits, { ...habit, id }] });
        return id;
      },
      updateHabit: (id, patch) => {
        set({
          habits: get().habits.map((habit) => (habit.id === id ? { ...habit, ...patch, id } : habit)),
        });
      },
      deleteHabit: (id) => {
        const habits = get().habits;
        const index = habits.findIndex((habit) => habit.id === id);
        if (index < 0) return null;
        const habit = habits[index]!;
        set({ habits: habits.filter((item) => item.id !== id) });
        return { habit, index };
      },
      restoreHabit: (habit, index) => {
        const habits = get().habits;
        if (habits.some((item) => item.id === habit.id)) return;
        const next = [...habits];
        next.splice(Math.max(0, Math.min(index, next.length)), 0, habit);
        set({ habits: next });
      },
    }),
    {
      name: ROUTINE_STORAGE_KEY,
      skipHydration: true,
      storage: createJSONStorage(() =>
        typeof window === "undefined"
          ? { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }
          : localStorage,
      ),
      partialize: (state) => ({
        habits: state.habits,
        done: state.done,
        theme: state.theme,
      }),
      merge: (persisted, current) => ({ ...current, ...mergePersisted(persisted, current) }),
    },
  ),
);
