import { addDays } from "@/lib/day";

export type Period = "morning" | "afternoon" | "evening";

export type Habit = {
  id: string;
  title: string;
  period: Period;
  time: string;
};

export const PERIODS: { id: Period; label: string }[] = [
  { id: "morning", label: "Morning" },
  { id: "afternoon", label: "Afternoon" },
  { id: "evening", label: "Evening" },
];

const PERIOD_ORDER: Record<Period, number> = {
  morning: 0,
  afternoon: 1,
  evening: 2,
};

export function sortHabits(habits: Habit[]): Habit[] {
  return [...habits].sort((a, b) => {
    const period = PERIOD_ORDER[a.period] - PERIOD_ORDER[b.period];
    if (period !== 0) return period;
    if (a.time && b.time && a.time !== b.time) return a.time.localeCompare(b.time);
    if (a.time !== b.time) return a.time ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

export function streakFor(habitId: string, done: Record<string, string[]>, today: string): number {
  const hit = (key: string) => (done[key] ?? []).includes(habitId);
  let cursor = hit(today) ? today : addDays(today, -1);
  if (!hit(cursor)) return 0;
  let count = 0;
  while (hit(cursor) && count < 800) {
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return count;
}

export function keptCount(habits: Habit[], ids: string[]): number {
  const set = new Set(ids);
  return habits.filter((habit) => set.has(habit.id)).length;
}
