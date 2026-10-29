package app.dayline.planner;
import org.junit.Test;
import static org.junit.Assert.*;
import java.time.*;
import java.util.*;

public class ScheduleCalculatorTest {
    private ScheduleCalculator.Revision revision(String start, String time, String repeat) { ScheduleCalculator.Revision r = new ScheduleCalculator.Revision(); r.date = start; r.effectiveFrom = start; r.time = time; r.repeat = repeat; r.title = "Study"; r.notes = ""; r.reminder = true; return r; }
    private long at(String iso) { return Instant.parse(iso).toEpochMilli(); }
    private ScheduleCalculator.Occurrence next(List<ScheduleCalculator.Revision> r, String now) { return ScheduleCalculator.next("t", r, Set.of(), Set.of(), at(now), ZoneId.of("UTC")); }
    @Test public void oneOffOccursOnce() { var r = revision("2026-10-29", "09:00", "none"); assertNotNull(next(List.of(r), "2026-10-29T08:00:00Z")); assertNull(next(List.of(r), "2026-10-29T10:00:00Z")); }
    @Test public void dailyKeepsGoingWithoutHorizon() { var r = revision("2026-10-29", "09:00", "daily"); assertEquals("2036-10-30", next(List.of(r), "2036-10-29T10:00:00Z").date); }
    @Test public void weekdaysSkipWeekend() { var r = revision("2026-10-29", "09:00", "weekdays"); assertEquals("2026-11-02", next(List.of(r), "2026-10-30T10:00:00Z").date); }
    @Test public void weeklyAnchoredToStart() { var r = revision("2026-10-29", "09:00", "weekly"); assertEquals("2026-11-05", next(List.of(r), "2026-10-30T08:00:00Z").date); }
    @Test public void completedOccurrenceExcluded() { var r = revision("2026-10-29", "09:00", "daily"); var o = ScheduleCalculator.next("t", List.of(r), Set.of("t@2026-10-29"), Set.of(), at("2026-10-29T08:00:00Z"), ZoneId.of("UTC")); assertEquals("2026-10-30", o.date); }
    @Test public void deliveredOccurrenceNotDuplicated() { var r = revision("2026-10-29", "09:00", "daily"); var old = ScheduleCalculator.occurrence("t", List.of(r), LocalDate.parse("2026-10-29"), ZoneId.of("UTC")); var o = ScheduleCalculator.next("t", List.of(r), Set.of(), Set.of(old.token()), at("2026-10-29T08:00:00Z"), ZoneId.of("UTC")); assertEquals("2026-10-30", o.date); }
    @Test public void rescheduleAlreadyFiredCanAlertAtNewTime() { var old = revision("2026-10-29", "09:00", "daily"); var token = ScheduleCalculator.occurrence("t", List.of(old), LocalDate.parse("2026-10-29"), ZoneId.of("UTC")).token(); var revised = revision("2026-10-29", "14:00", "daily"); var o = ScheduleCalculator.next("t", List.of(revised), Set.of(), Set.of(token), at("2026-10-29T10:00:00Z"), ZoneId.of("UTC")); assertEquals(at("2026-10-29T14:00:00Z"), o.at); }
    @Test public void archivalCancelsFutureAndKeepsPastRevision() { var first = revision("2026-10-28", "09:00", "daily"); var archive = revision("2026-10-28", "09:00", "daily"); archive.effectiveFrom = "2026-10-29"; archive.archived = true; assertNull(next(List.of(first, archive), "2026-10-29T08:00:00Z")); assertNotNull(ScheduleCalculator.occurrence("t", List.of(first, archive), LocalDate.parse("2026-10-28"), ZoneId.of("UTC"))); }
    @Test public void disabledOrUntimedNeverSchedules() { var r = revision("2026-10-29", "09:00", "daily"); r.reminder = false; assertNull(next(List.of(r), "2026-10-29T08:00:00Z")); r.reminder = true; r.time = ""; assertNull(next(List.of(r), "2026-10-29T08:00:00Z")); }
    @Test public void springGapMovesForward() { var r = revision("2026-03-08", "02:30", "none"); var o = ScheduleCalculator.occurrence("t", List.of(r), LocalDate.parse(r.date), ZoneId.of("America/New_York")); assertEquals(at("2026-03-08T07:30:00Z"), o.at); }
    @Test public void fallOverlapUsesFirstOffset() { var r = revision("2026-11-01", "01:30", "none"); var o = ScheduleCalculator.occurrence("t", List.of(r), LocalDate.parse(r.date), ZoneId.of("America/New_York")); assertEquals(at("2026-11-01T05:30:00Z"), o.at); }
    @Test public void delayedInexactAlarmSurvivesNormalResumeButNotExplicitRecovery() {
        long due = at("2026-10-29T09:00:00Z"), now = at("2026-10-29T09:05:00Z");
        assertTrue(ScheduleCalculator.retainDelayed(false, due, now, true, false));
        assertFalse(ScheduleCalculator.retainDelayed(true, due, now, true, false));
        assertFalse(ScheduleCalculator.retainDelayed(false, due, now, false, false));
        assertFalse(ScheduleCalculator.retainDelayed(false, due, now, true, true));
        assertFalse(ScheduleCalculator.retainDelayed(false, now + 60000, now, true, false));
    }
    @Test public void timezoneIsLocalWallClock() { var r = revision("2026-10-29", "09:00", "none"); var o = ScheduleCalculator.occurrence("t", List.of(r), LocalDate.parse(r.date), ZoneId.of("Asia/Damascus")); assertEquals(at("2026-10-29T06:00:00Z"), o.at); }
}
