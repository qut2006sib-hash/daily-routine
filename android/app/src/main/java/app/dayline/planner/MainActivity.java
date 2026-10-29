package app.dayline.planner;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) { registerPlugin(DaylineRemindersPlugin.class); super.onCreate(savedInstanceState); }
}
