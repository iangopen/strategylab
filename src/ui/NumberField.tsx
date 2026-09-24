import { useId, useState } from "react";

interface Props {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  /** Blank input means null ("off" / "no limit"). */
  optional?: boolean;
  placeholder?: string;
  error?: string | undefined;
  help?: string | undefined;
  disabled?: boolean;
  prefix?: string;
  /**
   * How a value is SHOWN when it comes from outside (first render, or an external change such as an
   * exact format conversion). The stored value is never rounded by this; it changes only when the
   * user edits the field. Default: String(value).
   */
  format?: (value: number) => string;
}

/**
 * Numeric input. The raw text being typed is kept locally only as an editing draft;
 * every parseable value is committed to the ScenarioConfig immediately.
 */
export function NumberField({ label, value, onChange, optional, placeholder, error, help, disabled, prefix, format = String }: Props) {
  const id = useId();
  const [text, setText] = useState(value === null ? "" : format(value));
  const [parseError, setParseError] = useState<string | null>(null);
  const [seenValue, setSeenValue] = useState(value);

  // Follow external changes (preset switch, randomize) unless the draft already means the same number.
  if (value !== seenValue) {
    setSeenValue(value);
    if (parse(text) !== value) {
      setText(value === null ? "" : format(value));
      setParseError(null);
    }
  }

  function handle(t: string) {
    setText(t);
    if (t.trim() === "") {
      if (optional) {
        setParseError(null);
        onChange(null);
      } else {
        setParseError("Required.");
      }
      return;
    }
    const n = parse(t);
    if (n === null) {
      setParseError("Enter a number.");
      return;
    }
    setParseError(null);
    onChange(n);
  }

  const shown = parseError ?? error;
  return (
    <div className={`field${shown ? " has-error" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <div className="input-row">
        {prefix && <span className="prefix">{prefix}</span>}
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={shown ? true : undefined}
          onChange={(e) => handle(e.target.value)}
        />
      </div>
      {shown ? <div className="error">{shown}</div> : help ? <div className="help">{help}</div> : null}
    </div>
  );
}

function parse(t: string): number | null {
  const cleaned = t.replace(/[,_\s$]/g, "");
  if (cleaned === "" || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
