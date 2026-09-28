import { useEffect, useState } from 'react';
import type { Availability, AvailabilityStatus, Fixture, Lineup, Me, Team } from '@hockey/contracts';
import { api } from '../../api-client';
import { playingTeams } from '../../core/auth';
import { useToast } from '../../core/Toast';
import './my-matches.css';

interface MatchCard {
  team: Team;
  fixture: Fixture;
  availability: Availability[];
  lineup: Lineup | null;
}

const CHOICES: { status: AvailabilityStatus; label: string }[] = [
  { status: 'available', label: "I'm in" },
  { status: 'maybe', label: 'Maybe' },
  { status: 'unavailable', label: "Can't make it" },
];

function kickoff(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function MyMatches({ me }: { me: Me }) {
  const toast = useToast();
  const [cards, setCards] = useState<MatchCard[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Include matches that kicked off in the last few hours.
      const from = new Date(Date.now() - 3 * 3600_000).toISOString();
      const teams = playingTeams(me);
      const perTeam = await Promise.all(
        teams.map(async (team) => {
          const fixtures = await api.getFixtures(team.id, from);
          return Promise.all(
            fixtures.map(async (fixture) => {
              const [availability, lineup] = await Promise.all([
                api.getAvailability(fixture.id),
                api.getLineup(fixture.id),
              ]);
              return { team, fixture, availability, lineup };
            }),
          );
        }),
      );
      if (!cancelled) {
        setCards(perTeam.flat().sort((a, b) => a.fixture.startsAt.localeCompare(b.fixture.startsAt)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [me]);

  const respond = async (card: MatchCard, status: AvailabilityStatus) => {
    const updated = await api.setAvailability(card.fixture.id, me.member.id, status);
    setCards((prev) =>
      prev!.map((c) =>
        c.fixture.id === card.fixture.id
          ? {
              ...c,
              availability: [...c.availability.filter((a) => a.memberId !== me.member.id), updated],
            }
          : c,
      ),
    );
    toast(status === 'available' ? 'See you there!' : status === 'maybe' ? 'Marked as maybe' : "Thanks for letting us know");
  };

  if (!cards) return <div className="loading">Loading your matches…</div>;

  return (
    <div className="matches">
      {cards.length === 0 && <p className="muted">No upcoming matches for your teams.</p>}
      {cards.map((card) => {
        const mine = card.availability.find((a) => a.memberId === me.member.id)?.status ?? 'no_response';
        const confirmed = card.availability.filter((a) => a.status === 'available').length;
        const needed = card.fixture.format;
        const slot = card.lineup?.sharedAt ? card.lineup.starting.find((s) => s.memberId === me.member.id) : undefined;
        const onBench = card.lineup?.sharedAt && card.lineup.bench.includes(me.member.id);
        return (
          <article key={card.fixture.id} className="match">
            <header className="match__head">
              <span className={`pill pill--${card.fixture.homeAway}`}>
                {card.fixture.homeAway === 'home' ? 'Home' : 'Away'}
              </span>
              <span className="muted small">{card.team.name}</span>
            </header>
            <h3 className="match__opponent">vs {card.fixture.opponent}</h3>
            <p className="match__meta muted">
              {kickoff(card.fixture.startsAt)} · {card.fixture.venue}
            </p>

            {mine === 'no_response' && <p className="match__ask">Can you play?</p>}
            <div className="match__choices" role="radiogroup" aria-label={`Availability vs ${card.fixture.opponent}`}>
              {CHOICES.map((c) => (
                <button
                  key={c.status}
                  type="button"
                  role="radio"
                  aria-checked={mine === c.status}
                  className={`choice choice--${c.status}${mine === c.status ? ' is-active' : ''}`}
                  onClick={() => respond(card, c.status)}
                >
                  {c.label}
                </button>
              ))}
            </div>

            <footer className="match__foot">
              <span className={confirmed >= needed ? 'status-good' : 'status-bad'}>
                {confirmed} confirmed{confirmed < needed ? ` · need ${needed - confirmed} more` : ''}
              </span>
              {(slot || onBench) && mine === 'unavailable' ? (
                <span className="status-bad">You're in the lineup — your manager can see you can't make it</span>
              ) : (
                <>
                  {slot && <span className="match__role">You're starting · {slot.slotId}</span>}
                  {onBench && <span className="match__role">You're on the bench</span>}
                </>
              )}
            </footer>
          </article>
        );
      })}
    </div>
  );
}
