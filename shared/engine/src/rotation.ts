import type { Id, SlotAssignment, Substitution } from '@hockey/contracts';
import { normaliseSubstitutions } from './subplan';

/**
 * A rotation chart: for every player, the position they hold in each block of the match (or null on the bench).
 * Block 0 is the starting lineup. Because every cell holds exactly one position and every position always has
 * exactly one player, a chart can never be inconsistent, unlike a list of changes.
 */
export interface Rotation {
  blockMinutes: number;
  blocks: number;
  states: Record<Id, (string | null)[]>;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** The block length: 5 minutes where everything lines up with that, otherwise the biggest length up to 5 that does. */
export function blockMinutesFor(durationMinutes: number, periodLength: number, subs: Substitution[]): number {
  let g = gcd(Math.round(durationMinutes), Math.max(1, Math.round(periodLength)));
  for (const s of subs) g = gcd(g, s.minute);
  for (let d = Math.min(5, g); d >= 1; d--) if (g % d === 0) return d;
  return 1;
}

/** Replay a plan into a chart. `players` are everyone who might play; anyone named in the plan is added. */
export function buildRotation(
  starting: SlotAssignment[],
  subs: Substitution[],
  players: Id[],
  durationMinutes: number,
  blockMinutes: number,
): Rotation {
  const blocks = Math.max(1, Math.round(durationMinutes / blockMinutes));
  const everyone = new Set<Id>(players);
  for (const s of starting) if (s.memberId) everyone.add(s.memberId);
  for (const s of subs) {
    everyone.add(s.onMemberId);
    everyone.add(s.offMemberId);
  }
  const states: Record<Id, (string | null)[]> = {};
  for (const id of everyone) states[id] = Array<string | null>(blocks).fill(null);

  const holder = new Map<string, Id>();
  for (const s of starting) if (s.memberId) holder.set(s.slotId, s.memberId);
  const ordered = subs.map((s, i) => ({ s, i })).sort((a, b) => a.s.minute - b.s.minute || a.i - b.i).map(({ s }) => s);
  let next = 0;
  for (let b = 0; b < blocks; b++) {
    while (next < ordered.length && ordered[next]!.minute <= b * blockMinutes) {
      holder.set(ordered[next]!.slotId, ordered[next]!.onMemberId);
      next++;
    }
    for (const [slotId, id] of holder) states[id]![b] = slotId;
  }
  return { blockMinutes, blocks, states };
}

/**
 * Turn a chart back into a list of changes. Changes at the same minute are put in an order that works
 * (someone must come off before they can go on somewhere else). Returns null if no order works, which
 * happens when two players on the pitch would have to swap positions.
 */
export function rotationSubstitutions(starting: SlotAssignment[], rot: Rotation): Substitution[] | null {
  const pitch = new Map<string, Id>();
  for (const s of starting) if (s.memberId) pitch.set(s.slotId, s.memberId);
  const subs: Substitution[] = [];
  for (let b = 1; b < rot.blocks; b++) {
    const next = new Map<string, Id>();
    for (const [id, st] of Object.entries(rot.states)) if (st[b]) next.set(st[b]!, id);
    const pending = [...pitch.keys()].filter((slot) => next.get(slot) !== pitch.get(slot));
    while (pending.length) {
      const onPitch = new Set(pitch.values());
      const at = pending.findIndex((slot) => {
        const on = next.get(slot);
        return on !== undefined && !onPitch.has(on);
      });
      if (at < 0) return null;
      const slotId = pending.splice(at, 1)[0]!;
      subs.push({ minute: b * rot.blockMinutes, slotId, offMemberId: pitch.get(slotId)!, onMemberId: next.get(slotId)! });
      pitch.set(slotId, next.get(slotId)!);
    }
  }
  return subs;
}

/** Like `rotationSubstitutions`, but also checks the result is a plan that really works; null if not. */
export function validRotationSubstitutions(starting: SlotAssignment[], rot: Rotation, durationMinutes: number): Substitution[] | null {
  const subs = rotationSubstitutions(starting, rot);
  if (!subs) return null;
  return normaliseSubstitutions(starting, subs, durationMinutes).dropped === 0 ? subs : null;
}

/**
 * Swap what two players are doing in blocks `from` up to (not including) `to`. A change always swaps someone on
 * the pitch with someone on the bench, so it stops at the first block where that isn't true. Block 0 (the
 * starting lineup) is never changed. `applied` is how many blocks were swapped.
 */
export function swapStates(rot: Rotation, a: Id, b: Id, from: number, to: number): { rotation: Rotation; applied: number } {
  const sa = rot.states[a];
  const sb = rot.states[b];
  if (!sa || !sb || a === b) return { rotation: rot, applied: 0 };
  const na = [...sa];
  const nb = [...sb];
  let applied = 0;
  for (let blk = Math.max(1, from); blk < Math.min(to, rot.blocks); blk++) {
    if ((na[blk] === null) === (nb[blk] === null)) break;
    [na[blk], nb[blk]] = [nb[blk]!, na[blk]!];
    applied++;
  }
  return { rotation: { ...rot, states: { ...rot.states, [a]: na, [b]: nb } }, applied };
}

/** How far a swap starting at `from` naturally runs: until either player's situation changes. */
export function defaultSwapEnd(rot: Rotation, a: Id, b: Id, from: number): number {
  const sa = rot.states[a];
  const sb = rot.states[b];
  if (!sa || !sb) return from + 1;
  let end = from + 1;
  while (end < rot.blocks && sa[end] === sa[from] && sb[end] === sb[from]) end++;
  return end;
}

/** Whole minutes each player is on the pitch for. Players who never play are left out. */
export function minutesFromRotation(rot: Rotation): Record<Id, number> {
  const out: Record<Id, number> = {};
  for (const [id, st] of Object.entries(rot.states)) {
    const played = st.filter((x) => x !== null).length * rot.blockMinutes;
    if (played > 0) out[id] = played;
  }
  return out;
}
