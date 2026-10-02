import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Fixture, Id, Me, NewFixture } from '@hockey/contracts';
import { api } from '../../api-client';
import { managedTeams } from '../../core/auth';
import { useToast } from '../../core/Toast';
import { BriefingDialog } from './BriefingDialog';
import { FixtureDialog } from './FixtureDialog';
import './fixtures.css';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function Fixtures({ me }: { me: Me }) {
  const toast = useToast();
  const teams = useMemo(() => managedTeams(me), [me]);
  const [teamId, setTeamId] = useState<Id>(teams[0]?.id ?? '');
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);
  const [dialog, setDialog] = useState<{ fixture?: Fixture } | null>(null);
  const [briefingFor, setBriefingFor] = useState<Fixture | null>(null);
  const team = teams.find((t) => t.id === teamId);

  const load = useCallback(async () => {
    if (!teamId) return;
    setFixtures(null);
    setFixtures(await api.getFixtures(teamId));
  }, [teamId]);

  useEffect(() => {
    load().catch(() => toast('Could not load fixtures'));
  }, [load, toast]);

  if (teams.length === 0) return <p className="muted">You don&apos;t manage any teams yet.</p>;

  const save = async (input: NewFixture) => {
    const editing = dialog?.fixture;
    if (editing) {
      const updated = await api.updateFixture(editing.id, input);
      setFixtures((cur) => cur?.map((f) => (f.id === updated.id ? updated : f)).sort(byStart) ?? cur);
      toast('Fixture saved');
    } else {
      const added = await api.addFixture(teamId, input);
      setFixtures((cur) => [...(cur ?? []), added].sort(byStart));
      toast(`Added ${added.opponent}`);
    }
    setDialog(null);
  };

  const remove = async (fixture: Fixture) => {
    if (!window.confirm(`Delete the match against ${fixture.opponent}? Its availability and lineup are deleted too.`)) return;
    try {
      await api.deleteFixture(fixture.id);
      setFixtures((cur) => cur?.filter((f) => f.id !== fixture.id) ?? cur);
      toast('Fixture deleted');
    } catch {
      toast('Could not delete the fixture');
    }
  };

  const now = new Date().toISOString();

  return (
    <section className="fixtures">
      <div className="fixtures__bar">
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
        <span className="spacer" />
        <button type="button" className="btn btn--primary" onClick={() => setDialog({})}>
          Add fixture
        </button>
      </div>

      {fixtures === null ? (
        <p className="muted">Loading fixtures…</p>
      ) : fixtures.length === 0 ? (
        <p className="muted">No fixtures yet. Add the first match.</p>
      ) : (
        <ul className="fixtures__list">
          {fixtures.map((f) => (
            <li key={f.id} className={`fixtures__row${f.startsAt < now ? ' is-past' : ''}`}>
              <div>
                <div className="fixtures__opponent">
                  <span className="fixtures__ha">{f.homeAway === 'home' ? 'Home' : 'Away'}</span> vs {f.opponent}
                </div>
                <div className="muted small">
                  {when(f.startsAt)} · {f.venue} · {f.format}-a-side · {f.durationMinutes} min ({f.periods} periods)
                </div>
              </div>
              <div className="fixtures__actions">
                <button type="button" className="btn btn--ghost" onClick={() => setBriefingFor(f)}>
                  Briefing
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setDialog({ fixture: f })}>
                  Edit
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => remove(f)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {briefingFor && <BriefingDialog fixture={briefingFor} teamId={teamId} onClose={() => setBriefingFor(null)} />}

      {dialog && team && (
        <FixtureDialog
          fixture={dialog.fixture}
          defaultFormat={team.defaultFormat}
          onCancel={() => setDialog(null)}
          onSave={save}
        />
      )}
    </section>
  );
}

const byStart = (a: Fixture, b: Fixture) => a.startsAt.localeCompare(b.startsAt);
