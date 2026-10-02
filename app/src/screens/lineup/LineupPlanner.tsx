import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type {
  AvailabilityStatus,
  Fixture,
  Formation,
  Id,
  Me,
  PitchPosition,
  PlayerProfile,
  SlotAssignment,
  SquadFormat,
  Substitution,
  SuggestionStrategy,
  Team,
} from '@hockey/contracts';
import { FORMATIONS, minutesFromPlan, normaliseSubstitutions, positionFit } from '@hockey/engine';
import { api, type LineupDraft } from '../../api-client';
import { managedTeams } from '../../core/auth';
import { Pitch } from '../../components/pitch/Pitch';
import { PlayerToken } from '../../components/pitch/PlayerToken';
import { Segmented } from '../../core/Segmented';
import { useToast } from '../../core/Toast';
import { AvailabilityPanel } from './AvailabilityPanel';
import { CustomFormationDialog } from './CustomFormationDialog';
import { MinutesPanel } from './MinutesPanel';
import { ShareDialog } from './ShareDialog';
import { SubPlan } from './SubPlan';
import { placeKey, useDragDrop, useDragState } from './useDragDrop';
import type { DragStore, Place } from './useDragDrop';
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

/** Sentinel `<option>` value that opens the custom-formation dialog instead of selecting anything. */
const NEW_FORMATION = '__new__';

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

