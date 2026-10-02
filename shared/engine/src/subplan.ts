import type { Id, SlotAssignment, Substitution } from '@hockey/contracts';
import { secondsPlayed } from './matchday';

/** Sort by minute, keeping the given order for changes at the same minute. */
function inTimeOrder(subs: Substitution[]): Substitution[] {
  return subs.map((s, i) => ({ s, i })).sort((a, b) => a.s.minute - b.s.minute || a.i - b.i).map(({ s }) => s);
}

/**
 * Make a hand-edited plan consistent again. Replays the changes in time order: whoever is in the slot at that
 * moment is the player who comes off, and a change is dropped if it could not happen (nobody in that position,
 * the player coming on is already on the pitch, or the minute is outside the match).
 */
export function normaliseSubstitutions(
  starting: SlotAssignment[],
  subs: Substitution[],
  durationMinutes: number,
): { substitutions: Substitution[]; dropped: number } {
  const holder = new Map<string, Id>();
  for (const s of starting) if (s.memberId) holder.set(s.slotId, s.memberId);
  const onPitch = new Set(holder.values());
  const kept: Substitution[] = [];
  for (const s of inTimeOrder(subs)) {
    const off = holder.get(s.slotId);
    const valid = s.minute > 0 && s.minute < durationMinutes && off && s.onMemberId !== off && !onPitch.has(s.onMemberId);
    if (!valid || !off) continue;
    kept.push({ ...s, offMemberId: off });
    holder.set(s.slotId, s.onMemberId);
    onPitch.delete(off);
    onPitch.add(s.onMemberId);
  }
  return { substitutions: kept, dropped: subs.length - kept.length };
}

/**
 * Put every change on a whole-`step`-minute mark (default 5), so the plan lines up with the rotation chart.
 * Rounding keeps the order of changes, so nothing becomes invalid; if the match isn't a multiple of the step
 * long, the plan is left alone.
 */
export function snapSubstitutions(
  starting: SlotAssignment[],
  subs: Substitution[],
  durationMinutes: number,
  step = 5,
): { substitutions: Substitution[]; dropped: number } {
  if (durationMinutes % step !== 0 || durationMinutes < step * 2) return normaliseSubstitutions(starting, subs, durationMinutes);
  const snapped = subs.map((s) => ({
    ...s,
    minute: Math.min(durationMinutes - step, Math.max(step, Math.round(s.minute / step) * step)),
  }));
  return normaliseSubstitutions(starting, snapped, durationMinutes);
}

/** Whole minutes each player is on the pitch for, for a (normalised) plan. Players who never play are left out. */
export function minutesFromPlan(starting: SlotAssignment[], subs: Substitution[], durationMinutes: number): Record<Id, number> {
  const events = inTimeOrder(subs).map((s) => ({
    atSecond: s.minute * 60,
    slotId: s.slotId,
    offMemberId: s.offMemberId,
    onMemberId: s.onMemberId,
  }));
  const seconds = secondsPlayed(starting, events, durationMinutes * 60);
  return Object.fromEntries(Object.entries(seconds).map(([id, s]) => [id, Math.round(s / 60)]));
}

/** Who is on the pitch just before the change at `index` (in the given order) happens. */
export function onPitchBeforeChange(starting: SlotAssignment[], subs: Substitution[], index: number): Set<Id> {
  const target = subs[index];
  const holder = new Map<string, Id>();
  for (const s of starting) if (s.memberId) holder.set(s.slotId, s.memberId);
  if (!target) return new Set(holder.values());
  for (const [i, s] of subs.map((s, i) => [i, s] as const).sort((a, b) => a[1].minute - b[1].minute || a[0] - b[0])) {
    if (i === index) break;
    holder.set(s.slotId, s.onMemberId);
  }
  return new Set(holder.values());
}
