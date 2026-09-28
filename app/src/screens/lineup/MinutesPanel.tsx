import type { Id, PlayerProfile } from '@hockey/contracts';

interface MinutesPanelProps {
  players: PlayerProfile[];
  minutes: Record<Id, number>;
  durationMinutes: number;
}

export function MinutesPanel({ players, minutes, durationMinutes }: MinutesPanelProps) {
  const rows = [...players].sort((a, b) => (minutes[b.memberId] ?? 0) - (minutes[a.memberId] ?? 0));
  return (
    <section className="card" aria-labelledby="minutes-title">
      <div className="card__head">
        <h2 id="minutes-title">Planned minutes</h2>
        <span className="muted">of {durationMinutes}</span>
      </div>
      <ul className="minutes">
        {rows.map((p) => {
          const m = minutes[p.memberId] ?? 0;
          return (
            <li key={p.memberId} className="minutes__row">
              <span className="minutes__name">{p.displayName}</span>
              <span className="minutes__track" aria-hidden="true">
                <span className="minutes__bar" style={{ width: `${(m / durationMinutes) * 100}%` }} />
              </span>
              <span className="minutes__value">{m}′</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
