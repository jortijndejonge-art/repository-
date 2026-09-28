import type {
  Formation,
  FormationSlot,
  Id,
  PlayerProfile,
  SlotAssignment,
  Substitution,
  SuggestionResult,
  SuggestionStrategy,
} from '@hockey/contracts';

export interface SuggestInput {
  /** Players available for this match (the caller filters on availability). */
  players: PlayerProfile[];
  formation: Formation;
  strategy: SuggestionStrategy;
  durationMinutes: number;
  periods: number;
  /** Manager overrides for the starting lineup. These always win. */
  locked?: SlotAssignment[];
}

/**
 * How well a player suits a slot, 0–1. `null` means not allowed
 * (only players who list GK may start in goal).
 */
export function positionFit(player: PlayerProfile, slot: FormationSlot): number | null {
  const idx = player.positions.indexOf(slot.line);
  if (slot.line === 'GK') return idx < 0 ? null : idx === 0 ? 1 : 0.85;
  if (idx === 0) return 1;
  if (idx > 0) return 0.85;
  // Keeper-only players can play outfield, but poorly.
  if (player.positions.length === 1 && player.positions[0] === 'GK') return 0.3;
  return 0.5;
}

function startScore(
  player: PlayerProfile,
  slot: FormationSlot,
  strategy: SuggestionStrategy,
  maxSeasonMinutes: number,
): number | null {
  const fit = positionFit(player, slot);
  if (fit === null) return null;
  switch (strategy) {
    case 'strongest':
      return player.skill * fit;
    case 'stamina':
      return (player.stamina + player.skill * 0.3) * fit;
    case 'fair': {
      // Players with the fewest season minutes start; skill only breaks ties.
      const owed = 1 - player.seasonMinutes / Math.max(1, maxSeasonMinutes);
      return fit * 3 + owed * 10 + player.skill * 0.01;
    }
  }
}

