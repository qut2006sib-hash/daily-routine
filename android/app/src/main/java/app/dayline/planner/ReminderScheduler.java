package app.dayline.planner;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import org.json.*;
import java.time.*;
import java.util.*;

/** Original app-local scheduler. Android owns timing and the persistent action queue. */
final class ReminderScheduler {
    static final String CHANNEL = "dayline-tasks-v1";
    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("dayline-reminders-v1", Context.MODE_PRIVATE); }
    private static JSONObject read(Context c, String key) {
        try { return new JSONObject(prefs(c).getString(key, "{}")); } catch (JSONException e) { return new JSONObject(); }
    }
    private static void save(Context c, String key, JSONObject value) {
        if (!prefs(c).edit().putString(key, value.toString()).commit()) throw new IllegalStateException("Could not save reminder state");
    }
    private static Set<String> keys(JSONObject o) { Set<String> result = new HashSet<>(); o.keys().forEachRemaining(result::add); return result; }
    static boolean exact(Context c) { return Build.VERSION.SDK_INT < 31 || c.getSystemService(AlarmManager.class).canScheduleExactAlarms(); }
    static boolean notificationsAllowed(Context c) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        if (!NotificationManagerCompat.from(c).areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= 26) { NotificationChannel channel = c.getSystemService(NotificationManager.class).getNotificationChannel(CHANNEL); if (channel != null && channel.getImportance() == NotificationManager.IMPORTANCE_NONE) return false; }
        return true;
    }
    static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT >= 26) { NotificationChannel channel = new NotificationChannel(CHANNEL, "Task reminders", NotificationManager.IMPORTANCE_HIGH); channel.setDescription("Scheduled tasks and snoozed reminders"); c.getSystemService(NotificationManager.class).createNotificationChannel(channel); }
    }
    private static List<ScheduleCalculator.Revision> revisions(JSONObject task) throws JSONException {
        List<ScheduleCalculator.Revision> result = new ArrayList<>(); JSONArray values = task.getJSONArray("revisions");
        for (int i = 0; i < values.length(); i++) {
            JSONObject value = values.getJSONObject(i); ScheduleCalculator.Revision r = new ScheduleCalculator.Revision();
            r.title = value.getString("title"); r.notes = value.optString("notes"); r.date = value.getString("date"); r.time = value.getString("time"); r.repeat = value.getString("repeat"); r.effectiveFrom = value.getString("effectiveFrom"); r.archived = value.getBoolean("archived"); r.reminder = value.getBoolean("reminder"); result.add(r);
        }
        return result;
    }
    private static JSONObject findTask(JSONObject config, String id) {
        JSONArray tasks = config.optJSONArray("tasks");
        if (tasks != null) for (int i = 0; i < tasks.length(); i++) { JSONObject task = tasks.optJSONObject(i); if (task != null && id.equals(task.optString("id"))) return task; }
        return null;
    }
    private static Set<String> completed(Context c, JSONObject config) {
        Set<String> result = new HashSet<>(); JSONObject values = config.optJSONObject("completions"); if (values != null) result.addAll(keys(values));
        JSONObject actions = read(c, "actions");
        for (String id : keys(actions)) { JSONObject a = actions.optJSONObject(id); if (a != null && config.optString("generation").equals(a.optString("generation"))) result.add(a.optString("taskId") + "@" + a.optString("date")); }
        return result;
    }
    private static Set<String> deliveredTokens(Context c) {
        Set<String> result = new HashSet<>(); JSONObject history = read(c, "delivered");
        for (String key : keys(history)) { JSONObject value = history.optJSONObject(key); if (value != null) result.add(value.optString("token")); }
        return result;
    }
    private static JSONObject occurrenceJson(ScheduleCalculator.Occurrence o, String generation) throws JSONException {
        return new JSONObject().put("taskId", o.taskId).put("date", o.date).put("title", o.title).put("time", o.time).put("at", o.at).put("token", o.token()).put("generation", generation).put("snooze", false);
    }
    private static boolean stillValid(JSONObject config, JSONObject o, Set<String> done) throws JSONException {
        if (!config.optString("generation").equals(o.optString("generation"))) return false;
        String id = o.optString("taskId"), date = o.optString("date"), key = id + "@" + date;
        if (done.contains(key)) return false;
        JSONObject task = findTask(config, id); if (task == null) return false;
        List<ScheduleCalculator.Revision> r = revisions(task);
        ScheduleCalculator.Revision current = ScheduleCalculator.revisionFor(r, LocalDate.now(ZoneId.systemDefault()));
        if (current != null && (current.archived || !current.reminder)) return false;
        ScheduleCalculator.Occurrence actual = ScheduleCalculator.occurrence(id, r, LocalDate.parse(date), ZoneId.systemDefault());
        return actual != null && actual.token().equals(o.optString("token"));
    }
    private static PendingIntent alarmIntent(Context c, String key, JSONObject o) {
        String generation = o.optString("generation"), token = o.optString("token");
        Intent intent = new Intent(c, ReminderReceiver.class).setAction("app.dayline.ALARM")
            .setData(Uri.parse("dayline://alarm/" + Uri.encode(generation) + "/" + Uri.encode(key) + "/" + Uri.encode(token)))
            .putExtra("key", key).putExtra("generation", generation).putExtra("token", token).putExtra("at", o.optLong("at"));
        return PendingIntent.getBroadcast(c, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    private static void cancel(Context c, String key, JSONObject value) { if (value != null) { PendingIntent pending = alarmIntent(c, key, value); c.getSystemService(AlarmManager.class).cancel(pending); pending.cancel(); } }
    private static void arm(Context c, String key, JSONObject value) {
        AlarmManager manager = c.getSystemService(AlarmManager.class); PendingIntent pending = alarmIntent(c, key, value);
        long at = Math.max(System.currentTimeMillis() + 1000, value.optLong("at"));
        try { if (exact(c)) manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending); else manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending); }
        catch (SecurityException denied) { manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending); }
    }
    static synchronized void configure(Context c, JSONObject config) {
        String generation = config.optString("generation"); if (generation.isEmpty()) throw new IllegalArgumentException("Missing planner generation");
        if (!generation.equals(read(c, "config").optString("generation"))) {
            JSONObject armed = read(c, "armed"), shown = read(c, "shown");
            // Only the already-durable planner generation can replace native state.
            if (!prefs(c).edit().clear().putString("config", config.toString()).commit()) throw new IllegalStateException("Could not replace reminder state");
            for (String key : keys(armed)) cancel(c, key, armed.optJSONObject(key));
            for (String key : keys(shown)) NotificationManagerCompat.from(c).cancel(key, 0);
        }
        save(c, "config", config); reconcile(c, false);
    }
    static synchronized void restore(Context c) { reconcile(c, true); }
    private static void reconcile(Context c, boolean recovery) {
        JSONObject config = read(c, "config"), old = read(c, "armed"), desired = new JSONObject(), snoozes = read(c, "snoozes"), tests = read(c, "tests"), shown = read(c, "shown");
        long now = System.currentTimeMillis();
        try {
            Set<String> done = completed(c, config), delivered = deliveredTokens(c);
            boolean enabled = notificationsAllowed(c) && config.optJSONObject("settings") != null && config.optJSONObject("settings").optBoolean("remindersEnabled");
            if (enabled) {
                JSONArray tasks = config.optJSONArray("tasks");
                if (tasks != null) for (int i = 0; i < tasks.length(); i++) {
                    JSONObject task = tasks.getJSONObject(i); ScheduleCalculator.Occurrence next = ScheduleCalculator.next(task.getString("id"), revisions(task), done, delivered, now, ZoneId.systemDefault());
                    if (next != null) desired.put(next.key(), occurrenceJson(next, config.optString("generation")));
                }
                // An inexact alarm may be overdue while Android is still delaying it. A normal
                // resume/edit must not cancel that valid pending delivery. Recovery after power-off
                // or a wall-clock/zone change deliberately uses the documented missed-task policy.
                for (String key : keys(old)) {
                    JSONObject pending = old.getJSONObject(key);
                    if (!pending.optBoolean("test") && !pending.optBoolean("snooze") &&
                        ScheduleCalculator.retainDelayed(recovery, pending.optLong("at"), now,
                            stillValid(config, pending, done), delivered.contains(pending.optString("token")))) {
                        desired.put(key, pending);
                    }
                }
                for (String key : keys(snoozes)) { JSONObject o = snoozes.getJSONObject(key); if (stillValid(config, o, done)) { if (o.optLong("at") <= now) o.put("at", now + 1000); desired.put(key + "#snooze", o); } else snoozes.remove(key); }
            } else snoozes = new JSONObject();
            if (notificationsAllowed(c)) for (String key : keys(tests)) { JSONObject o = tests.getJSONObject(key); if (o.optLong("at") > now) desired.put(key, o); else tests.remove(key); }
            for (String key : keys(old)) if (!desired.has(key) || !old.getJSONObject(key).toString().equals(desired.getJSONObject(key).toString())) cancel(c, key, old.getJSONObject(key));
            save(c, "armed", desired); save(c, "snoozes", snoozes); save(c, "tests", tests);
            for (String key : keys(desired)) arm(c, key, desired.getJSONObject(key));
            for (String key : keys(shown)) if (!enabled || !stillValid(config, shown.getJSONObject(key), done)) { NotificationManagerCompat.from(c).cancel(key, 0); shown.remove(key); }
            save(c, "shown", shown);
            JSONObject history = read(c, "delivered");
            for (String key : keys(history)) if (history.optJSONObject(key) == null || history.optJSONObject(key).optLong("at") < now - 90L * 86400000L) history.remove(key);
            save(c, "delivered", history);
        } catch (JSONException | IllegalArgumentException e) {
            for (String key : keys(old)) cancel(c, key, old.optJSONObject(key)); save(c, "armed", new JSONObject());
            throw new IllegalStateException("Invalid task reminder data", e);
        }
    }
    static synchronized void fire(Context c, Intent intent) {
        String key = intent.getStringExtra("key"); if (key == null) return;
        JSONObject armed = read(c, "armed"), value = armed.optJSONObject(key), config = read(c, "config");
        if (value == null || !ReminderIdentity.matches(config.optString("generation"), value.optString("generation"), value.optString("token"), intent.getStringExtra("generation"), intent.getStringExtra("token")) || value.optLong("at") != intent.getLongExtra("at", -1) || value.optLong("at") > System.currentTimeMillis() + 1000) return;
        try {
            boolean test = value.optBoolean("test"), enabled = config.optJSONObject("settings") != null && config.optJSONObject("settings").optBoolean("remindersEnabled");
            String occurrence = value.optString("taskId") + "@" + value.optString("date");
            if (notificationsAllowed(c) && (test || enabled && stillValid(config, value, completed(c, config))) && (test || value.optBoolean("snooze") || !deliveredTokens(c).contains(value.optString("token")))) {
                show(c, test ? key : occurrence, value);
                if (!test) { save(c, "delivered", read(c, "delivered").put(occurrence, new JSONObject().put("at", System.currentTimeMillis()).put("token", value.optString("token")))); save(c, "shown", read(c, "shown").put(occurrence, value)); }
            }
            armed.remove(key); save(c, "armed", armed);
            JSONObject snoozes = read(c, "snoozes"); snoozes.remove(occurrence); save(c, "snoozes", snoozes);
            JSONObject tests = read(c, "tests"); tests.remove(key); save(c, "tests", tests); reconcile(c, false);
        } catch (JSONException e) { throw new IllegalStateException(e); }
    }
    private static void show(Context c, String key, JSONObject value) {
        ensureChannel(c);
        Intent launch = new Intent(c, MainActivity.class).setAction(Intent.ACTION_MAIN).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(c, CHANNEL).setSmallIcon(R.drawable.ic_stat_dayline).setContentTitle(value.optString("title", "Dayline"))
            .setContentText(value.optBoolean("test") ? "Your phone reminders are ready." : "It’s time for this task.")
            .setContentIntent(PendingIntent.getActivity(c, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE)).setAutoCancel(true).setPriority(NotificationCompat.PRIORITY_HIGH).setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setCategory(NotificationCompat.CATEGORY_REMINDER);
        if (!value.optBoolean("test")) for (String action : new String[]{"DONE", "SNOOZE"}) {
            String generation = value.optString("generation"), token = value.optString("token");
            Intent intent = new Intent(c, ReminderReceiver.class).setAction("app.dayline." + action)
                .setData(Uri.parse("dayline://action/" + action + "/" + Uri.encode(generation) + "/" + Uri.encode(key) + "/" + Uri.encode(token)))
                .putExtra("key", key).putExtra("generation", generation).putExtra("token", token);
            PendingIntent pending = PendingIntent.getBroadcast(c, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            builder.addAction(0, "DONE".equals(action) ? "Done" : "Snooze 10 min", pending);
        }
        NotificationManagerCompat.from(c).notify(key, 0, builder.build());
    }
    static synchronized void action(Context c, Intent intent) {
        String key = intent.getStringExtra("key"); JSONObject shown = read(c, "shown"), value = key == null ? null : shown.optJSONObject(key), config = read(c, "config");
        if (value == null || !ReminderIdentity.matches(config.optString("generation"), value.optString("generation"), value.optString("token"), intent.getStringExtra("generation"), intent.getStringExtra("token"))) return;
        try {
            if ("app.dayline.DONE".equals(intent.getAction())) {
                String id = UUID.randomUUID().toString(); JSONObject event = new JSONObject().put("id", id).put("generation", config.optString("generation")).put("type", "done")
                    .put("taskId", value.getString("taskId")).put("date", value.getString("date")).put("title", value.getString("title")).put("scheduledTime", value.getString("time")).put("completedAt", Instant.now().toString());
                save(c, "actions", read(c, "actions").put(id, event));
                JSONObject snoozes = read(c, "snoozes"); snoozes.remove(key); save(c, "snoozes", snoozes);
            } else if ("app.dayline.SNOOZE".equals(intent.getAction())) {
                value.put("snooze", true).put("at", System.currentTimeMillis() + 10L * 60000); save(c, "snoozes", read(c, "snoozes").put(key, value));
            } else return;
            NotificationManagerCompat.from(c).cancel(key, 0); shown.remove(key); save(c, "shown", shown); reconcile(c, false);
        } catch (JSONException e) { throw new IllegalStateException(e); }
    }
    static synchronized JSONArray pendingActions(Context c) { JSONObject values = read(c, "actions"); JSONArray result = new JSONArray(); for (String key : keys(values)) result.put(values.optJSONObject(key)); return result; }
    static synchronized void acknowledge(Context c, JSONArray ids) {
        JSONObject values = read(c, "actions"), config = read(c, "config"), done = config.optJSONObject("completions");
        for (int i = 0; i < ids.length(); i++) { String id = ids.optString(i); JSONObject action = values.optJSONObject(id); if (action == null) continue;
            if (!config.optString("generation").equals(action.optString("generation")) || done != null && done.has(action.optString("taskId") + "@" + action.optString("date"))) values.remove(id);
        }
        save(c, "actions", values);
    }
    static synchronized void test(Context c) throws JSONException {
        String id = "test-" + UUID.randomUUID(); JSONObject value = new JSONObject().put("test", true).put("title", "Dayline reminder").put("at", System.currentTimeMillis() + 10000).put("token", id).put("generation", read(c, "config").optString("generation"));
        save(c, "tests", read(c, "tests").put(id, value)); reconcile(c, false);
    }
}
