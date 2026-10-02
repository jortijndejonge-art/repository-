import { useEffect, useRef, useState } from 'react';
import type { BriefingLink, BriefingRead, Fixture, Id, PlayerProfile } from '@hockey/contracts';
import { api } from '../../api-client';
import { useToast } from '../../core/Toast';

interface BriefingDialogProps {
  fixture: Fixture;
  teamId: Id;
  onClose: () => void;
}

/** A manager writes (or removes) the coaching notes and links for a match, and sees who has read them. */
export function BriefingDialog({ fixture, teamId, onClose }: BriefingDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const toast = useToast();
  const [loaded, setLoaded] = useState(false);
  const [exists, setExists] = useState(false);
  const [body, setBody] = useState('');
  const [links, setLinks] = useState<BriefingLink[]>([]);
  const [reads, setReads] = useState<BriefingRead[]>([]);
  const [squad, setSquad] = useState<PlayerProfile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.showModal();
    Promise.all([api.getBriefing(fixture.id), api.getBriefingReads(fixture.id), api.getSquad(teamId)])
      .then(([b, r, players]) => {
        setExists(Boolean(b));
        setBody(b?.body ?? '');
        setLinks(b?.links ?? []);
        setReads(r);
        setSquad(players);
        setLoaded(true);
      })
      .catch(() => {
        toast('Could not load the briefing');
        onClose();
      });
    // Loaded once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLink = (i: number, patch: Partial<BriefingLink>) =>
    setLinks((cur) => cur.map((l, at) => (at === i ? { ...l, ...patch } : l)));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.saveBriefing(fixture.id, { body: body.trim(), links: links.filter((l) => l.url.trim() !== '') });
      toast('Briefing saved. Players will see it as new.');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the briefing');
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('Remove this briefing?')) return;
    setBusy(true);
    try {
      await api.deleteBriefing(fixture.id);
      toast('Briefing removed');
      onClose();
    } catch {
      toast('Could not remove the briefing');
      setBusy(false);
    }
  };

  const name = (id: Id) => squad.find((p) => p.memberId === id)?.displayName ?? 'Player';
  const seen = reads.filter((r) => r.seen).length;

  return (
    <dialog ref={ref} className="dialog" onCancel={onClose} aria-labelledby="briefing-title">
      <h2 id="briefing-title">Briefing: vs {fixture.opponent}</h2>
      {!loaded ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="fixture-form">
            <label className="field">
              <span className="field__label">Notes for the squad</span>
              <textarea rows={5} value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} />
            </label>
            <div className="field">
              <span className="field__label">Links (YouTube clips, tactics pages)</span>
              {links.map((l, i) => (
                <div key={i} className="briefing-link">
                  <input aria-label="Link name" placeholder="Name" value={l.label} maxLength={120} onChange={(e) => setLink(i, { label: e.target.value })} />
                  <input aria-label="Link address" placeholder="https://…" value={l.url} maxLength={2000} onChange={(e) => setLink(i, { url: e.target.value })} />
                  <button type="button" className="btn btn--ghost" onClick={() => setLinks((cur) => cur.filter((_, at) => at !== i))}>
                    Remove
                  </button>
                </div>
              ))}
              {links.length < 10 && (
                <button type="button" className="btn btn--ghost" onClick={() => setLinks((cur) => [...cur, { label: '', url: '' }])}>
                  Add a link
                </button>
              )}
            </div>
          </div>

          {exists && (
            <div className="briefing-reads">
              <span className="field__label">
                Read by {seen} of {reads.length}
              </span>
              <ul>
                {reads.map((r) => (
                  <li key={r.memberId} className={r.seen ? 'is-seen' : undefined}>
                    {r.seen ? '✓' : '·'} {name(r.memberId)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {error && (
        <p className="squad-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog__actions">
        {exists && (
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={remove}>
            Remove briefing
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn--primary" disabled={!loaded || busy || (body.trim() === '' && links.every((l) => l.url.trim() === ''))} onClick={save}>
          {exists ? 'Save changes' : 'Save briefing'}
        </button>
      </div>
    </dialog>
  );
}
