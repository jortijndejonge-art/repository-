import type { HTMLAttributes } from 'react';
import type { PlayerProfile } from '@hockey/contracts';

interface PlayerTokenProps extends HTMLAttributes<HTMLButtonElement> {
  player: PlayerProfile;
  slotLabel?: string;
  keeper?: boolean;
  outOfPosition?: boolean;
  selected?: boolean;
  dragging?: boolean;
  /** A drop here would touch another player, so it would be refused. */
  blocked?: boolean;
  /** Shown only in the aria-label — the Planned minutes panel already covers this on the token itself. */
  minutes?: number;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .replace('.', '')
    .slice(0, 2)
    .toUpperCase();
}

export function PlayerToken({
  player,
  slotLabel,
  keeper,
  outOfPosition,
  selected,
  dragging,
  blocked,
  minutes,
  className,
  ...rest
}: PlayerTokenProps) {
  const classes = [
    'token',
    keeper && 'token--keeper',
    outOfPosition && 'token--oop',
    selected && 'token--selected',
    dragging && 'token--dragging',
    blocked && 'token--blocked',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const label = [
    player.displayName,
    slotLabel && `at ${slotLabel}`,
    outOfPosition && '(out of position)',
    minutes !== undefined && `${minutes} min planned`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type="button" className={classes} aria-label={label} title={label} aria-pressed={selected} {...rest}>
      <span className="token__disc">
        <span className="token__number">{player.shirtNumber ?? initials(player.displayName)}</span>
      </span>
      <span className="token__name">{player.displayName}</span>
    </button>
  );
}
