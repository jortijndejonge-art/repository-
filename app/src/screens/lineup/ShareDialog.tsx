import { useEffect, useRef, useState } from 'react';
import type { Id, PlayerProfile } from '@hockey/contracts';

interface ShareDialogProps {
  players: PlayerProfile[];
  summary: string;
  onCancel: () => void;
  onShare: (memberIds: Id[]) => void;
}

export function ShareDialog({ players, summary, onCancel, onShare }: ShareDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [chosen, setChosen] = useState<Set<Id>>(() => new Set(players.map((p) => p.memberId)));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const toggle = (id: Id) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChosen(next);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <dialog ref={ref} className="dialog" onCancel={onCancel} aria-labelledby="share-title">
      <h2 id="share-title">Share lineup</h2>
      <p className="muted small">Choose who gets notified. Everyone chosen sees the lineup and their planned minutes.</p>
      <div className="dialog__tools">
        <button type="button" className="btn btn--ghost" onClick={() => setChosen(new Set(players.map((p) => p.memberId)))}>
          Select all
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => setChosen(new Set())}>
          Clear
        </button>
      </div>
      <ul className="share-list">
        {players.map((p) => (
          <li key={p.memberId}>
            <label>
              <input type="checkbox" checked={chosen.has(p.memberId)} onChange={() => toggle(p.memberId)} />
              {p.displayName}
            </label>
          </li>
        ))}
      </ul>
      <pre className="share-preview">{summary}</pre>
      <div className="dialog__actions">
        <button type="button" className="btn btn--ghost" onClick={copy}>
          {copied ? 'Copied' : 'Copy as text'}
        </button>
        <span className="spacer" />
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={chosen.size === 0}
          onClick={() => onShare([...chosen])}
        >
          Share with {chosen.size}
        </button>
      </div>
    </dialog>
  );
}
