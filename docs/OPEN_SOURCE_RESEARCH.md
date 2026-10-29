# Dayline Android: open-source implementation research

Reviewed on 29 October 2026. This document records source inspection, not physical
Android acceptance. Links pin the exact revisions inspected. The research task
retrieved the reminder/action implementation files through the GitHub connector.

## Decision

Continue Dayline's React interface and package a separate static mobile bundle in
Capacitor. Use Android-local alarms and persisted schedule state for phone reminders.
No account, server, Firebase, or hosted web page is required for this version.

Super Productivity, Tasks.org and Vikunja are design references. Their application
source was not copied into Dayline. Merging an Angular/Kotlin/Go application into
Dayline would add a second framework and storage model without solving its small
personal-planning scope. The selected native reminder bridge is app-local Java.

## Inspected projects

| Project | Inspected commit | License | Useful patterns |
| --- | --- | --- | --- |
| [Super Productivity](https://github.com/super-productivity/super-productivity) | `f958c66b220ddc1f38f8c75e0a06623dfb06e916` | MIT | Persistent native alarms, reboot restoration, native Snooze/Done and frontend replay queue |
| [Tasks.org](https://github.com/tasks/tasks) | `4d7792727f1a96c92410fa00665a5e657681600f` | GPL-3.0 | Persisted snooze/dismissal, transactional state changes, quiet hours and alarm selection |
| [Vikunja](https://github.com/go-vikunja/vikunja) | `b5a39a32457a29a2093754f89c8cd7586b558451` | AGPL-3.0-or-later | Separate reminder identity, completed/deleted exclusions, absolute/relative times and time zones |
| [Capacitor 8.6.0](https://github.com/ionic-team/capacitor) | `ef3ce6e4edfbc90b678f37138f387d1f524d6b35` | MIT | Supported Android bridge, project template and toolchain |

### Super Productivity

The inspected
[ReminderActionReceiver.kt](https://github.com/super-productivity/super-productivity/blob/f958c66b220ddc1f38f8c75e0a06623dfb06e916/android/app/src/main/java/com/superproductivity/superproductivity/receiver/ReminderActionReceiver.kt)
handles notification actions in native Android code. A Snooze action can arm another
alarm without starting the frontend. Done records a native exclusion and queues a
frontend update. Related implementation:

- [ReminderAlarmStore.kt](https://github.com/super-productivity/super-productivity/blob/f958c66b220ddc1f38f8c75e0a06623dfb06e916/android/app/src/main/java/com/superproductivity/superproductivity/service/ReminderAlarmStore.kt)
  persists alarm parameters in SharedPreferences.
- [BootReceiver.kt](https://github.com/super-productivity/super-productivity/blob/f958c66b220ddc1f38f8c75e0a06623dfb06e916/android/app/src/main/java/com/superproductivity/superproductivity/receiver/BootReceiver.kt)
  restores alarms after boot or package replacement.

For Dayline, this motivates durable native scheduling and an acknowledged action
queue. Completion must be written to planner storage before its native action is
acknowledged. Numeric hash identities alone need collision handling; Dayline uses
explicit PendingIntent identities containing generation and schedule token.

### Tasks.org

The inspected
[AlarmService.kt](https://github.com/tasks/tasks/blob/4d7792727f1a96c92410fa00665a5e657681600f/kmp/src/commonMain/kotlin/com/todoroo/astrid/alarms/AlarmService.kt)
replaces previous snooze records, records dismissal changes transactionally, and
chooses the applicable pending alarm rather than allowing an ordinary alarm to
bypass a later snooze. It also makes quiet-hours behavior explicit.

Use these as behavioral requirements. No GPL application code is transplanted into
Dayline. Quiet hours are not a feature claimed for this first candidate.

### Vikunja

The inspected
[task_reminder.go](https://github.com/go-vikunja/vikunja/blob/b5a39a32457a29a2093754f89c8cd7586b558451/pkg/models/task_reminder.go)
models absolute reminder times and offsets relative to a task's due/start/end date.
Its server scans reminders, excludes completed or deleted tasks, evaluates users'
time zones and dispatches notifications. This is useful reminder semantics, but its
server scheduler is not an Android offline-delivery mechanism.

No AGPL application source is copied into Dayline.

## Capacitor and Android build selection

Use the pinned dependency versions selected for this candidate:

| Component | Version or requirement |
| --- | --- |
| `@capacitor/core`, `@capacitor/android`, `@capacitor/cli` | `8.6.0` |
| `@capacitor/app` | `8.1.0` |
| `@capacitor/filesystem` | `8.1.5` |
| `@capacitor/share` | `8.0.3` |
| Node | 22 or newer; validation uses Node 24 |
| Java | JDK 21 |
| Android SDK | Minimum API 24; compile/target API 36 |
| Android Gradle Plugin | 8.13.0 from the Capacitor 8.6.0 template |
| Gradle wrapper | 8.14.3 from the Capacitor 8.6.0 template |

The pinned
[Android template variables](https://github.com/ionic-team/capacitor/blob/ef3ce6e4edfbc90b678f37138f387d1f524d6b35/android-template/variables.gradle)
confirm the SDK levels. See the
[Android build configuration](https://github.com/ionic-team/capacitor/blob/ef3ce6e4edfbc90b678f37138f387d1f524d6b35/android/capacitor/build.gradle)
and [official environment setup](https://capacitorjs.com/docs/getting-started/environment-setup).

The official Local Notifications plugin 8.3.1 was also reviewed during planning.
Its separate repository is
[ionic-team/capacitor-local-notifications](https://github.com/ionic-team/capacitor-local-notifications/tree/6fa25dff7ee371f50a1b8ea2e02369326a128141).
Its action buttons launch the app through an activity PendingIntent; JavaScript
callbacks alone do not provide silent background Done/Snooze. It persists schedules
and restores after reboot, but a finite pre-scheduled horizon would still need native
replenishment or an explicit limit. Dayline instead uses an original native bridge,
so this plugin is not an installed runtime dependency.

## Requirements carried into the implementation

- Native scheduling continues after the WebView closes, with no browser timer as
  the delivery mechanism. Recurring tasks re-arm natively rather than expiring
  after a fixed number of precomputed days.
- Ordinary notification permission and exact-alarm access are separate. Permission
  requests are user initiated; the app must report reduced precision honestly.
- Schedule and action identities include dataset generation and schedule token.
  A stale alarm or notification action cannot mutate a replacement dataset.
- Done and Snooze survive normal process death. Failed planner writes retain the
  native action for retry, and retry must be idempotent.
- Restoring a backup creates a fresh durable generation. Old action queues,
  snoozes, delivery markers and alarms are reset after the planner write succeeds.
- Editing a delivered task to a new future time can re-arm that changed occurrence;
  merely reopening the app must not duplicate the unchanged reminder.
- Boot, package replacement, wall-clock/time-zone changes and exact-permission
  changes are distinct restoration cases.

Official behavior references:
[Android alarm scheduling](https://developer.android.com/develop/background-work/services/alarms)
and [Capacitor Local Notifications API](https://capacitorjs.com/docs/apis/local-notifications).

## Attribution and acceptance

Super Productivity's
[MIT license](https://github.com/super-productivity/super-productivity/blob/f958c66b220ddc1f38f8c75e0a06623dfb06e916/LICENSE)
requires its notice to accompany copied/adapted source. No such application source
is included in this candidate. Tasks.org and Vikunja remain source-linked design
references. Preserve the notices distributed with Capacitor and other packaged
MIT/BSD dependencies; the mobile build includes third-party notices.

A successful APK build, fake-bridge test or JVM calculator test is not evidence of
physical phone delivery. Lock-screen, app-closed, idle/Doze, reboot, notification
permission, exact-alarm access, snooze, duplicates and restore behavior remain
separate device acceptance checks. Force-stop and a powered-off phone must not be
represented as ordinary app closure.
