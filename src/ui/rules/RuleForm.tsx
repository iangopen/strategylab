import { useState } from "react";
import type { Entry, ProgressionRule, Rule, SequenceRule } from "../../engine/rules/types";
import type { RuleError } from "../../engine/rules/validate";
import { NumberField } from "../NumberField";
import {
  ACTION_CHOICES,
  actionValue,
  addEntry,
  canAddEntry,
  canMoveEntry,
  changeKind,
  CONDITION_CHOICES,
  conditionChoice,
  conditionValue,
  conditionValueKey,
  deleteEntry,
  formatLine,
  moveEntry,
  newAction,
  newCondition,
  parseLine,
  replaceEntry,
  withActionValue,
  withConditionValue,
  type ConditionChoice,
  type ListKey,
} from "./edit";

interface Props {
  /** A structurally valid rule (values may still be out of range). */
  rule: Rule;
  /** Validator errors for this rule (with ranges), shown next to their fields. */
  errors: readonly RuleError[];
  onChange: (rule: Rule) => void;
  disabled: boolean;
}

function errorAt(errors: readonly RuleError[], path: string): string | undefined {
  const msgs = errors.filter((e) => e.path === path).map((e) => e.message);
  return msgs.length > 0 ? msgs.join(" ") : undefined;
}

const LIST_TITLES: Record<ListKey, string> = { onWin: "After a win", onLoss: "After a loss" };

/** Form editor for a rule. Every edit is committed straight to the scenario (no hidden state). */
export function RuleForm({ rule, errors, onChange, disabled }: Props) {
  return (
    <div className="rule-form">
      <div className="row">
        <div className={`field${errorAt(errors, "name") ? " has-error" : ""}`}>
          <label>
            Name
            <input type="text" value={rule.name} disabled={disabled} maxLength={200} onChange={(e) => onChange({ ...rule, name: e.target.value })} />
          </label>
          {errorAt(errors, "name") && <div className="error">{errorAt(errors, "name")}</div>}
        </div>
        <div className="field">
          <label>
            Kind
            <select value={rule.kind} disabled={disabled} onChange={(e) => onChange(changeKind(rule, e.target.value as Rule["kind"]))}>
              <option value="progression">Progression (win/loss rules)</option>
              <option value="sequence">Cancellation line</option>
            </select>
          </label>
        </div>
      </div>
      {rule.kind === "progression" ? (
        <ProgressionForm rule={rule} errors={errors} onChange={onChange} disabled={disabled} />
      ) : (
        <SequenceForm rule={rule} errors={errors} onChange={onChange} disabled={disabled} />
      )}
    </div>
  );
}

function ProgressionForm({ rule, errors, onChange, disabled }: { rule: ProgressionRule; errors: readonly RuleError[]; onChange: (r: Rule) => void; disabled: boolean }) {
  return (
    <>
      <NumberField
        label="Start bet (units of the base bet)"
        value={rule.startUnits}
        onChange={(v) => v !== null && onChange({ ...rule, startUnits: v })}
        error={errorAt(errors, "startUnits")}
        help="Bet = base bet × units. Reset actions return here."
        disabled={disabled}
      />
      <p className="help">After each round, the matching list is checked from the top; the first rule whose condition holds decides the next bet.</p>
      {(["onWin", "onLoss"] as const).map((key) => (
        <fieldset className="rule-list" key={key}>
          <legend>{LIST_TITLES[key]}</legend>
          {rule[key].map((entry, i) => (
            <EntryEditor key={`${key}-${i}-${entry.when ? conditionChoice(entry.when) : "default"}-${entry.then.type}`} rule={rule} listKey={key} index={i} entry={entry} errors={errors} onChange={onChange} disabled={disabled} />
          ))}
          <button type="button" className="link" disabled={disabled || !canAddEntry(rule, key)} onClick={() => onChange(addEntry(rule, key))}>
            + Add a rule {canAddEntry(rule, key) ? "" : "(limit reached)"}
          </button>
        </fieldset>
      ))}
    </>
  );
}

interface EntryProps {
  rule: ProgressionRule;
  listKey: ListKey;
  index: number;
  entry: Entry;
  errors: readonly RuleError[];
  onChange: (r: Rule) => void;
  disabled: boolean;
}

