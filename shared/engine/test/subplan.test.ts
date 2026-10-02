import { describe, expect, it } from 'vitest';
import type { SlotAssignment, Substitution } from '@hockey/contracts';
import { minutesFromPlan, normaliseSubstitutions, onPitchBeforeChange } from '../src';

const starting: SlotAssignment[] = [
  { slotId: 'GK', memberId: 'gk' },
  { slotId: 'LB', memberId: 'a' },
  { slotId: 'RB', memberId: 'b' },
  { slotId: 'CF', memberId: null },
];
const sub = (minute: number, slotId: string, off: string, on: string): Substitution => ({ minute, slotId, offMemberId: off, onMemberId: on });
const DURATION = 40;

describe('normaliseSubstitutions', () => {
  it('keeps a valid plan and puts it in time order', () => {
    const { substitutions, dropped } = normaliseSubstitutions(starting, [sub(20, 'RB', 'b', 'd'), sub(10, 'LB', 'a', 'c')], DURATION);
    expect(substitutions.map((s) => [s.minute, s.slotId, s.offMemberId, s.onMemberId])).toEqual([
      [10, 'LB', 'a', 'c'],
      [20, 'RB', 'b', 'd'],
    ]);
    expect(dropped).toBe(0);
  });

  it('works out who comes off from who is in the slot, so changing a slot or a time stays consistent', () => {
    // The off player given is wrong on purpose: c is in LB at minute 30 because of the earlier change.
    const { substitutions } = normaliseSubstitutions(starting, [sub(30, 'LB', 'a', 'd'), sub(10, 'LB', 'a', 'c')], DURATION);
    expect(substitutions.map((s) => s.offMemberId)).toEqual(['a', 'c']);
  });

  it('drops changes that cannot happen: player already on, nobody in the slot, same player, outside the match', () => {
    const { substitutions, dropped } = normaliseSubstitutions(
      starting,
      [
        sub(5, 'LB', 'a', 'b'), // b is already on the pitch
        sub(6, 'CF', '', 'c'), // nobody is in CF
        sub(7, 'LB', 'a', 'a'), // same player
        sub(0, 'RB', 'b', 'c'), // before kick-off
        sub(40, 'RB', 'b', 'c'), // at full time
        sub(15, 'RB', 'b', 'c'), // fine
      ],
      DURATION,
    );
    expect(substitutions).toEqual([sub(15, 'RB', 'b', 'c')]);
    expect(dropped).toBe(5);
  });

  it('lets a player come back on after going off, and drops a later change that relied on a removed one', () => {
    const back = normaliseSubstitutions(starting, [sub(10, 'LB', 'a', 'c'), sub(20, 'RB', 'b', 'a')], DURATION);
    expect(back.substitutions).toHaveLength(2);
    // c can only go off in LB if c came on there first; with the first change removed it no longer makes sense.
    const orphan = normaliseSubstitutions(starting, [sub(20, 'LB', 'c', 'd')], DURATION);
    expect(orphan.substitutions.map((s) => s.offMemberId)).toEqual(['a']); // slot holder is a, so a comes off
  });
});

describe('minutesFromPlan', () => {
  it('gives starters the full match when there are no changes', () => {
    expect(minutesFromPlan(starting, [], DURATION)).toEqual({ gk: 40, a: 40, b: 40 });
  });

  it('splits a slot between the player going off and the one coming on', () => {
    expect(minutesFromPlan(starting, [sub(15, 'LB', 'a', 'c')], DURATION)).toEqual({ gk: 40, a: 15, b: 40, c: 25 });
  });

  it('adds up to slots x match length however the plan is arranged', () => {
    const plan = [sub(10, 'LB', 'a', 'c'), sub(20, 'LB', 'c', 'd'), sub(30, 'RB', 'b', 'a')];
    const minutes = minutesFromPlan(starting, plan, DURATION);
    expect(Object.values(minutes).reduce((x, y) => x + y, 0)).toBe(3 * DURATION);
  });
});

describe('onPitchBeforeChange', () => {
  it('is the pitch just before that change, whatever order the list is in', () => {
    const plan = [sub(20, 'LB', 'c', 'd'), sub(10, 'LB', 'a', 'c')]; // listed out of order
    expect([...onPitchBeforeChange(starting, plan, 0)].sort()).toEqual(['b', 'c', 'gk']); // before minute 20: c is in LB
    expect([...onPitchBeforeChange(starting, plan, 1)].sort()).toEqual(['a', 'b', 'gk']); // before minute 10: a is in LB
  });
});
