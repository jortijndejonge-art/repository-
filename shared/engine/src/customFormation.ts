import type { FormationSlot, PositionLine, SquadFormat } from '@hockey/contracts';

/**
 * Coaches type line counts defence-first through attack (e.g. [4, 3, 3] for
 * "4-3-3"), matching how the built-in formations already read: the first
 * number is defence, the last is attack, everything between is midfield.
 * The goalkeeper is implicit and always added on top.
 */
export type LineCountCheck = { ok: true; format: SquadFormat } | { ok: false; error: string };

/** Real formations never run deeper than defence/two-midfield-bands/attack, or wider than a back (or front) five. */
const MAX_LINES = 4;
const MAX_PER_LINE = 5;

export function validateLineCounts(lines: number[]): LineCountCheck {
  if (!Array.isArray(lines) || lines.length < 2 || lines.length > MAX_LINES) {
    return { ok: false, error: `Enter between 2 and ${MAX_LINES} lines, defence through attack.` };
  }
  if (!lines.every((n) => Number.isInteger(n) && n > 0 && n <= MAX_PER_LINE)) {
    return { ok: false, error: `Each line must be a whole number of players, 1 to ${MAX_PER_LINE}.` };
  }
  const outfield = lines.reduce((a, b) => a + b, 0);
  const total = outfield + 1;
  if (total !== 5 && total !== 7 && total !== 11) {
    return { ok: false, error: `That's ${total} players including the goalkeeper — must total 5, 7, or 11.` };
  }
  return { ok: true, format: total as SquadFormat };
}

/** Every line-count combination a coach could save for this format. */
export function customFormationShapes(format: SquadFormat): number[][] {
  const shapes: number[][] = [];
  const extend = (lines: number[]) => {
    const check = lines.length >= 2 ? validateLineCounts(lines) : null;
    if (check?.ok && check.format === format) shapes.push(lines);
    if (lines.length < MAX_LINES) for (let n = 1; n <= MAX_PER_LINE; n++) extend([...lines, n]);
  };
  extend([]);
  return shapes;
}

/**
 * Where a line of `count` players stands, as % across the pitch, the way real
 * formations line up: a pair is a tight central pair (two centre-backs, two
 * central mids, a front two) — the same 38/62 the built-in back four uses for
 * its centre-backs — while lines of three or more spread to the flanks.
 */
export const LINE_X: Record<number, number[]> = {
  1: [50],
  2: [38, 62],
  3: [20, 50, 80],
  4: [14, 38, 62, 86],
  5: [10, 30, 50, 70, 90],
};

/** Position codes for a band of `count` players, e.g. 4 -> ['L', 'LC', 'RC', 'R']. */
const POSITION_CODES: Record<number, string[]> = {
  1: ['C'],
  2: ['L', 'R'],
  3: ['L', 'C', 'R'],
  4: ['L', 'LC', 'RC', 'R'],
  5: ['L', 'LC', 'C', 'RC', 'R'],
};

/** A central pair of defenders or midfielders are centre-backs / centre-mids: LCB, RCB, LCM, RCM. */
function codesFor(count: number, suffix: string) {
  return count === 2 && (suffix === 'B' || suffix === 'M') ? ['LC', 'RC'] : POSITION_CODES[count]!;
}

/**
 * y on the same 0–100 scale as the hand-authored formations (0 = attacking
 * end, 100 = own goal). The pitch lays rows out evenly by their order, so
 * these just need to sort correctly and sit clearly apart from each other.
 */
function originalScaleY(i: number, total: number): number {
  if (i === 0) return 74; // DEF — matches the hand-authored formations (~72-77)
  if (i === total - 1) return 20; // FWD — matches the hand-authored formations (~17-26)
  // Middle bands spread through the 33–66 midfield slice; nearer defence (low i) sits deeper.
  const midCount = total - 2;
  return 33 + (midCount + 1 - i) * (33 / (midCount + 1));
}

/**
 * Builds the slots for a validated set of line counts. Assumes
 * `validateLineCounts` already accepted `lines` — throws otherwise, since
 * this is a shared internal helper, not a boundary that needs a soft error.
 */
export function buildCustomFormationSlots(lines: number[]): FormationSlot[] {
  const check = validateLineCounts(lines);
  if (!check.ok) throw new Error(check.error);

  // With two midfield bands (MAX_LINES allows at most two), the deeper one is
  // defensive midfield and the higher one attacking midfield — e.g. LDM, CAM.
  const twoMidBands = lines.length === 4;
  const slots: FormationSlot[] = [];

  lines.forEach((count, i) => {
    const isFirst = i === 0;
    const isLast = i === lines.length - 1;
    const line: PositionLine = isFirst ? 'DEF' : isLast ? 'FWD' : 'MID';
    const suffix = isFirst ? 'B' : isLast ? 'F' : twoMidBands ? (i === 1 ? 'DM' : 'AM') : 'M';
    const y = originalScaleY(i, lines.length);
    codesFor(count, suffix).forEach((code, j) => {
      const id = `${code}${suffix}`;
      slots.push({ id, label: id, line, x: LINE_X[count]![j]!, y });
    });
  });

  slots.push({ id: 'GK', label: 'GK', line: 'GK', x: 50, y: 93 });
  return slots;
}
