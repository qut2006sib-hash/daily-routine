import { useLayoutEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Moon, Pencil, Plus, Sun, X } from "lucide-react";
import { toast, Toaster } from "sonner";
import { cn } from "@/lib/cn";
import { addDays, formatTime, headingFor, todayKey, weekdayShort } from "@/lib/day";
import { keptCount, PERIODS, sortHabits, streakFor, type Habit, type Period } from "@/lib/routine";
import { hydrateRoutineSync, useRoutineStore, type ThemeName } from "@/lib/routine-store";

type Draft = {
  id: string | null;
  title: string;
  period: Period;
  time: string;
};

const EMPTY_DRAFT: Draft = { id: null, title: "", period: "morning", time: "" };

export function RoutineApp() {
  const habits = useRoutineStore((state) => state.habits);
  const done = useRoutineStore((state) => state.done);
  const theme = useRoutineStore((state) => state.theme);
  const setTheme = useRoutineStore((state) => state.setTheme);
  const toggleDone = useRoutineStore((state) => state.toggleDone);
  const [today, setToday] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  useLayoutEffect(() => {
    hydrateRoutineSync();
    setToday(todayKey());
  }, []);

  const ordered = useMemo(() => sortHabits(habits), [habits]);
  const todayIds = today ? (done[today] ?? []) : [];
  const completed = keptCount(habits, todayIds);
  const heading = today ? headingFor(today) : null;
  const week = today
    ? Array.from({ length: 7 }, (_, index) => addDays(today, index - 6))
    : [];

  function openNew() {
    setDraft(EMPTY_DRAFT);
  }

  function openEdit(habit: Habit) {
    setDraft({ id: habit.id, title: habit.title, period: habit.period, time: habit.time });
  }

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <a className="skip-link" href="#habits">
        Skip to habits
      </a>
      <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 pt-8 pb-28">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="font-serif text-2xl leading-none italic tracking-tight">Dayline</p>
            <h1 className="mt-4 font-serif text-4xl leading-none text-balance">
              {heading?.weekday ?? "Today"}
            </h1>
            <p className="mt-2 text-sm text-muted" suppressHydrationWarning>
              {heading?.rest ?? "Your routine stays on this device."}
            </p>
          </div>
          <ThemeButton theme={theme} onToggle={() => setTheme(theme === "dark" ? "light" : "dark")} />
        </header>

        <section className="mt-8 flex items-center gap-5" aria-label="Today’s progress">
          <ProgressRing completed={completed} total={habits.length} />
          <div>
            <p className="font-serif text-3xl leading-none tabular-nums">
              {completed}
              <span className="text-muted"> of {habits.length}</span>
            </p>
            <p className="mt-2 text-sm text-muted">
              {habits.length === 0
                ? "Add the first step of the day."
                : completed === 0
                  ? "Start with the first one."
                  : completed === habits.length
                    ? "The day is kept."
                    : `${habits.length - completed} still open`}
            </p>
          </div>
        </section>

        <ol className="mt-8 grid grid-cols-7 gap-2" aria-label="Last seven days">
          {week.map((day) => {
            const ratio = habits.length === 0 ? 0 : keptCount(habits, done[day] ?? []) / habits.length;
            const isToday = day === today;
            return (
              <li key={day} className="flex flex-col items-center gap-2">
                <div className="flex h-8 w-full items-end overflow-hidden rounded-sm bg-line">
                  <div
                    className="w-full bg-leaf"
                    style={{ height: `${Math.round(ratio * 100)}%` }}
                  />
                </div>
                <span
                  className={cn(
                    "text-xs tabular-nums",
                    isToday ? "font-medium text-ink" : "text-muted",
                  )}
                >
                  {weekdayShort(day)}
                </span>
              </li>
            );
          })}
        </ol>

        <div id="habits" className="mt-8 flex flex-col gap-8">
          {habits.length === 0 ? (
            <div className="rounded-lg border border-line bg-sheet px-5 py-10 text-center">
              <p className="font-serif text-2xl">No habits yet</p>
              <p className="mt-2 text-sm text-muted">A short list you can actually finish.</p>
            </div>
          ) : (
            PERIODS.map((period) => {
              const items = ordered.filter((habit) => habit.period === period.id);
              if (!items.length) return null;
              return (
                <section key={period.id} aria-label={period.label}>
                  <h2 className="text-xs font-medium tracking-wide text-muted uppercase">
                    {period.label}
                  </h2>
                  <ul className="mt-2 divide-y divide-line border-y border-line">
                    {items.map((habit) => (
                      <HabitRow
                        key={habit.id}
                        habit={habit}
                        checked={todayIds.includes(habit.id)}
                        streak={today ? streakFor(habit.id, done, today) : 0}
                        onToggle={() => today && toggleDone(habit.id, today)}
                        onEdit={() => openEdit(habit)}
                      />
                    ))}
                  </ul>
                </section>
              );
            })
          )}
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-paper px-5 py-4">
        <div className="mx-auto max-w-lg">
          <button
            type="button"
            onClick={openNew}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-leaf text-sm font-medium text-onleaf transition-colors duration-150 hover:bg-ink hover:text-sheet"
          >
            <Plus className="size-4" aria-hidden="true" />
            Add a habit
          </button>
        </div>
      </div>

      <HabitDialog
        draft={draft}
        onClose={() => setDraft(null)}
        onChange={setDraft}
      />
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            background: "var(--color-ink)",
            color: "var(--color-sheet)",
            border: "none",
            fontFamily: "var(--font-sans)",
          },
          actionButtonStyle: {
            background: "var(--color-sheet)",
            color: "var(--color-ink)",
          },
        }}
      />
    </div>
  );
}

