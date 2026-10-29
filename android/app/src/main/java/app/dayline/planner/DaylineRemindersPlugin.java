package app.dayline.planner;
import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import org.json.JSONArray;

@CapacitorPlugin(name = "DaylineReminders", permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) })
public class DaylineRemindersPlugin extends Plugin {
    private JSObject status() {
        ReminderScheduler.ensureChannel(getContext());
        boolean allowed = ReminderScheduler.notificationsAllowed(getContext()), exact = ReminderScheduler.exact(getContext());
        PermissionState permission = Build.VERSION.SDK_INT >= 33 ? getPermissionState("notifications") : PermissionState.GRANTED;
        String state = allowed ? "granted" : permission == PermissionState.PROMPT || permission == PermissionState.PROMPT_WITH_RATIONALE ? "prompt" : "denied";
        return new JSObject().put("supported", true).put("permission", state).put("exact", exact).put("message", !allowed ? "Allow notifications to receive task reminders." : exact ? "Phone reminders are ready, including while the app is closed." : "Reminders are enabled. Android may delay them until you allow Alarms & reminders.");
    }
    @PluginMethod public void getStatus(PluginCall call) { call.resolve(status()); }
    @PluginMethod public void enable(PluginCall call) { if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) requestPermissionForAlias("notifications", call, "permissionResult"); else call.resolve(status()); }
    @PermissionCallback private void permissionResult(PluginCall call) { call.resolve(status()); }
    @PluginMethod public void openExactSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 31) try { getActivity().startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getContext().getPackageName()))); } catch (Exception e) { call.reject("Could not open Alarms & reminders settings", e); return; }
        call.resolve();
    }
    @PluginMethod public void configure(PluginCall call) { JSObject data = call.getObject("data"); if (data == null) { call.reject("Missing planner data"); return; } try { ReminderScheduler.configure(getContext(), data); call.resolve(); } catch (Exception e) { call.reject("Could not save phone reminders", e); } }
    @PluginMethod public void pendingActions(PluginCall call) { call.resolve(new JSObject().put("actions", ReminderScheduler.pendingActions(getContext()))); }
    @PluginMethod public void acknowledge(PluginCall call) { JSONArray ids = call.getArray("ids"); if (ids == null) { call.reject("Missing action identifiers"); return; } try { ReminderScheduler.acknowledge(getContext(), ids); call.resolve(); } catch (Exception e) { call.reject("Could not acknowledge phone actions", e); } }
    @PluginMethod public void sendTest(PluginCall call) { if (!ReminderScheduler.notificationsAllowed(getContext())) { call.reject("Allow notifications before testing a phone reminder."); return; } try { ReminderScheduler.test(getContext()); call.resolve(); } catch (Exception e) { call.reject("Could not schedule a test reminder", e); } }
}
