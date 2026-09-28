interface Option<T> {
  value: T;
  label: string;
  hint?: string;
}

interface SegmentedProps<T> {
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** Compact single-choice control (radio group styled as a segmented switch). */
export function Segmented<T extends string | number>({ label, options, value, onChange }: SegmentedProps<T>) {
  return (
    <div className="field">
      <span className="field__label" id={`seg-${label}`}>
        {label}
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby={`seg-${label}`}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            title={o.hint}
            className={o.value === value ? 'is-active' : undefined}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
