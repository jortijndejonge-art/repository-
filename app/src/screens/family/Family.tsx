import { useState } from 'react';
import type { Me } from '@hockey/contracts';
import { MyMatches } from '../availability/MyMatches';
import { Training } from '../training/Training';
import './family.css';

/** A parent's view: for each child, their matches and training, answered on the child's behalf. */
export function Family({ me }: { me: Me }) {
  const [childId, setChildId] = useState(me.children[0]?.memberId ?? '');
  const child = me.children.find((c) => c.memberId === childId) ?? me.children[0];
  if (!child) return <p className="muted">No children are linked to your account yet. Ask your child&apos;s manager to add you.</p>;

  return (
    <section className="family">
      {me.children.length > 1 ? (
        <select value={child.memberId} aria-label="Child" onChange={(e) => setChildId(e.target.value)}>
          {me.children.map((c) => (
            <option key={c.memberId} value={c.memberId}>
              {c.displayName}
            </option>
          ))}
        </select>
      ) : (
        <h2 className="family__name">{child.displayName}</h2>
      )}
      <p className="muted small">
        You&apos;re answering for {child.displayName}
        {child.teams.length ? ` (${child.teams.map((t) => t.name).join(', ')})` : ''}.
      </p>
      <h3 className="family__heading">Matches</h3>
      <MyMatches key={`m-${child.memberId}`} me={me} subject={child} />
      <h3 className="family__heading">Training</h3>
      <Training key={`t-${child.memberId}`} me={me} subject={child} />
    </section>
  );
}
