import { describe, expect, it } from 'vitest';
import type { Pitch } from '@hockey/contracts';
import { clock, findConflicts, freeSlots, instantAt, localParts } from '../src';

const TZ = 'Europe/London';

const pitch: Pitch = {
  id: 'main',
  clubId: 'c',
  name: 'Main astro',
  slots: [
    // Saturday 09:00-13:00 for the juniors, Saturday 14:00-17:00 for adults
    { id: 's1', pitchId: 'main', weekday: 5, startMinute: 540, endMinute: 780, ageGroups: ['U8', 'U10', 'U12'] },
    { id: 's2', pitchId: 'main', weekday: 5, startMinute: 840, endMinute: 1020, ageGroups: ['Adult'] },
  ],
};
const open: Pitch = { id: 'grass', clubId: 'c', name: 'Grass', slots: [] };

// Saturday 3 October 2026 is in British Summer Time (UTC+1), so 09:00 local is 08:00Z.
const sat = (hhmm: string) => instantAt('2026-10-03', Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), TZ);

describe('localParts and instantAt', () => {
  it('reads the weekday and wall-clock time in the club time zone, in summer and winter', () => {
    expect(localParts('2026-10-03T08:00:00Z', TZ)).toEqual({ weekday: 5, minute: 540, date: '2026-10-03' }); // BST
    expect(localParts('2026-11-07T09:00:00Z', TZ)).toEqual({ weekday: 5, minute: 540, date: '2026-11-07' }); // GMT
    expect(localParts('2026-10-03T23:30:00Z', TZ)).toMatchObject({ weekday: 6, minute: 30, date: '2026-10-04' }); // past midnight locally
  });

  it('turns a local date and time back into the right instant either side of the clocks changing', () => {
    expect(instantAt('2026-10-03', 540, TZ)).toBe('2026-10-03T08:00:00.000Z');
    expect(instantAt('2026-10-31', 540, TZ)).toBe('2026-10-31T09:00:00.000Z');
    expect(instantAt('2026-10-25', 540, TZ)).toBe('2026-10-25T09:00:00.000Z'); // the day the clocks go back
    expect(clock(570)).toBe('09:30');
  });
});

describe('findConflicts', () => {
  const base = { turnaroundMinutes: 10, timeZone: TZ, pitches: [pitch, open], trainings: [] };
  const candidate = (over: Partial<{ id: string; teamId: string; startsAt: string; durationMinutes: number; pitchId: string; ageGroup: 'U12' | 'Adult' }> = {}) => ({
    id: 'new',
    teamId: 'u12b',
    ageGroup: 'U12' as const,
    startsAt: sat('10:00'),
    durationMinutes: 40,
    pitchId: 'main',
    ...over,
  });

  it('is clear when the pitch is open to the age group and nothing else is on', () => {
    expect(findConflicts({ ...base, candidate: candidate(), fixtures: [] })).toEqual([]);
  });

  it('flags a match that overlaps another on the same pitch, including the turnaround after it', () => {
    const other = { id: 'x', teamId: 'u10g', startsAt: sat('10:00'), durationMinutes: 40, pitchId: 'main' };
    expect(findConflicts({ ...base, candidate: candidate(), fixtures: [other] })).toMatchObject([{ kind: 'pitch', fixtureId: 'x' }]);
    // The other ends 10:40; with the 10-minute turnaround the pitch is free from 10:50.
    const early = { ...other, startsAt: sat('10:00'), durationMinutes: 40 };
    expect(findConflicts({ ...base, candidate: candidate({ startsAt: sat('10:45') }), fixtures: [early] }).map((c) => c.kind)).toContain('pitch');
    expect(findConflicts({ ...base, candidate: candidate({ startsAt: sat('10:50') }), fixtures: [early] })).toEqual([]);
  });

  it('allows the same time on a different pitch', () => {
    const other = { id: 'x', teamId: 'u10g', startsAt: sat('10:00'), durationMinutes: 40, pitchId: 'grass' };
    expect(findConflicts({ ...base, candidate: candidate(), fixtures: [other] })).toEqual([]);
  });

  it('does not clash a match with itself when editing it', () => {
    const self = { id: 'new', teamId: 'u12b', startsAt: sat('10:00'), durationMinutes: 40, pitchId: 'main' };
    expect(findConflicts({ ...base, candidate: candidate(), fixtures: [self] })).toEqual([]);
  });

  it('flags a team playing or training at the same time, wherever it is', () => {
    const away = { id: 'a', teamId: 'u12b', startsAt: sat('10:20'), durationMinutes: 40 };
    expect(findConflicts({ ...base, candidate: candidate(), fixtures: [away] })).toMatchObject([{ kind: 'team', fixtureId: 'a' }]);
    const training = { id: 't', teamId: 'u12b', startsAt: sat('09:30'), durationMinutes: 60 };
    expect(findConflicts({ ...base, candidate: candidate(), fixtures: [], trainings: [training] })).toMatchObject([{ kind: 'team' }]);
    const otherTeamTraining = { ...training, teamId: 'someone-else' };
    expect(findConflicts({ ...base, candidate: candidate(), fixtures: [], trainings: [otherTeamTraining] })).toEqual([]);
  });

  it('flags a time outside the pitch openings, or for an age group the opening is not for, and says what is open', () => {
    const late = findConflicts({ ...base, candidate: candidate({ startsAt: sat('15:00') }), fixtures: [] });
    expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({ kind: 'slot' });
    expect(late[0]!.message).toContain('09:00–13:00 for U8, U10, U12');
    expect(late[0]!.message).toContain('14:00–17:00 for Adult');
    // Runs over the end of the opening
    expect(findConflicts({ ...base, candidate: candidate({ startsAt: sat('12:30') }), fixtures: [] }).map((c) => c.kind)).toEqual(['slot']);
    // Adults at junior time
    expect(findConflicts({ ...base, candidate: candidate({ ageGroup: 'Adult', teamId: 'a1' }), fixtures: [] }).map((c) => c.kind)).toEqual(['slot']);
    // Adults at adult time is fine
    expect(findConflicts({ ...base, candidate: candidate({ ageGroup: 'Adult', teamId: 'a1', startsAt: sat('14:00'), durationMinutes: 60 }), fixtures: [] })).toEqual([]);
  });

  it('says the pitch is closed on a day with no openings', () => {
    const sunday = instantAt('2026-10-04', 600, TZ);
    const result = findConflicts({ ...base, candidate: candidate({ startsAt: sunday }), fixtures: [] });
    expect(result[0]!.message).toContain('not open on Suns');
  });

  it('does not check times for a pitch with no published openings, nor a match with no pitch', () => {
    expect(findConflicts({ ...base, candidate: candidate({ pitchId: 'grass', startsAt: sat('18:00') }), fixtures: [] })).toEqual([]);
    expect(findConflicts({ ...base, candidate: { ...candidate(), pitchId: undefined }, fixtures: [] })).toEqual([]);
  });
});

