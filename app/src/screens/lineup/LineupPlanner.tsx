import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AvailabilityStatus,
  Club,
  Fixture,
  Formation,
  Id,
  PlayerProfile,
  SlotAssignment,
  SquadFormat,
  Substitution,
  SuggestionStrategy,
  Team,
} from '@hockey/contracts';
import { positionFit } from '@hockey/engine';
import { api } from '../../api-client';
import { Pitch } from '../../components/pitch/Pitch';
import { PlayerToken } from '../../components/pitch/PlayerToken';
import { Segmented } from '../../core/Segmented';
import { useToast } from '../../core/Toast';
import { AvailabilityPanel } from './AvailabilityPanel';
import { MinutesPanel } from './MinutesPanel';
import { ShareDialog } from './ShareDialog';
import { SubPlan } from './SubPlan';
import { placeKey, useDragDrop } from './useDragDrop';
import type { Place } from './useDragDrop';
import './lineup.css';

type Assignments = Record<string, Id | null>;

interface Plan {
  substitutions: Substitution[];
  projectedMinutes: Record<Id, number>;
  warnings: string[];
}

const STRATEGIES: { value: SuggestionStrategy; label: string; hint: string }[] = [
  { value: 'fair', label: 'Fair time', hint: 'Share minutes evenly, catching up players who have played less this season' },
  { value: 'strongest', label: 'Strongest', hint: 'Start and keep the strongest players on longest' },
  { value: 'stamina', label: 'Stamina', hint: 'Rotate low-stamina players in shorter stints' },
];

const FORMATS: { value: SquadFormat; label: string }[] = [
  { value: 5, label: '5-a-side' },
  { value: 7, label: '7-a-side' },
  { value: 11, label: '11-a-side' },
];

function toAssignments(starting: SlotAssignment[]): Assignments {
  return Object.fromEntries(starting.map((s) => [s.slotId, s.memberId]));
}

