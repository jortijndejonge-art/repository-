import type { AgeGroup, Id, Pitch, ScheduleConflict } from '@hockey/contracts';

/** A pitch is held for a match for this long after it ends (warm-down, goals, nets) before the next can start. */
export const TURNAROUND_MINUTES = 10;

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The weekday (Monday = 0), minutes since local midnight, and local date of an instant, in a time zone. */
export function localParts(iso: string | Date, timeZone: string): { weekday: number; minute: number; date: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    weekday: DAY_NAMES.indexOf(get('weekday')),
    minute: Number(get('hour')) * 60 + Number(get('minute')),
    date: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

export const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
export const dayName = (weekday: number) => DAY_NAMES[weekday] ?? '?';

export interface ScheduledItem {
  id: Id;
  teamId: Id;
  startsAt: string;
  durationMinutes: number;
  pitchId?: Id;
}

export interface ConflictInput {
  /** The match being added or edited. `id` is set when editing, so it does not clash with itself. */
  candidate: ScheduledItem & { ageGroup: AgeGroup };
  /** Other matches in the club. */
  fixtures: ScheduledItem[];
  /** Training sessions, which a team cannot be at while playing. */
  trainings: ScheduledItem[];
  pitches: Pitch[];
  timeZone: string;
  turnaroundMinutes?: number;
}

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;
const ms = (iso: string) => new Date(iso).getTime();

/**
 * Everything wrong with putting a match here, in plain words: the pitch is already booked then, the team is
 * playing or training at that time, or the pitch is not available to this age group at that time. An empty
 * list means it fits.
 */
export function findConflicts({ candidate, fixtures, trainings, pitches, timeZone, turnaroundMinutes = TURNAROUND_MINUTES }: ConflictInput): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];
  const start = ms(candidate.startsAt);
  const end = start + candidate.durationMinutes * 60_000;
  const heldUntil = end + turnaroundMinutes * 60_000;
  const when = (iso: string) => {
    const p = localParts(iso, timeZone);
    return `${dayName(p.weekday)} ${clock(p.minute)}`;
  };

  const pitch = candidate.pitchId ? pitches.find((p) => p.id === candidate.pitchId) : undefined;

  if (pitch) {
    for (const other of fixtures) {
      if (other.id === candidate.id || other.pitchId !== pitch.id) continue;
      const otherStart = ms(other.startsAt);
      if (overlaps(start, heldUntil, otherStart, otherStart + (other.durationMinutes + turnaroundMinutes) * 60_000)) {
        conflicts.push({ kind: 'pitch', fixtureId: other.id, message: `${pitch.name} is already booked at ${when(other.startsAt)}.` });
      }
    }

    // Only pitches with published times are checked against them.
    if (pitch.slots.length > 0) {
      const local = localParts(candidate.startsAt, timeZone);
      const fits = pitch.slots.some(
        (s) => s.weekday === local.weekday && local.minute >= s.startMinute && local.minute + candidate.durationMinutes <= s.endMinute && s.ageGroups.includes(candidate.ageGroup),
      );
      if (!fits) {
        const today = pitch.slots.filter((s) => s.weekday === local.weekday);
        const available = today.length
          ? `On ${dayName(local.weekday)} it is open ${today.map((s) => `${clock(s.startMinute)}–${clock(s.endMinute)} for ${s.ageGroups.join(', ')}`).join('; ')}.`
          : `It is not open on ${dayName(local.weekday)}s.`;
        conflicts.push({ kind: 'slot', message: `${pitch.name} is not available to ${candidate.ageGroup} at ${when(candidate.startsAt)} for ${candidate.durationMinutes} minutes. ${available}` });
      }
    }
  }

  for (const other of fixtures) {
    if (other.id === candidate.id || other.teamId !== candidate.teamId) continue;
    const otherStart = ms(other.startsAt);
    if (overlaps(start, end, otherStart, otherStart + other.durationMinutes * 60_000)) {
      conflicts.push({ kind: 'team', fixtureId: other.id, message: `This team already has a match at ${when(other.startsAt)}.` });
    }
  }
  for (const session of trainings) {
    if (session.teamId !== candidate.teamId) continue;
    const sessionStart = ms(session.startsAt);
    if (overlaps(start, end, sessionStart, sessionStart + session.durationMinutes * 60_000)) {
      conflicts.push({ kind: 'team', message: `This team has training at ${when(session.startsAt)}.` });
    }
  }
  return conflicts;
}

