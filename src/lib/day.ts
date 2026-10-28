export function todayKey(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function addDays(key: string, delta: number): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year!, (month ?? 1) - 1, day);
  date.setDate(date.getDate() + delta);
  return todayKey(date);
}

export function headingFor(key: string): { weekday: string; rest: string } {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year!, (month ?? 1) - 1, day);
  return {
    weekday: date.toLocaleDateString("en", { weekday: "long" }),
    rest: date.toLocaleDateString("en", { month: "long", day: "numeric" }),
  };
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;

export function weekdayShort(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year!, (month ?? 1) - 1, day);
  return WEEKDAYS[date.getDay()] ?? "";
}

export function formatTime(value: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return "";
  const hours = Number(match[1]);
  const minutes = match[2];
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour = hours % 12 || 12;
  return `${hour}:${minutes} ${suffix}`;
}
