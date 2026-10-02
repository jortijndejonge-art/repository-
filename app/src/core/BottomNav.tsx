import { useEffect, useRef, useState } from 'react';
import type { Tab } from '../App';
import { Icon } from './icons';

const SHORT_LABELS: Partial<Record<Tab, string>> = {
  lineup: 'Lineup',
  matches: 'Matches',
  family: 'Children',
  announcements: 'News',
};

interface BottomNavProps {
  tabs: { id: Tab; label: string }[];
  /** The tabs that get their own button (up to four); the rest go under More. */
  primary: Tab[];
  current: Tab;
  badges: Partial<Record<Tab, number>>;
  onSelect: (tab: Tab) => void;
  onSignOut: () => void;
}

/** Phone navigation: a bar along the bottom with the main sections, and More for the rest. */
export function BottomNav({ tabs, primary, current, badges, onSelect, onSignOut }: BottomNavProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const shown = primary.map((id) => tabs.find((t) => t.id === id)).filter((t): t is { id: Tab; label: string } => Boolean(t)).slice(0, 4);
  const rest = tabs.filter((t) => !shown.includes(t));
  const inMore = rest.some((t) => t.id === current);
  const moreBadge = rest.reduce((sum, t) => sum + (badges[t.id] ?? 0), 0);

  const pick = (tab: Tab) => {
    setMoreOpen(false);
    onSelect(tab);
  };

  return (
    <>
      <nav className="bottom-nav" aria-label="Sections">
        {shown.map((t) => (
          <NavButton
            key={t.id}
            icon={t.id}
            label={SHORT_LABELS[t.id] ?? t.label}
            active={current === t.id}
            badge={badges[t.id]}
            onClick={() => pick(t.id)}
          />
        ))}
        {rest.length > 0 && (
          <NavButton icon="more" label="More" active={inMore || moreOpen} badge={moreBadge} onClick={() => setMoreOpen(true)} />
        )}
      </nav>
      {moreOpen && <MoreSheet tabs={rest} current={current} onPick={pick} onSignOut={onSignOut} onClose={() => setMoreOpen(false)} />}
    </>
  );
}

function NavButton({ icon, label, active, badge, onClick }: { icon: string; label: string; active: boolean; badge?: number; onClick: () => void }) {
  return (
    <button type="button" className={`bottom-nav__item${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}>
      <span className="bottom-nav__icon">
        <Icon name={icon} />
        {badge ? <span className="bottom-nav__badge">{badge > 99 ? '99+' : badge}</span> : null}
      </span>
      <span className="bottom-nav__label">{label}</span>
    </button>
  );
}

function MoreSheet({
  tabs,
  current,
  onPick,
  onSignOut,
  onClose,
}: {
  tabs: { id: Tab; label: string }[];
  current: Tab;
  onPick: (tab: Tab) => void;
  onSignOut: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="more-sheet"
      onCancel={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      aria-label="More sections"
    >
      <ul>
        {tabs.map((t) => (
          <li key={t.id}>
            <button type="button" className={current === t.id ? 'is-active' : undefined} onClick={() => onPick(t.id)}>
              <Icon name={t.id} />
              {t.label}
            </button>
          </li>
        ))}
        <li>
          <button type="button" onClick={onSignOut}>
            <Icon name="account" />
            Sign out
          </button>
        </li>
      </ul>
    </dialog>
  );
}
