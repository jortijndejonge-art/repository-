import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import type { ChatMessage, EventKind, Id, Me } from '@hockey/contracts';
import { api } from '../../api-client';
import { LineupCardView } from './LineupCardView';
import './chat.css';

/** How often an open chat checks for new messages. */
const POLL_MS = 8000;

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

interface EventChatProps {
  me: Me;
  kind: EventKind;
  eventId: Id;
  title: string;
  subtitle: string;
  onClose: () => void;
}

/**
 * The group chat for one match or training session. Everyone in the team (and
 * players' parents) sees every message; managers can remove any, people their own.
 */
export function EventChat({ me, kind, eventId, title, subtitle, onClose }: EventChatProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [canModerate, setCanModerate] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const atBottom = useRef(true);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const load = useCallback(async () => {
    try {
      const thread = await api.getEventChat(kind, eventId);
      setMessages(thread.messages);
      setCanModerate(thread.canModerate);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [kind, eventId]);

  // Load now, then keep checking while the chat is open and the page is visible.
  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Stay pinned to the newest message unless the reader has scrolled up.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const msg = await api.postEventMessage(kind, eventId, text);
      setDraft('');
      atBottom.current = true;
      setMessages((prev) => [...(prev ?? []), msg]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends on a keyboard; Shift+Enter (and phones' return key) makes a new line.
    if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
      e.preventDefault();
      send();
    }
  };

  const remove = async (msg: ChatMessage) => {
    if (!window.confirm('Remove this message for everyone?')) return;
    try {
      await api.deleteChatMessage(msg.id);
      setMessages((prev) => (prev ?? []).filter((m) => m.id !== msg.id));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <dialog ref={ref} className="chat" onCancel={onClose} aria-labelledby="chat-title">
      <header className="chat__head">
        <div>
          <h2 id="chat-title">{title}</h2>
          <p className="muted small">{subtitle}</p>
        </div>
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Close
        </button>
      </header>
      <p className="chat__note muted small">Everyone in the team and players' parents can see this chat.</p>

      <div
        className="chat__list"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        aria-live="polite"
      >
        {messages === null && !error && <p className="muted small">Loading…</p>}
        {messages?.length === 0 && <p className="muted small chat__empty">No messages yet. Say hello!</p>}
        {messages?.map((m) => {
          const mine = m.authorId === me.member.id;
          return (
            <article key={m.id} className={`chat__msg${mine ? ' chat__msg--mine' : ''}`}>
              <div className="chat__meta">
                <span className="chat__author">{mine ? 'You' : m.authorName}</span>
                {m.authorRole && !mine && <span className="chat__role">{m.authorRole}</span>}
                <span className="chat__time">{when(m.createdAt)}</span>
              </div>
              <div className="chat__bubble">
                {m.body && <p className="chat__body">{m.body}</p>}
                {m.lineup && <LineupCardView card={m.lineup} />}
              </div>
              {(mine || canModerate) && (
                <button type="button" className="chat__remove" onClick={() => remove(m)}>
                  Remove
                </button>
              )}
            </article>
          );
        })}
      </div>

      {error && <p className="status-bad small chat__error">{error}</p>}

      <form className="chat__composer" onSubmit={send}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Write a message…"
          aria-label="Message"
          rows={1}
          maxLength={2000}
        />
        <button type="submit" className="btn btn--primary" disabled={!draft.trim() || sending}>
          Send
        </button>
      </form>
    </dialog>
  );
}
