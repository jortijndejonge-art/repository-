import type { ReactNode } from 'react';
import type { Formation, FormationSlot, SquadFormat } from '@hockey/contracts';
import './pitch.css';

/*
 * Shortened pitch, in SVG units (~10.9 units per metre), 600 wide, attacking
 * upwards. The attacking 23 m area is shown at the top, then a break (//)
 * stands in for the stretch up to halfway, then our full half:
 *
 *   0 ─ attacking back line
 *   0–252     ATTACK   (attacking D + 23 m area)
 *   252–316   break    (the "//" gap)
 *   316       halfway line
 *   316–568   MIDFIELD (halfway → our 23 m line)
 *   568–814   DEFENCE  (our 23 m line → our back line and D)
 */
const ATTACK_END = 252;
const HALFWAY = 316;
const OUR_23 = 568;
const BASELINE = 814;
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

/**
 * Map a formation's y (0–100, bands at 33 / 66) onto the shortened pitch,
 * skipping the break so every line lands in its labelled band. In defence the
 * back line sits just below our 23 m line and the keeper high enough in the D
 * that their name stays on the pitch — room for both even at 5-a-side.
 */
const Y_ANCHORS: [number, number][] = [
  [0, 0],
  [33, ATTACK_END],
  [33, HALFWAY],
  [66, OUR_23],
  [80, 612],
  [100, 808],
];

function pitchY(y: number) {
  for (let i = 1; i < Y_ANCHORS.length; i++) {
    const [y0, p0] = Y_ANCHORS[i - 1]!;
    const [y1, p1] = Y_ANCHORS[i]!;
    if (y <= y1 && y1 > y0) return p0 + ((Math.max(y, y0) - y0) / (y1 - y0)) * (p1 - p0);
  }
  return BASELINE;
}

/** Convert a formation slot (percent) to CSS left/top percent over the SVG. */
export function slotPosition(slot: Pick<FormationSlot, 'x' | 'y'>) {
  return {
    left: `${((slot.x * 6 - VIEW.x) / VIEW.w) * 100}%`,
    top: `${((pitchY(slot.y) - VIEW.y) / VIEW.h) * 100}%`,
  };
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
}

export function Pitch({ formation, format, renderSlot }: PitchProps) {
  return (
    <div className={`pitch pitch--${format}`}>
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
          <line x1={0} y1={OUR_23} x2={600} y2={OUR_23} className="pitch__line--quarter" />
          <circle cx={300} cy={HALFWAY} r={4} className="pitch__spot" />

          {/* Attacking shooting circle (top) */}
          <path d="M 120 0 A 160 160 0 0 0 280 160 L 320 160 A 160 160 0 0 0 480 0" className="pitch__d--attack" />
          <circle cx={300} cy={70} r={4} className="pitch__spot" />

          {/* Our shooting circle (bottom) */}
          <path
            d={`M 120 ${BASELINE} A 160 160 0 0 1 280 ${BASELINE - 160} L 320 ${BASELINE - 160} A 160 160 0 0 1 480 ${BASELINE}`}
          />

          {/* Back-line marks, pointing into the pitch */}
          {TICKS.map((x) => (
            <g key={x}>
              <line x1={x} y1={0} x2={x} y2={12} />
              <line x1={x} y1={BASELINE} x2={x} y2={BASELINE - 12} />
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
        {formation.slots.map((slot) => (
          <div key={slot.id} className="pitch__slot" style={slotPosition(slot)}>
            {renderSlot(slot)}
          </div>
        ))}
      </div>
    </div>
  );
}
