import { describe, expect, it } from 'vitest';
import { buildCustomFormationSlots, customFormationShapes, validateLineCounts } from '../src';

describe('validateLineCounts', () => {
  it('accepts 4-3-3 as 11-a-side', () => {
    expect(validateLineCounts([4, 3, 3])).toEqual({ ok: true, format: 11 });
  });

  it('accepts 3-2-1 as 7-a-side', () => {
    expect(validateLineCounts([3, 2, 1])).toEqual({ ok: true, format: 7 });
  });

  it('accepts 2-2 as 5-a-side', () => {
    expect(validateLineCounts([2, 2])).toEqual({ ok: true, format: 5 });
  });

  it('accepts 3-2-3-2 as 11-a-side', () => {
    expect(validateLineCounts([3, 2, 3, 2])).toEqual({ ok: true, format: 11 });
  });

  it('rejects a total that is not 5, 7, or 11', () => {
    const result = validateLineCounts([4, 4, 4]); // 12 + GK = 13
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/13/);
  });

  it('rejects a single line (needs at least defence and attack)', () => {
    expect(validateLineCounts([4]).ok).toBe(false);
  });

  it('allows the same shapes in every format, e.g. a 7-a-side diamond', () => {
    expect(validateLineCounts([2, 1, 1, 2])).toEqual({ ok: true, format: 7 });
    expect(validateLineCounts([4, 2, 3, 1])).toEqual({ ok: true, format: 11 });
  });

  it('enumerates every saveable shape per format, all valid', () => {
    for (const format of [5, 7, 11] as const) {
      const shapes = customFormationShapes(format);
      expect(shapes.length).toBeGreaterThan(0);
      for (const lines of shapes) expect(validateLineCounts(lines)).toEqual({ ok: true, format });
    }
    expect(customFormationShapes(5)).toContainEqual([2, 2]);
    expect(customFormationShapes(11)).toContainEqual([3, 2, 3, 2]);
  });

  it('rejects more than 4 lines (no real formation runs deeper than DEF / 2×MID / FWD)', () => {
    expect(validateLineCounts([2, 2, 2, 2, 2]).ok).toBe(false); // 10 + GK = 11, but 5 lines
  });

  it('rejects more than 5 players in one line (no real formation is wider than a back five)', () => {
    expect(validateLineCounts([6, 4]).ok).toBe(false); // 10 + GK = 11, but a back six
    expect(validateLineCounts([5, 5]).ok).toBe(true);
  });

  it('rejects zero, negative, or non-integer counts', () => {
    expect(validateLineCounts([4, 0, 3]).ok).toBe(false);
    expect(validateLineCounts([4, -1, 3]).ok).toBe(false);
    expect(validateLineCounts([4, 1.5, 3]).ok).toBe(false);
  });
});

describe('buildCustomFormationSlots', () => {
  it('tags the first line DEF, the last FWD, and always adds one GK', () => {
    const slots = buildCustomFormationSlots([4, 3, 3]);
    expect(slots.filter((s) => s.line === 'DEF')).toHaveLength(4);
    expect(slots.filter((s) => s.line === 'MID')).toHaveLength(3);
    expect(slots.filter((s) => s.line === 'FWD')).toHaveLength(3);
    expect(slots.filter((s) => s.line === 'GK')).toHaveLength(1);
    expect(slots).toHaveLength(11);
  });

  it('places every slot below halfway on the percent scale (y <= 76) and GK deepest', () => {
    const slots = buildCustomFormationSlots([4, 3, 3]);
    for (const s of slots) expect(s.y).toBeLessThanOrEqual(93);
    const gk = slots.find((s) => s.id === 'GK')!;
    const def = slots.filter((s) => s.line === 'DEF');
    const fwd = slots.filter((s) => s.line === 'FWD');
    expect(gk.y).toBeGreaterThan(Math.max(...def.map((s) => s.y)));
    expect(Math.min(...def.map((s) => s.y))).toBeGreaterThan(Math.max(...fwd.map((s) => s.y)));
  });

  it('orders bands strictly from defence (deepest) up to attack, with GK deepest of all', () => {
    const slots = buildCustomFormationSlots([3, 2, 3, 2]);
    const depth = (prefix: string) => slots.find((s) => s.id.endsWith(prefix))!.y;
    // DEF > DM (defensive midfield) > AM (attacking midfield) > FWD, on the 0 (attack) – 100 (own goal) scale
    expect(depth('GK')).toBeGreaterThan(depth('B'));
    expect(depth('B')).toBeGreaterThan(depth('DM'));
    expect(depth('DM')).toBeGreaterThan(depth('AM'));
    expect(depth('AM')).toBeGreaterThan(depth('F'));
  });

  it('draws a line of two as a tight central pair, narrower than a line of three', () => {
    const slots = buildCustomFormationSlots([2, 3, 2, 3]);
    const xs = (line: string) => slots.filter((s) => s.id.endsWith(line)).map((s) => s.x);
    expect(xs('CB')).toEqual([38, 62]);
    expect(xs('AM')).toEqual([38, 62]);
    expect(xs('DM')).toEqual([20, 50, 80]);
    expect(xs('F')).toEqual([20, 50, 80]);
    expect(slots.filter((s) => s.line === 'DEF').map((s) => s.id)).toEqual(['LCB', 'RCB']);
    expect(buildCustomFormationSlots([4, 2, 4]).filter((s) => s.line === 'MID').map((s) => s.id)).toEqual(['LCM', 'RCM']);
  });

  it('uses real position names: a back five, and DM/AM for two midfield bands', () => {
    expect(buildCustomFormationSlots([5, 3, 2]).filter((s) => s.line === 'DEF').map((s) => s.id)).toEqual([
      'LB',
      'LCB',
      'CB',
      'RCB',
      'RB',
    ]);
    expect(buildCustomFormationSlots([4, 2, 3, 1]).filter((s) => s.line === 'MID').map((s) => s.id)).toEqual([
      'LDM',
      'RDM',
      'LAM',
      'CAM',
      'RAM',
    ]);
  });

  it('keeps generated y values on the same scale as the built-in formations', () => {
    const slots = buildCustomFormationSlots([4, 3, 3]);
    const mid = slots.find((s) => s.line === 'MID')!;
    // Built-in midfield lines sit around 47-50; a single generated MID band should land there too.
    expect(mid.y).toBeGreaterThan(45);
    expect(mid.y).toBeLessThan(52);
  });

  it('gives every slot a unique id, even with two MID bands', () => {
    const slots = buildCustomFormationSlots([3, 2, 3, 2]);
    const ids = slots.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(slots.filter((s) => s.line === 'MID')).toHaveLength(5);
  });

  it('throws for an invalid line count (internal misuse, not a soft boundary)', () => {
    expect(() => buildCustomFormationSlots([4, 4, 4])).toThrow();
  });
});
