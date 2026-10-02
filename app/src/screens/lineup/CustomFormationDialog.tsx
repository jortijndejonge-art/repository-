import { useEffect, useMemo, useRef, useState } from 'react';
import type { Formation } from '@hockey/contracts';
import { buildCustomFormationSlots, validateLineCounts } from '@hockey/engine';
import { Pitch } from '../../components/pitch/Pitch';

interface CustomFormationDialogProps {
  onCancel: () => void;
  onCreate: (input: { name: string; lines: number[] }) => Promise<void>;
}

/** Line counts as typed, front line first — e.g. "2 3 2 3 GK" -> [2, 3, 2, 3]. A trailing "GK" or "+" is ignored. */
function parseLines(text: string): number[] {
  return text
    .split(/[\s,+-]+/)
    .map((s) => s.trim())
    .filter((s) => s && s.toLowerCase() !== 'gk')
    .map(Number);
}

export function CustomFormationDialog({ onCancel, onCreate }: CustomFormationDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [linesText, setLinesText] = useState('');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  // Coaches type front line first, down to the keeper; the engine wants defence first.
  const typed = useMemo(() => parseLines(linesText), [linesText]);
  const lines = useMemo(() => [...typed].reverse(), [typed]);
  const check = lines.length > 0 ? validateLineCounts(lines) : null;
  const autoName = typed.length > 0 ? `${typed.join('-')} + GK` : '';
  const displayName = nameTouched ? name : autoName;

  const preview: Formation | null =
    check?.ok
      ? { id: 'preview', name: displayName || autoName, format: check.format, slots: buildCustomFormationSlots(lines) }
      : null;

  const submit = async () => {
    if (!check?.ok) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate({ name: (displayName || autoName).trim(), lines });
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <dialog ref={ref} className="dialog" onCancel={onCancel} aria-labelledby="custom-formation-title">
      <h2 id="custom-formation-title">New formation</h2>
      <p className="muted small">
        Type each line's player count from the front line back to the goalkeeper — e.g. "2 3 2 3" is two up front,
        then three, then two, then three in front of the keeper. The goalkeeper is added automatically; the total
        including keeper must be 5, 7, or 11.
      </p>

      <div className="formation-form">
        <label className="field">
          <span className="field__label">Lines (front → goalkeeper)</span>
          <input
            type="text"
            value={linesText}
            onChange={(e) => setLinesText(e.target.value)}
            placeholder="e.g. 2 3 2 3"
            autoFocus
          />
        </label>

        <label className="field">
          <span className="field__label">Name</span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => {
              setNameTouched(true);
              setName(e.target.value);
            }}
            placeholder={autoName || 'e.g. 2-3-2-3 + GK'}
          />
        </label>
      </div>

      {typed.length > 0 && (
        <p className={`small ${check?.ok ? 'status-good' : 'status-bad'}`}>
          {check?.ok
            ? `${typed.join(' + ')} + goalkeeper = ${typed.reduce((a, b) => a + b, 0) + 1} ✓`
            : check?.error}
        </p>
      )}

      {preview && (
        <div className="formation-preview">
          <Pitch
            formation={preview}
            format={preview.format}
            renderSlot={(slot) => <div className="formation-preview__slot">{slot.label}</div>}
          />
        </div>
      )}

      {error && (
        <p className="banner" role="alert">
          {error}
        </p>
      )}

      <div className="dialog__actions">
        <span className="spacer" />
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn--primary" disabled={!check?.ok || saving} onClick={submit}>
          {saving ? 'Saving…' : 'Save formation'}
        </button>
      </div>
    </dialog>
  );
}
