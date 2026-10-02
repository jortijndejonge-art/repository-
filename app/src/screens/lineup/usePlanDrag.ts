import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/** One cell of the rotation chart: a player in a block of the match. */
export interface CellRef {
  playerId: string;
  block: number;
}

/** The `data-cell` attribute value that marks an element as a drop target. */
export const cellKey = (c: CellRef) => `${c.playerId}|${c.block}`;

const THRESHOLD = 6;
/** On touch, a drag begins after holding still this long, so an ordinary swipe still scrolls the page. */
const HOLD_MS = 260;
/** Moving further than this before the hold finishes means the finger is scrolling, not dragging. */
const HOLD_SLOP = 10;
/** Within this many pixels of the top or bottom of the screen, a drag scrolls the page. */
const EDGE = 70;
const SCROLL_SPEED = 14;

function cellAt(x: number, y: number): CellRef | null {
  const raw = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-cell]')?.dataset.cell;
  const at = raw?.lastIndexOf('|') ?? -1;
  if (!raw || at < 0) return null;
  return { playerId: raw.slice(0, at), block: Number(raw.slice(at + 1)) };
}

/**
 * Pointer-based drag and drop for the rotation chart. It works the same for mouse, touch and pen, and only
 * starts after the pointer moves a few pixels, so a plain tap still selects the cell it landed on. Dragging
 * near the top or bottom of the screen scrolls the page.
 */
export function usePlanDrag(onDrop: (from: CellRef, to: CellRef) => void) {
  const [drag, setDrag] = useState<{ from: CellRef; label: string; x: number; y: number } | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;

  useEffect(() => () => cleanup.current?.(), []);

  const start = useCallback(
    (from: CellRef, label: string) => (e: ReactPointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      cleanup.current?.();
      const origin = { x: e.clientX, y: e.clientY };
      const touch = e.pointerType === 'touch';
      let active = false;
      let lastX = origin.x;
      let lastY = origin.y;
      let frame = 0;
      let hold = 0;
      // Once a touch drag is under way the page must not scroll under the finger.
      const blockScroll = (ev: TouchEvent) => {
        if (active && ev.cancelable) ev.preventDefault();
      };

      const autoscroll = () => {
        if (lastY < EDGE) window.scrollBy(0, -SCROLL_SPEED);
        else if (lastY > window.innerHeight - EDGE) window.scrollBy(0, SCROLL_SPEED);
        frame = requestAnimationFrame(autoscroll);
      };

      const activate = () => {
        active = true;
        frame = requestAnimationFrame(autoscroll);
        if (touch) navigator.vibrate?.(12);
        setDrag({ from, label, x: lastX, y: lastY });
        const over = cellAt(lastX, lastY);
        setOverKey(over ? cellKey(over) : null);
      };

      const move = (ev: PointerEvent) => {
        if (!active) {
          const moved = Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y);
          if (touch) {
            // Moved before the hold finished: this is a scroll, so give up and let the page scroll.
            if (moved > HOLD_SLOP) stop();
            return;
          }
          if (moved < THRESHOLD) return;
          lastX = ev.clientX;
          lastY = ev.clientY;
          activate();
        }
        lastX = ev.clientX;
        lastY = ev.clientY;
        ev.preventDefault();
        setDrag({ from, label, x: ev.clientX, y: ev.clientY });
        const over = cellAt(ev.clientX, ev.clientY);
        setOverKey(over ? cellKey(over) : null);
      };
      const stop = () => {
        window.clearTimeout(hold);
        window.removeEventListener('touchmove', blockScroll);
        cancelAnimationFrame(frame);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        cleanup.current = null;
      };
      const finish = (ev: PointerEvent, drop: boolean) => {
        const target = active && drop ? cellAt(ev.clientX, ev.clientY) : null;
        stop();
        setDrag(null);
        setOverKey(null);
        if (target) dropRef.current(from, target);
      };
      const up = (ev: PointerEvent) => finish(ev, true);
      const cancel = (ev: PointerEvent) => finish(ev, false);

      if (touch) {
        window.addEventListener('touchmove', blockScroll, { passive: false });
        hold = window.setTimeout(activate, HOLD_MS);
      }
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      cleanup.current = stop;
    },
    [],
  );

  return { start, drag, overKey };
}