function EntryEditor({ rule, listKey, index, entry, errors, onChange, disabled }: EntryProps) {
  const isDefault = entry.when === undefined;
  const at = `${listKey} entry ${index + 1}`;
  const set = (e: Entry) => onChange(replaceEntry(rule, listKey, index, e));
  const act = actionValue(entry.then);
  const entryError = errorAt(errors, at);

  return (
    <div className="rule-entry">
      <div className="rule-entry-head">
        <strong>{isDefault ? "Otherwise" : `Rule ${index + 1}`}</strong>
        {!isDefault && (
          <span className="rule-entry-tools">
            <button type="button" className="link" aria-label="Move up" title="Move up" disabled={disabled || !canMoveEntry(rule, listKey, index, -1)} onClick={() => onChange(moveEntry(rule, listKey, index, -1))}>
              ↑
            </button>
            <button type="button" className="link" aria-label="Move down" title="Move down" disabled={disabled || !canMoveEntry(rule, listKey, index, 1)} onClick={() => onChange(moveEntry(rule, listKey, index, 1))}>
              ↓
            </button>
            <button type="button" className="link" disabled={disabled} onClick={() => onChange(deleteEntry(rule, listKey, index))}>
              Delete
            </button>
          </span>
        )}
      </div>
      {entryError && <div className="error">{entryError}</div>}
      {entry.when !== undefined && (
        <div className="row">
          <div className="field">
            <label>
              When
              <select value={conditionChoice(entry.when)} disabled={disabled} onChange={(e) => set({ ...entry, when: newCondition(e.target.value as ConditionChoice) })}>
                {CONDITION_CHOICES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <NumberField
            label={entry.when.type === "bankroll" ? "Percent of start" : "At least"}
            value={conditionValue(entry.when)}
            onChange={(v) => v !== null && entry.when && set({ ...entry, when: withConditionValue(entry.when, v) })}
            error={errorAt(errors, `${at} → condition → ${conditionValueKey(entry.when)}`)}
            disabled={disabled}
          />
        </div>
      )}
      <div className="row">
        <div className="field">
          <label>
            {isDefault ? "Then (in every other case)" : "Then"}
            <select value={entry.then.type} disabled={disabled} onChange={(e) => set({ ...entry, then: newAction(e.target.value as (typeof ACTION_CHOICES)[number]["value"]) })}>
              {ACTION_CHOICES.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {act && (
          <NumberField
            label={act.key === "by" ? "Factor" : "Units"}
            value={act.value}
            onChange={(v) => v !== null && set({ ...entry, then: withActionValue(entry.then, v) })}
            error={errorAt(errors, `${at} → action → ${act.key}`)}
            disabled={disabled}
          />
        )}
      </div>
    </div>
  );
}

function SequenceForm({ rule, errors, onChange, disabled }: { rule: SequenceRule; errors: readonly RuleError[]; onChange: (r: Rule) => void; disabled: boolean }) {
  // Local text draft only while typing, like NumberField; every parseable line is committed.
  const [text, setText] = useState(formatLine(rule.line));
  const [seen, setSeen] = useState(rule.line);
  const [parseError, setParseError] = useState<string | null>(null);
  if (rule.line !== seen) {
    setSeen(rule.line);
    if (JSON.stringify(parseLine(text)) !== JSON.stringify(rule.line)) {
      setText(formatLine(rule.line));
      setParseError(null);
    }
  }
  const lineErrors = errors.filter((e) => e.path.startsWith("line")).map((e) => (e.path === "line" ? e.message : `${e.path.replace("line ", "")}: ${e.message}`));
  const shown = parseError ?? (lineErrors.length > 0 ? lineErrors.join(" ") : undefined);

  return (
    <>
      <div className={`field${shown ? " has-error" : ""}`}>
        <label>
          Starting line (units)
          <input
            type="text"
            value={text}
            disabled={disabled}
            onChange={(e) => {
              setText(e.target.value);
              const line = parseLine(e.target.value);
              if (line === null) {
                setParseError("Enter whole numbers separated by commas, e.g. 1, 2, 3, 4.");
                return;
              }
              setParseError(null);
              onChange({ ...rule, line });
            }}
          />
        </label>
        {shown ? <div className="error">{shown}</div> : <div className="help">Bet = (first + last) × base bet. A win crosses both off; a loss adds the amount just bet to the end. 1 to 20 numbers, each 1 to 100.</div>}
      </div>
      <div className="field">
        <label>
          When the line clears
          <select value={rule.onComplete} disabled={disabled} onChange={(e) => onChange({ ...rule, onComplete: e.target.value as SequenceRule["onComplete"] })}>
            <option value="restart">Restart the line</option>
            <option value="stop">Stop the session</option>
          </select>
        </label>
      </div>
    </>
  );
}
