import type { CSSProperties, ReactNode } from 'react';
import type { Formation, FormationSlot, PitchPosition, SquadFormat } from '@hockey/contracts';
import { buildCustomFormationSlots, customFormationShapes, FORMATIONS, LINE_X } from '@hockey/engine';
import './pitch.css';

/*
 * Shortened pitch, in SVG units (~10.9 units per metre), 600 wide, attacking
 * upwards. The attacking 23 m area is shown at the top, then a break (//)
 * stands in for the stretch up to halfway, then our full half:
 *
 *   0 ─ attacking back line
 *   0–252     ATTACK   (attacking D + 23 m area, to scale)
 *   252–316   break    (the "//" gap)
 *   316       halfway line
 *   then MIDFIELD (halfway → our 23 m line) and DEFENCE (→ our back line)
 *
 * Our half is drawn OUR_HALF_STRETCH times taller than scale, as lineup
 * graphics do, so the rows have room to breathe and players can be bigger.
 */
const OUR_HALF_STRETCH = 1.3;
const ATTACK_END = 252;
const HALFWAY = 316;
const OUR_23 = HALFWAY + 252 * OUR_HALF_STRETCH;
const BASELINE = HALFWAY + 498 * OUR_HALF_STRETCH;
const BREAK_MID = (ATTACK_END + HALFWAY) / 2;

const VIEW = { x: -24, y: -36, w: 648, h: BASELINE + 72 };
const BANDS = [
  { label: 'Attack', y: 0, h: ATTACK_END },
  { label: 'Midfield', y: HALFWAY, h: OUR_23 - HALFWAY },
  { label: 'Defence', y: OUR_23, h: BASELINE - OUR_23 },
];

/** Back-line marks 5 m and 10 m either side of the goal posts. */
const TICKS = [171, 226, 374, 429];
const GOAL = { x: 262, w: 76, depth: 22 };

/*
 * A token's full footprint, in disc diameters, from the CSS in lineup.css: the
 * lock button pokes 0.62 above centre, and the name may be up to 1.6 wide. The
 * name label ends ~0.86 below centre on desktop but ~1.0 on a phone, where its
 * 10px minimum font makes it proportionally taller — so we size for the phone.
 * GAP keeps neighbours from touching.
 */
const FOOTPRINT = { top: 0.62, bottom: 1.0, width: 1.6, gap: 0.08 };

/** Clear space between the keeper's name label and our back line. */
const BACK_LINE_CLEARANCE = 14;
/** Slots within this many % of each other share a row and are drawn level (built-ins stagger by 2–3). */
const ROW_TOLERANCE = 6;
/** Clear space between the front row's lock icons and the halfway line. */
const HALFWAY_CLEARANCE = 12;

interface Placed {
  slot: FormationSlot;
  x: number;
  y: number;
}

/** Clear space between a row's players and our 23 m line, so the line never runs through them. */
const LINE_CLEARANCE = 6;

/** `count` values evenly spread from `from` to `to` (a single value sits at `from`). */
function spread(count: number, from: number, to: number) {
  return Array.from({ length: count }, (_, i) => (count > 1 ? from + (i * (to - from)) / (count - 1) : from));
}

/**
 * Row heights with one equal gap between every row, as large as possible,
 * running from `top` down towards `bottom`. The 23 m line must fall between
 * row `split - 1` (last forward/midfield row) and row `split` (first
 * defensive row): the first may sit no lower than `aboveLine`, the second no
 * higher than `belowLine`. Null if no equal gap can satisfy that.
 */
function evenRows(count: number, split: number, top: number, bottom: number, aboveLine: number, belowLine: number) {
  if (count <= 1) return [top];
  for (let gap = (bottom - top) / (count - 1); gap > 0; gap -= 0.5) {
    const lo = Math.max(top, split > 0 && split < count ? belowLine - split * gap : top);
    const hi = Math.min(bottom - (count - 1) * gap, split > 0 ? aboveLine - (split - 1) * gap : bottom);
    if (lo <= hi) return Array.from({ length: count }, (_, i) => lo + i * gap);
  }
  return null;
}

/**
 * Lays the lineup out as real lineup graphics do: every row the same distance
 * apart, from just below halfway (so no player crosses it) towards the keeper
 * (whose name clears the back line). Our 23 m line falls between the last
 * forward/midfield row and the first defensive row, clear of every disc — it
 * may pass behind a name label, which hides it. Across the pitch, every row of
 * the same size uses the same positions (LINE_X), whatever the formation — a
 * pair is always the same tight central pair. `diameter` is in SVG units.
 */
