import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Id, Me, NewPlayer, PlayerProfile } from '@hockey/contracts';
import { api } from '../../api-client';
import { managedTeams } from '../../core/auth';
import { useToast } from '../../core/Toast';
import { PlayerDialog } from './PlayerDialog';
import './squad.css';

export function Squad({ me }: { me: Me }) {
  const toast = useToast();
  const teams = useMemo(() => managedTeams(me), [me]);
  const [teamId, setTeamId] = useState<Id>(teams[0]?.id ?? '');
  const [squad, setSquad] = useState<PlayerProfile[] | null>(null);
  const [dialog, setDialog] = useState<{ player?: PlayerProfile } | null>(null);

  const load = useCallback(async () => {
    if (!teamId) return;
    setSquad(null);
    setSquad(await api.getSquad(teamId));
  }, [teamId]);

  useEffect(() => {
    load().catch(() => toast('Could not load the squad'));
  }, [load, toast]);

  if (teams.length === 0) return <p className="muted">You don&apos;t manage any teams yet.</p>;

  const save = async (input: NewPlayer) => {
    const editing = dialog?.player;
    if (editing) {
      const { displayName, shirtNumber, positions, skill, stamina } = input;
      const updated = await api.updatePlayer(teamId, editing.memberId, {
        displayName: displayName ?? editing.displayName,
        shirtNumber,
        positions,
        skill,
        stamina,
      });
      setSquad((cur) => cur?.map((p) => (p.memberId === updated.memberId ? updated : p)) ?? cur);
      toast(`Saved ${updated.displayName}`);
    } else {
      const added = await api.addPlayer(teamId, input);
      setSquad((cur) => [...(cur ?? []), added]);
      toast(`Added ${added.displayName}`);
    }
    setDialog(null);
  };

  return (
    <section className="squad">
      <div className="squad__bar">
        {teams.length > 1 ? (
          <select value={teamId} aria-label="Team" onChange={(e) => setTeamId(e.target.value)}>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        ) : (
          <strong>{teams[0]!.name}</strong>
        )}
        <span className="spacer" />
        <button type="button" className="btn btn--primary" onClick={() => setDialog({})}>
          Add player
        </button>
      </div>

      {squad === null ? (
        <p className="muted">Loading squad…</p>
      ) : squad.length === 0 ? (
        <p className="muted">No players yet. Add the first one.</p>
      ) : (
        <ul className="squad__list">
          {squad.map((p) => (
            <li key={p.memberId} className="squad__row">
              <span className="squad__shirt">{p.shirtNumber ?? '–'}</span>
              <span className="squad__name">{p.displayName}</span>
              <span className="squad__lines">{p.positions.join(' · ')}</span>
              <span className="squad__rating muted small" title="Skill / stamina">
                {p.skill}/{p.stamina}
              </span>
              <button type="button" className="btn btn--ghost" onClick={() => setDialog({ player: p })}>
                Edit
              </button>
            </li>
          ))}
        </ul>
      )}

      {dialog && (
        <PlayerDialog
          player={dialog.player}
          onCancel={() => setDialog(null)}
          onSave={save}
          onCreateLogin={
            dialog.player ? (email) => api.createPlayerLogin(teamId, dialog.player!.memberId, email) : undefined
          }
        />
      )}
    </section>
  );
}
