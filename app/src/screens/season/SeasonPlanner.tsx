import { useCallback, useEffect, useState } from 'react';
import type { AgeGroup, League, LeagueConfig, LeagueDivision, LeagueOpponent, Me, NewPitchSlot, Pitch } from '@hockey/contracts';
import { clock, dayName, describeStart, leagueToSeasonInput, ourMatches, planSeason } from '@hockey/engine';
import type { OurClub, SeasonResult } from '@hockey/engine';
import { api } from '../../api-client';
import { useToast } from '../../core/Toast';
import './season.css';

const TZ = 'Europe/London';
const AGE_GROUPS: AgeGroup[] = ['U8', 'U10', 'U12', 'U14', 'U16', 'U18', 'Adult'];
const toMinute = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

/** The next Saturday after today (a Saturday today means next week, so nothing is planned in the past), as YYYY-MM-DD. */
function nextSaturday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + (((6 - d.getUTCDay() + 7) % 7) || 7));
  return d.toISOString().slice(0, 10);
}

function defaultConfig(me: Me): LeagueConfig {
  const first = nextSaturday();
  const last = new Date(Date.parse(`${first}T12:00:00Z`) + 84 * 86_400_000).toISOString().slice(0, 10);
  const team = me.teams[0];
  return {
    firstDate: first,
    lastDate: last,
    weekday: 5,
    excludedDates: [],
    doubleRound: true,
    divisions: team ? [{ name: team.name, ageGroup: team.ageGroup, ourTeamId: team.id }] : [],
    opponents: [],
  };
}

