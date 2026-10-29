# Dayline Android candidate: implementation contract

Source baseline main d5b94503c8c3b32502edad558eb1c0e5c4a78edc; work only on feat/android-day-planner.
User wants Android phone dashboard, dated tasks, actual activity, daily/task notes, offline native
reminders, Done/Snooze, backup/restore. No accounts/server/sync/AI in this candidate. Existing web
shell stays. Reuse React as static mobile Vite bundle + Capacitor8.6.0. Node24, JDK21, SDK36.

## Non-overlapping ownership

- Data agent: planner.ts, planner-store.ts, planner*.test.ts only.
- UI agent: routine-app.tsx, styles.css, use-local-day.ts only.
- Native agent: reminders*.ts, use-reminders.ts, android/, mobile/, vite.mobile.config.ts,
  capacitor.config.ts, docs/ANDROID_REMINDERS.md only (parent owns mobile/public notices).
- Research/test agent: docs/OPEN_SOURCE_RESEARCH.md and scripts/*.test.mjs portability fixes only.
- Parent: package files, backup-files.ts, CI/README/integration, tests/builds, GitHub persistence.

Shared types fixed in src/lib/planner-types.ts. Coordinate additions, never edit others' files.
Pure modules/tests use explicit relative .ts imports for Node TS stripping. No agent commits,
dependency installation or cap sync unless parent says ready. Parent checkpoints each completed part.

## Data API

planner.ts exports localDateKey(now?), addLocalDays(date,delta), isDateKey, occurrenceKey(taskId,date),
getDayTasks(tasks,date):DayTask[] sorted, createEmptyPlanner():PlannerData, MAX_BACKUP_BYTES (5MiB),
validatePlannerData(raw):PlannerData (throws), parsePlannerBackup(json), migrateLegacyRoutine(raw,today).
Task revisions effective per local calendar day; edits/archive today never rewrite earlier plans.
Completion snapshots survive archive/edit. No fake seed data; new store empty.

usePlannerStore returns {data,hydrated,storageError,hydrate,addTask(input):string,
updateTask(id,input),archiveTask(id),toggleComplete(id,date),completeTask(id,date,completedAt?),
importNativeCompletion(snapshot:Completion,generation:string),addActivity(input):string,
deleteActivity(id),saveNote(date,text),setTheme(theme),setRemindersEnabled(bool),exportBackup():string,
restoreBackup(json):void}. createPlannerStore({storage?,now?,createId?}) for meaningful tests.
Native import validates known task ID+same generation+snapshot and persists idempotently even after
same-day archive/edit; actual timestamp must be nonnull. No overwrite of existing completion.
Every write persists BEFORE updating state. Bad/full/unavailable storage must be visible and never
replace unreadable saved bytes. Storage key dayline.planner.v2; migrate dayline.routine.v1 only if v2
absent, keep v1 untouched. Legacy unknown completedAt=null, removed IDs 'Archived habit'. Creation
dates/old denominators cannot be perfectly recovered; document limitation, no invented noon times.
Backup strict full validation: sizes/date/time/finite bounds/duplicate ids/key match/revision ordering.
Generation is durable UUID/bounded nonempty id. Normal writes preserve it; successful restore fully
validates then atomically persists a fresh generation. Failed restore leaves old data/generation.

## UI

Preserve Dayline paper/leaf Figtree/Fraunces identity, responsive mobile safe areas, 44px actions,
accessible dialogs, focus, empty/error states. Tabs Today / Activity / Notes / Settings. Today tasks,
progress,next task,date selector; task add/edit/archive with date,time,duration,repeat,reminder,notes.
Activity logs actual work/duration/notes and completed snapshots (unknown legacy time labelled).
Daily notes save with visible state. Date updates across midnight/focus but selected past day stays.
No future task completion; new tasks not in past (activity/notes may be historical).
Settings theme/native permission+precision/status/test, backup export/import/paste with confirmation.
Use parent saveBackupFile(json):Promise<'shared'|'downloaded'> from backup-files.ts, with copy-text
fallback. All limits share MAX_BACKUP_BYTES. No claims browser timers deliver Android background alerts.

## Native APIs and invariants

reminders.ts exports getReminderStatus(), enableReminders(), openExactAlarmSettings(), sendTestReminder().
useReminders(): {status:ReminderStatus|null,error:string|null,refresh:()=>Promise<void>}.
Use original app-local Capacitor Java bridge registered DaylineReminders. Native AlarmManager
owns next occurrence/repeating schedules, persists schedule mirror+completion exclusions+snoozes+
delivered markers+Done queue. Re-arm on receipt indefinitely; restore boot/unlock, package replace,
time/zone change, exact permission grant. Done and Snooze10min can run without launching WebView.
Permission requests user initiated; exact denied -> inexact and honest status. Force-stop requires
reopen. Powered-off missed ordinary tasks stay incomplete/skipped; overdue snooze retry shortly.

Mirror {generation,tasks,completions:{key:true},settings:{remindersEnabled}}. Bridge configure({data}),
pendingActions():{actions:unknown[]}, acknowledge({ids}). Queued done {id,generation,type:'done',
taskId,date,title,scheduledTime,completedAt}. JS normalizes Java Instant precision to canonical JS ISO.
Configure generation before draining: native new generation resets prior alarms/notifs/actions/
snoozes/overlay/delivered state. Normal same-gen configure preserves pending actions. Serialize JS
reconcile, re-read latest state inside queue and handle restore racing awaits. Import native snapshot
atomically, mirror saved completions before ACK; storage error must retain action/no sync.
Delivery token includes occurrence+time/title so rescheduling an already-fired task can re-alert.
ALL alarm and action PendingIntents include generation+token identities; reject stale before mutation.
No hash collision identity; explicit URI per occurrence. Unit-test date/DST/recurrence/cancel/id/replay/
restore/failure races; JVM calculator + identity tests. No copied GPL/AGPL source.

## Packaging and proof

Parent pins core/android/cli8.6.0, app8.1.0, filesystem8.1.5,share8.0.3 (no unused local-notifications).
Static mobile/index.html/main.tsx uses same RoutineApp, vite.mobile.config.ts output dist-mobile,
publicDir mobile/public (notices). appId app.dayline.planner, versionName0.1.0/versionCode1/min24.
Original Dayline vector launcher/splash, no platform default icon. No remote SSR URL or external
fonts needed for APK. Preserve original web vite config/branding/shell; parent handles preview host.
Commit native sources/wrapper, exclude keystores/local.properties/build outputs/copied web assets.
Parent builds APK, web/mobile bundles, typechecks, test suites and UI. Physical phone delivery is a
separate acceptance gate; never claim hardware tests done. Research docs pin exact inspected repos.
