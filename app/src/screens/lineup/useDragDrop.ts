import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { Id, PitchPosition } from '@hockey/contracts';
import { pitchPointOf, pitchPositionAt, wouldTouch } from '../../components/pitch/Pitch';

export type Place =
  | { kind: 'slot'; slotId: string }
  | { kind: 'bench' }
  /** Open grass on the pitch: the (clamped) spot the player lands on. */
  | { kind: 'pitch'; spot: PitchPosition };

/** ok: a drop here does something. blocked: it would touch another player, so it's refused. none: nothing happens. */
export type DropStatus = 'ok' | 'blocked' | 'none';

export interface DragState {
  memberId: Id;
  from: Place;
  over: Place | null;
  status: DropStatus;
  /** Where the floating token's disc centre goes, snapped to the landing spot on grass. */
  x: number;
  y: number;
  /** Disc diameter in px. */
  size: number;
}

/** On touch, the dragged token rides this far above the finger so it stays visible. */
const TOUCH_LIFT = 48;
/** A pitch player held this close outside the pitch still drops on its edge. */
const PITCH_MARGIN = 60;
const DRAG_THRESHOLD = 6;

type Hit = { place: Place; x: number; y: number; status: DropStatus } | null;

function pitchEl() {
  return document.querySelector<HTMLElement>('[data-drop="pitch"]');
}

/** A grass drop at this point: snapped inside our half, refused if it would touch someone. */
function grassAt(from: Place, pitch: HTMLElement, x: number, y: number): Hit {
  if (from.kind !== 'slot') return null; // bench players dropped on grass do nothing
  const box = pitch.getBoundingClientRect();
  const spot = pitchPositionAt(box, x, y);
  const point = pitchPointOf(box, spot);
  return { place: { kind: 'pitch', spot }, ...point, status: wouldTouch(pitch, from.slotId, spot) ? 'blocked' : 'ok' };
}

/**
 * What a drag from `from` would drop on at (x, y) — the token's point, lifted
 * above the finger on touch. Targets are data-drop="bench", "pitch" or
 * "slot:<id>". A finger actually on the bench always means the bench, even
 * when the lifted point is still over the pitch's edge.
 */
function hitAt(from: Place, x: number, y: number, fingerX: number, fingerY: number): Hit {
  const underFinger = document.elementFromPoint(fingerX, fingerY)?.closest<HTMLElement>('[data-drop="bench"]');
  const el = underFinger ?? document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]');
  const drop = el?.dataset.drop;
  if (drop === 'bench') return from.kind === 'bench' ? null : { place: { kind: 'bench' }, x, y, status: 'ok' };
  if (drop?.startsWith('slot:')) {
    const slotId = drop.slice(5);
    // Back on its own spot: a small nudge, so treat it as a move on the grass.
    if (from.kind === 'slot' && from.slotId === slotId) {
      const pitch = pitchEl();
      return pitch ? grassAt(from, pitch, x, y) : null;
    }
    return { place: { kind: 'slot', slotId }, x, y, status: 'ok' };
  }
  if (drop === 'pitch' && el) return grassAt(from, el, x, y);
  const pitch = pitchNear(x, y, PITCH_MARGIN);
  return pitch ? grassAt(from, pitch, x, y) : null;
}

/** The pitch element, if this point is within `margin` px of its box. */
function pitchNear(x: number, y: number, margin: number) {
  const pitch = pitchEl();
  const box = pitch?.getBoundingClientRect();
  if (!box) return null;
  const inside = x > box.left - margin && x < box.right + margin && y > box.top - margin && y < box.bottom + margin;
  return inside ? pitch : null;
}

export function placeKey(place: Place | null): string | null {
  if (!place) return null;
  if (place.kind === 'slot') return `slot:${place.slotId}`;
  return place.kind;
}

