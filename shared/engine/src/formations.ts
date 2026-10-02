import type { Formation, SquadFormat } from '@hockey/contracts';

/**
 * Formations are drawn on one half-view of the pitch attacking upwards:
 * y = 0 is the attacking D (top), y = 100 is our own goal (bottom).
 * Zone bands: forwards 0–33, midfield 33–66, defence 66–100.
 */
export const FORMATIONS: Formation[] = [
  {
    id: '5-1-2-1',
    name: '1-2-1 + GK',
    format: 5,
    slots: [
      { id: 'CF', label: 'CF', line: 'FWD', x: 50, y: 22 },
      { id: 'LM', label: 'LM', line: 'MID', x: 28, y: 48 },
      { id: 'RM', label: 'RM', line: 'MID', x: 72, y: 48 },
      { id: 'CB', label: 'CB', line: 'DEF', x: 50, y: 74 },
      { id: 'GK', label: 'GK', line: 'GK', x: 50, y: 92 },
    ],
  },
  {
    id: '5-2-2',
    name: '2-2 + GK',
    format: 5,
    slots: [
      { id: 'LF', label: 'LF', line: 'FWD', x: 30, y: 26 },
      { id: 'RF', label: 'RF', line: 'FWD', x: 70, y: 26 },
      { id: 'LB', label: 'LB', line: 'DEF', x: 30, y: 72 },
      { id: 'RB', label: 'RB', line: 'DEF', x: 70, y: 72 },
      { id: 'GK', label: 'GK', line: 'GK', x: 50, y: 92 },
    ],
  },
  {
    id: '7-2-2-2',
    name: '2-2-2 + GK',
    format: 7,
    slots: [
      { id: 'LF', label: 'LF', line: 'FWD', x: 32, y: 22 },
      { id: 'RF', label: 'RF', line: 'FWD', x: 68, y: 22 },
      { id: 'LM', label: 'LM', line: 'MID', x: 24, y: 48 },
      { id: 'RM', label: 'RM', line: 'MID', x: 76, y: 48 },
      { id: 'LB', label: 'LB', line: 'DEF', x: 32, y: 74 },
      { id: 'RB', label: 'RB', line: 'DEF', x: 68, y: 74 },
      { id: 'GK', label: 'GK', line: 'GK', x: 50, y: 92 },
    ],
  },
  {
    id: '7-3-2-1',
    name: '3-2-1 + GK',
    format: 7,
    slots: [
      { id: 'CF', label: 'CF', line: 'FWD', x: 50, y: 22 },
      { id: 'LM', label: 'LM', line: 'MID', x: 32, y: 48 },
      { id: 'RM', label: 'RM', line: 'MID', x: 68, y: 48 },
      { id: 'LB', label: 'LB', line: 'DEF', x: 20, y: 74 },
      { id: 'CB', label: 'CB', line: 'DEF', x: 50, y: 76 },
      { id: 'RB', label: 'RB', line: 'DEF', x: 80, y: 74 },
      { id: 'GK', label: 'GK', line: 'GK', x: 50, y: 92 },
    ],
  },
  {
    id: '11-4-3-3',
    name: '4-3-3 + GK',
    format: 11,
    slots: [
      { id: 'LW', label: 'LW', line: 'FWD', x: 18, y: 20 },
      { id: 'CF', label: 'CF', line: 'FWD', x: 50, y: 17 },
      { id: 'RW', label: 'RW', line: 'FWD', x: 82, y: 20 },
      { id: 'LM', label: 'LM', line: 'MID', x: 24, y: 48 },
      { id: 'CM', label: 'CM', line: 'MID', x: 50, y: 50 },
      { id: 'RM', label: 'RM', line: 'MID', x: 76, y: 48 },
      { id: 'LB', label: 'LB', line: 'DEF', x: 14, y: 74 },
      { id: 'LCB', label: 'LCB', line: 'DEF', x: 38, y: 77 },
      { id: 'RCB', label: 'RCB', line: 'DEF', x: 62, y: 77 },
      { id: 'RB', label: 'RB', line: 'DEF', x: 86, y: 74 },
      { id: 'GK', label: 'GK', line: 'GK', x: 50, y: 93 },
    ],
  },
  {
    id: '11-4-4-2',
    name: '4-4-2 + GK',
    format: 11,
    slots: [
      { id: 'LF', label: 'LF', line: 'FWD', x: 35, y: 20 },
      { id: 'RF', label: 'RF', line: 'FWD', x: 65, y: 20 },
      { id: 'LM', label: 'LM', line: 'MID', x: 13, y: 47 },
      { id: 'LCM', label: 'LCM', line: 'MID', x: 38, y: 50 },
      { id: 'RCM', label: 'RCM', line: 'MID', x: 62, y: 50 },
      { id: 'RM', label: 'RM', line: 'MID', x: 87, y: 47 },
      { id: 'LB', label: 'LB', line: 'DEF', x: 14, y: 74 },
      { id: 'LCB', label: 'LCB', line: 'DEF', x: 38, y: 77 },
      { id: 'RCB', label: 'RCB', line: 'DEF', x: 62, y: 77 },
      { id: 'RB', label: 'RB', line: 'DEF', x: 86, y: 74 },
      { id: 'GK', label: 'GK', line: 'GK', x: 50, y: 93 },
    ],
  },
];

export function formationsFor(format: SquadFormat): Formation[] {
  return FORMATIONS.filter((f) => f.format === format);
}

export function getFormation(id: string): Formation {
  const formation = FORMATIONS.find((f) => f.id === id);
  if (!formation) throw new Error(`Unknown formation: ${id}`);
  return formation;
}