function layout(slots: FormationSlot[], diameter: number): Placed[] {
  const top = HALFWAY + FOOTPRINT.top * diameter + HALFWAY_CLEARANCE;
  const aboveLine = OUR_23 - diameter / 2 - LINE_CLEARANCE;
  const belowLine = OUR_23 + diameter / 2 + LINE_CLEARANCE;
  const keeperY = BASELINE - FOOTPRINT.bottom * diameter - BACK_LINE_CLEARANCE;

  const rows: FormationSlot[][] = [];
  for (const slot of [...slots].sort((a, b) => a.y - b.y)) {
    const row = rows[rows.length - 1];
    if (row && slot.y - row[0]!.y <= ROW_TOLERANCE) row.push(slot);
    else rows.push([slot]);
  }

  const isBack = (row: FormationSlot[]) => row.some((s) => s.line === 'DEF' || s.line === 'GK');
  const front = rows.filter((row) => !isBack(row));
  const back = rows.filter(isBack);
  const ys = evenRows(rows.length, front.length, top, keeperY, aboveLine, belowLine) ?? [
    // No single gap fits both sides of the line — space each side evenly instead.
    ...spread(front.length, top, aboveLine),
    ...spread(back.length, belowLine, keeperY),
  ];

  return [...front, ...back].flatMap((row, i) => {
    const xs = LINE_X[row.length];
    return [...row]
      .sort((a, b) => a.x - b.x)
      .map((slot, j) => ({ slot, x: (xs ? xs[j]! : slot.x) * 6, y: ys[i]! }));
  });
}

/** The automatic layout, with any positions the team has dragged into place on top. */
function placeAll(slots: FormationSlot[], diameter: number, positions: Record<string, PitchPosition> = {}): Placed[] {
  return layout(slots, diameter).map((p) => {
    const moved = positions[p.slot.id];
    return moved ? { slot: p.slot, x: moved.x * 6, y: HALFWAY + (moved.y / 100) * (BASELINE - HALFWAY) } : p;
  });
}

/** True if no two players' footprints (disc, name and lock) touch. */
function fits(placed: Placed[], diameter: number) {
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const dx = Math.abs(placed[i]!.x - placed[j]!.x);
      const dy = Math.abs(placed[i]!.y - placed[j]!.y);
      const sideBySide = dx >= (FOOTPRINT.width + FOOTPRINT.gap) * diameter;
      const stacked = dy >= (FOOTPRINT.top + FOOTPRINT.bottom + FOOTPRINT.gap) * diameter;
      if (!sideBySide && !stacked) return false;
    }
  }
  return true;
}

/** Upper bound for the token size search, as % of pitch width. */
const MAX_TOKEN_SIZE = 14;

/**
 * One token size for every pitch — 5, 7 or 11-a-side — the largest (up to
 * MAX_TOKEN_SIZE) at which every built-in formation AND every custom formation
 * a coach could save fits. Players are the same size whatever the format or
 * formation.
 */
const TOKEN_SIZE = (() => {
  const shapes = [
    ...FORMATIONS.map((f) => f.slots),
    ...([5, 7, 11] as SquadFormat[]).flatMap((format) => customFormationShapes(format).map(buildCustomFormationSlots)),
  ];
  const fitsAll = (pct: number) => {
    const diameter = (pct / 100) * VIEW.w;
    return shapes.every((slots) => fits(layout(slots, diameter), diameter));
  };
  let size = MAX_TOKEN_SIZE;
  while (size > 4 && !fitsAll(size)) size = Math.round((size - 0.1) * 10) / 10;
  return size;
})();
const DIAMETER = (TOKEN_SIZE / 100) * VIEW.w;

/**
 * Where a point on screen falls on our half, given the pitch element's
 * bounding box — clamped so a player dropped there stays fully inside our
 * half: below halfway, clear of the back line, and inside the side lines.
 */
export function pitchPositionAt(pitch: DOMRect, clientX: number, clientY: number): PitchPosition {
  const svgX = VIEW.x + ((clientX - pitch.left) / pitch.width) * VIEW.w;
  const svgY = VIEW.y + ((clientY - pitch.top) / pitch.height) * VIEW.h;
  const halfWidth = (FOOTPRINT.width / 2) * DIAMETER;
  const x = Math.min(600 - halfWidth, Math.max(halfWidth, svgX));
  const y = Math.min(
    BASELINE - FOOTPRINT.bottom * DIAMETER - BACK_LINE_CLEARANCE,
    Math.max(HALFWAY + FOOTPRINT.top * DIAMETER + HALFWAY_CLEARANCE, svgY),
  );
  return { x: (x / 600) * 100, y: ((y - HALFWAY) / (BASELINE - HALFWAY)) * 100 };
}

