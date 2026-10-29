import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Bell, BellOff, BookOpen, CalendarDays, Check, ChevronLeft, ChevronRight, ClipboardList, Clock3, Download, FileText, Moon, Pencil, Plus, Settings2, Sun, Trash2, Upload, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { saveBackupFile } from "@/lib/backup-files";
import { addLocalDays, getDayTasks, isDateKey, MAX_BACKUP_BYTES, parsePlannerBackup } from "@/lib/planner";
import { usePlannerStore } from "@/lib/planner-store";
import type { ActivityInput, DayTask, TaskInput } from "@/lib/planner-types";
import { useLocalDay } from "@/lib/use-local-day";
import { enableReminders, openExactAlarmSettings, sendTestReminder } from "@/lib/reminders";
import { useReminders } from "@/lib/use-reminders";

type Tab = "today" | "activity" | "notes" | "settings";
type ModalName = "task" | "activity" | "export" | "restore" | "confirm" | null;
type TaskDraft = TaskInput & { id?: string };
type Confirm = { title: string; description: string; label: string; previous: ModalName; action: () => void };
const TABS = [{ id: "today", label: "Today", icon: CalendarDays }, { id: "activity", label: "Activity", icon: ClipboardList }, { id: "notes", label: "Notes", icon: BookOpen }, { id: "settings", label: "Settings", icon: Settings2 }] as const;
const REPEATS = { none: "Does not repeat", daily: "Every day", weekdays: "Monday to Friday", weekly: "Every week" };
const messageFor = (error: unknown) => error instanceof Error ? error.message : "That could not be saved. Please try again.";
function dateLabel(day: string) { return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }); }
function timeLabel(time: string) { return time ? new Date(`2000-01-01T${time}:00`).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "Anytime"; }

