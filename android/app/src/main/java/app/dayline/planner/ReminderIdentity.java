package app.dayline.planner;
/** Both alarms and notification actions are tied to an immutable dataset and schedule. */
public final class ReminderIdentity {
    private ReminderIdentity() {}
    public static boolean matches(String currentGeneration, String shownGeneration, String shownToken, String eventGeneration, String eventToken) {
        return currentGeneration != null && !currentGeneration.isEmpty() && currentGeneration.equals(shownGeneration) && currentGeneration.equals(eventGeneration) && shownToken != null && !shownToken.isEmpty() && shownToken.equals(eventToken);
    }
}