/** The point on screen where a player at `position` has its disc centre — the reverse of pitchPositionAt. */
export function pitchPointOf(pitch: DOMRect, position: PitchPosition): { x: number; y: number } {
  const scale = pitch.width / VIEW.w;
  return {
    x: pitch.left + (position.x * 6 - VIEW.x) * scale,
    y: pitch.top + (HALFWAY + (position.y / 100) * (BASELINE - HALFWAY) - VIEW.y) * scale,
  };
}

/** Clear space, in screen pixels, a dragged player must keep from every other player. */
const DRAG_GAP = 4;

type Box = { left: number; right: number; top: number; bottom: number };
type Shape = { kind: 'circle'; x: number; y: number; r: number } | ({ kind: 'box' } & Box);

function shapesOf(slotEl: Element, dx = 0, dy = 0): Shape[] {
  const shapes: Shape[] = [];
  const disc = slotEl.querySelector('.token__disc, .slot-empty')?.getBoundingClientRect();
  if (disc) shapes.push({ kind: 'circle', x: disc.left + disc.width / 2 + dx, y: disc.top + disc.height / 2 + dy, r: disc.width / 2 });
  const name = slotEl.querySelector('.token__name')?.getBoundingClientRect();
  if (name) shapes.push({ kind: 'box', left: name.left + dx, right: name.right + dx, top: name.top + dy, bottom: name.bottom + dy });
  return shapes;
}

function touch(a: Shape, b: Shape): boolean {
  if (a.kind === 'circle' && b.kind === 'circle') return Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r + DRAG_GAP;
  if (a.kind === 'box' && b.kind === 'box') {
    return a.left < b.right + DRAG_GAP && b.left < a.right + DRAG_GAP && a.top < b.bottom + DRAG_GAP && b.top < a.bottom + DRAG_GAP;
  }
  const c = a.kind === 'circle' ? a : (b as Extract<Shape, { kind: 'circle' }>);
  const r = a.kind === 'box' ? a : (b as Box);
  const nearestX = Math.min(r.right, Math.max(r.left, c.x));
  const nearestY = Math.min(r.bottom, Math.max(r.top, c.y));
  return Math.hypot(c.x - nearestX, c.y - nearestY) < c.r + DRAG_GAP;
}

/**
 * True if moving `slotId` to `position` would make its circle or name label
 * touch any other player's, measured on the shapes actually on screen — so
 * players may sit as close as they visibly can without touching.
 */
export function wouldTouch(pitch: HTMLElement, slotId: string, position: PitchPosition): boolean {
  const moving = pitch.querySelector(`[data-slot="${CSS.escape(slotId)}"]`);
  const disc = moving?.querySelector('.token__disc, .slot-empty')?.getBoundingClientRect();
  if (!moving || !disc) return false;
  const { x, y } = pitchPointOf(pitch.getBoundingClientRect(), position);
  const movedShapes = shapesOf(moving, x - (disc.left + disc.width / 2), y - (disc.top + disc.height / 2));
  return [...pitch.querySelectorAll('[data-slot]')]
    .filter((el) => el !== moving)
    .some((el) => shapesOf(el).some((other) => movedShapes.some((mine) => touch(mine, other))));
}

/** The "//" marks where the pitch is cut, on one side line. */
function BreakMark({ x }: { x: number }) {
  const d = 11; // gap between the two strokes
  const stroke = (offset: number) => `M ${x - 22} ${BREAK_MID + 10 + offset} L ${x + 22} ${BREAK_MID - 10 + offset}`;
  return (
    <g className="pitch__break">
      <path
        className="pitch__break-gap"
        d={`M ${x - 22} ${BREAK_MID + 10 - d / 2} L ${x + 22} ${BREAK_MID - 10 - d / 2} L ${x + 22} ${BREAK_MID - 10 + d / 2} L ${x - 22} ${BREAK_MID + 10 + d / 2} Z`}
      />
      <path d={stroke(-d / 2)} />
      <path d={stroke(d / 2)} />
    </g>
  );
}

