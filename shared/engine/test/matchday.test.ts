import { describe, expect, it } from 'vitest';
import type { LiveSubstitution, SlotAssignment } from '@hockey/contracts';
import { benchNow, nextDueSubstitution, pitchAt, secondsPlayed } from '../src';

const starting: SlotAssignment[] = [
  { slotId: 'GK', memberId: 'gk' },
  { slotId: 'LB', memberId: 'a' },
  { slotId: 'RB', memberId: 'b' },
  { slotId: 'CF', memberId: null },
];
const bench = ['c', 'd'];
const sub = (atSecond: number, slotId: string, off: string, on: string): LiveSubstitution => ({ atSecond, slotId, offMemberId: off, onMemberId: on });

describe('matchday: who is on the pitch', () => {
  it('starts from the lineup, ignoring empty slots', () => {
    expect([...pitchAt(starting, [])]).toEqual([['GK', 'gk'], ['LB', 'a'], ['RB', 'b']]);
  });

  it('applies substitutions in time order and can look at an earlier moment', () => {
    const events = [sub(900, 'LB', 'a', 'd'), sub(300, 'LB', 'd', 'c')]; // given out of order on purpose
    expect(pitchAt(starting, events).get('LB')).toBe('d');
    expect(pitchAt(starting, events, 600).get('LB')).toBe('c');
    expect(pitchAt(starting, events, 100).get('LB')).toBe('a');
  });

  it('lists the bench as everyone named who is off, in order', () => {
    expect(benchNow(starting, bench, [])).toEqual(['c', 'd']);
    expect(benchNow(starting, bench, [sub(300, 'LB', 'a', 'c')])).toEqual(['a', 'd']);
  });
});

describe('matchday: minutes played', () => {
  it('gives starters the whole time when nobody is substituted', () => {
    expect(secondsPlayed(starting, [], 3600)).toEqual({ gk: 3600, a: 3600, b: 3600 });
  });

  it('splits a slot between the player coming off and the one coming on', () => {
    const played = secondsPlayed(starting, [sub(1200, 'LB', 'a', 'c')], 3600);
    expect(played).toEqual({ gk: 3600, a: 1200, b: 3600, c: 2400 });
  });

  it('handles a player going off and coming back on, and chains of changes in one slot', () => {
    const events = [sub(600, 'LB', 'a', 'c'), sub(1200, 'LB', 'c', 'd'), sub(2400, 'LB', 'd', 'a')];
    expect(secondsPlayed(starting, events, 3000)).toEqual({ gk: 3000, a: 600 + 600, b: 3000, c: 600, d: 1200 });
  });

  it('adds up to slots x match time, and ignores changes after the final whistle', () => {
    const events = [sub(1000, 'LB', 'a', 'c'), sub(2000, 'RB', 'b', 'd'), sub(9999, 'GK', 'gk', 'a')];
    const played = secondsPlayed(starting, events, 3600);
    expect(Object.values(played).reduce((x, y) => x + y, 0)).toBe(3 * 3600);
  });
});

describe('matchday: planned substitutions', () => {
  const planned = [
    { minute: 15, slotId: 'LB', offMemberId: 'a', onMemberId: 'c' },
    { minute: 30, slotId: 'RB', offMemberId: 'b', onMemberId: 'd' },
  ];

  it('finds the first planned change that is due and still valid', () => {
    expect(nextDueSubstitution(planned, starting, [], 14 * 60)).toBeUndefined();
    expect(nextDueSubstitution(planned, starting, [], 15 * 60)?.slotId).toBe('LB');
    expect(nextDueSubstitution(planned, starting, [], 40 * 60)?.slotId).toBe('LB');
  });

  it('moves on once it has been made, and skips changes that no longer make sense', () => {
    const done = [sub(900, 'LB', 'a', 'c')];
    expect(nextDueSubstitution(planned, starting, done, 40 * 60)?.slotId).toBe('RB');
    // The manager already swapped b out by hand, so the planned b -> d change is no longer valid.
    const manual = [sub(900, 'LB', 'a', 'c'), sub(1000, 'RB', 'b', 'a')];
    expect(nextDueSubstitution(planned, starting, manual, 40 * 60)).toBeUndefined();
  });
});
