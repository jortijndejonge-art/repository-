import type { ImportRow, PositionLine } from '@hockey/contracts';

/** What a spreadsheet column holds, once we have worked it out. */
export type ImportField =
  | 'firstName'
  | 'lastName'
  | 'fullName'
  | 'email'
  | 'phone'
  | 'team'
  | 'shirtNumber'
  | 'positions'
  | 'guardianEmail'
  | 'guardianName';

export type ColumnMapping = Partial<Record<ImportField, number>>;

/** A line from the sheet that could not be imported, with the reason in plain words. */
export interface RowProblem {
  /** 1-based line number in the file, counting the header row. */
  line: number;
  reason: string;
}

export interface MappedRows {
  rows: (ImportRow & { team?: string; line: number })[];
  problems: RowProblem[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();

/** Header names that mean each field, as exported by Spond, Teamo, TeamSnap, Excel sheets and so on. */
const SYNONYMS: Record<ImportField, string[]> = {
  firstName: ['first name', 'firstname', 'first', 'forename', 'given name', 'given names', 'christian name'],
  lastName: ['last name', 'lastname', 'last', 'surname', 'family name', 'second name'],
  fullName: ['name', 'full name', 'member', 'member name', 'player', 'player name', 'child', 'child name'],
  email: ['email', 'e mail', 'email address', 'e mail address', 'member email', 'player email', 'contact email'],
  phone: ['phone', 'mobile', 'telephone', 'tel', 'phone number', 'mobile number', 'cell', 'contact number'],
  team: ['team', 'teams', 'group', 'groups', 'age group', 'squad', 'section', 'category'],
  shirtNumber: ['shirt', 'shirt number', 'shirt no', 'number', 'no', '#', 'squad number', 'kit number', 'jersey', 'jersey number'],
  positions: ['position', 'positions', 'pos', 'preferred position', 'role on pitch'],
  guardianEmail: [
    'parent email',
    'guardian email',
    'parent guardian email',
    'parents email',
    'email parent',
    'email guardian',
    'parent e mail',
    'guardian e mail',
    'primary contact email',
    'contact 1 email',
  ],
  guardianName: ['parent name', 'guardian name', 'parent guardian name', 'parents name', 'parent', 'guardian', 'primary contact', 'contact 1 name'],
};

/** Split a pasted or exported CSV into rows of cells. Copes with a BOM, quotes, commas inside quotes, CRLF and blank lines. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const count = (ch: string) => firstLine.split(ch).length - 1;
  // Excel in much of Europe writes semicolons, and pasting from a sheet gives tabs.
  const delimiter = [',', ';', '\t'].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ',');

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]!;
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Guess which column is which from the header row. Anything it cannot place is left for the person to choose. */
export function detectColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const taken = new Set<number>();
  // Most specific fields first, so "Parent email" is not mistaken for the player's own "email".
  const order: ImportField[] = ['guardianEmail', 'guardianName', 'firstName', 'lastName', 'email', 'phone', 'team', 'shirtNumber', 'positions', 'fullName'];
  for (const field of order) {
    const at = headers.findIndex((h, i) => !taken.has(i) && SYNONYMS[field].includes(norm(h)));
    if (at >= 0) {
      mapping[field] = at;
      taken.add(at);
    }
  }
  // "Name" alone is only a full name when there is no separate first/last name.
  if (mapping.fullName !== undefined && (mapping.firstName !== undefined || mapping.lastName !== undefined)) delete mapping.fullName;
  return mapping;
}

const POSITION_WORDS: [RegExp, PositionLine][] = [
  [/\b(gk|goal ?keeper|goalie|keeper|goal)\b/, 'GK'],
  [/\b(def|defen[cs]e|defender|back|backs|fullback|full back|sweeper|cb)\b/, 'DEF'],
  [/\b(mid|midfield|midfielder|half|halves|link|cm)\b/, 'MID'],
  [/\b(fwd|forward|forwards|striker|attack|attacker|winger|wing|cf)\b/, 'FWD'],
];

/** "Goalkeeper / Defender" or "GK, DEF" into position lines, in the order written, without repeats. */
export function parsePositions(value: string): PositionLine[] {
  const found: PositionLine[] = [];
  for (const part of value.toLowerCase().split(/[\/,;|&+]| and /)) {
    for (const [pattern, line] of POSITION_WORDS) {
      if (pattern.test(part.trim()) && !found.includes(line)) found.push(line);
    }
  }
  return found;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Title-case a name that arrived in capitals or lower case, leaving mixed-case names such as "McDonald" alone. */
function tidyName(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t === t.toUpperCase() || t === t.toLowerCase() ? t.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase()) : t;
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = tidyName(full).split(' ');
  if (parts.length === 1) return { firstName: parts[0]!, lastName: '' };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(' ') };
}

