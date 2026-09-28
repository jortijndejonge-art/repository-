import type { Formation, Id, PlayerProfile, Substitution } from '@hockey/contracts';

interface SubPlanProps {
  substitutions: Substitution[];
  formation: Formation;
  players: Map<Id, PlayerProfile>;
  periods: number;
  durationMinutes: number;
}

export function SubPlan({ substitutions, formation, players, periods, durationMinutes }: SubPlanProps) {
  const byMinute = new Map<number, Substitution[]>();
  for (const sub of substitutions) {
    byMinute.set(sub.minute, [...(byMinute.get(sub.minute) ?? []), sub]);
  }
  const periodLength = durationMinutes / periods;
  const periodName = periods === 4 ? 'Q' : periods === 2 ? 'H' : 'P';
  const slotLabel = (id: string) => formation.slots.find((s) => s.id === id)?.label ?? id;
  const name = (id: Id) => players.get(id)?.displayName ?? '?';

  return (
    <section className="card" aria-labelledby="subplan-title">
      <div className="card__head">
        <h2 id="subplan-title">Substitution plan</h2>
        <span className="muted">{substitutions.length} changes</span>
      </div>
      {byMinute.size === 0 ? (
        <p className="muted">No substitutions planned — everyone available plays the full match.</p>
      ) : (
        <ol className="subplan">
          {[...byMinute.entries()].map(([minute, subs]) => {
            const atBreak = minute % periodLength === 0;
            return (
              <li key={minute} className="subplan__group">
                <div className="subplan__time">
                  <span className="subplan__minute">{minute}′</span>
                  {atBreak && (
                    <span className="subplan__break">
                      {periodName}
                      {minute / periodLength + 1} start
                    </span>
                  )}
                </div>
                <ul>
                  {subs.map((s) => (
                    <li key={s.slotId} className="subplan__row">
                      <span className="subplan__slot">{slotLabel(s.slotId)}</span>
                      <span className="subplan__on" title="On">
                        ▲ {name(s.onMemberId)}
                      </span>
                      <span className="subplan__off" title="Off">
                        ▼ {name(s.offMemberId)}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