function formatKickoff(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function LineupPlanner() {
  const toast = useToast();
  const [club, setClub] = useState<Club | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState<Id>('u12');
  const [fixture, setFixture] = useState<Fixture | null>(null);
  const [squad, setSquad] = useState<PlayerProfile[]>([]);
  const [availability, setAvailability] = useState<Record<Id, AvailabilityStatus>>({});
  const [format, setFormat] = useState<SquadFormat>(7);
  const [formations, setFormations] = useState<Formation[]>([]);
  const [formationId, setFormationId] = useState<string>('');
  const [strategy, setStrategy] = useState<SuggestionStrategy>('fair');
  const [assignments, setAssignments] = useState<Assignments>({});
  const [locks, setLocks] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<Plan | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const formation = formations.find((f) => f.id === formationId) ?? null;
  const byId = useMemo(() => new Map(squad.map((p) => [p.memberId, p])), [squad]);
  const available = useMemo(
    () => squad.filter((p) => availability[p.memberId] === 'available'),
    [squad, availability],
  );
  const onPitch = new Set(Object.values(assignments).filter(Boolean) as Id[]);
  const bench = available.filter((p) => !onPitch.has(p.memberId));

  /**
   * Ask the engine for a plan. `locked` slots are kept exactly as given —
   * the manager's choices always win — and everything else is optimised.
   */
  const runSuggest = useCallback(
    async (opts: { fixtureId: Id; formationId: string; strategy: SuggestionStrategy; locked: SlotAssignment[] }) => {
      const result = await api.suggest({
        fixtureId: opts.fixtureId,
        formationId: opts.formationId,
        strategy: opts.strategy,
        locked: opts.locked,
      });
      setAssignments(toAssignments(result.starting));
      setPlan({
        substitutions: result.substitutions,
        projectedMinutes: result.projectedMinutes,
        warnings: result.warnings,
      });
    },
    [],
  );

  // Initial load.
  useEffect(() => {
    api.getClub().then(setClub);
    api.getTeams().then(setTeams);
  }, []);

  // Team change: load squad, next fixture, availability, and suggest a first lineup.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [players, fx] = await Promise.all([api.getSquad(teamId), api.getNextFixture(teamId)]);
      const [avail, forms] = await Promise.all([api.getAvailability(fx.id), api.getFormations(fx.format)]);
      if (cancelled) return;
      const first = forms[0]!;
      setSquad(players);
      setFixture(fx);
      setAvailability(Object.fromEntries(avail.map((a) => [a.memberId, a.status])));
      setFormat(fx.format);
      setFormations(forms);
      setFormationId(first.id);
      setLocks(new Set());
      await runSuggest({ fixtureId: fx.id, formationId: first.id, strategy, locked: [] });
    })();
    return () => {
      cancelled = true;
    };
    // Strategy is read at load time only; changing it waits for "Suggest".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, runSuggest]);

  const lockedAssignments = (a: Assignments, only?: Set<string>): SlotAssignment[] =>
    Object.entries(a)
      .filter(([slotId, memberId]) => memberId && (!only || only.has(slotId)))
      .map(([slotId, memberId]) => ({ slotId, memberId }));

  /** Re-plan substitutions around the lineup exactly as it stands now. */
  const replan = (next: Assignments) => {
    if (!fixture) return;
    setAssignments(next);
    runSuggest({ fixtureId: fixture.id, formationId, strategy, locked: lockedAssignments(next) });
  };

  const suggest = () => {
    if (!fixture) return;
    runSuggest({ fixtureId: fixture.id, formationId, strategy, locked: lockedAssignments(assignments, locks) });
    toast(locks.size ? `Suggested around your ${locks.size} locked position${locks.size > 1 ? 's' : ''}` : 'Lineup suggested');
  };

  const changeFormation = async (nextFormat: SquadFormat, nextFormationId?: string) => {
    if (!fixture) return;
    const forms = await api.getFormations(nextFormat);
    const id = nextFormationId ?? forms[0]!.id;
    setFormat(nextFormat);
    setFormations(forms);
    setFormationId(id);
    setLocks(new Set());
    runSuggest({ fixtureId: fixture.id, formationId: id, strategy, locked: [] });
  };

  const move = useCallback(
    (memberId: Id, from: Place, to: Place) => {
      const next = { ...assignments };
      const nextLocks = new Set(locks);
      if (to.kind === 'slot') {
        const occupant = next[to.slotId] ?? null;
        next[to.slotId] = memberId;
        nextLocks.add(to.slotId);
        if (from.kind === 'slot') {
          next[from.slotId] = occupant; // swap (or leave empty)
          if (occupant) nextLocks.add(from.slotId);
          else nextLocks.delete(from.slotId);
        }
      } else if (from.kind === 'slot') {
        // Sent to the bench: bring on the best-fitting sub who isn't them.
        const slot = formation?.slots.find((s) => s.id === from.slotId);
        const replacement = slot
          ? bench
              .filter((p) => p.memberId !== memberId && positionFit(p, slot) !== null)
              .sort(
                (a, b) =>
                  (positionFit(b, slot) ?? 0) - (positionFit(a, slot) ?? 0) ||
                  (plan?.projectedMinutes[a.memberId] ?? 0) - (plan?.projectedMinutes[b.memberId] ?? 0),
              )[0]
          : undefined;
        next[from.slotId] = replacement?.memberId ?? null;
        nextLocks.delete(from.slotId);
      }
      setLocks(nextLocks);
      replan(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assignments, locks, fixture, formation, formationId, strategy, bench, plan],
  );

  const dnd = useDragDrop(move);

  const toggleLock = (slotId: string) => {
    const next = new Set(locks);
    if (next.has(slotId)) next.delete(slotId);
    else next.add(slotId);
    setLocks(next);
  };

  const updateAvailability = async (memberId: Id, status: AvailabilityStatus) => {
    if (!fixture) return;
    await api.setAvailability(fixture.id, memberId, status);
    setAvailability((prev) => ({ ...prev, [memberId]: status }));
    if (status !== 'available' && onPitch.has(memberId)) {
      // Pull them off and re-suggest around the manager's locked positions,
      // so the engine can reshuffle everyone else (e.g. move a keeper into goal).
      const next = { ...assignments };
      const nextLocks = new Set(locks);
      for (const [slotId, id] of Object.entries(next)) {
        if (id === memberId) {
          next[slotId] = null;
          nextLocks.delete(slotId);
        }
      }
      setLocks(nextLocks);
      runSuggest({ fixtureId: fixture.id, formationId, strategy, locked: lockedAssignments(next, nextLocks) });
      toast(`${byId.get(memberId)?.displayName} removed from the lineup`);
    } else if (status === 'available' && plan) {
      // Re-plan so the newly available player gets minutes.
      replan(assignments);
    }
  };

  const share = async (memberIds: Id[]) => {
    if (!fixture || !formation || !plan) return;
    await api.saveLineup({
      id: `lineup-${fixture.id}`,
      fixtureId: fixture.id,
      formationId: formation.id,
      strategy: locks.size ? 'manual' : strategy,
      starting: lockedAssignments(assignments),
      bench: bench.map((p) => p.memberId),
      substitutions: plan.substitutions,
      updatedAt: new Date().toISOString(),
    });
    await api.shareLineup(fixture.id, memberIds);
    setShareOpen(false);
    toast(`Lineup shared with ${memberIds.length} player${memberIds.length === 1 ? '' : 's'}`);
  };

  if (!fixture || !formation) {
    return <div className="loading">Loading…</div>;
  }

  const team = teams.find((t) => t.id === teamId);
  const emptySlots = formation.slots.filter((s) => !assignments[s.id]).length;

  return (
    <div className="planner">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__logo" aria-hidden="true" />
          <div>
            <div className="topbar__club">{club?.name}</div>
            <h1 className="topbar__title">Lineup planner</h1>
          </div>
        </div>
        <label className="field topbar__team">
          <span className="field__label">Team</span>
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </header>

      <section className="fixture" aria-label="Fixture">
        <div className="fixture__main">
          <span className={`pill pill--${fixture.homeAway}`}>{fixture.homeAway === 'home' ? 'Home' : 'Away'}</span>
          <span className="fixture__vs">
            {team?.name} <span className="muted">vs</span> {fixture.opponent}
          </span>
        </div>
        <div className="fixture__meta muted">
          {formatKickoff(fixture.startsAt)} · {fixture.venue} · {fixture.durationMinutes} min ({fixture.periods} ×{' '}
          {fixture.durationMinutes / fixture.periods})
        </div>
      </section>

      <section className="controls" aria-label="Lineup options">
        <Segmented label="Format" options={FORMATS} value={format} onChange={(f) => changeFormation(f)} />
        <label className="field">
          <span className="field__label">Formation</span>
          <select value={formationId} onChange={(e) => changeFormation(format, e.target.value)}>
            {formations.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <Segmented label="Strategy" options={STRATEGIES} value={strategy} onChange={setStrategy} />
        <div className="controls__actions">
          <button type="button" className="btn btn--primary" onClick={suggest}>
            Suggest lineup
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setShareOpen(true)}
            title={emptySlots ? `${emptySlots} position${emptySlots > 1 ? 's' : ''} still empty` : undefined}
          >
            Share
          </button>
        </div>
      </section>

      {plan && plan.warnings.length > 0 && (
        <div className="banner" role="status">
          {plan.warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      )}

      <div className="layout">
        <div className="layout__pitch">
          <div className="pitch-card">
            <Pitch
              formation={formation}
              format={format}
              renderSlot={(slot) => {
                const memberId = assignments[slot.id];
                const player = memberId ? byId.get(memberId) : undefined;
                const here: Place = { kind: 'slot', slotId: slot.id };
                const isHover = dnd.hover === placeKey(here);
                if (!player) {
                  return (
                    <button
                      type="button"
                      data-drop={`slot:${slot.id}`}
                      className={`slot-empty${isHover ? ' is-hover' : ''}${dnd.selected ? ' is-armed' : ''}`}
                      onClick={() => dnd.tapPlace(here)}
                      aria-label={`Empty ${slot.label} position`}
                    >
                      {slot.label}
                    </button>
                  );
                }
                return (
                  <div data-drop={`slot:${slot.id}`} className={`slot-filled${isHover ? ' is-hover' : ''}`}>
                    <PlayerToken
                      player={player}
                      slotLabel={slot.label}
                      keeper={slot.line === 'GK'}
                      outOfPosition={(positionFit(player, slot) ?? 0) < 0.85}
                      selected={dnd.selected?.memberId === player.memberId}
                      dragging={dnd.drag?.memberId === player.memberId}
                      minutes={plan?.projectedMinutes[player.memberId]}
                      {...dnd.tokenHandlers(player.memberId, here, player.displayName)}
                    />
                    <button
                      type="button"
                      className={`lock${locks.has(slot.id) ? ' is-locked' : ''}`}
                      onClick={() => toggleLock(slot.id)}
                      aria-pressed={locks.has(slot.id)}
                      aria-label={locks.has(slot.id) ? `Unlock ${slot.label}` : `Lock ${player.displayName} at ${slot.label}`}
                      title={locks.has(slot.id) ? 'Locked — suggestions keep this player here' : 'Lock this player here'}
                    >
                      <LockIcon locked={locks.has(slot.id)} />
                    </button>
                  </div>
                );
              }}
            />
          </div>

          <section
            className={`bench${dnd.hover === 'bench' ? ' is-hover' : ''}${dnd.selected?.from.kind === 'slot' ? ' is-armed' : ''}`}
            data-drop="bench"
            onClick={() => dnd.tapPlace({ kind: 'bench' })}
            aria-label="Bench"
          >
            <div className="bench__head">
              <h2>Bench</h2>
              <span className="muted">
                {bench.length} sub{bench.length === 1 ? '' : 's'} · drag players on and off
              </span>
            </div>
            <div className="bench__list">
              {bench.length === 0 && <div className="muted bench__empty">No substitutes available</div>}
              {bench.map((p) => (
                <PlayerToken
                  key={p.memberId}
                  player={p}
                  keeper={p.positions[0] === 'GK'}
                  selected={dnd.selected?.memberId === p.memberId}
                  dragging={dnd.drag?.memberId === p.memberId}
                  minutes={plan?.projectedMinutes[p.memberId]}
                  className="token--bench"
                  {...dnd.tokenHandlers(p.memberId, { kind: 'bench' }, p.displayName)}
                />
              ))}
            </div>
          </section>
          <p className="hint muted">
            Tip: drag a player onto a position to swap, or tap one player then tap where they should go. Moved
            players are locked <LockIcon locked /> so “Suggest lineup” plans around them.
          </p>
        </div>

        <aside className="layout__side">
          <SubPlan
            substitutions={plan?.substitutions ?? []}
            formation={formation}
            players={byId}
            periods={fixture.periods}
            durationMinutes={fixture.durationMinutes}
          />
          <MinutesPanel
            players={available}
            minutes={plan?.projectedMinutes ?? {}}
            durationMinutes={fixture.durationMinutes}
          />
          <AvailabilityPanel
            squad={squad}
            availability={availability}
            needed={formation.slots.length}
            onChange={updateAvailability}
          />
        </aside>
      </div>

      {dnd.drag && (
        <div className="drag-ghost" style={{ left: dnd.drag.x, top: dnd.drag.y }} aria-hidden="true">
          {dnd.drag.label}
        </div>
      )}

      {shareOpen && (
        <ShareDialog
          players={available}
          onCancel={() => setShareOpen(false)}
          onShare={share}
          summary={shareText(fixture, team, formation, assignments, bench, byId)}
        />
      )}
    </div>
  );
}

function shareText(
  fixture: Fixture,
  team: Team | undefined,
  formation: Formation,
  assignments: Assignments,
  bench: PlayerProfile[],
  byId: Map<Id, PlayerProfile>,
) {
  const lines = [
    `${team?.name ?? ''} vs ${fixture.opponent} — ${formatKickoff(fixture.startsAt)}, ${fixture.venue}`,
    `Formation: ${formation.name}`,
    '',
    ...formation.slots.map((s) => `${s.label}: ${byId.get(assignments[s.id] ?? '')?.displayName ?? '—'}`),
    '',
    `Bench: ${bench.map((p) => p.displayName).join(', ') || '—'}`,
  ];
  return lines.join('\n');
}

function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg className="lock-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <rect x="3" y="7" width="10" height="8" rx="1.5" fill="currentColor" />
      <path
        d={locked ? 'M5 7V5a3 3 0 0 1 6 0v2' : 'M5 7V5a3 3 0 0 1 5.8-1'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}
