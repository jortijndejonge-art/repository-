import { useState } from 'react';
import type { AvailabilityStatus, Id, PlayerProfile } from '@hockey/contracts';

interface AvailabilityPanelProps {
  squad: PlayerProfile[];
  availability: Record<Id, AvailabilityStatus>;
  needed: number;
  onChange: (memberId: Id, status: AvailabilityStatus) => void;
  /** Remind everyone who has not answered; shown only while some have not. */
  onRemind?: () => Promise<void>;
}

const CHOICES: { status: AvailabilityStatus; label: string; symbol: string }[] = [
  { status: 'available', label: 'Available', symbol: '✓' },
  { status: 'maybe', label: 'Maybe', symbol: '?' },
  { status: 'unavailable', label: 'Unavailable', symbol: '✕' },
];

export function AvailabilityPanel({ squad, availability, needed, onChange, onRemind }: AvailabilityPanelProps) {
  const [reminding, setReminding] = useState(false);
  const count = (s: AvailabilityStatus) => squad.filter((p) => (availability[p.memberId] ?? 'no_response') === s).length;
  const confirmed = count('available');
  const short = Math.max(0, needed - confirmed);

  return (
    <section className="card" aria-labelledby="availability-title">
      <div className="card__head">
        <h2 id="availability-title">Availability</h2>
        <span className={short ? 'status-bad' : 'status-good'}>
          {confirmed} confirmed{short ? `, need ${short} more` : ''}
        </span>
      </div>
      <p className="muted small">
        {count('maybe')} maybe · {count('unavailable')} unavailable · {count('no_response')} no reply
      </p>
      {onRemind && count('no_response') > 0 && (
        <button
          type="button"
          className="btn"
          disabled={reminding}
          onClick={async () => {
            setReminding(true);
            try {
              await onRemind();
            } finally {
              setReminding(false);
            }
          }}
        >
          Remind {count('no_response')} who {count('no_response') === 1 ? 'has' : 'have'}n&apos;t replied
        </button>
      )}
      <ul className="availability">
        {squad.map((p) => {
          const current = availability[p.memberId] ?? 'no_response';
          return (
            <li key={p.memberId} className="availability__row">
              <span className="availability__name">
                {p.displayName}
                <span className="availability__pos">{p.positions.join(' / ')}</span>
              </span>
              <span className="availability__choices" role="radiogroup" aria-label={`${p.displayName} availability`}>
                {CHOICES.map((c) => (
                  <button
                    key={c.status}
                    type="button"
                    role="radio"
                    aria-checked={current === c.status}
                    aria-label={c.label}
                    title={c.label}
                    className={`avail-btn avail-btn--${c.status}${current === c.status ? ' is-active' : ''}`}
                    onClick={() => onChange(p.memberId, c.status)}
                  >
                    {c.symbol}
                  </button>
                ))}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
