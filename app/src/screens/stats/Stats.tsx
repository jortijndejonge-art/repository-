import { useEffect, useMemo, useState } from 'react';
import type { Id, Me, PlayerStats } from '@hockey/contracts';
import { api } from '../../api-client';
import { managedTeams } from '../../core/auth';
import { useToast } from '../../core/Toast';
import './stats.css';

type SortKey = 'name' | 'training' | 'matches' | 'minutes';

const percent = (part: number, whole: number) => (whole === 0 ? null : Math.round((part / whole) * 100));

/** How often each player turns up and how much they play, so fair playing time is visible across the season. */
export function Stats({ me }: { me: Me }) {
  const toast = useToast();
  const teams = useMemo(() => managedTeams(me), [me]);
  const [teamId, setTeamId] = useState<Id>(teams[0]?.id ?? '');
  const [rows, setRows] = useState<PlayerStats[] | null>(null);
  const [sort, setSort] = useState<SortKey>('name');

  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    setRows(null);
    api
      .getTeamStats(teamId)
      .then((r) => !cancelled && setRows(r))
      .catch(() => toast('Could not load the stats'));
    return () => {
      cancelled = true;
    };
  }, [teamId, toast]);

  const sorted = useMemo(() => {
    const list = [...(rows ?? [])];
    const key: Record<SortKey, (p: PlayerStats) => number | string> = {
      name: (p) => p.displayName,
      training: (p) => percent(p.trainingAttended, p.trainingTotal) ?? -1,
      matches: (p) => percent(p.matchesAvailable, p.matchesTotal) ?? -1,
      minutes: (p) => p.seasonMinutes,
    };
    // Names read A to Z; the numbers read biggest first.
    list.sort((a, b) => (sort === 'name' ? String(key.name(a)).localeCompare(String(key.name(b))) : Number(key[sort](b)) - Number(key[sort](a))));
    return list;
  }, [rows, sort]);

  if (teams.length === 0) return <p className="muted">You don&apos;t manage any teams yet.</p>;

  const trainingTotal = rows?.[0]?.trainingTotal ?? 0;
  const matchesTotal = rows?.[0]?.matchesTotal ?? 0;
  const mostMinutes = Math.max(1, ...(rows ?? []).map((p) => p.seasonMinutes));

  const head = (key: SortKey, label: string) => (
    <th scope="col">
      <button type="button" className={`stats__sort${sort === key ? ' is-active' : ''}`} onClick={() => setSort(key)}>
        {label}
      </button>
    </th>
  );

  return (
    <section className="stats">
      <div className="stats__bar">
        {teams.length > 1 ? (
          <select value={teamId} aria-label="Team" onChange={(e) => setTeamId(e.target.value)}>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        ) : (
          <strong>{teams[0]!.name}</strong>
        )}
      </div>

      {rows === null ? (
        <p className="muted">Loading stats…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No players in this squad yet.</p>
      ) : (
        <>
          <p className="muted small">
            Training counts the {trainingTotal} past session{trainingTotal === 1 ? '' : 's'} where you recorded attendance. Matches
            counts the {matchesTotal} already played. Minutes come from matches you finished on the Matchday tab.
          </p>
          <div className="stats__scroll">
            <table className="stats__table">
              <thead>
                <tr>
                  {head('name', 'Player')}
                  {head('training', 'Training')}
                  {head('matches', 'Matches available')}
                  {head('minutes', 'Minutes played')}
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => {
                  const training = percent(p.trainingAttended, p.trainingTotal);
                  const matches = percent(p.matchesAvailable, p.matchesTotal);
                  return (
                    <tr key={p.memberId}>
                      <th scope="row">{p.displayName}</th>
                      <td>{p.trainingTotal === 0 ? '–' : `${p.trainingAttended}/${p.trainingTotal} (${training}%)`}</td>
                      <td>{p.matchesTotal === 0 ? '–' : `${p.matchesAvailable}/${p.matchesTotal} (${matches}%)`}</td>
                      <td>
                        <span className="stats__minutes">
                          <span className="stats__bar-fill" style={{ width: `${(p.seasonMinutes / mostMinutes) * 100}%` }} />
                        </span>{' '}
                        {p.seasonMinutes}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
