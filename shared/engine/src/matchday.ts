import type { Id, LiveSubstitution, SlotAssignment } from '@hockey/contracts';

/** Who is standing in each slot after the substitutions made up to `atSecond` (default: all of them). */
export function pitchAt(starting: SlotAssignment[], events: LiveSubstitution[], atSecond = Infinity): Map<string, Id> {
  const pitch = new Map<string, Id>();
  for (const s of starting) if (s.memberId) pitch.set(s.slotId, s.memberId);
  for (const e of [...events].sort((a, b) => a.atSecond - b.atSecond)) {
    if (e.atSecond > atSecond) break;
    pitch.set(e.slotId, e.onMemberId);
  }
  return pitch;
}

/** Everyone named in the lineup who is not on the pitch right now, in the order they were named. */
export function benchNow(starting: SlotAssignment[], bench: Id[], events: LiveSubstitution[]): Id[] {
  const onPitch = new Set(pitchAt(starting, events).values());
  const everyone = [...starting.map((s) => s.memberId).filter((m): m is Id => Boolean(m)), ...bench];
  return everyone.filter((id, i) => everyone.indexOf(id) === i && !onPitch.has(id));
}

/** Seconds each player has been on the pitch by `totalSeconds`, counting only players who played at all. */
export function secondsPlayed(starting: SlotAssignment[], events: LiveSubstitution[], totalSeconds: number): Record<Id, number> {
  const played: Record<Id, number> = {};
  const since = new Map<string, number>(); // slot -> second the current player came on
  const holder = new Map<string, Id>();
  for (const s of starting) {
    if (!s.memberId) continue;
    holder.set(s.slotId, s.memberId);
    since.set(s.slotId, 0);
  }
  const credit = (slotId: string, until: number) => {
    const id = holder.get(slotId);
    if (!id) return;
    const from = since.get(slotId) ?? 0;
    played[id] = (played[id] ?? 0) + Math.max(0, Math.min(until, totalSeconds) - Math.min(from, totalSeconds));
  };
  for (const e of [...events].sort((a, b) => a.atSecond - b.atSecond)) {
    credit(e.slotId, e.atSecond);
    holder.set(e.slotId, e.onMemberId);
    since.set(e.slotId, e.atSecond);
  }
  for (const slotId of holder.keys()) credit(slotId, totalSeconds);
  return played;
}

/** The next planned substitution that is due by `elapsedSeconds` and hasn't been made yet, if any. */
export function nextDueSubstitution(
  planned: { minute: number; slotId: string; offMemberId: Id; onMemberId: Id }[],
  starting: SlotAssignment[],
  events: LiveSubstitution[],
  elapsedSeconds: number,
) {
  const pitch = pitchAt(starting, events);
  const onPitch = new Set(pitch.values());
  return [...planned]
    .sort((a, b) => a.minute - b.minute)
    .find((p) => p.minute * 60 <= elapsedSeconds && pitch.get(p.slotId) === p.offMemberId && !onPitch.has(p.onMemberId));
}