function ProgressRing({ completed, total }: { completed: number; total: number }) {
  const ratio = total === 0 ? 0 : completed / total;
  return (
    <div
      role="img"
      aria-label={`${completed} of ${total} habits kept`}
      className="grid size-28 shrink-0 place-items-center rounded-full"
      style={{
        background: `conic-gradient(var(--color-leaf) ${Math.round(ratio * 360)}deg, var(--color-line) 0)`,
      }}
    >
      <div className="grid size-24 place-items-center rounded-full bg-sheet">
        <span className="font-serif text-3xl tabular-nums">{completed}</span>
      </div>
    </div>
  );
}

function HabitRow({
  habit,
  checked,
  streak,
  onToggle,
  onEdit,
}: {
  habit: Habit;
  checked: boolean;
  streak: number;
  onToggle: () => void;
  onEdit: () => void;
}) {
  return (
    <li className="flex items-center gap-2 py-2">
      <span className="w-20 shrink-0 text-xs text-muted tabular-nums">
        {habit.time ? formatTime(habit.time) : ""}
      </span>
      <span className={cn("min-w-0 flex-1 truncate", checked && "text-muted line-through")}>
        {habit.title}
      </span>
      {streak > 0 ? (
        <span className="shrink-0 text-xs text-leaf tabular-nums">{streak}d</span>
      ) : null}
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${habit.title}`}
        className="inline-flex size-11 items-center justify-center rounded-md text-muted hover:bg-sheet hover:text-ink"
      >
        <Pencil className="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={checked}
        aria-label={checked ? `Mark ${habit.title} not done` : `Mark ${habit.title} done`}
        className={cn(
          "inline-flex size-11 items-center justify-center rounded-full border-2 transition-colors duration-150",
          checked ? "border-leaf bg-leaf text-onleaf" : "border-line bg-sheet text-transparent",
        )}
      >
        <Check className="size-5" aria-hidden="true" />
      </button>
    </li>
  );
}

function ThemeButton({ theme, onToggle }: { theme: ThemeName; onToggle: () => void }) {
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={dark ? "Light mode" : "Dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className="inline-flex size-11 items-center justify-center rounded-md text-muted hover:bg-sheet hover:text-ink"
    >
      {dark ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
    </button>
  );
}

function HabitDialog({
  draft,
  onClose,
  onChange,
}: {
  draft: Draft | null;
  onClose: () => void;
  onChange: (draft: Draft) => void;
}) {
  const addHabit = useRoutineStore((state) => state.addHabit);
  const updateHabit = useRoutineStore((state) => state.updateHabit);
  const deleteHabit = useRoutineStore((state) => state.deleteHabit);
  const restoreHabit = useRoutineStore((state) => state.restoreHabit);

  function save() {
    if (!draft) return;
    const title = draft.title.trim();
    if (!title) return;
    const next = { title, period: draft.period, time: draft.time };
    if (draft.id) updateHabit(draft.id, next);
    else addHabit(next);
    onClose();
  }

  function remove() {
    if (!draft?.id) return;
    const removed = deleteHabit(draft.id);
    onClose();
    if (!removed) return;
    toast(`Removed “${removed.habit.title}”`, {
      action: {
        label: "Undo",
        onClick: () => restoreHabit(removed.habit, removed.index),
      },
      duration: 6000,
    });
  }

  return (
    <Dialog.Root open={draft !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-veil/50" />
        <Dialog.Content className="fixed inset-x-4 bottom-4 z-50 mx-auto w-full max-w-md rounded-lg border border-line bg-sheet p-5 text-ink sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2">
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="font-serif text-2xl">
              {draft?.id ? "Edit habit" : "New habit"}
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="inline-flex size-11 items-center justify-center rounded-md text-muted hover:bg-paper hover:text-ink"
            >
              <X className="size-4" aria-hidden="true" />
            </Dialog.Close>
          </div>
          <form
            className="mt-4 flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <label className="flex flex-col gap-2 text-sm">
              Name
              <input
                value={draft?.title ?? ""}
                onChange={(event) => draft && onChange({ ...draft, title: event.target.value })}
                placeholder="A short walk"
                autoFocus
                className="h-11 rounded-md border border-line bg-paper px-3 text-base text-ink placeholder:text-muted"
              />
            </label>
            <fieldset>
              <legend className="text-sm">Part of the day</legend>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {PERIODS.map((period) => {
                  const selected = draft?.period === period.id;
                  return (
                    <button
                      key={period.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => draft && onChange({ ...draft, period: period.id })}
                      className={cn(
                        "h-11 rounded-md text-sm",
                        selected ? "bg-ink text-sheet" : "bg-paper text-muted",
                      )}
                    >
                      {period.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <label className="flex flex-col gap-2 text-sm">
              Time
              <input
                type="time"
                value={draft?.time ?? ""}
                onChange={(event) => draft && onChange({ ...draft, time: event.target.value })}
                className="h-11 rounded-md border border-line bg-paper px-3 text-base text-ink"
              />
            </label>
            <div className="flex items-center gap-2">
              {draft?.id ? (
                <button
                  type="button"
                  onClick={remove}
                  className="h-11 rounded-md px-3 text-sm text-muted hover:text-ink"
                >
                  Delete
                </button>
              ) : null}
              <button
                type="submit"
                disabled={!draft?.title.trim()}
                className="ml-auto h-11 rounded-md bg-leaf px-4 text-sm font-medium text-onleaf hover:bg-ink hover:text-sheet disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
