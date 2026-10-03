import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { ImportLogin, ImportResult, ImportRow, Team } from '@hockey/contracts';
import { detectColumns, mapRows, matchTeamName, parseCsv } from '@hockey/engine';
import type { ColumnMapping, ImportField } from '@hockey/engine';
import { api } from '../../api-client';
import './import.css';

const FIELDS: { field: ImportField; label: string; hint?: string }[] = [
  { field: 'firstName', label: 'First name' },
  { field: 'lastName', label: 'Last name' },
  { field: 'fullName', label: 'Full name', hint: 'Use this if first and last name are in one column.' },
  { field: 'email', label: 'Email' },
  { field: 'phone', label: 'Phone' },
  { field: 'team', label: 'Team', hint: 'Sends each person to the matching team.' },
  { field: 'shirtNumber', label: 'Shirt number' },
  { field: 'positions', label: 'Position' },
  { field: 'guardianEmail', label: 'Parent email' },
  { field: 'guardianName', label: 'Parent name' },
];

interface ImportPanelProps {
  teams: Team[];
  defaultTeamId: string;
  /** Called after players were created, so the squad list can refresh. */
  onImported: () => void;
  onClose: () => void;
}

function downloadLogins(logins: ImportLogin[]) {
  const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const csv = ['Name,Role,Email,Password', ...logins.map((l) => [l.name, l.role, l.email, l.password].map(quote).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'new-logins.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/** Bring a whole squad in from a spreadsheet (Spond, Teamo, Excel…): paste or upload, check the columns, import. */
export function ImportPanel({ teams, defaultTeamId, onImported, onClose }: ImportPanelProps) {
  const [text, setText] = useState('');
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [emailIsParent, setEmailIsParent] = useState(false);
  const [createLogins, setCreateLogins] = useState(false);
  const [teamId, setTeamId] = useState(defaultTeamId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ result: ImportResult; teamNames: string[] } | null>(null);

  const table = useMemo(() => parseCsv(text), [text]);
  const headers = table[0] ?? [];
  const data = table.slice(1);
  const headerKey = headers.join('\u0000');

  // A new file or paste: guess the columns again.
  useEffect(() => {
    setMapping(detectColumns(headers));
    // Only when the headings change, so a person's own choices are not overwritten while typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headerKey]);

  const mapped = useMemo(() => mapRows(data, mapping, { emailIsParent }), [data, mapping, emailIsParent]);
  const hasName = mapping.firstName !== undefined || mapping.fullName !== undefined;

  // Where each person goes: the Team column if there is one, otherwise the chosen team.
  const plan = useMemo(() => {
    const groups = new Map<string, ImportRow[]>();
    const unmatched: { line: number; reason: string }[] = [];
    for (const row of mapped.rows) {
      const { team: teamCell, line, ...person } = row as ImportRow & { team?: string; line: number };
      let target: Team | undefined = teams.find((t) => t.id === teamId);
      if (mapping.team !== undefined) {
        target = teamCell ? matchTeamName(teamCell, teams) : teams.find((t) => t.id === teamId);
        if (!target) {
          unmatched.push({ line, reason: `No team called "${teamCell}". Check the spelling, or ask for a Team column to be left out.` });
          continue;
        }
      }
      if (!target) continue;
      groups.set(target.id, [...(groups.get(target.id) ?? []), person]);
    }
    return { groups, unmatched };
  }, [mapped.rows, mapping.team, teams, teamId]);

  const importable = [...plan.groups.values()].flat();
  const total = importable.length;
  const problems = [...mapped.problems, ...plan.unmatched];
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? '';

  const readFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setText(await file.text());
    e.target.value = '';
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const combined: ImportResult = { created: 0, guardiansLinked: 0, skipped: [], logins: [] };
      const names: string[] = [];
      for (const [id, players] of plan.groups) {
        const res = await api.importPlayers(id, { players, createLogins });
        combined.created += res.created;
        combined.guardiansLinked += res.guardiansLinked;
        combined.skipped.push(...res.skipped.map((s) => ({ ...s, name: plan.groups.size > 1 ? `${s.name} (${teamName(id)})` : s.name })));
        combined.logins.push(...res.logins);
        names.push(teamName(id));
      }
      setResult({ result: combined, teamNames: names });
      if (combined.created > 0) onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The import did not finish. Nothing more was added.');
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    const r = result.result;
    return (
      <section className="import">
        <h2 className="import__heading">Import finished</h2>
        <p>
          Added <strong>{r.created}</strong> player{r.created === 1 ? '' : 's'} to {result.teamNames.join(', ') || 'the squad'}
          {r.guardiansLinked ? ` and linked ${r.guardiansLinked} parent${r.guardiansLinked === 1 ? '' : 's'}` : ''}.
        </p>
        {r.logins.length > 0 && (
          <div className="import__box">
            <h3>New sign-ins ({r.logins.length})</h3>
            <p className="muted small">These passwords are shown once. Download them and hand them out; everyone can change theirs in Account.</p>
            <button type="button" className="btn btn--primary" onClick={() => downloadLogins(r.logins)}>
              Download logins (CSV)
            </button>
            <ul className="import__list">
              {r.logins.slice(0, 8).map((l) => (
                <li key={l.email}>
                  <strong>{l.name}</strong> <span className="muted small">{l.role}</span>
                  <div className="import__mono">{l.email} · {l.password}</div>
                </li>
              ))}
              {r.logins.length > 8 && <li className="muted small">…and {r.logins.length - 8} more in the download.</li>}
            </ul>
          </div>
        )}
        {r.skipped.length > 0 && (
          <div className="import__box import__box--warn">
            <h3>Skipped ({r.skipped.length})</h3>
            <ul className="import__list">
              {r.skipped.map((s, i) => (
                <li key={i}>
                  <strong>{s.name}</strong>: {s.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
        <button type="button" className="btn btn--primary" onClick={onClose}>
          Done
        </button>
      </section>
    );
  }

  const columnOptions = headers.map((h, i) => (
    <option key={i} value={i}>
      {h.trim() || `Column ${i + 1}`}
    </option>
  ));

  return (
    <section className="import">
      <div className="import__top">
        <h2 className="import__heading">Import players from a spreadsheet</h2>
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
      <p className="muted small">
        Export your members from Spond, Teamo or Excel as a CSV file, then upload it here or paste the rows. Column
        names are worked out for you, and anything that cannot be used is listed rather than stopping the import.
      </p>

      <div className="import__source">
        <label className="btn">
          Choose a CSV file
          <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={readFile} hidden />
        </label>
        <span className="muted small">or paste below</span>
      </div>
      <textarea
        className="import__paste"
        rows={5}
        value={text}
        placeholder={'First name,Last name,Email,Shirt,Position\nJo,Smith,jo@example.com,7,Forward'}
        onChange={(e) => setText(e.target.value)}
        aria-label="Spreadsheet rows"
      />

      {headers.length > 0 && (
        <>
          <h3 className="import__sub">1. Check the columns</h3>
          <div className="import__map">
            {FIELDS.map(({ field, label, hint }) => (
              <label key={field} className="field" title={hint}>
                <span className="field__label">{label}</span>
                <select
                  value={mapping[field] ?? ''}
                  onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value === '' ? undefined : Number(e.target.value) }))}
                >
                  <option value="">Not in my file</option>
                  {columnOptions}
                </select>
              </label>
            ))}
          </div>
          {!hasName && <p className="squad-error">Choose which column holds the first name (or the full name).</p>}
          {mapping.email !== undefined && (
            <label className="import__check">
              <input type="checkbox" checked={emailIsParent} onChange={(e) => setEmailIsParent(e.target.checked)} />
              The Email column holds the <strong>parent&apos;s</strong> email (usual for children). They are linked as parents instead.
            </label>
          )}

          <h3 className="import__sub">2. Where do they go?</h3>
          <label className="field">
            <span className="field__label">{mapping.team !== undefined ? 'Team for anyone without a team in the file' : 'Team'}</span>
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="import__check">
            <input type="checkbox" checked={createLogins} onChange={(e) => setCreateLogins(e.target.checked)} />
            Also create a sign-in password for each player who has their own email. Parents added from the file always get one.
          </label>

          <h3 className="import__sub">3. Check and import</h3>
          {hasName && (
            <>
              <p>
                <strong>{total}</strong> ready to import
                {[...plan.groups].length > 1 ? `: ${[...plan.groups].map(([id, rows]) => `${rows.length} to ${teamName(id)}`).join(', ')}` : `, to ${teamName([...plan.groups.keys()][0] ?? teamId)}`}.
              </p>
              <div className="import__scroll">
                <table className="import__table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Shirt</th>
                      <th>Position</th>
                      <th>Parent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importable.slice(0, 6).map((r, i) => (
                      <tr key={i}>
                        <td>
                          {r.firstName} {r.lastName === '-' ? '' : r.lastName}
                        </td>
                        <td>{r.email ?? ''}</td>
                        <td>{r.shirtNumber ?? ''}</td>
                        <td>{r.positions?.join('/') ?? ''}</td>
                        <td>{r.guardianEmail ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {importable.length > 6 && <p className="muted small">…and {importable.length - 6} more.</p>}
            </>
          )}
          {problems.length > 0 && (
            <div className="import__box import__box--warn">
              <h3>{problems.length} line{problems.length === 1 ? '' : 's'} will be left out</h3>
              <ul className="import__list">
                {problems.slice(0, 10).map((p, i) => (
                  <li key={i}>
                    Line {p.line}: {p.reason}
                  </li>
                ))}
                {problems.length > 10 && <li className="muted small">…and {problems.length - 10} more.</li>}
              </ul>
            </div>
          )}
          {error && (
            <p className="squad-error" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="btn btn--primary" disabled={busy || !hasName || total === 0} onClick={run}>
            {busy ? 'Importing…' : `Import ${total} player${total === 1 ? '' : 's'}`}
          </button>
        </>
      )}
    </section>
  );
}