export function LineupPlanner({ me }: { me: Me }) {
  const toast = useToast();
  const teams = useMemo(() => managedTeams(me), [me]);
  const [teamId, setTeamId] = useState<Id>(() => (teams.find((t) => t.id === 'u12') ?? teams[0])?.id ?? '');
  const [fixture, setFixture] = useState<Fixture | null>(null);
  const [noFixture, setNoFixture] = useState(false);
  const [squad, setSquad] = useState<PlayerProfile[]>([]);
  const [availability, setAvailability] = useState<Record<Id, AvailabilityStatus>>({});
  const [format, setFormat] = useState<SquadFormat>(7);
  const [formations, setFormations] = useState<Formation[]>([]);
  /** This team's saved custom formations, any format — filtered per-format for display. */
  const [customFormations, setCustomFormations] = useState<Formation[]>([]);
  const [formationId, setFormationId] = useState<string>('');
  const [strategy, setStrategy] = useState<SuggestionStrategy>('fair');
  const [assignments, setAssignments] = useState<Assignments>({});
  const [locks, setLocks] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<Plan | null>(null);
  /** True once the manager has changed the suggested substitutions by hand. */
  const [planEdited, setPlanEdited] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [newFormationOpen, setNewFormationOpen] = useState(false);
  /** Per formation: positions the team has saved, and positions dragged but not yet saved. */
  const [savedLayouts, setSavedLayouts] = useState<Record<string, Record<string, PitchPosition>>>({});
  const [draftLayouts, setDraftLayouts] = useState<Record<string, Record<string, PitchPosition>>>({});

  const customFormationsForFormat = useMemo(
    () => customFormations.filter((f) => f.format === format),
    [customFormations, format],
  );
  const allFormations = useMemo(
    () => [...formations, ...customFormationsForFormat],
    [formations, customFormationsForFormat],
  );
  const formation = allFormations.find((f) => f.id === formationId) ?? null;
  const savedPositions = savedLayouts[formationId];
  const positions = draftLayouts[formationId] ?? savedPositions ?? {};
  const positionsUnsaved = formationId in draftLayouts;
  const positionsAdjusted = positionsUnsaved || savedPositions !== undefined;
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
      setPlanEdited(false);
      setPlan({
        substitutions: result.substitutions,
        projectedMinutes: result.projectedMinutes,
        warnings: result.warnings,
      });
    },
    [],
  );

  // Team change: load squad, next fixture, availability, and either the saved
  // lineup or a fresh suggestion.
  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    (async () => {
      const from = new Date(Date.now() - 3 * 3600_000).toISOString();
      const [players, fixtures] = await Promise.all([api.getSquad(teamId), api.getFixtures(teamId, from)]);
      const fx = fixtures[0];
      if (!fx) {
        if (!cancelled) {
          setNoFixture(true);
          setFixture(null);
        }
        return;
      }
      const [avail, saved, customForms, layouts] = await Promise.all([
        api.getAvailability(fx.id),
        api.getLineup(fx.id),
        api.getCustomFormations(teamId),
        api.getFormationLayouts(teamId),
      ]);
      const savedFormation = saved
        ? (FORMATIONS.find((f) => f.id === saved.formationId) ?? customForms.find((f) => f.id === saved.formationId))
        : undefined;
      const fmt = savedFormation?.format ?? fx.format;
      const forms = await api.getFormations(fmt);
      if (cancelled) return;
      const formation = savedFormation ?? forms[0]!;
      setNoFixture(false);
      setSquad(players);
      setFixture(fx);
      setAvailability(Object.fromEntries(avail.map((a) => [a.memberId, a.status])));
      setFormat(fmt);
      setFormations(forms);
      setCustomFormations(customForms);
      setSavedLayouts(Object.fromEntries(layouts.map((l) => [l.formationId, l.positions])));
      setDraftLayouts({});
      setFormationId(formation.id);
      if (saved) {
        // Keep the saved lineup exactly; just re-plan substitutions around it.
        const kept = saved.starting.filter((s) => s.memberId);
        setLocks(new Set(kept.map((s) => s.slotId)));
        await runSuggest({ fixtureId: fx.id, formationId: formation.id, strategy, locked: kept });
      } else {
        setLocks(new Set());
        await runSuggest({ fixtureId: fx.id, formationId: formation.id, strategy, locked: [] });
      }
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

  /** The manager edited the substitution plan: tidy it, recompute minutes, and keep their changes. */
  const editPlan = (subs: Substitution[]) => {
    if (!fixture || !formation || !plan) return;
    const starting = formation.slots.map((s) => ({ slotId: s.id, memberId: assignments[s.id] ?? null }));
    const { substitutions, dropped } = normaliseSubstitutions(starting, subs, fixture.durationMinutes);
    setPlan({
      ...plan,
      substitutions,
      projectedMinutes: minutesFromPlan(starting, substitutions, fixture.durationMinutes),
    });
    setPlanEdited(true);
    if (dropped > 0) toast(`${dropped} change${dropped > 1 ? 's were' : ' was'} removed because it no longer made sense`);
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

  const createCustomFormation = async (input: { name: string; lines: number[] }) => {
    if (!teamId) return;
    const created = await api.createCustomFormation(teamId, input);
    setCustomFormations((prev) => [...prev, created]);
    await changeFormation(created.format, created.id);
    setNewFormationOpen(false);
    toast(`Saved "${created.name}"`);
  };

  const move = useCallback(
    (memberId: Id, from: Place, to: Place) => {
      if (to.kind === 'pitch') {
        // Dropped on open grass: move that position, whoever plays it.
        if (from.kind !== 'slot' || !formation) return;
        setDraftLayouts((prev) => ({ ...prev, [formation.id]: { ...positions, [from.slotId]: to.spot } }));
        return;
      }
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
    [assignments, locks, fixture, formation, formationId, strategy, bench, plan, positions],
  );

  const savePositions = async () => {
    if (!teamId || !positionsUnsaved) return;
    try {
      const layout = await api.saveFormationLayout(teamId, { formationId, positions });
      setSavedLayouts((prev) => ({ ...prev, [formationId]: layout.positions }));
      setDraftLayouts(({ [formationId]: _, ...rest }) => rest);
      toast('Positions saved');
    } catch (err) {
      toast(`Couldn't save positions: ${(err as Error).message}`);
    }
  };

  const resetPositions = async () => {
    if (!teamId) return;
    try {
      if (savedPositions) await api.resetFormationLayout(teamId, formationId);
      setSavedLayouts(({ [formationId]: _, ...rest }) => rest);
      setDraftLayouts(({ [formationId]: _, ...rest }) => rest);
      toast('Positions reset');
    } catch (err) {
      toast(`Couldn't reset positions: ${(err as Error).message}`);
    }
  };

  const dnd = useDragDrop(move, () => toast('That would touch another player — try a little further away'));

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

  const draft = (): LineupDraft | null =>
    formation && plan
      ? {
          formationId: formation.id,
          strategy: locks.size ? 'manual' : strategy,
          starting: formation.slots.map((s) => ({ slotId: s.id, memberId: assignments[s.id] ?? null })),
          bench: bench.map((p) => p.memberId),
          substitutions: plan.substitutions,
        }
      : null;

  const save = async () => {
    const d = draft();
    if (!fixture || !d) return;
    try {
      await api.saveLineup(fixture.id, d);
      toast('Lineup saved');
    } catch (err) {
      toast(`Couldn't save: ${(err as Error).message}`);
    }
  };

  /** Save, then post the lineup into the match chat as a card. */
  const postToChat = async (note: string) => {
    const d = draft();
    if (!fixture || !d) return;
    try {
      await api.saveLineup(fixture.id, d);
      await api.postLineupToChat(fixture.id, note);
      setShareOpen(false);
      toast('Lineup posted in the match chat');
    } catch (err) {
      toast(`Couldn't post: ${(err as Error).message}`);
    }
  };

  const share = async (memberIds: Id[]) => {
    const d = draft();
    if (!fixture || !d) return;
    try {
      await api.saveLineup(fixture.id, d);
      const { sharedWith } = await api.shareLineup(fixture.id, memberIds);
      setShareOpen(false);
      toast(`Lineup shared with ${sharedWith} player${sharedWith === 1 ? '' : 's'}`);
    } catch (err) {
      toast(`Couldn't share: ${(err as Error).message}`);
    }
  };

  const teamPicker = (
    <label className="field">
      <span className="field__label">Team</span>
      <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  );

  if (teams.length === 0) {
    return <p className="muted">You don't manage any teams yet.</p>;
  }

  if (noFixture) {
    return (
      <div className="planner">
        <section className="controls">{teamPicker}</section>
        <p className="muted">No upcoming fixtures for this team.</p>
      </div>
    );
  }

  if (!fixture || !formation) {
    return <div className="loading">Loading…</div>;
  }

  const team = teams.find((t) => t.id === teamId);
  const emptySlots = formation.slots.filter((s) => !assignments[s.id]).length;

  return (
    <div className="planner">
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
        {teamPicker}
        <Segmented label="Format" options={FORMATS} value={format} onChange={(f) => changeFormation(f)} />
        <label className="field">
          <span className="field__label">Formation</span>
          <select
            value={formationId}
            onChange={(e) => {
              if (e.target.value === NEW_FORMATION) setNewFormationOpen(true);
              else changeFormation(format, e.target.value);
            }}
          >
            <optgroup label="Standard">
              {formations.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </optgroup>
            {customFormationsForFormat.length > 0 && (
              <optgroup label="Your formations">
                {customFormationsForFormat.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </optgroup>
            )}
            <option value={NEW_FORMATION}>+ New formation…</option>
          </select>
        </label>
        <Segmented label="Strategy" options={STRATEGIES} value={strategy} onChange={setStrategy} />
        <div className="controls__actions">
          <button type="button" className="btn btn--primary" onClick={suggest}>
            Suggest lineup
          </button>
          <button type="button" className="btn" onClick={save}>
            Save
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
              positions={positions}
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
                      dragging={dnd.draggingId === player.memberId}
                      minutes={plan?.projectedMinutes[player.memberId]}
                      {...dnd.tokenHandlers(player.memberId, here)}
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

          {positionsAdjusted && (
            <div className="positions-bar" role="status">
              <span className="muted small">{positionsUnsaved ? 'Positions moved — not saved yet' : 'Using your saved positions'}</span>
              <span className="spacer" />
              <button type="button" className="btn" onClick={resetPositions}>
                Reset positions
              </button>
              <button type="button" className="btn btn--primary" onClick={savePositions} disabled={!positionsUnsaved}>
                Save positions
              </button>
            </div>
          )}

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
                  dragging={dnd.draggingId === p.memberId}
                  minutes={plan?.projectedMinutes[p.memberId]}
                  className="token--bench"
                  {...dnd.tokenHandlers(p.memberId, { kind: 'bench' })}
                />
              ))}
            </div>
          </section>
          <p className="hint muted">
            Tip: drag a player onto another position to swap, or onto open grass to move that position. Swapped
            players are locked <LockIcon locked /> so “Suggest lineup” plans around them.
          </p>
        </div>

        <aside className="layout__side">
          <SubPlan
            substitutions={plan?.substitutions ?? []}
            formation={formation}
            players={byId}
            available={available}
            starting={formation.slots.map((s) => ({ slotId: s.id, memberId: assignments[s.id] ?? null }))}
            minutes={plan?.projectedMinutes ?? {}}
            periods={fixture.periods}
            durationMinutes={fixture.durationMinutes}
            onChange={editPlan}
            edited={planEdited}
            onReset={() => replan(assignments)}
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

      {dnd.draggingId && <DragFloat store={dnd.store} players={byId} formation={formation} />}

      {shareOpen && (
        <ShareDialog
          players={available}
          onCancel={() => setShareOpen(false)}
          onShare={share}
          onPostToChat={postToChat}
          summary={shareText(fixture, team, formation, assignments, bench, byId)}
        />
      )}

      {newFormationOpen && (
        <CustomFormationDialog onCancel={() => setNewFormationOpen(false)} onCreate={createCustomFormation} />
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

/**
 * The dragged player's token, following the pointer (all worked out by the
 * drag hook). Over open grass it sits exactly where the player would land and
 * turns red if dropping there would touch another player; where a drop would
 * do nothing it fades.
 */
function DragFloat({ store, players, formation }: { store: DragStore; players: Map<Id, PlayerProfile>; formation: Formation }) {
  const drag = useDragState(store);
  const player = drag && players.get(drag.memberId);
  if (!drag || !player) return null;
  const { from } = drag;
  const slot = from.kind === 'slot' ? formation.slots.find((s) => s.id === from.slotId) : undefined;
  const style = { left: drag.x, top: drag.y, '--token': `${drag.size}px` } as CSSProperties;
  return (
    <div className={`drag-float${drag.status === 'none' ? ' is-nodrop' : ''}`} style={style} aria-hidden="true">
      <PlayerToken
        player={player}
        keeper={slot ? slot.line === 'GK' : player.positions[0] === 'GK'}
        blocked={drag.status === 'blocked'}
        tabIndex={-1}
      />
    </div>
  );
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
