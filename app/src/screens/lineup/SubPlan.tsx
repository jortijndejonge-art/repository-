import { useMemo, useState } from 'react';
import type { Formation, Id, PlayerProfile, PositionLine, SlotAssignment, Substitution } from '@hockey/contracts';
import {
  blockMinutesFor,
  buildRotation,
  defaultSwapEnd,
  minutesFromRotation,
  swapStates,
  validRotationSubstitutions,
} from '@hockey/engine';
import { useToast } from '../../core/Toast';
import { cellKey, usePlanDrag } from './usePlanDrag';
import type { CellRef } from './usePlanDrag';
import './subplan.css';

interface SubPlanProps {
  substitutions: Substitution[];
  formation: Formation;
  players: Map<Id, PlayerProfile>;
  /** Players who can be brought on: everyone marked available. */
  available: PlayerProfile[];
  /** Who starts in each position. */
  starting: SlotAssignment[];
  minutes: Record<Id, number>;
  periods: number;
  durationMinutes: number;
  /** The plan after an edit. */
  onChange: (substitutions: Substitution[]) => void;
  /** True once the manager has changed the suggested plan by hand. */
  edited: boolean;
  onReset: () => void;
}

/**
 * The substitution plan as a rotation chart: a row per player, a column per block of the match, each cell the
 * position that player holds then (blank on the bench). Drag one player's cell onto another's, or tap a cell and
 * tap who to swap with. A chart can't contradict itself, so every edit just works.
 */