describe('freeSlots', () => {
  const opts = { from: new Date('2026-10-01T00:00:00Z'), days: 14, timeZone: TZ, durationMinutes: 40 };

  it('lists the openings in the next fortnight in date order', () => {
    const slots = freeSlots([pitch], [], opts);
    expect(slots.map((s) => `${s.date} ${clock(s.startMinute)}`)).toEqual(['2026-10-03 09:00', '2026-10-03 14:00', '2026-10-10 09:00', '2026-10-10 14:00']);
    expect(slots[0]).toMatchObject({ pitchName: 'Main astro', startsAt: '2026-10-03T08:00:00.000Z', freeMinutes: 240 });
  });

  it('offers the earliest time in an opening that really fits, not just its start', () => {
    const slot = pitch.slots[0]!;
    // One match at 09:00 for 50 minutes (held until 10:00), so a 40-minute match first fits at 10:00.
    const booked = [{ id: 'f', teamId: 't', pitchId: 'main', startsAt: instantAt('2026-10-03', slot.startMinute, TZ), durationMinutes: 50 }];
    const first = freeSlots([pitch], booked, { ...opts, ageGroup: 'U12' }).find((s) => s.date === '2026-10-03')!;
    expect(first.startsAt).toBe(instantAt('2026-10-03', 600, TZ));
    // A booking in the middle leaves room only after it, or before it if the match fits with the turnaround
    const middle = [{ ...booked[0]!, startsAt: instantAt('2026-10-03', 600, TZ) }];
    expect(freeSlots([pitch], middle, { ...opts, ageGroup: 'U12' }).find((s) => s.date === '2026-10-03')!.startsAt).toBe(instantAt('2026-10-03', 540, TZ));
  });

  it('filters by age group and by how long the match is', () => {
    expect(freeSlots([pitch], [], { ...opts, ageGroup: 'Adult' }).map((s) => clock(s.startMinute))).toEqual(['14:00', '14:00']);
    expect(freeSlots([pitch], [], { ...opts, durationMinutes: 200 }).map((s) => clock(s.startMinute))).toEqual(['09:00', '09:00']); // the 3-hour adult window is too short
  });

  it('takes booked matches (and their turnaround) out of an opening, dropping it when no room is left', () => {
    const slot = pitch.slots[0]!;
    const fill = Array.from({ length: 4 }, (_, i) => ({ id: `f${i}`, teamId: `t${i}`, pitchId: 'main', startsAt: instantAt('2026-10-03', slot.startMinute + i * 60, TZ), durationMinutes: 50 }));
    const afterThree = freeSlots([pitch], fill.slice(0, 3), { ...opts, ageGroup: 'U12' }).find((s) => s.date === '2026-10-03');
    expect(afterThree?.freeMinutes).toBe(240 - 3 * 60);
    expect(freeSlots([pitch], fill, { ...opts, ageGroup: 'U12', durationMinutes: 40 }).find((s) => s.date === '2026-10-03')).toBeUndefined();
    // another pitch's bookings do not count
    expect(freeSlots([pitch], fill.map((f) => ({ ...f, pitchId: 'grass' })), { ...opts, ageGroup: 'U12' }).find((s) => s.date === '2026-10-03')?.freeMinutes).toBe(240);
  });
});
