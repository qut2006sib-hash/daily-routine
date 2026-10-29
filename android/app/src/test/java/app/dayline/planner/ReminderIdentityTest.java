package app.dayline.planner;
import org.junit.Test;
import static org.junit.Assert.*;
public class ReminderIdentityTest {
    @Test public void currentIdentityAccepted() { assertTrue(ReminderIdentity.matches("new", "new", "t@today|14:00", "new", "t@today|14:00")); }
    @Test public void oldDatasetRejected() { assertFalse(ReminderIdentity.matches("new", "new", "same", "old", "same")); }
    @Test public void oldTimeAndMissingIdentityRejected() { assertFalse(ReminderIdentity.matches("new", "new", "14:00", "new", "09:00")); assertFalse(ReminderIdentity.matches("new", "new", "14:00", null, null)); }
}
