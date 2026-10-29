# Dayline

An Android day planner with a browser companion. Plan tasks, record what you
actually did, keep daily notes, and receive device-local reminders. No account,
server, or internet connection is needed for the Android routine.

## Android candidate 0.1.0

- **Today:** dated tasks, planned duration, task notes, completion, and next task.
- **Repeating tasks:** once, daily, Monday–Friday, or weekly from the start date.
- **Activity:** record actual work, its duration and notes, including unplanned work.
- **Notes:** one page per day, saved on the device.
- **Phone reminders:** native alarms, Done and Snooze 10 min, reboot restoration.
- **Settings:** theme, notification permission/precision, test reminder, JSON backup.

This is a test candidate. Automated tests and APK compilation do not prove delivery
on your particular phone. [Android acceptance](docs/ANDROID_REMINDERS.md) separates
verified software behavior from physical lock-screen, reboot, idle and permission
checks that still require an Android device.

## Use the Android app

Install the APK on Android 7 or newer. In **Settings → Phone reminders**, enable
notifications and allow **Alarms & reminders** for precise timing. Send a test
notification, then create a task a few minutes ahead and lock the screen. Android
schedules the alert; a web page does not need to stay open.

Normal reboot recovery occurs after the phone is unlocked. Force-stopping Dayline
from Android settings blocks alarms until you open it again. When exact alarms are
not permitted, the app reports possible delay. The receiver keeps repeating tasks
going without needing to reopen the app every month.

Data is local to this app on this phone. Browser and Android storage are separate.
To move an existing routine, open the browser that contains it, export its backup,
then import that backup on Android. **Save JSON file** uses Android's share sheet;
choose a destination outside the app. Export before uninstalling or changing phones.

The candidate is debug-signed, not a Play Store release. Android requires the same
signing certificate for an in-place update. If a later candidate uses another
certificate, back up before replacing the installation.

## Existing data and backups

First launch migrates `dayline.routine.v1` only when no v2 planner exists. Original
v1 bytes remain untouched. Task edits and archives use calendar-day revisions, so
earlier plans and completion snapshots are preserved.

The old format did not store creation dates or completion times. Migration uses the
earliest known recorded day as its history boundary, leaves unknown completion
times unknown, and retains removed habit completions as **Archived habit** snapshots.
It cannot reconstruct information the original format never recorded.

A backup is validated completely before replacement. Failed restores preserve saved
bytes and reminder identity. A successful restore commits a new dataset generation;
old pending phone actions, alarms and snoozes are cleared on reconciliation. Writes
finish before the UI acknowledges a saved change. Maximum backup size: 5 MiB.

## Development

Use Node 22+ (CI uses Node 24):

```sh
npm ci
npm test
npm run typecheck
npm run dev
```

The original web entry and builder shell remain intact. A separate static entry
bundles the same React interface for Capacitor:

```sh
npm run build
npm run build:mobile
npm run android:sync
```

With JDK 21 and Android SDK platform 36/build-tools 36.0.0 installed, set `JAVA_HOME`
and `ANDROID_HOME`, then run:

```sh
npm run android:debug
```

APK: `android/app/build/outputs/apk/debug/app-debug.apk`. The command also runs native
JVM tests. GitHub Actions runs tests, typecheck, builds and uploads a candidate APK.
Keystores, local SDK paths, copied web assets and build outputs are not committed.

## Open-source references

[Research notes](docs/OPEN_SOURCE_RESEARCH.md) pin the inspected GitHub revisions of
Super Productivity, Tasks.org, Vikunja and Capacitor. Their reminder behavior informed
this implementation; no application source from those planners was copied. Dayline's
native Java bridge is original. The mobile build includes dependency license notices.

[Architecture and acceptance](docs/ANDROID_REMINDERS.md) documents recurrence, local
time, missed alarms, action replay, permissions, device limits and test scenarios.
