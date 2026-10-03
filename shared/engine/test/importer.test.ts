import { describe, expect, it } from 'vitest';
import { detectColumns, mapRows, matchTeamName, parseCsv, parsePositions } from '../src';

describe('parseCsv', () => {
  it('reads commas, quoted cells with commas and quotes, CRLF line ends and a byte-order mark', () => {
    const rows = parseCsv('﻿Name,Notes\r\n"Smith, Jo","said ""hi"""\r\nAli,plain\r\n');
    expect(rows).toEqual([
      ['Name', 'Notes'],
      ['Smith, Jo', 'said "hi"'],
      ['Ali', 'plain'],
    ]);
  });

  it('detects semicolons (European Excel) and tabs (pasted from a sheet)', () => {
    expect(parseCsv('First name;Last name\nJo;Smith')).toEqual([['First name', 'Last name'], ['Jo', 'Smith']]);
    expect(parseCsv('First name\tLast name\nJo\tSmith')).toEqual([['First name', 'Last name'], ['Jo', 'Smith']]);
  });

  it('skips blank lines and copes with a missing final newline', () => {
    expect(parseCsv('a,b\n\n1,2\n\n3,4')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
  });

  it('keeps a newline inside a quoted cell', () => {
    expect(parseCsv('a,b\n"line1\nline2",x')[1]).toEqual(['line1\nline2', 'x']);
  });
});

describe('detectColumns', () => {
  it('recognises the usual headings whatever the case or punctuation', () => {
    const m = detectColumns(['First Name', 'SURNAME', 'E-mail address', 'Mobile', 'Group', 'Shirt No.', 'Position']);
    expect(m).toEqual({ firstName: 0, lastName: 1, email: 2, phone: 3, team: 4, shirtNumber: 5, positions: 6 });
  });

  it("does not mistake a parent's email for the player's, and keeps both when both are present", () => {
    expect(detectColumns(['Name', 'Parent email'])).toEqual({ fullName: 0, guardianEmail: 1 });
    expect(detectColumns(['First name', 'Last name', 'Email', 'Parent Email', 'Parent name'])).toEqual({
      firstName: 0,
      lastName: 1,
      email: 2,
      guardianEmail: 3,
      guardianName: 4,
    });
  });

  it('treats "Name" as a full name only when there is no first/last name', () => {
    expect(detectColumns(['Name', 'First name', 'Last name']).fullName).toBeUndefined();
    expect(detectColumns(['Name', 'Email']).fullName).toBe(0);
  });

  it('leaves unknown columns unmapped', () => {
    expect(detectColumns(['Favourite colour', 'Shoe size'])).toEqual({});
  });
});

describe('parsePositions', () => {
  it('reads words, abbreviations and several positions in the order written', () => {
    expect(parsePositions('Goalkeeper')).toEqual(['GK']);
    expect(parsePositions('Defender / Midfield')).toEqual(['DEF', 'MID']);
    expect(parsePositions('striker, mid & back')).toEqual(['FWD', 'MID', 'DEF']);
    expect(parsePositions('GK, GK')).toEqual(['GK']);
    expect(parsePositions('')).toEqual([]);
    expect(parsePositions('captain')).toEqual([]);
  });
});

describe('mapRows', () => {
  const header = ['First name', 'Last name', 'Email', 'Shirt', 'Position', 'Team'];
  const mapping = detectColumns(header);

  it('builds players, tidying shouty names and numbers', () => {
    const { rows, problems } = mapRows(
      [['JO', 'smith', 'JO@Example.com', '#7', 'Forward', 'U12 Girls'], ['Aoife', "O'Neill", '', '', '', '']],
      mapping,
    );
    expect(problems).toEqual([]);
    expect(rows[0]).toMatchObject({ firstName: 'Jo', lastName: 'Smith', email: 'jo@example.com', shirtNumber: 7, positions: ['FWD'], team: 'U12 Girls', line: 2 });
    expect(rows[1]).toMatchObject({ firstName: 'Aoife', lastName: "O'Neill" });
    expect(rows[1]).not.toHaveProperty('email');
  });

  it('leaves mixed-case names alone and uses a dash when there is no last name', () => {
    const { rows } = mapRows([['Ciara', 'McDonald'], ['Sam', '']], detectColumns(['First name', 'Last name']));
    expect(rows[0]!.lastName).toBe('McDonald');
    expect(rows[1]!.lastName).toBe('-');
  });

  it('splits a single full-name column', () => {
    const { rows } = mapRows([['Mary Anne van Dyk']], { fullName: 0 });
    expect(rows[0]).toMatchObject({ firstName: 'Mary', lastName: 'Anne van Dyk' });
  });

  it('reports bad rows with their line number and carries on with the good ones', () => {
    const { rows, problems } = mapRows(
      [['Jo', 'A', 'jo@x.com'], ['', 'B', ''], ['Al', 'C', 'not-an-email'], ['Bo', 'D', 'jo@x.com'], ['Cy', 'E', 'cy@x.com']],
      detectColumns(['First name', 'Last name', 'Email']),
    );
    expect(rows.map((r) => r.firstName)).toEqual(['Jo', 'Cy']);
    expect(problems.map((p) => [p.line, p.reason.split(' ').slice(0, 3).join(' ')])).toEqual([
      [3, 'No first name'],
      [4, '"not-an-email" is not'],
      [5, 'jo@x.com appears more'],
    ]);
  });

  it("treats the email column as the parent's when asked (children often have their parent's address)", () => {
    const { rows } = mapRows([['Kit', 'Young', 'pat@x.com'], ['Sam', 'Young', 'pat@x.com']], detectColumns(['First name', 'Last name', 'Email']), { emailIsParent: true });
    expect(rows).toHaveLength(2); // two children sharing one parent address is fine
    expect(rows[0]).toMatchObject({ guardianEmail: 'pat@x.com' });
    expect(rows[0]).not.toHaveProperty('email');
  });

  it('keeps parent details, defaulting the parent surname to the child', () => {
    const { rows } = mapRows([['Kit', 'Young', 'pat@x.com', 'Pat']], detectColumns(['First name', 'Last name', 'Parent email', 'Parent name']));
    expect(rows[0]).toMatchObject({ guardianEmail: 'pat@x.com', guardianFirstName: 'Pat', guardianLastName: 'Young' });
  });
});

describe('matchTeamName', () => {
  const teams = [
    { id: 'a', name: 'U12 Boys' },
    { id: 'b', name: 'U12 Girls' },
    { id: 'c', name: 'Adult Team 1' },
  ];
  it('matches ignoring case and spacing, or a unique partial match', () => {
    expect(matchTeamName('u12  boys', teams)?.id).toBe('a');
    expect(matchTeamName('Girls U12', teams)).toBeUndefined(); // word order differs and there is no unique substring
    expect(matchTeamName('Adult Team 1', teams)?.id).toBe('c');
    expect(matchTeamName('adult', teams)?.id).toBe('c');
  });
  it('gives up when it is ambiguous or empty', () => {
    expect(matchTeamName('U12', teams)).toBeUndefined();
    expect(matchTeamName('', teams)).toBeUndefined();
  });
});