/** A tiny store so the floating token can follow the pointer without re-rendering the page. */
function createDragStore() {
  let value: DragState | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: DragState | null) {
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
export type DragStore = ReturnType<typeof createDragStore>;

export function useDragState(store: DragStore) {
  return useSyncExternalStore(store.subscribe, store.get);
}

interface Pending {
  memberId: Id;
  from: Place;
  x: number;
  y: number;
  /** The latest pointer position, so a scroll mid-drag can re-resolve the preview. */
  lastX: number;
  lastY: number;
  lift: number;
  size: number;
  pitchSize: number;
}

const discWidth = (el: Element | null | undefined) => el?.getBoundingClientRect().width ?? 0;

/**
 * Pointer-based drag and drop (mouse, touch and pen alike) plus
 * tap-to-select / tap-to-place, which also works from the keyboard.
 * `onRefused` is called for a drop that would make players touch.
 */
export function useDragDrop(onMove: (memberId: Id, from: Place, to: Place) => void, onRefused: () => void) {
  const [store] = useState(createDragStore);
  /** Only who is being dragged lives in React state; the per-move position lives in the store. */
  const [draggingId, setDraggingId] = useState<Id | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ memberId: Id; from: Place } | null>(null);
  const pending = useRef<Pending | null>(null);
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

  const end = () => {
    pending.current = null;
    dragging.current = false;
    store.set(null);
    setDraggingId(null);
    setHover(null);
  };

  /** Re-resolve the preview for the pointer at (clientX, clientY). */
  const update = (p: Pending, clientX: number, clientY: number) => {
    p.lastX = clientX;
    p.lastY = clientY;
    const x = clientX;
    const y = clientY - p.lift;
    const hit = hitAt(p.from, x, y, clientX, clientY);
    const overPitch = hit?.place.kind === 'slot' || pitchNear(x, y, 0) !== null;
    store.set({
      memberId: p.memberId,
      from: p.from,
      over: hit?.place ?? null,
      status: hit?.status ?? 'none',
      x: hit?.x ?? x,
      y: hit?.y ?? y,
      size: p.from.kind === 'bench' && overPitch ? p.pitchSize : p.size,
    });
    setHover(hit && hit.place.kind !== 'pitch' ? placeKey(hit.place) : null);
  };

  // A scroll mid-drag moves the pitch under a still pointer: re-resolve so the preview (and the drop) stay true.
  useEffect(() => {
    if (!draggingId) return;
    const onScroll = () => {
      const p = pending.current;
      if (p && dragging.current) update(p, p.lastX, p.lastY);
    };
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', onScroll, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingId]);

  const tokenHandlers = (memberId: Id, from: Place) => ({
    onPointerDown(e: ReactPointerEvent<HTMLElement>) {
      if (e.button !== 0) return;
      pending.current = {
        memberId,
        from,
        x: e.clientX,
        y: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        lift: e.pointerType === 'touch' ? TOUCH_LIFT : 0,
        size: 0,
        pitchSize: 0,
      };
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
        p.size = discWidth(e.currentTarget.querySelector('.token__disc'));
        p.pitchSize = discWidth(document.querySelector('.pitch .token__disc, .pitch .slot-empty')) || p.size;
        setSelected(null);
        setDraggingId(p.memberId);
      }
      update(p, e.clientX, e.clientY);
    },
    onPointerUp() {
      const p = pending.current;
      const last = store.get();
      const wasDragging = dragging.current;
      end();
      if (!p || !wasDragging) return;
      suppressClick.current = true;
      // Drop exactly what the preview last showed.
      if (!last?.over || last.status === 'none') return;
      if (last.status === 'blocked') onRefused();
      else onMove(p.memberId, p.from, last.over);
    },
    onPointerCancel: end,
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
    store,
    draggingId,
    hover,
    selected,
    clearSelection: () => setSelected(null),
    tokenHandlers,
    /** Tap on an empty slot or the bench area. */
    tapPlace: (at: Place) => tap(null, at),
  };
}