/** Turn the data rows into players, reporting (not stopping at) the ones that cannot be used. */
export function mapRows(data: string[][], mapping: ColumnMapping, opts: { emailIsParent?: boolean } = {}): MappedRows {
  const cell = (row: string[], field: ImportField) => (mapping[field] === undefined ? '' : (row[mapping[field]!] ?? '').trim());
  const rows: MappedRows['rows'] = [];
  const problems: RowProblem[] = [];
  const seenEmails = new Set<string>();

  data.forEach((raw, i) => {
    const line = i + 2; // the header is line 1
    let { firstName, lastName } = mapping.fullName !== undefined ? splitName(cell(raw, 'fullName')) : { firstName: tidyName(cell(raw, 'firstName')), lastName: tidyName(cell(raw, 'lastName')) };
    if (!firstName) {
      problems.push({ line, reason: 'No first name' });
      return;
    }
    if (!lastName) lastName = '-';

    let email = cell(raw, 'email').toLowerCase();
    let guardianEmail = cell(raw, 'guardianEmail').toLowerCase();
    if (opts.emailIsParent && email) {
      guardianEmail ||= email;
      email = '';
    }
    for (const [label, value] of [['email', email], ['parent email', guardianEmail]] as const) {
      if (value && !EMAIL.test(value)) {
        problems.push({ line, reason: `"${value}" is not a valid ${label}` });
        return;
      }
    }
    if (email) {
      if (seenEmails.has(email)) {
        problems.push({ line, reason: `${email} appears more than once in the file` });
        return;
      }
      seenEmails.add(email);
    }

    const shirt = cell(raw, 'shirtNumber').replace(/[^0-9]/g, '');
    const phone = cell(raw, 'phone');
    const guardianName = cell(raw, 'guardianName');
    const guardian = guardianName ? splitName(guardianName) : undefined;
    const positions = parsePositions(cell(raw, 'positions'));
    const team = cell(raw, 'team');

    rows.push({
      line,
      firstName,
      lastName,
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      ...(shirt !== '' && Number(shirt) <= 999 ? { shirtNumber: Number(shirt) } : {}),
      ...(positions.length ? { positions } : {}),
      ...(guardianEmail ? { guardianEmail } : {}),
      ...(guardian ? { guardianFirstName: guardian.firstName, guardianLastName: guardian.lastName || lastName } : {}),
      ...(team ? { team } : {}),
    });
  });
  return { rows, problems };
}

/** Find which of the club's teams a spreadsheet's "team" cell means, ignoring case and spacing; undefined if unclear. */
export function matchTeamName<T extends { id: string; name: string }>(cellValue: string, teams: T[]): T | undefined {
  const want = norm(cellValue);
  if (!want) return undefined;
  const exact = teams.filter((t) => norm(t.name) === want);
  if (exact.length === 1) return exact[0];
  const contains = teams.filter((t) => norm(t.name).includes(want) || want.includes(norm(t.name)));
  return contains.length === 1 ? contains[0] : undefined;
}
