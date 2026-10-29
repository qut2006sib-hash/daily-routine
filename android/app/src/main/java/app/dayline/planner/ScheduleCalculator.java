package app.dayline.planner;

import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;

/** Pure local-calendar scheduling; no Android state or global clock. */
public final class ScheduleCalculator {
    private ScheduleCalculator() {}
    public static final class Revision {
        public String title, notes, date, time, repeat, effectiveFrom;
        public boolean archived, reminder;
    }
    public static final class Occurrence {
        public final String taskId, date, title, time;
        public final long at;
        public Occurrence(String taskId, LocalDate date, Revision revision, long at) {
            this.taskId = taskId; this.date = date.toString(); this.title = revision.title; this.time = revision.time; this.at = at;
        }
        public String key() { return taskId + "@" + date; }
        public String token() { return key() + "|" + time + "|" + title; }
    }
    public static Revision revisionFor(List<Revision> revisions, LocalDate day) {
        Revision chosen = null;
        for (Revision r : revisions) if (r.effectiveFrom.compareTo(day.toString()) <= 0 && (chosen == null || r.effectiveFrom.compareTo(chosen.effectiveFrom) >= 0)) chosen = r;
        return chosen;
    }
    public static boolean occurs(Revision r, LocalDate day) {
        if (r == null || r.archived || !r.reminder || r.time == null || r.time.isEmpty()) return false;
        LocalDate start = LocalDate.parse(r.date);
        if (day.isBefore(start)) return false;
        return switch (r.repeat) {
            case "daily" -> true;
            case "weekdays" -> day.getDayOfWeek() != DayOfWeek.SATURDAY && day.getDayOfWeek() != DayOfWeek.SUNDAY;
            case "weekly" -> ChronoUnit.DAYS.between(start, day) % 7 == 0;
            default -> day.equals(start);
        };
    }
    public static Occurrence occurrence(String id, List<Revision> revisions, LocalDate date, ZoneId zone) {
        Revision r = revisionFor(revisions, date);
        if (!occurs(r, date)) return null;
        // Zone rules move DST gaps forward and choose the first offset of an overlap.
        return new Occurrence(id, date, r, date.atTime(LocalTime.parse(r.time)).atZone(zone).toInstant().toEpochMilli());
    }
    /** Normal edits preserve alarms Android is delaying; reboot/clock recovery skips missed ones. */
    public static boolean retainDelayed(boolean recovery, long scheduledAt, long now, boolean valid, boolean delivered) {
        return !recovery && scheduledAt <= now && valid && !delivered;
    }
    public static Occurrence next(String id, List<Revision> revisions, Set<String> completed, Set<String> delivered, long now, ZoneId zone) {
        LocalDate today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate();
        List<Revision> ordered = new ArrayList<>(revisions); ordered.sort(Comparator.comparing(r -> r.effectiveFrom));
        Occurrence best = null;
        for (int index = 0; index < ordered.size(); index++) {
            Revision r = ordered.get(index);
            if (r.archived || !r.reminder || r.time == null || r.time.isEmpty()) continue;
            LocalDate start = LocalDate.parse(r.date), effective = LocalDate.parse(r.effectiveFrom);
            LocalDate day = today.isAfter(start) ? today : start;
            if (effective.isAfter(day)) day = effective;
            LocalDate end = index + 1 < ordered.size() ? LocalDate.parse(ordered.get(index + 1).effectiveFrom) : null;
            if ("none".equals(r.repeat)) day = start;
            int limit = 8 + 7 * (completed.size() + delivered.size());
            for (int examined = 0; examined < limit; examined++, day = day.plusDays(1)) {
                if (day.isBefore(today) || day.isBefore(effective) || (end != null && !day.isBefore(end))) break;
                if ("none".equals(r.repeat) && !day.equals(start)) break;
                if (!occurs(r, day)) continue;
                Occurrence candidate = occurrence(id, ordered, day, zone);
                if (candidate != null && candidate.at > now && !completed.contains(candidate.key()) && !delivered.contains(candidate.token())) {
                    if (best == null || candidate.at < best.at) best = candidate;
                    break;
                }
            }
        }
        return best;
    }
}
