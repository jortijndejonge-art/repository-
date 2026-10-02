import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/** What is being dragged: a player chip (maybe out of a row), or a whole change row by its handle. */
export type PlanDragPayload =
  | { kind: 'player'; id: string; label: string; fromRow?: number }
  | { kind: 'row'; index: number; label: string };

/** Where it was dropped, read from the `data-drop` attribute (`on:3` or `row:3`) of the element under the pointer. */
export interface PlanDropTarget {
  kind: 'on' | 'row';
  index: number;
}

const THRESHOLD = 6;
/** Within this many pixels of the top or bottom of the screen, a drag scrolls the page. */
const EDGE = 70;
const SCROLL_SPEED = 14;

/**
 * Small pointer-based drag and drop for the substitution plan. It works the same for mouse, touch and pen,
 * and only starts after the pointer moves a few pixels, so a plain tap still presses the button or select
 * it landed on.
 */
export function usePlanDrag(onDrop: (payload: PlanDragPayload, target: PlanDropTarget) => void) {
  const [drag, setDrag] = useState<{ payload: PlanDragPayload; x: number; y: number } | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;

  useEffect(() => () => cleanup.current?.(), []);

  const targetAt = (x: number, y: number): PlanDropTarget | null => {
    const raw = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]')?.dataset.drop;
    const match = raw?.match(/^(on|row):(\d+)$/);
    return match ? { kind: match[1] as 'on' | 'row', index: Number(match[2]) } : null;
  };

  const start = useCallback(
    (payload: PlanDragPayload) => (e: ReactPointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      cleanup.current?.();
      const from = { x: e.clientX, y: e.clientY };
      let active = false;
      let lastY = from.y;
      let frame = 0;

      // While dragging near the top or bottom edge, keep scrolling so far-away changes can be reached.
      const autoscroll = () => {
        if (lastY < EDGE) window.scrollBy(0, -SCROLL_SPEED);
        else if (lastY > window.innerHeight - EDGE) window.scrollBy(0, SCROLL_SPEED);
        frame = requestAnimationFrame(autoscroll);
      };

      const move = (ev: PointerEvent) => {
        if (!active) {
          if (Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < THRESHOLD) return;
          active = true;
          frame = requestAnimationFrame(autoscroll);
        }
        lastY = ev.clientY;
        ev.preventDefault();
        setDrag({ payload, x: ev.clientX, y: ev.clientY });
        const t = targetAt(ev.clientX, ev.clientY);
        setOverKey(t ? `${t.kind}:${t.index}` : null);
      };
      const finish = (ev: PointerEvent, drop: boolean) => {
        const target = active && drop ? targetAt(ev.clientX, ev.clientY) : null;
        stop();
        setDrag(null);
        setOverKey(null);
        if (target) dropRef.current(payload, target);
      };
      const up = (ev: PointerEvent) => finish(ev, true);
      const cancel = (ev: PointerEvent) => finish(ev, false);
      const stop = () => {
        cancelAnimationFrame(frame);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        cleanup.current = null;
      };

      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      cleanup.current = stop;
    },
    [],
  );

  return { start, drag, overKey };
}