/** Plan a whole season: enter the other clubs and when their pitches are free, and get every match placed fairly. */
export function SeasonPlanner({ me }: { me: Me }) {
  const toast = useToast();
  const [leagues, setLeagues] = useState<League[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [name, setName] = useState('');

  const load = useCallback(async () => setLeagues(await api.getLeagues(me.club.id)), [me.club.id]);
  useEffect(() => {
    load().catch(() => toast('Could not load the season plans'));
  }, [load, toast]);

  const create = async () => {
    try {
      const made = await api.addLeague(me.club.id, { name: name.trim(), config: defaultConfig(me) });
      setLeagues((cur) => [made, ...(cur ?? [])]);
      setName('');
      setOpenId(made.id);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not create the plan');
    }
  };

  const open = leagues?.find((l) => l.id === openId);
  if (open) {
    return (
      <LeagueEditor
        key={open.id}
        me={me}
        league={open}
        onSaved={(l) => setLeagues((cur) => cur?.map((x) => (x.id === l.id ? l : x)) ?? cur)}
        onDeleted={() => {
          setLeagues((cur) => cur?.filter((x) => x.id !== open.id) ?? cur);
          setOpenId(null);
        }}
        onBack={() => setOpenId(null)}
      />
    );
  }

  return (
    <section className="season">
      <p className="muted small">
        A season plan works out who plays whom, and when, for each age group: every match on a pitch that is free, no team
        twice on a day, home and away kept even, and travel shared fairly. Add the other clubs by hand with their pitch
        times, plan, check, then create your own fixtures.
      </p>
      <form
        className="season__new"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <label className="field">
          <span className="field__label">New season plan</span>
          <input value={name} maxLength={80} placeholder="Autumn 2026" onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="submit" className="btn btn--primary" disabled={name.trim() === ''}>
          Create
        </button>
      </form>
      {leagues === null ? (
        <p className="muted">Loading…</p>
      ) : leagues.length === 0 ? (
        <p className="muted">No season plans yet.</p>
      ) : (
        <ul className="season__list">
          {leagues.map((l) => (
            <li key={l.id}>
              <button type="button" className="season__open" onClick={() => setOpenId(l.id)}>
                <strong>{l.name}</strong>
                <span className="muted small">
                  {l.config.divisions.length} division{l.config.divisions.length === 1 ? '' : 's'} · {l.config.opponents.length} other club
                  {l.config.opponents.length === 1 ? '' : 's'} · {l.config.firstDate} to {l.config.lastDate}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LeagueEditor({ me, league, onSaved, onDeleted, onBack }: { me: Me; league: League; onSaved: (l: League) => void; onDeleted: () => void; onBack: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(league.name);
  const [config, setConfig] = useState<LeagueConfig>(league.config);
  const [pitches, setPitches] = useState<Pitch[] | null>(null);
  const [result, setResult] = useState<{ result: SeasonResult; plan: ReturnType<typeof leagueToSeasonInput>; ours: OurClub } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [excluded, setExcluded] = useState('');

  useEffect(() => {
    api.getPitches(me.club.id).then(setPitches).catch(() => setPitches([]));
  }, [me.club.id]);

  const change = (patch: Partial<LeagueConfig>) => {
    setConfig((c) => ({ ...c, ...patch }));
    setDirty(true);
    setResult(null);
  };
  const setDivision = (i: number, patch: Partial<LeagueDivision>) => change({ divisions: config.divisions.map((d, at) => (at === i ? { ...d, ...patch } : d)) });
  const setOpponent = (i: number, patch: Partial<LeagueOpponent>) => change({ opponents: config.opponents.map((o, at) => (at === i ? { ...o, ...patch } : o)) });

  const save = async () => {
    setBusy(true);
    try {
      const saved = await api.updateLeague(league.id, { name: name.trim(), config });
      onSaved(saved);
      setDirty(false);
      toast('Saved');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${league.name}"? Fixtures already created from it stay.`)) return;
    try {
      await api.deleteLeague(league.id);
      onDeleted();
    } catch {
      toast('Could not delete the plan');
    }
  };

  const ours: OurClub = {
    clubId: me.club.id,
    clubName: me.club.name,
    pitches: pitches ?? [],
    teams: me.teams.map((t) => ({ id: t.id, name: t.name, ageGroup: t.ageGroup })),
  };

  const runPlan = () => {
    const plan = leagueToSeasonInput(config, ours, TZ);
    setResult({ result: planSeason({ ...plan.input, attempts: 80 }), plan, ours });
  };

  const apply = async () => {
    if (!result) return;
    const matches = ourMatches(result.result, result.plan, result.ours);
    if (!window.confirm(`Create ${matches.length} fixtures for your teams? Any you already have at those times are skipped.`)) return;
    setBusy(true);
    try {
      const done = await api.applyLeague(league.id, matches);
      toast(`Created ${done.created} fixture${done.created === 1 ? '' : 's'}${done.skipped ? `, skipped ${done.skipped} you already had` : ''}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not create the fixtures');
    } finally {
      setBusy(false);
    }
  };

  const teamsInLeague = config.divisions.reduce((n, d) => n + (d.ourTeamId ? 1 : 0) + config.opponents.filter((o) => o.divisions.includes(d.name)).length, 0);
  const ready = config.divisions.length > 0 && teamsInLeague >= 2;
  const ourHome = me.teams.some((t) => config.divisions.some((d) => d.ourTeamId === t.id)) && (pitches?.every((p) => p.slots.length === 0) ?? false);

  return (
    <section className="season">
      <div className="season__top">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          ‹ All plans
        </button>
        <span className="spacer" />
        <button type="button" className="btn btn--ghost" onClick={remove}>
          Delete
        </button>
        <button type="button" className="btn btn--primary" disabled={busy || !dirty} onClick={save}>
          {dirty ? 'Save' : 'Saved'}
        </button>
      </div>

      <label className="field">
        <span className="field__label">Name</span>
        <input
          value={name}
          maxLength={80}
          onChange={(e) => {
            setName(e.target.value);
            setDirty(true);
          }}
        />
      </label>

      <h2 className="season__heading">1. The season</h2>
      <div className="season__grid">
        <label className="field">
          <span className="field__label">First date</span>
          <input type="date" value={config.firstDate} onChange={(e) => change({ firstDate: e.target.value })} />
        </label>
        <label className="field">
          <span className="field__label">Last date</span>
          <input type="date" value={config.lastDate} onChange={(e) => change({ lastDate: e.target.value })} />
        </label>
        <label className="field">
          <span className="field__label">Match day</span>
          <select value={config.weekday} onChange={(e) => change({ weekday: Number(e.target.value) })}>
            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
              <option key={d} value={d}>
                {dayName(d)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="season__check">
        <input type="checkbox" checked={config.doubleRound} onChange={(e) => change({ doubleRound: e.target.checked })} />
        Everyone plays everyone home and away
      </label>
      <div className="season__chips">
        <span className="muted small">Dates to skip (half term, holidays):</span>
        {config.excludedDates.map((d) => (
          <button key={d} type="button" className="season__chip" onClick={() => change({ excludedDates: config.excludedDates.filter((x) => x !== d) })} aria-label={`Stop skipping ${d}`}>
            {d} ✕
          </button>
        ))}
        <input type="date" value={excluded} onChange={(e) => setExcluded(e.target.value)} aria-label="Date to skip" />
        <button type="button" className="btn" disabled={!excluded || config.excludedDates.includes(excluded)} onClick={() => { change({ excludedDates: [...config.excludedDates, excluded].sort() }); setExcluded(''); }}>
          Skip it
        </button>
      </div>

      <h2 className="season__heading">2. Age groups (divisions)</h2>
      {config.divisions.map((d, i) => (
        <div key={i} className="season__card">
          <div className="season__grid">
            <label className="field">
              <span className="field__label">Name</span>
              <input value={d.name} maxLength={60} onChange={(e) => {
                // Opponents refer to divisions by name, so rename them together.
                const old = d.name;
                change({
                  divisions: config.divisions.map((x, at) => (at === i ? { ...x, name: e.target.value } : x)),
                  opponents: config.opponents.map((o) => ({ ...o, divisions: o.divisions.map((n) => (n === old ? e.target.value : n)) })),
                });
              }} />
            </label>
            <label className="field">
              <span className="field__label">Age group</span>
              <select value={d.ageGroup} onChange={(e) => setDivision(i, { ageGroup: e.target.value as AgeGroup, ourTeamId: undefined })}>
                {AGE_GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Our team</span>
              <select value={d.ourTeamId ?? ''} onChange={(e) => setDivision(i, { ourTeamId: e.target.value || undefined })}>
                <option value="">None</option>
                {me.teams.filter((t) => t.ageGroup === d.ageGroup).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button type="button" className="btn btn--ghost" onClick={() => change({ divisions: config.divisions.filter((_, at) => at !== i), opponents: config.opponents.map((o) => ({ ...o, divisions: o.divisions.filter((n) => n !== d.name) })) })}>
            Remove this division
          </button>
        </div>
      ))}
      <button type="button" className="btn" onClick={() => change({ divisions: [...config.divisions, { name: `Division ${config.divisions.length + 1}`, ageGroup: 'U12' }] })}>
        Add a division
      </button>

      <h2 className="season__heading">3. The other clubs</h2>
      <p className="muted small">Add each club that plays in your divisions, how far away it is, and when its pitch can host matches.</p>
      {config.opponents.map((o, i) => (
        <OpponentCard key={o.id} opponent={o} divisions={config.divisions} onChange={(patch) => setOpponent(i, patch)} onRemove={() => change({ opponents: config.opponents.filter((_, at) => at !== i) })} />
      ))}
      <button type="button" className="btn" onClick={() => change({ opponents: [...config.opponents, { id: newId('opp'), name: `Club ${config.opponents.length + 1}`, miles: 10, slots: [], divisions: config.divisions.map((d) => d.name) }] })}>
        Add a club
      </button>

      <h2 className="season__heading">4. Plan it</h2>
      {ourHome && <p className="season__warn">Your own pitches have no opening times yet, so your home matches cannot be placed. Add them on the Pitches tab first.</p>}
      <button type="button" className="btn btn--primary" disabled={!ready} onClick={runPlan}>
        Plan the season
      </button>
      {!ready && <p className="muted small">Add at least two teams to a division (yours and one other club).</p>}

      {result && <PlanView result={result.result} plan={result.plan} ours={result.ours} busy={busy} onApply={apply} />}
    </section>
  );
}

function OpponentCard({ opponent, divisions, onChange, onRemove }: { opponent: LeagueOpponent; divisions: LeagueDivision[]; onChange: (patch: Partial<LeagueOpponent>) => void; onRemove: () => void }) {
  const [weekday, setWeekday] = useState(5);
  const [from, setFrom] = useState('09:00');
  const [to, setTo] = useState('13:00');
  const [groups, setGroups] = useState<AgeGroup[]>([]);
  const valid = groups.length > 0 && toMinute(to) > toMinute(from);

  const addSlot = () => {
    const slot: NewPitchSlot = { weekday, startMinute: toMinute(from), endMinute: toMinute(to), ageGroups: AGE_GROUPS.filter((g) => groups.includes(g)) };
    onChange({ slots: [...opponent.slots, slot] });
  };

  return (
    <div className="season__card">
      <div className="season__grid">
        <label className="field">
          <span className="field__label">Club name</span>
          <input value={opponent.name} maxLength={80} onChange={(e) => onChange({ name: e.target.value })} />
        </label>
        <label className="field">
          <span className="field__label">Miles from us</span>
          <input type="number" min={0} max={1000} value={opponent.miles} onChange={(e) => onChange({ miles: Math.max(0, Number(e.target.value)) })} />
        </label>
      </div>
      <fieldset className="season__groups">
        <legend className="muted small">Enters a team in</legend>
        {divisions.map((d) => (
          <label key={d.name} className="season__check">
            <input
              type="checkbox"
              checked={opponent.divisions.includes(d.name)}
              onChange={(e) => onChange({ divisions: e.target.checked ? [...opponent.divisions, d.name] : opponent.divisions.filter((n) => n !== d.name) })}
            />
            {d.name}
          </label>
        ))}
      </fieldset>
      <div>
        <span className="field__label">When their pitch is open</span>
        {opponent.slots.length === 0 ? (
          <p className="muted small">No times yet, so they cannot host.</p>
        ) : (
          <ul className="season__slots">
            {opponent.slots.map((s, i) => (
              <li key={i}>
                <strong>{dayName(s.weekday)}</strong> {clock(s.startMinute)}–{clock(s.endMinute)} <span className="muted small">· {s.ageGroups.join(', ')}</span>
                <button type="button" className="season__x" aria-label="Remove this opening" onClick={() => onChange({ slots: opponent.slots.filter((_, at) => at !== i) })}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="season__grid season__grid--tight">
          <select aria-label="Day" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
              <option key={d} value={d}>
                {dayName(d)}
              </option>
            ))}
          </select>
          <input type="time" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input type="time" aria-label="Until" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <fieldset className="season__groups">
          {AGE_GROUPS.map((g) => (
            <label key={g} className="season__check">
              <input type="checkbox" checked={groups.includes(g)} onChange={() => setGroups((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]))} />
              {g}
            </label>
          ))}
        </fieldset>
        <button type="button" className="btn" disabled={!valid} onClick={addSlot}>
          Add opening
        </button>
      </div>
      <button type="button" className="btn btn--ghost" onClick={onRemove}>
        Remove this club
      </button>
    </div>
  );
}

function PlanView({ result, plan, ours, busy, onApply }: { result: SeasonResult; plan: ReturnType<typeof leagueToSeasonInput>; ours: OurClub; busy: boolean; onApply: () => void }) {
  const mine = ourMatches(result, plan, ours);
  const name = (id: string) => plan.names.teams.get(id) ?? id;
  const ourIds = new Set(ours.teams.map((t) => t.id));
  const byDate = new Map<string, typeof result.matches>();
  for (const m of result.matches) byDate.set(m.date, [...(byDate.get(m.date) ?? []), m]);
  const total = result.matches.length + result.unplanned.length;

  return (
    <div className="season__result">
      <p className={result.unplanned.length ? 'season__warn' : 'season__ok'}>
        {result.matches.length} of {total} matches placed
        {result.unplanned.length ? `, ${result.unplanned.length} could not be placed` : '. Everything fits.'}
      </p>

      {result.unplanned.length > 0 && (
        <div className="season__box season__box--warn">
          <h3>Could not place</h3>
          <ul className="season__plain">
            {result.unplanned.map((u, i) => (
              <li key={i}>
                <strong>
                  {name(u.homeTeamId)} v {name(u.awayTeamId)}
                </strong>
                <span className="muted small"> {u.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {mine.length > 0 && (
        <div className="season__box">
          <h3>Your matches ({mine.length})</h3>
          <ul className="season__plain">
            {mine
              .slice()
              .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
              .map((m, i) => (
                <li key={i}>
                  <span className="season__when">{describeStart(m, TZ)}</span> <strong>{ours.teams.find((t) => t.id === m.teamId)?.name}</strong>{' '}
                  <span className="muted">{m.homeAway === 'home' ? 'at home v' : 'away at'} {m.homeAway === 'home' ? m.opponent : m.venue}</span>
                  {m.homeAway === 'home' && m.pitchId && <span className="muted small"> · {m.venue}</span>}
                </li>
              ))}
          </ul>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={onApply}>
            Create {mine.length} fixtures for your teams
          </button>
        </div>
      )}

      <div className="season__box">
        <h3>Fairness</h3>
        <div className="season__scroll">
          <table className="season__table">
            <thead>
              <tr>
                <th>Team</th>
                <th>Played</th>
                <th>Home</th>
                <th>Away</th>
                <th>Away miles</th>
              </tr>
            </thead>
            <tbody>
              {result.stats.map((s) => (
                <tr key={s.teamId} className={ourIds.has(s.teamId) ? 'is-ours' : undefined}>
                  <th scope="row">{name(s.teamId)}</th>
                  <td>{s.played}</td>
                  <td>{s.home}</td>
                  <td>{s.away}</td>
                  <td>{s.awayMiles}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <details className="season__box">
        <summary>
          <strong>Every match, by date ({result.matches.length})</strong>
        </summary>
        {[...byDate].map(([date, matches]) => (
          <div key={date}>
            <h4 className="season__date">{date}</h4>
            <ul className="season__plain">
              {matches.map((m, i) => (
                <li key={i}>
                  <span className="season__when">{describeStart(m, TZ).split(', ')[1]}</span> {name(m.homeTeamId)} <span className="muted">v</span> {name(m.awayTeamId)}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </details>
    </div>
  );
}
