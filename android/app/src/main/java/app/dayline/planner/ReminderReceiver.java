package app.dayline.planner;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
public class ReminderReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        try {
            String action = intent.getAction();
            if ("app.dayline.ALARM".equals(action)) ReminderScheduler.fire(context, intent);
            else if ("app.dayline.DONE".equals(action) || "app.dayline.SNOOZE".equals(action)) ReminderScheduler.action(context, intent);
            else ReminderScheduler.restore(context);
        } catch (RuntimeException error) { Log.e("DaylineReminders", "Reminder recovery failed; reopen Dayline to retry", error); }
    }
}
