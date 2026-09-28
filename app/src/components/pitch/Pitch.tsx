import type { ReactNode } from 'react';
import type { Formation, FormationSlot, SquadFormat } from '@hockey/contracts';
import './pitch.css';

/*
 * Pitch geometry, in SVG units (~10.9 units per metre): 600 wide × 1000 long,
 * drawn attacking upwards. y = 0 is the attacking end, y = 1000 our own goal.
 */
const VIEW = { x: -24, y: -36, w: 648, h: 1072 };
const BANDS = [
  { label: 'Forwards', y: 0, h: 333 },
  { label: 'Midfield', y: 333, h: 334 },
  { label: 'Defence', y: 667, h: 333 },
];

/** Convert a formation slot (percent) to CSS left/top percent over the SVG. */
export function slotPosition(slot: Pick<FormationSlot, 'x' | 'y'>) {
  return {
    left: `${((slot.x * 6 - VIEW.x) / VIEW.w) * 100}%`,
    top: `${((slot.y * 10 - VIEW.y) / VIEW.h) * 100}%`,
  };
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

        <g className="pitch__lines">
          <rect x={0} y={0} width={600} height={1000} />
          <line x1={0} y1={500} x2={600} y2={500} />
          <line x1={0} y1={252} x2={600} y2={252} className="pitch__line--quarter" />
          <line x1={0} y1={748} x2={600} y2={748} className="pitch__line--quarter" />

          {/* Attacking shooting circle (top) */}
          <path d="M 120 0 A 160 160 0 0 0 280 160 L 320 160 A 160 160 0 0 0 480 0" className="pitch__d--attack" />
          <path d="M 65 0 A 215 215 0 0 0 280 215 L 320 215 A 215 215 0 0 0 535 0" className="pitch__dashed" />
          <circle cx={300} cy={70} r={4} className="pitch__spot" />

          {/* Our defending circle (bottom) */}
          <path d="M 120 1000 A 160 160 0 0 1 280 840 L 320 840 A 160 160 0 0 1 480 1000" />
          <path d="M 65 1000 A 215 215 0 0 1 280 785 L 320 785 A 215 215 0 0 1 535 1000" className="pitch__dashed" />
          <circle cx={300} cy={930} r={4} className="pitch__spot" />
        </g>

        <rect x={278} y={-16} width={44} height={16} className="pitch__goal pitch__goal--attack" />
        <rect x={278} y={1000} width={44} height={16} className="pitch__goal pitch__goal--own" />

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

        <text x={300} y={-20} className="pitch__end-label" textAnchor="middle">
          ATTACKING ▲
        </text>
        <text x={300} y={1032} className="pitch__end-label pitch__end-label--own" textAnchor="middle">
          OUR GOAL
        </text>

        <g className="pitch__direction" transform="translate(586 500)">
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
