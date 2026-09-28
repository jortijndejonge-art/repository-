import { describe, expect, it } from 'vitest';
import type { PlayerProfile, PositionLine, SuggestionStrategy } from '@hockey/contracts';
import { FORMATIONS, getFormation, positionFit, suggestLineup } from '../src';

function player(
  id: string,
  positions: PositionLine[],
  skill = 5,
  stamina = 5,
  seasonMinutes = 0,
): PlayerProfile {
  return { memberId: id, displayName: id, positions, skill, stamina, seasonMinutes };
}

/** A squad of `n` with two keepers and a spread of skills/stamina. */
function squad(n: number): PlayerProfile[] {
  const lines: PositionLine[] = ['DEF', 'MID', 'FWD'];
  const players = [player('gk1', ['GK'], 7, 9, 300), player('gk2', ['GK', 'DEF'], 4, 6, 100)];
  for (let i = 0; players.length < n; i++) {
    const line = lines[i % 3]!;
    const alt = lines[(i + 1) % 3]!;
    players.push(player(`p${i}`, [line, alt], 1 + (i % 10), 1 + ((i * 3) % 10), (i * 37) % 400));
  }
  return players;
}

const strategies: SuggestionStrategy[] = ['fair', 'strongest', 'stamina'];

describe('suggestLineup — invariants for every format × strategy', () => {
  for (const formation of FORMATIONS) {
    for (const strategy of strategies) {
      it(`${formation.id} / ${strategy}`, () => {
        const players = squad(formation.slots.length + 4);
        const duration = formation.format === 11 ? 60 : 40;
        const result = suggestLineup({ players, formation, strategy, durationMinutes: duration, periods: 4 });

        // Every slot filled, no one twice.
        const starters = result.starting.map((s) => s.memberId);
        expect(starters.every(Boolean)).toBe(true);
        expect(new Set(starters).size).toBe(starters.length);
        expect(result.bench).toHaveLength(4);
        expect(result.warnings).toEqual([]);

        // Keeper is a keeper.
        const gk = result.starting.find((s) => s.slotId === 'GK')!;
        const gkPlayer = players.find((p) => p.memberId === gk.memberId)!;
        expect(gkPlayer.positions).toContain('GK');

        // Minutes add up to positions × match length.
        const total = Object.values(result.projectedMinutes).reduce((a, b) => a + b, 0);
        expect(total).toBe(formation.slots.length * duration);

        // Every bench player gets on at some point.
        for (const id of result.bench) expect(result.projectedMinutes[id]).toBeGreaterThan(0);

        // Substitutions are consistent: the player going off is on that slot.
        const onPitch = new Map(result.starting.map((s) => [s.slotId, s.memberId]));
        for (const sub of result.substitutions) {
          expect(onPitch.get(sub.slotId)).toBe(sub.offMemberId);
          expect([...onPitch.values()]).not.toContain(sub.onMemberId);
          onPitch.set(sub.slotId, sub.onMemberId);
        }
      });
    }
  }
});

describe('suggestLineup — strategies', () => {
  const formation = getFormation('7-2-2-2');
  const players = squad(12);
  const run = (strategy: SuggestionStrategy) =>
    suggestLineup({ players, formation, strategy, durationMinutes: 40, periods: 4 });

  const outfieldSpread = (minutes: Record<string, number>, keeperId: string) => {
    const values = Object.entries(minutes)
      .filter(([id]) => id !== keeperId)
      .map(([, m]) => m);
    return Math.max(...values) - Math.min(...values);
  };

  it('fair playing time spreads minutes more evenly than strongest', () => {
    const fair = run('fair');
    const strongest = run('strongest');
    const keeper = fair.starting.find((s) => s.slotId === 'GK')!.memberId!;
    expect(outfieldSpread(fair.projectedMinutes, keeper)).toBeLessThan(
      outfieldSpread(strongest.projectedMinutes, keeper),
    );
  });

  it('strongest starts the highest-skilled outfield players', () => {
    const result = run('strongest');
    const starters = new Set(result.starting.map((s) => s.memberId));
    const outfield = players.filter((p) => !p.positions.includes('GK'));
    const bestBenched = Math.max(
      ...outfield.filter((p) => !starters.has(p.memberId)).map((p) => p.skill),
    );
    const weakestStarter = Math.min(
      ...outfield.filter((p) => starters.has(p.memberId)).map((p) => p.skill),
    );
    expect(weakestStarter).toBeGreaterThanOrEqual(bestBenched - 1);
  });

  it('fair starts the players with the fewest season minutes', () => {
    const result = run('fair');
    const starters = new Set(result.starting.map((s) => s.memberId));
    const outfield = players.filter((p) => !p.positions.includes('GK'));
    const leastPlayed = [...outfield].sort((a, b) => a.seasonMinutes - b.seasonMinutes)[0]!;
    expect(starters.has(leastPlayed.memberId)).toBe(true);
  });
});

describe('suggestLineup — manager override and edge cases', () => {
  it('manager locks always win', () => {
    const formation = getFormation('11-4-3-3');
    const players = squad(14);
    const result = suggestLineup({
      players,
      formation,
      strategy: 'strongest',
      durationMinutes: 60,
      periods: 4,
      locked: [
        { slotId: 'CF', memberId: 'p0' }, // the weakest player, deliberately
        { slotId: 'GK', memberId: 'gk2' },
      ],
    });
    expect(result.starting.find((s) => s.slotId === 'CF')!.memberId).toBe('p0');
    expect(result.starting.find((s) => s.slotId === 'GK')!.memberId).toBe('gk2');
  });

  it('warns when no goalkeeper is available but still fills the slot', () => {
    const formation = getFormation('5-1-2-1');
    const players = squad(9).filter((p) => !p.positions.includes('GK'));
    const result = suggestLineup({ players, formation, strategy: 'fair', durationMinutes: 40, periods: 4 });
    expect(result.warnings.join(' ')).toMatch(/goalkeeper/i);
    expect(result.starting.every((s) => s.memberId)).toBe(true);
  });

  it('warns and leaves slots empty when short of players', () => {
    const formation = getFormation('11-4-4-2');
    const players = squad(9);
    const result = suggestLineup({ players, formation, strategy: 'fair', durationMinutes: 60, periods: 4 });
    expect(result.starting.filter((s) => !s.memberId)).toHaveLength(2);
    expect(result.substitutions).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/Only 9 available/);
  });

  it('only lets listed keepers start in goal', () => {
    const gkSlot = getFormation('7-2-2-2').slots.find((s) => s.line === 'GK')!;
    expect(positionFit(player('x', ['DEF']), gkSlot)).toBeNull();
    expect(positionFit(player('y', ['DEF', 'GK']), gkSlot)).toBe(0.85);
    expect(positionFit(player('z', ['GK']), gkSlot)).toBe(1);
  });

  it('puts the specialist keeper in goal even when fairness favours a part-timer', () => {
    const formation = getFormation('7-2-2-2');
    const players = [
      player('keeper', ['GK'], 5, 5, 400),
      player('parttime', ['DEF', 'GK'], 5, 5, 0),
      ...squad(12).filter((p) => !p.positions.includes('GK')),
    ];
    const result = suggestLineup({ players, formation, strategy: 'fair', durationMinutes: 40, periods: 4 });
    expect(result.starting.find((s) => s.slotId === 'GK')!.memberId).toBe('keeper');
  });
});