interface PitchProps {
  formation: Formation;
  format: SquadFormat;
  /** Rendered once per slot, absolutely positioned at the slot. */
  renderSlot: (slot: FormationSlot) => ReactNode;
  /** Positions the team has dragged into place, overriding the automatic layout. */
  positions?: Record<string, PitchPosition>;
}

export function Pitch({ formation, format, renderSlot, positions }: PitchProps) {
  const placed = placeAll(formation.slots, DIAMETER, positions);
  const style = { '--token': `${TOKEN_SIZE}cqw`, aspectRatio: `${VIEW.w} / ${VIEW.h}` } as CSSProperties;
  return (
    <div className={`pitch pitch--${format}`} style={style} data-drop="pitch">
      <svg
        className="pitch__svg"
        viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
        role="img"
        aria-label="Hockey pitch, attacking towards the top"
      >
        <defs>
          <pattern id="goal-net" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" className="pitch__net-bg" />
            <path d="M 0 0 L 0 6 M 0 0 L 6 0" className="pitch__net-line" />
          </pattern>
        </defs>

        <rect x={VIEW.x} y={VIEW.y} width={VIEW.w} height={VIEW.h} className="pitch__surround" rx="18" />

        {BANDS.map((band, i) => (
          <rect
            key={band.label}
            x={0}
            y={band.y}
            width={600}
            height={band.h}
            className={i % 2 === 0 ? 'pitch__band' : 'pitch__band pitch__band--alt'}
          />
        ))}
        <rect x={0} y={ATTACK_END} width={600} height={HALFWAY - ATTACK_END} className="pitch__gap" />

        <g className="pitch__lines">
          {/* Attacking area: back line, sides, 23 m line */}
          <path d={`M 0 ${ATTACK_END} V 0 H 600 V ${ATTACK_END}`} />
          <line x1={0} y1={ATTACK_END} x2={600} y2={ATTACK_END} />
          {/* Our half: halfway line, sides, back line, 23 m line */}
          <path d={`M 0 ${HALFWAY} V ${BASELINE} H 600 V ${HALFWAY}`} />
          <line x1={0} y1={HALFWAY} x2={600} y2={HALFWAY} />
          <line x1={0} y1={OUR_23} x2={600} y2={OUR_23} className="pitch__marking" />
          <circle cx={300} cy={HALFWAY} r={4} className="pitch__spot" />

          {/* Attacking shooting circle (top) */}
          <path d="M 120 0 A 160 160 0 0 0 280 160 L 320 160 A 160 160 0 0 0 480 0" className="pitch__d--attack" />
          <circle cx={300} cy={70} r={4} className="pitch__spot" />

          {/* Our shooting circle (bottom) */}
          <path
            d={`M 120 ${BASELINE} A 160 160 0 0 1 280 ${BASELINE - 160} L 320 ${BASELINE - 160} A 160 160 0 0 1 480 ${BASELINE}`}
            className="pitch__marking"
          />

          {/* Back-line marks, pointing into the pitch */}
          {TICKS.map((x) => (
            <g key={x}>
              <line x1={x} y1={0} x2={x} y2={12} />
              <line x1={x} y1={BASELINE} x2={x} y2={BASELINE - 12} className="pitch__marking" />
            </g>
          ))}
        </g>

        <BreakMark x={0} />
        <BreakMark x={600} />

        <rect x={GOAL.x} y={-GOAL.depth} width={GOAL.w} height={GOAL.depth} className="pitch__goal" />
        <rect x={GOAL.x} y={BASELINE} width={GOAL.w} height={GOAL.depth} className="pitch__goal" />

        {BANDS.map((band) => (
          <text
            key={band.label}
            className="pitch__band-label"
            transform={`translate(14 ${band.y + band.h / 2}) rotate(-90)`}
            textAnchor="middle"
          >
            {band.label.toUpperCase()}
          </text>
        ))}

        <g className="pitch__direction" transform={`translate(586 ${(HALFWAY + OUR_23) / 2})`}>
          <line x1={0} y1={60} x2={0} y2={-60} />
          <path d="M -9 -46 L 0 -62 L 9 -46" />
        </g>
      </svg>

      <div className="pitch__slots">
        {placed.map(({ slot, x, y }) => (
          <div
            key={slot.id}
            className="pitch__slot"
            data-slot={slot.id}
            style={{ left: `${((x - VIEW.x) / VIEW.w) * 100}%`, top: `${((y - VIEW.y) / VIEW.h) * 100}%` }}
          >
            {renderSlot(slot)}
          </div>
        ))}
      </div>
    </div>
  );
}
