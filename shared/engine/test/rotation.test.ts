import { describe, expect, it } from 'vitest';
import type { SlotAssignment, Substitution } from '@hockey/contracts';
import {
  blockMinutesFor,
  buildRotation,
  defaultSwapEnd,
  minutesFromPlan,
  minutesFromRotation,
  rotationSubstitutions,
  swapStates,
  validRotationSubstitutions,
} from '../src';

const starting: SlotAssignment[] = [
  { slotId: 'GK', memberId: 'gk' },
  { slotId: 'LB', memberId: 'a' },
  { slotId: 'RB', memberId: 'b' },
];
const players = ['gk', 'a', 'b', 'c', 'd'];
const sub = (minute: number, slotId: string, off: string, on: string): Substitution => ({ minute, slotId, offMemberId: off, onMemberId: on });
const DURATION = 40;
const build = (subs: Substitution[] = []) => buildRotation(starting, subs, players, DURATION, 5);

describe('blockMinutesFor', () => {
  it('uses 5-minute blocks when the match and changes line up with that', () => {
    expect(blockMinutesFor(40, 10, [sub(5, 'LB', 'a', 'c'), sub(15, 'RB', 'b', 'd')])).toBe(5);
    expect(blockMinutesFor(60, 15, [])).toBe(5);
  });
  it('falls back to a smaller block when a change is at an odd minute', () => {
    expect(blockMinutesFor(40, 10, [sub(7, 'LB', 'a', 'c')])).toBe(1);
    expect(blockMinutesFor(30, 15, [sub(6, 'LB', 'a', 'c')])).toBe(3);
  });
});

describe('buildRotation', () => {
  it('puts the starters in their positions all match and everyone else on the bench', () => {
    const rot = build();
    expect(rot.blocks).toBe(8);
    expect(rot.states.a).toEqual(Array(8).fill('LB'));
    expect(rot.states.c).toEqual(Array(8).fill(null));
  });

  it('replays changes at their minute: the player on takes over from that block', () => {
    const rot = build([sub(15, 'LB', 'a', 'c')]);
    expect(rot.states.a).toEqual(['LB', 'LB', 'LB', null, null, null, null, null]);
    expect(rot.states.c).toEqual([null, null, null, 'LB', 'LB', 'LB', 'LB', 'LB']);
  });

  it('has exactly one player in every position in every block', () => {
    const rot = build([sub(10, 'LB', 'a', 'c'), sub(20, 'LB', 'c', 'd'), sub(30, 'RB', 'b', 'a')]);
    for (let b = 0; b < rot.blocks; b++) {
      for (const slot of ['GK', 'LB', 'RB']) {
        expect(Object.values(rot.states).filter((st) => st[b] === slot)).toHaveLength(1);
      }
    }
  });
});

describe('rotationSubstitutions', () => {
  it('turns a chart back into the same changes it was built from', () => {
    const plan = [sub(10, 'LB', 'a', 'c'), sub(25, 'RB', 'b', 'a')];
    expect(rotationSubstitutions(starting, build(plan))).toEqual(plan);
  });

  it('orders same-minute changes so each player is off before they go on elsewhere', () => {
    // At 20' a comes off LB for c, and b comes off RB for a (a moves from LB to RB): LB must happen first.
    const plan = [sub(20, 'LB', 'a', 'c'), sub(20, 'RB', 'b', 'a')];
    const subs = rotationSubstitutions(starting, build(plan))!;
    expect(subs.map((s) => s.slotId)).toEqual(['LB', 'RB']);
    expect(validRotationSubstitutions(starting, build(plan), DURATION)).toHaveLength(2);
  });

  it('gives up (null) when two players on the pitch would have to swap positions', () => {
    const rot = build();
    const cycle = { ...rot, states: { ...rot.states, a: [...rot.states.a!], b: [...rot.states.b!] } };
    cycle.states.a![4] = 'RB';
    cycle.states.b![4] = 'LB';
    expect(rotationSubstitutions(starting, cycle)).toBeNull();
  });
});

describe('swapStates', () => {
  it('swaps a player on the pitch with one on the bench from a block onward', () => {
    const { rotation, applied } = swapStates(build(), 'a', 'c', 3, 8);
    expect(applied).toBe(5);
    expect(rotation.states.a).toEqual(['LB', 'LB', 'LB', null, null, null, null, null]);
    expect(rotation.states.c).toEqual([null, null, null, 'LB', 'LB', 'LB', 'LB', 'LB']);
  });

  it('never changes the starting lineup (block 0)', () => {
    const { rotation, applied } = swapStates(build(), 'a', 'c', 0, 3);
    expect(applied).toBe(2);
    expect(rotation.states.a![0]).toBe('LB');
    expect(rotation.states.c![0]).toBeNull();
  });

  it('stops where both players are on the pitch or both on the bench, and does nothing if that is the first block', () => {
    expect(swapStates(build(), 'a', 'b', 2, 6).applied).toBe(0); // both on the pitch
    expect(swapStates(build(), 'c', 'd', 2, 6).applied).toBe(0); // both on the bench
    // c is already on in LB from block 4: swapping a and c from block 2 stops at 4 when both are on the pitch/bench alike
    const rot = build([sub(20, 'LB', 'a', 'c')]);
    expect(swapStates(rot, 'a', 'd', 2, 8).applied).toBe(2); // a is on until block 4, d never plays, then a is also off
  });

  it('does not change the original chart', () => {
    const rot = build();
    swapStates(rot, 'a', 'c', 3, 8);
    expect(rot.states.a).toEqual(Array(8).fill('LB'));
  });
});

describe('defaultSwapEnd', () => {
  it("runs until either player's situation changes", () => {
    const rot = build([sub(20, 'RB', 'b', 'd')]);
    expect(defaultSwapEnd(rot, 'a', 'c', 2)).toBe(8); // nothing changes for a or c
    expect(defaultSwapEnd(rot, 'b', 'c', 2)).toBe(4); // b comes off at block 4
  });
});

describe('minutesFromRotation', () => {
  it('counts blocks on the pitch and agrees with the minutes worked out from the list of changes', () => {
    const plan = [sub(10, 'LB', 'a', 'c'), sub(20, 'LB', 'c', 'd'), sub(30, 'RB', 'b', 'a')];
    const rot = build(plan);
    expect(minutesFromRotation(rot)).toEqual(minutesFromPlan(starting, plan, DURATION));
    expect(Object.values(minutesFromRotation(rot)).reduce((x, y) => x + y, 0)).toBe(3 * DURATION);
  });
});
