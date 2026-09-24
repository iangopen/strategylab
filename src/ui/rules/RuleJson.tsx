import { useState } from "react";
import { RULE_LIMITS } from "../../engine/rules/limits";
import { parseRuleJson } from "../../engine/rules/validate";

interface Props {
  rule: unknown;
  /** Called with any text that PARSES as JSON, valid rule or not, so its errors show and Run is blocked. */
  onChange: (rule: unknown) => void;
  disabled: boolean;
}

const pretty = (rule: unknown) => JSON.stringify(rule, null, 2) ?? "";

/** Raw JSON view: read, copy, paste. The text is parsed with JSON.parse only, never evaluated. */
export function RuleJson({ rule, onChange, disabled }: Props) {
  const [text, setText] = useState(() => pretty(rule));
  const [seen, setSeen] = useState(rule);
  const [parseError, setParseError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Follow edits made in the form tab, unless the draft already means the same rule.
  if (rule !== seen) {
    setSeen(rule);
    const p = parseRuleJson(text);
    if (!p.ok || JSON.stringify(p.value) !== JSON.stringify(rule)) {
      setText(pretty(rule));
      setParseError(null);
    }
  }

  function handle(t: string) {
    setText(t);
    setCopied(null);
    const p = parseRuleJson(t);
    if (!p.ok) {
      setParseError(p.error);
      return;
    }
    setParseError(null);
    onChange(p.value);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("Copied.");
    } catch {
      setCopied("Copy failed: select the text and copy it by hand.");
    }
  }

  return (
    <div className={`field${parseError ? " has-error" : ""}`}>
      <label>
        Rule JSON
        <textarea className="rule-json" value={text} spellCheck={false} rows={14} disabled={disabled} maxLength={RULE_LIMITS.maxJsonLength + 1000} onChange={(e) => handle(e.target.value)} />
      </label>
      <div className="rule-json-tools">
        <button type="button" onClick={() => void copy()}>
          Copy
        </button>
        {copied && <span className="help">{copied}</span>}
      </div>
      {parseError ? <div className="error">{parseError}</div> : <div className="help">Paste a rule here to load it. Rules are plain data: they are checked against the rule grammar and never run as code.</div>}
    </div>
  );
}
