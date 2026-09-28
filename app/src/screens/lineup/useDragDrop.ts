import { useCallback, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { Id } from '@hockey/contracts';

export type Place = { kind: 'slot'; slotId: string } | { kind: 'bench' };

export interface DragState {
  memberId: Id;
  label: string;
  x: number;
  y: number;
}

/** Drop targets are marked with data-drop="bench" or data-drop="slot:<id>". */
function placeAt(x: number, y: number): Place | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]');
  const drop = el?.dataset.drop;
  if (!drop) return null;
  if (drop === 'bench') return { kind: 'bench' };
  if (drop.startsWith('slot:')) return { kind: 'slot', slotId: drop.slice(5) };
  return null;
}

export function placeKey(place: Place | null): string | null {
  if (!place) return null;
  return place.kind === 'bench' ? 'bench' : `slot:${place.slotId}`;
}

const DRAG_THRESHOLD = 6;

/**
 * Pointer-based drag and drop (mouse, touch and pen alike) plus
 * tap-to-select / tap-to-place, which also works from the keyboard.
 */
export function useDragDrop(onMove: (memberId: Id, from: Place, to: Place) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ memberId: Id; from: Place } | null>(null);
  const pending = useRef<{ memberId: Id; from: Place; label: string; x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const suppressClick = useRef(false);

  const tap = useCallback(
    (memberId: Id | null, at: Place) => {
      if (!selected) {
        if (memberId) setSelected({ memberId, from: at });
        return;
      }
      if (selected.memberId === memberId) {
        setSelected(null);
        return;
      }
      if (selected.from.kind === 'bench' && at.kind === 'bench') {
        setSelected(memberId ? { memberId, from: at } : null);
        return;
      }
      onMove(selected.memberId, selected.from, at);
      setSelected(null);
    },
    [selected, onMove],
  );

  const tokenHandlers = (memberId: Id, from: Place, label: string) => ({
    onPointerDown(e: ReactPointerEvent<HTMLElement>) {
      if (e.button !== 0) return;
      pending.current = { memberId, from, label, x: e.clientX, y: e.clientY };
      dragging.current = false;
      suppressClick.current = false;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove(e: ReactPointerEvent<HTMLElement>) {
      const p = pending.current;
      if (!p) return;
      if (!dragging.current) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return;
        dragging.current = true;
        setSelected(null);
      }
      setDrag({ memberId: p.memberId, label: p.label, x: e.clientX, y: e.clientY });
      setHover(placeKey(placeAt(e.clientX, e.clientY)));
    },
    onPointerUp(e: ReactPointerEvent<HTMLElement>) {
      const p = pending.current;
      pending.current = null;
      if (!p || !dragging.current) return;
      dragging.current = false;
      suppressClick.current = true;
      setDrag(null);
      setHover(null);
      const to = placeAt(e.clientX, e.clientY);
      if (to && placeKey(to) !== placeKey(p.from)) onMove(p.memberId, p.from, to);
    },
    onPointerCancel() {
      pending.current = null;
      dragging.current = false;
      setDrag(null);
      setHover(null);
    },
    onClick(e: ReactMouseEvent<HTMLElement>) {
      e.stopPropagation(); // don't also count as a tap on the bench area behind
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      tap(memberId, from);
    },
  });

  return {
    drag,
    hover,
    selected,
    clearSelection: () => setSelected(null),
    tokenHandlers,
    /** Tap on an empty slot or the bench area. */
    tapPlace: (at: Place) => tap(null, at),
  };
}