/** Greedy best-pair assignment of players to open slots. */
function assignSlots(
  slots: FormationSlot[],
  players: PlayerProfile[],
  score: (p: PlayerProfile, s: FormationSlot) => number | null,
): Map<string, Id> {
  const result = new Map<string, Id>();
  const pairs: { slotId: string; memberId: Id; score: number }[] = [];
  for (const slot of slots) {
    for (const p of players) {
      const s = score(p, slot);
      if (s !== null) pairs.push({ slotId: slot.id, memberId: p.memberId, score: s });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const usedPlayers = new Set<Id>();
  for (const pair of pairs) {
    if (result.has(pair.slotId) || usedPlayers.has(pair.memberId)) continue;
    result.set(pair.slotId, pair.memberId);
    usedPlayers.add(pair.memberId);
  }
  return result;
}

/**
 * Share `total` minutes between players in proportion to `weights`,
 * each between `floor` and `cap` (water-filling).
 */
function allocateMinutes(weights: Map<Id, number>, total: number, floor: number, cap: number): Map<Id, number> {
  const ids = [...weights.keys()];
  const result = new Map<Id, number>();
  if (ids.length === 0) return result;
  const effectiveFloor = Math.min(floor, total / ids.length);
  let free = new Set(ids);
  let remaining = total;
  for (const id of ids) {
    result.set(id, effectiveFloor);
    remaining -= effectiveFloor;
  }
  // Distribute what's left proportionally, capping and re-distributing overflow.
  while (remaining > 1e-6 && free.size > 0) {
    const weightSum = [...free].reduce((sum, id) => sum + (weights.get(id) ?? 0), 0);
    let overflow = 0;
    const nextFree = new Set<Id>();
    for (const id of free) {
      const w = weights.get(id) ?? 0;
      const share = weightSum > 0 ? (remaining * w) / weightSum : remaining / free.size;
      const current = result.get(id) ?? 0;
      const next = current + share;
      if (next >= cap) {
        result.set(id, cap);
        overflow += next - cap;
      } else {
        result.set(id, next);
        nextFree.add(id);
      }
    }
    remaining = overflow;
    free = nextFree;
  }
  return result;
}

/** Consecutive segments a player should play before a rest, by stamina. */
function maxStint(stamina: number): number {
  if (stamina >= 8) return Infinity;
  if (stamina >= 5) return 3;
  return 2;
}

export function suggestLineup(input: SuggestInput): SuggestionResult {
  const { players, formation, strategy, durationMinutes, periods } = input;
  const warnings: string[] = [];
  const byId = new Map(players.map((p) => [p.memberId, p]));
  const slotById = new Map(formation.slots.map((s) => [s.id, s]));
  const maxSeason = Math.max(0, ...players.map((p) => p.seasonMinutes));

  // 1. Starting lineup: manager locks first, then best available per slot.
  const starting = new Map<string, Id>();
  for (const lock of input.locked ?? []) {
    if (lock.memberId && slotById.has(lock.slotId) && byId.has(lock.memberId)) {
      starting.set(lock.slotId, lock.memberId);
    }
  }
  const lockedIds = new Set(starting.values());
  const openSlots = formation.slots.filter((s) => !starting.has(s.id));
  const pool = players.filter((p) => !lockedIds.has(p.memberId));

  // Keeper first, so a specialist is never "used up" in outfield.
  const gkSlots = openSlots.filter((s) => s.line === 'GK');
  const outfieldSlots = openSlots.filter((s) => s.line !== 'GK');
  const score = (p: PlayerProfile, s: FormationSlot) => startScore(p, s, strategy, maxSeason);
  // In goal, a specialist keeper always beats strategy considerations.
  const keeperScore = (p: PlayerProfile, s: FormationSlot) => {
    const fit = positionFit(p, s);
    return fit === null ? null : fit * 100 + (score(p, s) ?? 0);
  };
  for (const [slotId, memberId] of assignSlots(gkSlots, pool, keeperScore)) starting.set(slotId, memberId);

  for (const slot of gkSlots) {
    if (!starting.has(slot.id)) {
      warnings.push('No free goalkeeper — an outfield player has been put in goal.');
    }
  }

  const afterGk = pool.filter((p) => ![...starting.values()].includes(p.memberId));
  for (const [slotId, memberId] of assignSlots(outfieldSlots, afterGk, score)) starting.set(slotId, memberId);

  // Anyone left over (e.g. no keeper found) — fill remaining slots with whoever is free.
  const stillOpen = formation.slots.filter((s) => !starting.has(s.id));
  const unused = players.filter((p) => ![...starting.values()].includes(p.memberId));
  for (const slot of stillOpen) {
    const next = unused.shift();
    if (next) starting.set(slot.id, next.memberId);
  }
  const emptySlots = formation.slots.filter((s) => !starting.has(s.id)).length;
  if (emptySlots > 0) {
    warnings.push(
      `Only ${players.length} available for ${formation.slots.length} positions — ${emptySlots} left empty.`,
    );
  }

  const startingIds = new Set(starting.values());
  const bench = players.filter((p) => !startingIds.has(p.memberId)).map((p) => p.memberId);

  // 2. Substitution plan. Keepers stay on for the whole match in v1.
  const segments = durationMinutes / (periods * 2) >= 5 ? periods * 2 : periods;
  const boundaries = Array.from({ length: segments + 1 }, (_, i) => Math.round((durationMinutes * i) / segments));
  const segLen = durationMinutes / segments;

  const rotatingSlots = formation.slots.filter((s) => s.line !== 'GK' && starting.has(s.id));
  const keeperIds = new Set(
    formation.slots.filter((s) => s.line === 'GK').map((s) => starting.get(s.id)).filter(Boolean) as Id[],
  );
  const outfieldPool = players.filter((p) => !keeperIds.has(p.memberId));

  const weights = new Map<Id, number>();
  const avgSeason = outfieldPool.reduce((sum, p) => sum + p.seasonMinutes, 0) / Math.max(1, outfieldPool.length);
  for (const p of outfieldPool) {
    let w: number;
    if (strategy === 'strongest') w = p.skill * p.skill;
    else if (strategy === 'stamina') w = p.stamina;
    else w = 1 + Math.max(-0.15, Math.min(0.15, (avgSeason - p.seasonMinutes) / (avgSeason + 60)));
    weights.set(p.memberId, w);
  }
  const targets = allocateMinutes(weights, rotatingSlots.length * durationMinutes, segLen, durationMinutes);

  const played = new Map<Id, number>(players.map((p) => [p.memberId, 0]));
  const stint = new Map<Id, number>();
  const substitutions: Substitution[] = [];
  let onPitch = new Map(starting); // slotId -> memberId

  for (let seg = 0; seg < segments; seg++) {
    const minute = boundaries[seg] ?? 0;
    const length = (boundaries[seg + 1] ?? durationMinutes) - minute;

    if (seg > 0 && outfieldPool.length > rotatingSlots.length) {
      const currentOutfield = new Set(rotatingSlots.map((s) => onPitch.get(s.id)).filter(Boolean) as Id[]);
      const need = (p: PlayerProfile) => {
        let n = (targets.get(p.memberId) ?? 0) - (played.get(p.memberId) ?? 0);
        if (currentOutfield.has(p.memberId)) n += segLen * 0.5; // favour continuity: fewer, cleaner changes
        if (strategy === 'stamina' && (stint.get(p.memberId) ?? 0) >= maxStint(p.stamina)) n -= durationMinutes;
        return n;
      };
      const chosen = new Set(
        [...outfieldPool]
          .sort((a, b) => need(b) - need(a))
          .slice(0, rotatingSlots.length)
          .map((p) => p.memberId),
      );

      const next = new Map(onPitch);
      const vacated: FormationSlot[] = [];
      for (const slot of rotatingSlots) {
        const occupant = onPitch.get(slot.id);
        if (occupant && !chosen.has(occupant)) vacated.push(slot);
      }
      const incoming = [...chosen].filter((id) => !currentOutfield.has(id)).map((id) => byId.get(id)!);
      const placed = assignSlots(vacated, incoming, (p, s) => positionFit(p, s) ?? 0);
      for (const slot of vacated) {
        const on = placed.get(slot.id);
        const off = onPitch.get(slot.id);
        if (!on || !off) continue;
        next.set(slot.id, on);
        substitutions.push({ minute, slotId: slot.id, offMemberId: off, onMemberId: on });
      }
      onPitch = next;
    }

    const onIds = new Set(onPitch.values());
    for (const p of players) {
      if (onIds.has(p.memberId)) {
        played.set(p.memberId, (played.get(p.memberId) ?? 0) + length);
        stint.set(p.memberId, (stint.get(p.memberId) ?? 0) + 1);
      } else {
        stint.set(p.memberId, 0);
      }
    }
  }

  const projectedMinutes: Record<Id, number> = {};
  for (const [id, mins] of played) projectedMinutes[id] = Math.round(mins);

  return {
    starting: formation.slots.map((s) => ({ slotId: s.id, memberId: starting.get(s.id) ?? null })),
    bench,
    substitutions,
    projectedMinutes,
    warnings,
  };
}
