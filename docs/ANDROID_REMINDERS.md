# Android reminders and acceptance

Candidate: Dayline 0.1.0, Android API24+. Source/unit/build checks do not prove
physical delivery on a particular phone.

## Implementation

The APK bundles a static React interface locally through Capacitor. It does not
load a remote SSR page. Tasks, activities and notes remain on the device; native
reminders need no account, server, Firebase or internet connection.

The original `DaylineReminders` Java bridge mirrors task revisions, completion
exclusions, reminder setting and a durable dataset generation to SharedPreferences.
Only schedule state crosses that bridge; daily notes and activity logs do not.
Android AlarmManager holds the next occurrence of each timed task. The native
receiver posts it and arms the next occurrence, so daily, weekday and weekly
recurrence continues while the WebView is closed, without a rolling 30-day horizon.
A weekly task stays anchored to its chosen start date.

Notification **Done** and **Snooze 10 min** actions run in a native receiver without
opening the interface. Snoozes are persisted one-off alarms. Done appends a durable
completion event; pending events immediately exclude the occurrence from native
scheduling. React imports the original title/time/timestamp snapshot idempotently,
persists it, mirrors the saved completion, and only then acknowledges the event.
Java Instant precision is normalized to canonical JS milliseconds. A storage failure
leaves the event pending. Same-day archive/edit does not destroy that snapshot.

A successful backup restore atomically writes a new planner generation. Native
configuration resets the previous generation's alarms, shown notifications, actions,
snoozes and delivery markers before reading its queue. A failed backup write leaves
both the planner generation and active native state unchanged. This handshake also
recovers after process death between the planner write and native reconciliation.

All alarm and action PendingIntents include the dataset generation and schedule
token. Receivers validate both before mutating state. Tokens include occurrence,
time and title, allowing a delivered 09:00 task to be intentionally rescheduled to
14:00 without suppressing the new reminder. Refreshing an unchanged schedule does
not duplicate that delivery. Frontend reconciliation is serialized and re-reads the
durable generation after asynchronous handoffs, including a restore racing queue
reads or configuration.

Reboot (after unlock), package replacement, wall-clock/time-zone change and exact
alarm access grant trigger native reconstruction. Calendar calculations follow the
phone's local time zone. DST gaps move the time forward; overlaps use the first
offset. Historical task revisions remain unchanged by current edits.

## Device behavior and limits

- Notifications are requested only after the user enables reminders.
- Android notification permission and **Alarms & reminders** access are separate.
  Without exact access, native alarms use inexact allow-while-idle delivery and the
  interface reports possible delay.
- Force-stopping from Android settings blocks alarms until Dayline is opened again.
  Swiping the app away is a different operation. Manufacturer battery policies and
  Android idle quotas can delay closely spaced notifications.
- Normal foreground reconciliation preserves an already-armed valid alarm if Android
  is delaying it past its due time. Editing a different task does not drop that alert.
- A powered-off phone cannot notify. Ordinary occurrences already in the past are
  skipped during recovery and remain incomplete in the dashboard. A persisted
  overdue snooze is retried shortly after recovery.
- One next alarm is armed per active timed task, plus snoozes/tests. Android imposes
  per-app alarm limits; this candidate targets a personal daily list and does not
  claim unlimited simultaneous reminders. Large-scale scheduling needs a batching
  dispatcher before increasing that scope.
- Normal backup replacement intentionally discards old pending phone actions and
  snoozes. Browser and Android storage are separate; transfer data by backup.
- Uninstalling removes app-local data. Save a backup outside the app before doing so.

## Physical-phone acceptance: not yet run

Use disposable tasks and export existing data first. Record model, Android version,
notification permission, exact-alarm access, battery policy, scheduled and actual times.

| Check | Steps | Pass condition |
|---|---|---|
| Permission denied | Deny notification permission; enable reminders. | Settings explains permission is blocked; no delivery success claim. |
| Test reminder | Allow notifications, send test, lock screen. | One notification appears about ten seconds later under normal conditions. |
| Closed app | Set task a few minutes ahead, swipe app away, lock screen. | Exactly one reminder appears without internet or open WebView. |
| Native Done | Tap Done while app closed, reopen later. | Correct date completed once, original snapshot/action time preserved. |
| Native Snooze | Tap Snooze 10 min, keep app closed. | One reminder returns around ten minutes later; reopening does not duplicate it. |
| Change/cancel | Edit time, disable, archive or complete before due. | Old alarm does not arrive; revised enabled time arrives once. |
| Reschedule delivered | Receive 09:00 reminder, move it to later time. | New time can notify once; unchanged refresh does not duplicate. |
| Reboot | Schedule future task; reboot, unlock once, close app. | Reminder restored and arrives once. |
| Snooze reboot | Snooze then reboot/unlock before due. | Snooze survives and arrives once. |
| Recurrence | Daily, weekday and weekly tasks across occurrences. | Recurrence continues natively; weekends skipped and weekly anchor retained. |
| Midnight | Keep interface open across local midnight. | Today advances; deliberately selected historical date stays selected. |
| Time-zone change | Change zone with future reminders and app closed. | Future tasks follow local wall-clock time without duplicates. |
| Backup boundary | Queue Done and snooze, restore older backup. | Stale actions/snoozes do not alter replacement data. |
| Inexact fallback | Deny exact alarms, reopen. | Settings reports possible delay and schedules with fallback. |
| Force-stop recovery | Force-stop, then reopen Dayline. | Future alarms rebuilt; missed delivery during force-stop is not falsely claimed. |

JVM tests cover calendar calculation and identity rejection. Fake-bridge tests cover
persistence/ACK ordering, generation replacement and async races. They do not test
the real Android alarm service, lock screen or manufacturer battery restrictions.

## Open-source references

See [OPEN_SOURCE_RESEARCH.md](OPEN_SOURCE_RESEARCH.md) for inspected immutable source
links and license distinctions. Super Productivity, Tasks.org and Vikunja informed
behavioral requirements. No application source from those planners was copied;
the app-local Java/TypeScript reminder implementation is original.
