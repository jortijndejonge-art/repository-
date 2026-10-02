import type { Formation, Id, PlayerProfile, SlotAssignment, Substitution } from '@hockey/contracts';
import { normaliseSubstitutions, onPitchBeforeChange } from '@hockey/engine';
import { useToast } from '../../core/Toast';
import { usePlanDrag } from './usePlanDrag';
import type { PlanDragPayload, PlanDropTarget } from './usePlanDrag';
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
  /** The plan after an edit; the planner tidies it so it always stays consistent. */
  onChange: (substitutions: Substitution[]) => void;
  /** True once the manager has changed the suggested plan by hand. */
  edited: boolean;
  onReset: () => void;
}

export function SubPlan({
  substitutions,
  formation,
  players,
  available,
  starting,
  minutes,
  periods,
  durationMinutes,
  onChange,
  edited,
  onReset,
}: SubPlanProps) {
  const toast = useToast();
  const periodLength = durationMinutes / periods;
  const periodName = periods === 4 ? 'Q' : periods === 2 ? 'H' : 'P';
  const slotLabel = (id: string) => formation.slots.find((s) => s.id === id)?.label ?? id;
  const name = (id: Id) => players.get(id)?.displayName ?? '?';
  const filledSlots = starting.filter((s) => s.memberId).map((s) => s.slotId);

  /** A plan is fine if replaying it never has to drop a change. */
  const works = (plan: Substitution[]) => normaliseSubstitutions(starting, plan, durationMinutes).dropped === 0;
  const withPatch = (index: number, patch: Partial<Substitution>) =>
    substitutions.map((s, i) => (i === index ? { ...s, ...patch } : s));
  /** Apply an edit only if the plan still works; otherwise explain, so later changes are never lost by accident. */
  const attempt = (next: Substitution[]) => {
    if (works(next)) onChange(next);
    else toast('That would break a later change. Move or remove the later changes first.');
  };
  const update = (index: number, patch: Partial<Substitution>) => attempt(withPatch(index, patch));
  /** Removing a change also removes later ones that depended on it, and the planner says so. */
  const remove = (index: number) => onChange(substitutions.filter((_, i) => i !== index));

  /** Players who could come on for change `index`: available and not already on the pitch just before it. */
  const canComeOn = (index: number) => {
    const onPitch = onPitchBeforeChange(starting, substitutions, index);
    return available.filter((p) => !onPitch.has(p.memberId));
  };

  const add = () => {
    // Try period starts first, then every other minute; take the first change that fits the plan.
    const breaks = Array.from({ length: periods - 1 }, (_, i) => Math.round(periodLength * (i + 1)));
    const minutesToTry = [...breaks, ...Array.from({ length: durationMinutes - 1 }, (_, i) => i + 1)];
    for (const minute of minutesToTry) {
      for (const slotId of filledSlots) {
        for (const p of available) {
          const candidate = { minute, slotId, offMemberId: '', onMemberId: p.memberId };
          if (works([...substitutions, candidate])) {
            onChange([...substitutions, candidate]);
            return;
          }
        }
      }
    }
    toast('Nobody is free to come on at any point');
  };

  const drop = (payload: PlanDragPayload, target: PlanDropTarget) => {
    if (payload.kind === 'player') {
      if (payload.fromRow !== undefined && payload.fromRow !== target.index) {
        // Swap the two players who come on.
        const a = substitutions[payload.fromRow];
        const b = substitutions[target.index];
        if (!a || !b) return;
        attempt(
          substitutions.map((s, i) =>
            i === payload.fromRow ? { ...s, onMemberId: b.onMemberId } : i === target.index ? { ...s, onMemberId: a.onMemberId } : s,
          ),
        );
      } else if (payload.fromRow === undefined) {
        update(target.index, { onMemberId: payload.id });
      }
    } else if (payload.index !== target.index) {
      // Swap the times of the two changes.
      const a = substitutions[payload.index];
      const b = substitutions[target.index];
      if (!a || !b) return;
      attempt(
        substitutions.map((s, i) => (i === payload.index ? { ...s, minute: b.minute } : i === target.index ? { ...s, minute: a.minute } : s)),
      );
    }
  };

  const { start, drag, overKey } = usePlanDrag(drop);
  const canAdd = filledSlots.length > 0 && available.length > 0 && substitutions.length < 30;
  const minuteOptions = Array.from({ length: Math.max(0, durationMinutes - 1) }, (_, i) => i + 1);

  return (
    <section className="card" aria-labelledby="subplan-title">
      <div className="card__head">
        <h2 id="subplan-title">Substitution plan</h2>
        <span className="muted">{substitutions.length} changes</span>
      </div>

      <p className="subplan__tip muted small">
        Change anything with the menus (greyed-out choices would break a later change), or drag: a player onto a change to
        bring them on, a change by its handle onto another to swap their times.
      </p>

      <ul className="subplan__chips" aria-label="Players">
        {[...available]
          .sort((a, b) => (minutes[b.memberId] ?? 0) - (minutes[a.memberId] ?? 0))
          .map((p) => (
            <li
              key={p.memberId}
              className="subplan__chip"
              onPointerDown={start({ kind: 'player', id: p.memberId, label: p.displayName })}
              title={`Drag ${p.displayName} onto a change`}
            >
              {p.displayName} <span className="muted">{minutes[p.memberId] ?? 0}′</span>
            </li>
          ))}
      </ul>

      {substitutions.length === 0 ? (
        <p className="muted">No substitutions planned — everyone available plays the full match.</p>
      ) : (
        <ol className="subplan subplan--edit">
          {substitutions.map((s, i) => {
            const atBreak = s.minute % periodLength === 0;
            const comeOn = canComeOn(i);
            return (
              <li
                key={`${i}-${s.slotId}-${s.minute}`}
                className={`subplan__edit-row${overKey === `row:${i}` ? ' is-over' : ''}`}
                data-drop={`row:${i}`}
              >
                <button
                  type="button"
                  className="subplan__handle"
                  aria-label={`Drag the ${s.minute} minute change to swap times with another`}
                  onPointerDown={start({ kind: 'row', index: i, label: `${s.minute}′ ${slotLabel(s.slotId)}` })}
                >
                  ⠿
                </button>
                <div className="subplan__fields">
                  <label className="subplan__field">
                    <span className="subplan__field-label">Minute</span>
                    <select value={s.minute} aria-label={`Minute of change ${i + 1}`} onChange={(e) => update(i, { minute: Number(e.target.value) })}>
                      {minuteOptions.map((m) => (
                        <option key={m} value={m} disabled={m !== s.minute && !works(withPatch(i, { minute: m }))}>
                          {m}′{m % periodLength === 0 ? ` · ${periodName}${m / periodLength + 1} start` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="subplan__field">
                    <span className="subplan__field-label">Position</span>
                    <select value={s.slotId} aria-label={`Position of change ${i + 1}`} onChange={(e) => update(i, { slotId: e.target.value })}>
                      {filledSlots.map((id) => (
                        <option key={id} value={id} disabled={id !== s.slotId && !works(withPatch(i, { slotId: id }))}>
                          {slotLabel(id)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label
                    className={`subplan__field subplan__field--on${overKey === `on:${i}` ? ' is-over' : ''}`}
                    data-drop={`on:${i}`}
                  >
                    <span className="subplan__field-label">▲ Comes on</span>
                    <select
                      value={s.onMemberId}
                      aria-label={`Player coming on in change ${i + 1}`}
                      onChange={(e) => update(i, { onMemberId: e.target.value })}
                      onPointerDown={start({ kind: 'player', id: s.onMemberId, label: name(s.onMemberId), fromRow: i })}
                    >
                      {comeOn.map((p) => (
                        <option key={p.memberId} value={p.memberId} disabled={p.memberId !== s.onMemberId && !works(withPatch(i, { onMemberId: p.memberId }))}>
                          {p.displayName}
                        </option>
                      ))}
                      {!comeOn.some((p) => p.memberId === s.onMemberId) && <option value={s.onMemberId}>{name(s.onMemberId)}</option>}
                    </select>
                  </label>
                  <span className="subplan__off" title="Off">
                    ▼ {name(s.offMemberId)}
                  </span>
                </div>
                {atBreak && (
                  <span className="subplan__break">
                    {periodName}
                    {s.minute / periodLength + 1} start
                  </span>
                )}
                <button type="button" className="subplan__remove" aria-label={`Remove change ${i + 1}`} onClick={() => remove(i)}>
                  ✕
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <div className="subplan__actions">
        <button type="button" className="btn" onClick={add} disabled={!canAdd}>
          Add a change
        </button>
        {edited && (
          <button type="button" className="btn btn--ghost" onClick={onReset}>
            Reset to suggested plan
          </button>
        )}
      </div>
      {edited && <p className="muted small">Edited by you. Moving players on the pitch or pressing Suggest lineup plans again from scratch.</p>}

      {drag && (
        <div className="subplan__float" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          {drag.payload.label}
        </div>
      )}
    </section>
  );
}
