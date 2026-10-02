import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { Announcement, Id, Me } from '@hockey/contracts';
import { api } from '../../api-client';
import { managedTeams } from '../../core/auth';
import { useToast } from '../../core/Toast';
import './announcements.css';

const posted = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** News from managers for the teams you are in, newest first. Managers can post to the teams they run. */
export function Announcements({ me }: { me: Me }) {
  const toast = useToast();
  const managed = useMemo(() => managedTeams(me), [me]);
  const managedIds = useMemo(() => new Set(managed.map((t) => t.id)), [managed]);
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [filter, setFilter] = useState<Id | 'all'>('all');
  const teamName = useCallback((id: Id) => me.teams.find((t) => t.id === id)?.name ?? '', [me.teams]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(me.teams.map((t) => api.getAnnouncements(t.id)))
      .then((lists) => {
        if (!cancelled) setItems(lists.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      })
      .catch(() => toast('Could not load announcements'));
    return () => {
      cancelled = true;
    };
  }, [me.teams, toast]);

  const remove = async (a: Announcement) => {
    if (!window.confirm(`Delete "${a.title}"?`)) return;
    try {
      await api.deleteAnnouncement(a.id);
      setItems((cur) => cur?.filter((x) => x.id !== a.id) ?? cur);
    } catch {
      toast('Could not delete the announcement');
    }
  };

  const shown = (items ?? []).filter((a) => filter === 'all' || a.teamId === filter);

  return (
    <section className="announcements">
      {managed.length > 0 && (
        <NewAnnouncement
          teams={managed.map((t) => ({ id: t.id, name: t.name }))}
          onPosted={(a) => {
            setItems((cur) => [a, ...(cur ?? [])]);
            toast('Announcement posted');
          }}
        />
      )}

      {me.teams.length > 1 && (
        <select value={filter} aria-label="Team" onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All my teams</option>
          {me.teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}

      {items === null ? (
        <p className="muted">Loading announcements…</p>
      ) : shown.length === 0 ? (
        <p className="muted">No announcements yet.</p>
      ) : (
        <ul className="announcements__list">
          {shown.map((a) => (
            <li key={a.id} className="announcements__item">
              <header>
                <strong>{a.title}</strong>
                {managedIds.has(a.teamId) && (
                  <button type="button" className="btn btn--ghost" onClick={() => remove(a)}>
                    Delete
                  </button>
                )}
              </header>
              <p className="announcements__body">{a.body}</p>
              <footer className="muted small">
                {a.authorName} · {teamName(a.teamId)} · {posted(a.createdAt)}
              </footer>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NewAnnouncement({
  teams,
  onPosted,
}: {
  teams: { id: Id; name: string }[];
  onPosted: (a: Announcement) => void;
}) {
  const toast = useToast();
  const [teamId, setTeamId] = useState<Id>(teams[0]!.id);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      onPosted(await api.postAnnouncement(teamId, { title: title.trim(), body: body.trim() }));
      setTitle('');
      setBody('');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not post the announcement');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="announcements__new" onSubmit={submit}>
      <h2 className="announcements__heading">Post to a squad</h2>
      {teams.length > 1 && (
        <select value={teamId} aria-label="Post to team" onChange={(e) => setTeamId(e.target.value)}>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      <label className="field">
        <span className="field__label">Title</span>
        <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span className="field__label">Message</span>
        <textarea rows={3} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} />
      </label>
      <button type="submit" className="btn btn--primary" disabled={busy || title.trim() === '' || body.trim() === ''}>
        Post
      </button>
    </form>
  );
}