export function SubPlan({
  substitutions,
  formation,
  players,
  available,
  starting,
  periods,
  durationMinutes,
  onChange,
  edited,
  onReset,
}: SubPlanProps) {
  const toast = useToast();
  const [selected, setSelected] = useState<CellRef | null>(null);
  /** How long a swap lasts: until either player's situation changes, or until a chosen block. */
  const [until, setUntil] = useState<'stint' | number>('stint');

  const periodLength = durationMinutes / periods;
  const blockMinutes = blockMinutesFor(durationMinutes, periodLength, substitutions);
  const blocksPerPeriod = Math.max(1, Math.round(periodLength / blockMinutes));
  const slotLabel = (id: string) => formation.slots.find((s) => s.id === id)?.label ?? id;
  const lineOf = (slotId: string): PositionLine => formation.slots.find((s) => s.id === slotId)?.line ?? 'MID';
  const name = (id: Id) => players.get(id)?.displayName ?? '?';

  const rot = useMemo(
    () =>
      buildRotation(
        starting,
        substitutions,
        available.map((p) => p.memberId),
        durationMinutes,
        blockMinutes,
      ),
    [starting, substitutions, available, durationMinutes, blockMinutes],
  );
  const minutes = useMemo(() => minutesFromRotation(rot), [rot]);

  // Starters first, in position order, then everyone else with the most minutes first.
  const rows = useMemo(() => {
    const label = (id: Id) => players.get(id)?.displayName ?? '?';
    const starters = starting.map((s) => s.memberId).filter((id): id is Id => Boolean(id));
    const rest = Object.keys(rot.states)
      .filter((id) => !starters.includes(id))
      .sort((a, b) => (minutes[b] ?? 0) - (minutes[a] ?? 0) || label(a).localeCompare(label(b)));
    return [...starters, ...rest];
  }, [starting, rot, minutes, players]);

  /** Swap two players from `from` until `to`, then hand the new plan up. */
  const swap = (a: Id, b: Id, from: number, to: number) => {
    if (from < 1) {
      toast('The first block is your starting lineup. Change that on the pitch.');
      return;
    }
    const { rotation, applied } = swapStates(rot, a, b, from, to);
    if (applied === 0) {
      toast('A change swaps someone on the pitch with someone on the bench. Those two are both on the pitch, or both on the bench, then.');
      return;
    }
    const subs = validRotationSubstitutions(starting, rotation, durationMinutes);
    if (!subs) {
      toast("That would swap two players' positions on the pitch, which isn't a substitution. Move them on the pitch instead.");
      return;
    }
    onChange(subs);
    setSelected(null);
    setUntil('stint');
  };

  const drop = (from: CellRef, to: CellRef) => {
    if (from.playerId === to.playerId) return;
    swap(from.playerId, to.playerId, to.block, defaultSwapEnd(rot, from.playerId, to.playerId, to.block));
  };
  const { start, drag, overKey } = usePlanDrag(drop);

  const pick = (partner: Id) => {
    if (!selected) return;
    const end = until === 'stint' ? defaultSwapEnd(rot, selected.playerId, partner, selected.block) : until;
    swap(selected.playerId, partner, selected.block, end);
  };

  const sel = selected ? rot.states[selected.playerId]?.[selected.block] : undefined;
  const partners =
    selected && selected.block >= 1
      ? rows.filter((id) => id !== selected.playerId && (rot.states[id]![selected.block] === null) !== (sel === null))
      : [];
  const endOptions = selected ? Array.from({ length: rot.blocks - selected.block }, (_, i) => selected.block + 1 + i) : [];
  const minuteLabel = (block: number) => `${block * blockMinutes}′`;
  const periodName = periods === 4 ? 'Q' : periods === 2 ? 'H' : 'P';

  return (
    <section className="card" aria-labelledby="subplan-title">
      <div className="card__head">
        <h2 id="subplan-title">Substitution plan</h2>
        <span className="muted">{substitutions.length} changes</span>
      </div>

      <p className="rota__tip muted small">
        Each row is a player, each column {blockMinutes} minutes. <strong>Drag</strong> one player&apos;s cell onto
        another&apos;s to swap them from that time, or <strong>tap</strong> a cell and tap who to swap with.
      </p>

      <div className="rota__scroll">
        <div className="rota" style={{ ['--cols' as string]: rot.blocks }} role="grid" aria-label="Rotation chart">
          <div className="rota__row rota__row--head" role="row">
            <span className="rota__name" role="columnheader">
              Player
            </span>
            {Array.from({ length: rot.blocks }, (_, b) => (
              <span
                key={b}
                role="columnheader"
                className={`rota__time${b > 0 && b % blocksPerPeriod === 0 ? ' rota__time--period' : ''}`}
                title={b % blocksPerPeriod === 0 ? `${periodName}${b / blocksPerPeriod + 1} start` : undefined}
              >
                {b * blockMinutes}
              </span>
            ))}
            <span className="rota__total" role="columnheader">
              Min
            </span>
          </div>

          {rows.map((id) => (
            <div key={id} className="rota__row" role="row">
              <span className="rota__name" role="rowheader" title={name(id)}>
                {name(id)}
              </span>
              {rot.states[id]!.map((slot, b) => {
                const isSelected = selected?.playerId === id && selected.block === b;
                const classes = [
                  'rota__cell',
                  slot ? `rota__cell--${lineOf(slot)}` : 'rota__cell--bench',
                  b === 0 ? 'rota__cell--locked' : '',
                  b > 0 && b % blocksPerPeriod === 0 ? 'rota__cell--period' : '',
                  isSelected ? 'is-selected' : '',
                  overKey === cellKey({ playerId: id, block: b }) ? 'is-over' : '',
                ];
                return (
                  <button
                    key={b}
                    type="button"
                    role="gridcell"
                    className={classes.filter(Boolean).join(' ')}
                    data-cell={cellKey({ playerId: id, block: b })}
                    aria-label={`${name(id)} at ${minuteLabel(b)}: ${slot ? slotLabel(slot) : 'bench'}`}
                    aria-pressed={isSelected}
                    onPointerDown={start({ playerId: id, block: b }, name(id))}
                    onContextMenu={(e) => e.preventDefault()}
                    onClick={() => {
                      setSelected(isSelected ? null : { playerId: id, block: b });
                      setUntil('stint');
                    }}
                  >
                    {slot ? slotLabel(slot) : ''}
                  </button>
                );
              })}
              <span className="rota__total">{minutes[id] ?? 0}</span>
            </div>
          ))}
        </div>
      </div>

      {selected ? (
        <div className="rota__editor" role="group" aria-label="Change this cell">
          <div className="rota__editor-head">
            <strong>
              {name(selected.playerId)} at {minuteLabel(selected.block)}
            </strong>
            <span className="muted small">{sel ? `playing ${slotLabel(sel)}` : 'on the bench'}</span>
            <button type="button" className="btn btn--ghost" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          {selected.block < 1 ? (
            <p className="muted small">This is the starting lineup. Change it on the pitch.</p>
          ) : (
            <>
              <p className="muted small">{sel ? 'Who takes over from the bench?' : 'Who do they replace?'}</p>
              <div className="rota__chips">
                {partners.length === 0 && <span className="muted small">Nobody to swap with at this time.</span>}
                {partners.map((id) => {
                  const there = rot.states[id]![selected.block];
                  return (
                    <button key={id} type="button" className="rota__chip" onClick={() => pick(id)}>
                      {name(id)}
                      {there ? <span className="muted">· {slotLabel(there)}</span> : null}
                    </button>
                  );
                })}
              </div>
              <label className="rota__until">
                <span className="muted small">For</span>
                <select value={until} onChange={(e) => setUntil(e.target.value === 'stint' ? 'stint' : Number(e.target.value))}>
                  <option value="stint">the rest of this stint</option>
                  {endOptions.map((end) => (
                    <option key={end} value={end}>
                      {end >= rot.blocks ? 'to full time' : `until ${minuteLabel(end)}`}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>
      ) : null}

      {edited && (
        <div className="rota__actions">
          <button type="button" className="btn btn--ghost" onClick={onReset}>
            Reset to suggested plan
          </button>
          <span className="muted small">Edited by you. Moving players on the pitch or pressing Suggest lineup plans again from scratch.</span>
        </div>
      )}

      {drag && (
        <div className="rota__float" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          {drag.label}
        </div>
      )}
    </section>
  );
}
