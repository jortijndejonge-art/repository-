import { useMemo } from 'react';
import type { Id, LineupCard } from '@hockey/contracts';
import { Pitch } from '../../components/pitch/Pitch';
import { PlayerToken } from '../../components/pitch/PlayerToken';
import '../lineup/lineup.css';

type CardPlayer = LineupCard['players'][number];

/** PlayerToken wants a full profile; a card only carries name and number. */
const asProfile = (p: CardPlayer) => ({ ...p, positions: [], skill: 0, stamina: 0, seasonMinutes: 0 });

/** A lineup posted in a match chat: the pitch, bench, and (folded away) substitutions and minutes. */
export function LineupCardView({ card }: { card: LineupCard }) {
  const byId = useMemo(() => new Map(card.players.map((p) => [p.memberId, p])), [card]);
  const name = (id: Id) => byId.get(id)?.displayName ?? '—';
  const bench = card.bench.map((id) => byId.get(id)).filter((p): p is CardPlayer => Boolean(p));
  const subs = [...card.substitutions].sort((a, b) => a.minute - b.minute);
  const played = [...card.players].sort((a, b) => (card.minutes[b.memberId] ?? 0) - (card.minutes[a.memberId] ?? 0));

  return (
    <div className="lineup-card">
      <div className="lineup-card__head">
        <strong>Lineup</strong>
        <span className="muted small">
          {card.formation.name} · vs {card.opponent}
        </span>
      </div>
      <div className="lineup-card__pitch">
        <Pitch
          formation={card.formation}
          format={card.format}
          positions={card.positions}
          renderSlot={(slot) => {
            const memberId = card.starting.find((s) => s.slotId === slot.id)?.memberId;
            const player = memberId ? byId.get(memberId) : undefined;
            if (!player) return <span className="slot-empty">{slot.label}</span>;
            return <PlayerToken player={asProfile(player)} slotLabel={slot.label} keeper={slot.line === 'GK'} tabIndex={-1} className="token--readonly" />;
          }}
        />
      </div>
      <p className="lineup-card__bench">
        <span className="muted">Bench:</span> {bench.length ? bench.map((p) => p.displayName).join(', ') : 'none'}
      </p>
      <details className="lineup-card__more">
        <summary>
          {subs.length} substitution{subs.length === 1 ? '' : 's'} and minutes
        </summary>
        {subs.length > 0 && (
          <ul className="lineup-card__subs">
            {subs.map((s) => (
              <li key={`${s.minute}-${s.slotId}-${s.onMemberId}`}>
                <span className="lineup-card__minute">{s.minute}′</span>
                <span className="lineup-card__on">▲ {name(s.onMemberId)}</span>
                <span className="lineup-card__off">▼ {name(s.offMemberId)}</span>
              </li>
            ))}
          </ul>
        )}
        <ul className="lineup-card__minutes">
          {played.map((p) => (
            <li key={p.memberId}>
              <span>{p.displayName}</span>
              <span>{card.minutes[p.memberId] ?? 0}′</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