export function RoutineApp() {
  const store = usePlannerStore();
  const { data, hydrated, storageError } = store;
  const { today, now } = useLocalDay();
  const reminders = useReminders();
  const [tab, setTab] = useState<Tab>("today");
  const [chosenDay, setChosenDay] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalName>(null);
  const [task, setTask] = useState<TaskDraft | null>(null);
  const [activity, setActivity] = useState<ActivityInput | null>(null);
  const [confirmation, setConfirmation] = useState<Confirm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [backup, setBackup] = useState("");
  const [restoreText, setRestoreText] = useState("");
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const day = chosenDay ?? today;
  const past = Boolean(day && today && day < today);
  const tasks = useMemo(() => day ? getDayTasks(data.tasks, day) : [], [data.tasks, day]);
  const completed = tasks.filter((item) => Boolean(data.completions[item.occurrenceKey])).length;
  const completionRecords = Object.values(data.completions).filter((item) => item.date === day).sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  const activities = data.activities.filter((item) => item.date === day).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const minutes = activities.reduce((sum, item) => sum + item.minutes, 0);
  const currentTime = now ? `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}` : "";
  const next = tasks.find((item) => item.time && !data.completions[item.occurrenceKey] && (day !== today || item.time >= currentTime));
  const noteText = day ? noteDrafts[day] ?? data.notes[day]?.text ?? "" : "";
  const noteUnsaved = Boolean(day && noteText !== (data.notes[day]?.text ?? ""));

  useEffect(() => { usePlannerStore.getState().hydrate(); }, []);
  useEffect(() => { document.documentElement.classList.toggle("dark", data.settings.theme === "dark"); document.documentElement.style.colorScheme = data.settings.theme; }, [data.settings.theme]);

  function perform(action: () => void, success?: string, inForm = false) {
    try { action(); setError(null); setFormError(null); if (success) setNotice(success); return true; }
    catch (cause) { if (inForm) setFormError(messageFor(cause)); else setError(messageFor(cause)); return false; }
  }
  async function runAsync(action: () => Promise<void>, inForm = false) {
    setBusy(true);
    try { await action(); setError(null); setFormError(null); }
    catch (cause) { if (inForm) setFormError(messageFor(cause)); else setError(messageFor(cause)); }
    finally { setBusy(false); }
  }
  function open(name: ModalName) { setFormError(null); setNotice(null); setModal(name); }
  function newTask() {
    if (!today) return;
    setTask({ title: "", date: day && day >= today ? day : today, time: "", durationMinutes: 30, notes: "", repeat: "none", reminder: false });
    open("task");
  }
  function editTask(item: DayTask) {
    const { id, title, date, time, durationMinutes, repeat, reminder, notes } = item;
    setTask({ id, title, date, time, durationMinutes, repeat, reminder, notes }); open("task");
  }
  function saveTask(event: FormEvent) {
    event.preventDefault();
    if (!task) return;
    if (task.reminder && !task.time) { setFormError("Choose a time for this reminder."); return; }
    if (perform(() => { const { id, ...input } = task; if (id) store.updateTask(id, input); else store.addTask(input); }, "Task saved.", true)) {
      setChosenDay(task.date === today ? null : task.date); setModal(null);
    }
  }
  function newActivity() { if (day && today) { setActivity({ title: "", date: day > today ? today : day, minutes: 30, notes: "" }); open("activity"); } }
  function saveActivity(event: FormEvent) {
    event.preventDefault();
    if (activity && perform(() => { store.addActivity(activity); }, "Activity recorded.", true)) { setChosenDay(activity.date === today ? null : activity.date); setModal(null); }
  }
  function ask(confirm: Confirm) { setConfirmation(confirm); open("confirm"); }
  function exportData() { perform(() => { setBackup(store.exportBackup()); open("export"); }); }
  async function readFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) { setError("Choose a backup no larger than 5 MiB."); return; }
    await runAsync(async () => { setRestoreText(await file.text()); open("restore"); });
  }
  function reviewRestore() {
    if (!perform(() => { parsePlannerBackup(restoreText); }, undefined, true)) return;
    const text = restoreText;
    ask({ title: "Replace your current data?", label: "Restore this backup", previous: "restore",
      description: "This replaces all tasks, activity and notes on this device. Export your current data first if you want to keep it. Old phone reminders and pending actions will be replaced too.",
      action: () => { if (perform(() => store.restoreBackup(text), "Backup restored.", true)) { setNoteDrafts({}); setChosenDay(null); setModal(null); } else setModal("restore"); } });
  }
  const modalTitle = modal === "task" ? task?.id ? "Edit task" : "Add a task" : modal === "activity" ? "Log an activity" : modal === "export" ? "Export your backup" : modal === "restore" ? "Restore a backup" : confirmation?.title ?? "Confirm";
  const modalDescription = modal === "task" ? task?.id ? "Changes apply from today. Earlier plans stay in your history." : "Choose what you want to do and when you want to do it." : modal === "activity" ? "Record what you actually did, including work you had not planned." : modal === "export" ? "Save this JSON file outside Dayline, or copy the complete backup text." : modal === "restore" ? "Choose a backup file in Settings, or paste its complete JSON text here." : confirmation?.description ?? "";

  return (
    <div className="dayline-app">
      <a className="skip-link" href="#dayline-main">Skip to content</a>
      <div className="dayline-shell">
        <header className="app-header"><div className="brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>Dayline</span></div>
          <button type="button" className="icon-button" aria-label={data.settings.theme === "dark" ? "Use light theme" : "Use dark theme"} onClick={() => perform(() => store.setTheme(data.settings.theme === "dark" ? "light" : "dark"))}>{data.settings.theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}</button>
        </header>
        <main className="app-main" id="dayline-main">
          <div className="page-heading"><h1>{tab === "today" ? day === today ? "Your day" : "Your plan" : TABS.find((item) => item.id === tab)?.label}</h1><p>{tab === "today" ? "Make room for what matters." : tab === "activity" ? "A record of what you actually did." : tab === "notes" ? "Thoughts, ideas, and things to remember." : "Make Dayline work for you."}</p></div>
          {storageError && <div className="message error" role="alert"><strong>Your changes may not be saved.</strong><p>{storageError}</p><button type="button" className="text-button" onClick={exportData}>Export a copy</button></div>}
          {error && <div className="message error" role="alert">{error}<button type="button" className="icon-button" aria-label="Dismiss message" onClick={() => setError(null)}><X size={17} /></button></div>}
          {notice && modal === null && <div className="message success" role="status">{notice}<button type="button" className="icon-button" aria-label="Dismiss message" onClick={() => setNotice(null)}><X size={17} /></button></div>}
          {!hydrated || !day || !today ? <p role="status">Opening your day…</p> : <>
            {tab !== "settings" && <section className="day-selector" aria-label="Selected day">
              <button type="button" className="icon-button" aria-label="Previous day" disabled={day <= "1970-01-01"} onClick={() => setChosenDay(addLocalDays(day, -1))}><ChevronLeft size={20} /></button>
              <label className="day-display"><span>{dateLabel(day)}</span><input type="date" aria-label="Choose day" min="1970-01-01" max="9999-12-31" value={day} onChange={(event) => { if (isDateKey(event.target.value)) setChosenDay(event.target.value === today ? null : event.target.value); }} /></label>
              <button type="button" className="icon-button" aria-label="Next day" disabled={day >= "9999-12-31"} onClick={() => setChosenDay(addLocalDays(day, 1))}><ChevronRight size={20} /></button>
              {day !== today && <button type="button" className="text-button" onClick={() => setChosenDay(null)}>Today</button>}
            </section>}
            {tab === "today" && <>
              <section className="day-overview" aria-label="Daily progress"><div className="progress-copy"><p className="progress-number">{completed}<span> / {tasks.length}</span></p><p>{tasks.length === 0 ? "Your day is ready to plan" : completed === tasks.length ? "Everything on your list is done" : "tasks completed"}</p></div>
                <div className="progress-track" role="progressbar" aria-label="Completed tasks" aria-valuemin={0} aria-valuemax={tasks.length || 1} aria-valuenow={completed}><span style={{ width: `${tasks.length ? completed / tasks.length * 100 : 0}%` }} /></div>
                {next && <div className="next-task"><Clock3 size={16} /><span>{day === today ? "Next" : "Coming up"} <strong>{timeLabel(next.time)}</strong></span><span>{next.title}</span></div>}
              </section>
              {tasks.some((item) => item.reminder) && (!data.settings.remindersEnabled || reminders.status?.permission === "denied" || reminders.status?.supported === false) && <div className="reminder-hint"><BellOff size={18} /><p>{reminders.status?.supported === false ? "Background reminders are available in the Android app." : "Turn on phone reminders to receive notifications for these tasks."}</p><button type="button" className="text-button" onClick={() => setTab("settings")}>Reminder settings</button></div>}
              <div className="section-heading"><h2>Schedule</h2><button type="button" className="primary compact" onClick={newTask}><Plus size={17} />Add task</button></div>
              {tasks.length ? <ul className="task-list">{tasks.map((item) => {
                const done = Boolean(data.completions[item.occurrenceKey]);
                return <li className={cn("task-row", done && "is-done")} key={item.occurrenceKey}>
                  <button type="button" className="completion-button" aria-label={`${done ? "Mark not done" : "Mark done"}: ${item.title}`} aria-pressed={done} disabled={day > today} title={day > today ? "Complete this task on its scheduled day" : undefined} onClick={() => perform(() => store.toggleComplete(item.id, day))}><span><Check size={17} /></span></button>
                  <div className="task-body"><div className="task-meta"><span>{timeLabel(item.time)}</span>{item.durationMinutes > 0 && <span>{item.durationMinutes} min planned</span>}{item.reminder && <Bell size={13} aria-label="Reminder enabled for this task" />}</div><h3>{item.title}</h3>{item.notes && <p className="task-note">{item.notes}</p>}{item.repeat !== "none" && <p className="repeat-label">{REPEATS[item.repeat]}</p>}</div>
                  {!past && <button type="button" className="icon-button" aria-label={`Edit task: ${item.title}`} onClick={() => editTask(item)}><Pencil size={17} /></button>}
                </li>;
              })}</ul> : <Empty icon={<CalendarDays size={28} />} title="A little space for your plans" text={past ? "There were no tasks planned for this day. You can still record an activity or write a note." : "Add something you want to do. Give it a time, or leave it open for later."}>{!past && <button type="button" className="text-button" onClick={newTask}>Add your first task</button>}</Empty>}
              {past && tasks.length > 0 && <p className="help">Past plans stay in your history when you change or archive a task.</p>}
              <section className="quick-note"><FileText size={18} /><div><h2>{day === today ? "Today’s note" : "Day’s note"}</h2><p>{data.notes[day]?.text || "Keep a thought from this day."}</p></div><button type="button" className="text-button" onClick={() => setTab("notes")}>{data.notes[day]?.text ? "Open note" : "Write a note"}</button></section>
            </>}
            {tab === "activity" && <>
              <section className="activity-overview"><div><strong>{minutes}</strong><span>minutes logged</span></div><div><strong>{completionRecords.length}</strong><span>tasks completed</span></div></section>
              <div className="section-heading"><h2>Activity log</h2><button type="button" className="primary compact" onClick={newActivity}><Plus size={17} />Log activity</button></div>
              {!activities.length && !completionRecords.length && <Empty icon={<ClipboardList size={28} />} title="What did you do today?" text="Record your work, study, exercise or anything else you want to remember."><button type="button" className="text-button" onClick={newActivity}>Log your first activity</button></Empty>}
              {activities.length > 0 && <ul className="record-list">{activities.map((item) => <li key={item.id}><span className="record-icon"><Clock3 size={18} /></span><div><h3>{item.title}</h3><p className="record-meta">{item.minutes} min logged</p>{item.notes && <p>{item.notes}</p>}</div><button type="button" className="icon-button" aria-label={`Delete activity: ${item.title}`} onClick={() => ask({ title: "Delete this activity?", description: `This removes “${item.title}” from your activity log.`, label: "Delete activity", previous: null, action: () => { if (perform(() => store.deleteActivity(item.id), "Activity deleted.", true)) setModal(null); } })}><Trash2 size={17} /></button></li>)}</ul>}
              {completionRecords.length > 0 && <section className="completed-records"><h2>Completed tasks</h2><ul className="record-list">{completionRecords.map((item) => <li key={`${item.taskId}@${item.date}`}><span className="record-icon"><Check size={18} /></span><div><h3>{item.title}</h3><p className="record-meta">{item.completedAt ? new Date(item.completedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "Time not recorded"}</p></div></li>)}</ul></section>}
            </>}
            {tab === "notes" && <section className="notes-section"><div className="section-heading"><h2>{day === today ? "Today’s note" : "Day’s note"}</h2><span className={cn("save-status", noteUnsaved && "not-saved")} role="status">{noteUnsaved ? "Not saved — keep a copy" : "Saved on this device"}</span></div><label className="sr-only" htmlFor="daily-note">Daily note</label><textarea id="daily-note" className="daily-note" value={noteText} maxLength={50000} placeholder="What went well? What do you want to remember?" onChange={(event) => { const text = event.target.value; setNoteDrafts((old) => ({ ...old, [day]: text })); perform(() => store.saveNote(day, text)); }} /><p className="help">Your note saves as you write. Each day has its own page.</p>{noteUnsaved && <button type="button" className="secondary" onClick={() => perform(() => store.saveNote(day, noteText), "Note saved.")}>Try saving again</button>}</section>}
            {tab === "settings" && <>
              <section className="settings-section"><div className="section-heading"><h2>Phone reminders</h2><Bell size={20} /></div><p>{reminders.status?.message ?? "Checking reminder support…"}</p>
                {reminders.error && <p className="inline-error" role="alert">{reminders.error}</p>}
                {reminders.status?.supported && <><div className="setting-line"><div><strong>Task reminders</strong><p>{data.settings.remindersEnabled ? "Enabled for tasks with a reminder time" : "Off until you enable them"}</p></div><button type="button" className={data.settings.remindersEnabled ? "secondary" : "primary"} disabled={busy} onClick={() => { if (data.settings.remindersEnabled) perform(() => store.setRemindersEnabled(false)); else void runAsync(async () => { const status = await enableReminders(); if (status.permission === "granted") store.setRemindersEnabled(true); else setNotice("Allow notifications in Android Settings → Apps → Dayline, then return here."); await reminders.refresh(); }); }}>{data.settings.remindersEnabled ? "Turn off" : "Enable reminders"}</button></div>
                  <div className="setting-line"><div><strong>Reminder timing</strong><p>{reminders.status.exact ? "Precise alarms are available" : "Android may delay reminders without alarm access"}</p></div>{!reminders.status.exact && <button type="button" className="secondary" disabled={busy} onClick={() => { void runAsync(async () => { await openExactAlarmSettings(); await reminders.refresh(); }); }}>Allow precise timing</button>}</div>
                  <button type="button" className="secondary full-width" disabled={busy || reminders.status.permission !== "granted"} onClick={() => { void runAsync(async () => { await sendTestReminder(); setNotice("Test reminder scheduled for about 10 seconds from now. Lock your screen to check it."); }); }}><Bell size={17} />Send a test reminder</button>
                  <p className="help">After a force-stop in Android settings, open Dayline again to restore alarms. Device power settings can affect delivery.</p></>}
              </section>
              <section className="settings-section"><h2>Appearance</h2><div className="setting-line"><div><strong>Dark theme</strong><p>A quieter screen in the evening</p></div><button type="button" className="secondary" aria-pressed={data.settings.theme === "dark"} onClick={() => perform(() => store.setTheme(data.settings.theme === "dark" ? "light" : "dark"))}>{data.settings.theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}{data.settings.theme === "dark" ? "Use light" : "Use dark"}</button></div></section>
              <section className="settings-section"><h2>Your data</h2><p>Tasks, activity and notes stay on this device. Keep a backup outside the app before moving phones or uninstalling.</p><div className="button-row"><button type="button" className="primary" onClick={exportData}><Download size={17} />Export backup</button><button type="button" className="secondary" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={17} />Choose backup file</button></div><button type="button" className="text-button" onClick={() => { setRestoreText(""); open("restore"); }}>Paste a backup instead</button><input ref={fileInput} className="sr-only" tabIndex={-1} type="file" accept="application/json,.json" aria-label="Backup file" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void readFile(file); }} /><p className="help">Browser data and Android data are separate. Export here and import on the other device.</p></section>
              <p className="about">Dayline · Android candidate 0.1.0</p>
            </>}
          </>}
        </main>
        <nav className="bottom-nav" aria-label="Main navigation">{TABS.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={cn(tab === id && "active")} aria-current={tab === id ? "page" : undefined} onClick={() => { setTab(id); setNotice(null); }}><Icon size={21} /><span>{label}</span></button>)}</nav>
      </div>
      <Dialog.Root open={modal !== null} onOpenChange={(value) => { if (!value) setModal(null); }}><Dialog.Portal><Dialog.Overlay className="modal-overlay" /><Dialog.Content className="modal-content"><div className="modal-heading"><Dialog.Title>{modalTitle}</Dialog.Title><Dialog.Close className="icon-button" aria-label="Close dialog"><X size={20} /></Dialog.Close></div><Dialog.Description className="modal-description">{modalDescription}</Dialog.Description>
        {formError && <p className="inline-error" role="alert">{formError}</p>}
        {modal === "task" && task && <form className="form-stack" onSubmit={saveTask}>
          <Field label="Task name" id="task-name"><input id="task-name" autoFocus required maxLength={300} value={task.title} onChange={(event) => setTask({ ...task, title: event.target.value })} placeholder="Study NumPy for 30 minutes" /></Field>
          <div className="form-grid"><Field label={task.repeat === "none" ? "Date" : "Starts on"} id="task-date"><input id="task-date" type="date" required min={task.id ? "1970-01-01" : today ?? undefined} max="9999-12-31" value={task.date} onChange={(event) => setTask({ ...task, date: event.target.value })} /></Field><Field label="Time (optional)" id="task-time"><input id="task-time" type="time" value={task.time} onChange={(event) => setTask({ ...task, time: event.target.value })} /></Field></div>
          <div className="form-grid"><Field label="Planned minutes" id="task-minutes"><input id="task-minutes" type="number" min={1} max={1440} required step={1} value={task.durationMinutes} onChange={(event) => setTask({ ...task, durationMinutes: Number(event.target.value) })} /></Field><Field label="Repeat" id="task-repeat"><select id="task-repeat" value={task.repeat} onChange={(event) => setTask({ ...task, repeat: event.target.value as TaskInput["repeat"] })}>{Object.entries(REPEATS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></div>
          <Field label="Task notes (optional)" id="task-notes"><textarea id="task-notes" rows={3} maxLength={20000} value={task.notes} onChange={(event) => setTask({ ...task, notes: event.target.value })} /></Field>
          <label className="checkbox-field"><input type="checkbox" checked={task.reminder} onChange={(event) => setTask({ ...task, reminder: event.target.checked })} /><span>Remind me at the task time<small>Enable phone reminders in Settings.</small></span><Bell size={17} /></label>
          <div className="form-actions">{task.id && <button type="button" className="text-button danger" onClick={() => { const id = task.id!; ask({ title: "Archive this task?", description: "This removes the task from today and future plans. Earlier plans and completed activity stay in history.", label: "Archive task", previous: "task", action: () => { if (perform(() => store.archiveTask(id), "Task archived.", true)) setModal(null); } }); }}>Archive task</button>}<button type="submit" className="primary" disabled={!task.title.trim()}>Save task</button></div>
        </form>}
        {modal === "activity" && activity && <form className="form-stack" onSubmit={saveActivity}>
          <Field label="What did you do?" id="activity-title"><input id="activity-title" autoFocus required maxLength={300} value={activity.title} onChange={(event) => setActivity({ ...activity, title: event.target.value })} /></Field>
          <div className="form-grid"><Field label="Date" id="activity-date"><input id="activity-date" type="date" required min="1970-01-01" max={today ?? "9999-12-31"} value={activity.date} onChange={(event) => setActivity({ ...activity, date: event.target.value })} /></Field><Field label="Actual minutes" id="activity-minutes"><input id="activity-minutes" type="number" min={1} max={1440} step={1} required value={activity.minutes} onChange={(event) => setActivity({ ...activity, minutes: Number(event.target.value) })} /></Field></div>
          <Field label="Activity notes (optional)" id="activity-notes"><textarea id="activity-notes" rows={3} maxLength={20000} value={activity.notes} onChange={(event) => setActivity({ ...activity, notes: event.target.value })} /></Field><div className="form-actions"><button type="submit" className="primary" disabled={!activity.title.trim()}>Save activity</button></div>
        </form>}
        {modal === "export" && <div className="form-stack">{notice && <p className="help" role="status">{notice}</p>}<div className="button-row"><button type="button" className="primary" disabled={busy} onClick={() => { void runAsync(async () => { const result = await saveBackupFile(backup); setNotice(result === "shared" ? "Backup file prepared for sharing." : "Backup download started."); }, true); }}><Download size={17} />Save JSON file</button><button type="button" className="secondary" disabled={busy} onClick={() => { void runAsync(async () => { if (!navigator.clipboard) throw new Error("Select the backup text below and copy it."); await navigator.clipboard.writeText(backup); setNotice("Backup copied."); }, true); }}>Copy backup</button></div><Field label="Backup text" id="backup-text"><textarea id="backup-text" className="backup-text" readOnly value={backup} onFocus={(event) => event.target.select()} /></Field></div>}
        {modal === "restore" && <div className="form-stack"><Field label="Backup JSON" id="restore-json"><textarea id="restore-json" className="backup-text" value={restoreText} maxLength={MAX_BACKUP_BYTES} onChange={(event) => setRestoreText(event.target.value)} placeholder="Paste your Dayline backup here" /></Field><button type="button" className="primary" disabled={!restoreText.trim()} onClick={reviewRestore}>Review restore</button></div>}
        {modal === "confirm" && confirmation && <div className="button-row confirm-actions"><button type="button" className="secondary" onClick={() => { setModal(confirmation.previous); setFormError(null); }}>Cancel</button><button type="button" className="primary danger-button" onClick={confirmation.action}>{confirmation.label}</button></div>}
      </Dialog.Content></Dialog.Portal></Dialog.Root>
    </div>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) { return <div className="field"><label htmlFor={id}>{label}</label>{children}</div>; }
function Empty({ icon, title, text, children }: { icon: ReactNode; title: string; text: string; children?: ReactNode }) { return <section className="empty-state"><span className="empty-icon" aria-hidden="true">{icon}</span><h3>{title}</h3><p>{text}</p>{children}</section>; }