export interface FreeSlot {
  pitchId: Id;
  pitchName: string;
  /** The earliest time in the opening a match of the asked length fits, as an instant. */
  startsAt: string;
  startMinute: number;
  endMinute: number;
  ageGroups: AgeGroup[];
  weekday: number;
  /** Local date, e.g. "2026-10-10". */
  date: string;
  /** Minutes of the opening not already taken by a booked match (with turnaround). */
  freeMinutes: number;
}

/**
 * The published openings in the next `days` days that still have room for a match of `durationMinutes`,
 * optionally only for one age group. This is what "assisted" fixture entry offers, and what the season
 * scheduler fills.
 */
export function freeSlots(
  pitches: Pitch[],
  fixtures: ScheduledItem[],
  opts: { from: Date; days: number; timeZone: string; durationMinutes: number; ageGroup?: AgeGroup; turnaroundMinutes?: number },
): FreeSlot[] {
  const turnaround = opts.turnaroundMinutes ?? TURNAROUND_MINUTES;
  const out: FreeSlot[] = [];
  const DAY = 86_400_000;
  // Walk the calendar one local date at a time, using noon so a clock change cannot skip or repeat a day.
  const seen = new Set<string>();
  for (let i = 0; i <= opts.days + 1; i++) {
    const noon = new Date(opts.from.getTime() + i * DAY);
    const day = localParts(noon, opts.timeZone);
    if (seen.has(day.date)) continue;
    seen.add(day.date);
    for (const pitch of pitches) {
      for (const slot of pitch.slots.filter((s) => s.weekday === day.weekday && (!opts.ageGroup || s.ageGroups.includes(opts.ageGroup)))) {
        const startsAt = instantAt(day.date, slot.startMinute, opts.timeZone);
        if (new Date(startsAt) < opts.from || new Date(startsAt).getTime() > opts.from.getTime() + opts.days * DAY) continue;
        const opening = [ms(startsAt), ms(startsAt) + (slot.endMinute - slot.startMinute) * 60_000] as const;
        const booked = fixtures
          .filter((f) => f.pitchId === pitch.id)
          .map((f) => [ms(f.startsAt), ms(f.startsAt) + (f.durationMinutes + turnaround) * 60_000] as const)
          .filter(([a, b]) => overlaps(a, b, opening[0], opening[1]));
        const used = booked.reduce((sum, [a, b]) => sum + (Math.min(b, opening[1]) - Math.max(a, opening[0])), 0) / 60_000;
        const freeMinutes = slot.endMinute - slot.startMinute - used;

        // The earliest start (on a 5-minute mark) where the match and its turnaround miss every booking.
        const length = opts.durationMinutes * 60_000;
        let fit: number | null = null;
        for (let t = opening[0]; t + length <= opening[1]; t += 5 * 60_000) {
          if (!booked.some(([a, b]) => overlaps(t, t + length + turnaround * 60_000, a, b))) {
            fit = t;
            break;
          }
        }
        if (fit !== null) {
          out.push({ pitchId: pitch.id, pitchName: pitch.name, startsAt: new Date(fit).toISOString(), startMinute: slot.startMinute, endMinute: slot.endMinute, ageGroups: slot.ageGroups, weekday: slot.weekday, date: day.date, freeMinutes });
        }
      }
    }
  }
  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.pitchName.localeCompare(b.pitchName));
}

/** The instant that is `minute` minutes after local midnight on a local date in a time zone. */
export function instantAt(date: string, minute: number, timeZone: string): string {
  // Start from the same wall-clock time read as UTC, then correct by the zone's offset at that moment.
  const asUtc = Date.parse(`${date}T${clock(minute)}:00Z`);
  const offsetMinutes = (instant: number) => {
    const p = localParts(new Date(instant), timeZone);
    const local = Date.parse(`${p.date}T${clock(p.minute)}:00Z`);
    return (local - instant) / 60_000;
  };
  let instant = asUtc - offsetMinutes(asUtc) * 60_000;
  instant = asUtc - offsetMinutes(instant) * 60_000; // second pass settles days next to a clock change
  return new Date(instant).toISOString();
}
