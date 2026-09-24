import { useMemo, useState } from "react";
import { formatRuleError, validateRule } from "../../engine/rules/validate";
import { RuleForm } from "./RuleForm";
import { RuleJson } from "./RuleJson";

interface Props {
  /** The instance's rule as stored in the ScenarioConfig: plain JSON, possibly invalid. */
  rule: unknown;
  onChange: (rule: unknown) => void;
  disabled: boolean;
}

/** Form + JSON editor for one custom rule. Validation uses the SAME validator the worker runs. */
export function RuleBuilder({ rule, onChange, disabled }: Props) {
  // Which tab is showing: view state, not scenario state.
  const [tab, setTab] = useState<"form" | "json">("form");
  const full = useMemo(() => validateRule(rule), [rule]);
  const shape = useMemo(() => validateRule(rule, { ranges: false }), [rule]);
  const errors = full.ok ? [] : full.errors;

  const errorList = errors.length > 0 && (
    <div className="error rule-errors" role="alert">
      {errors.length === 1 ? "This rule has a problem:" : `This rule has ${errors.length} problems:`}
      <ul>
        {errors.map((e, i) => (
          <li key={i}>{formatRuleError(e)}</li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="rule-builder">
      <div className="tabs" role="tablist" aria-label="Rule editor">
        <button type="button" role="tab" aria-selected={tab === "form"} className={tab === "form" ? "tab active" : "tab"} onClick={() => setTab("form")}>
          Form
        </button>
        <button type="button" role="tab" aria-selected={tab === "json"} className={tab === "json" ? "tab active" : "tab"} onClick={() => setTab("json")}>
          JSON
        </button>
      </div>
      {tab === "form" ? (
        shape.ok ? (
          <>
            <RuleForm rule={shape.rule} errors={errors} onChange={onChange} disabled={disabled} />
            {errors.length > 0 && <div className="error">Fix the highlighted values to run.</div>}
          </>
        ) : (
          <>
            <p className="help">This rule can’t be shown as a form. Fix it in the JSON tab.</p>
            {errorList}
          </>
        )
      ) : (
        <>
          <RuleJson rule={rule} onChange={onChange} disabled={disabled} />
          {errorList}
        </>
      )}
    </div>
  );
}
