import { SCENARIO_VERSION } from "../scenario";
import type { LinkNotice } from "./linkBoot";

interface Props {
  notice: LinkNotice;
  onDismiss: () => void;
}

/** What happened when a scenario link was opened: loaded, loaded with dropped fields, or not loaded. */
export function LinkBanner({ notice, onDismiss }: Props) {
  const dismiss = (
    <button type="button" className="link" onClick={onDismiss}>
      Dismiss
    </button>
  );
  if (notice.kind === "error") {
    return (
      <section className="panel link-banner is-error" role="alert">
        <div className="link-banner-head">
          <strong>Couldn’t load a scenario from this link.</strong>
          {dismiss}
        </div>
        <p className="error">{notice.message}</p>
        <p className="help">Your current settings are unchanged.</p>
      </section>
    );
  }
  const upgraded = notice.fromVersion < SCENARIO_VERSION ? ` It was made with an older version (${notice.fromVersion}) and was upgraded.` : "";
  return (
    <section className={`panel link-banner${notice.dropped.length > 0 ? " is-partial" : ""}`} role="status">
      <div className="link-banner-head">
        <strong>{notice.dropped.length === 0 ? "Loaded the scenario from the link." : `Loaded the scenario from the link, except ${notice.dropped.length === 1 ? "one item" : `${notice.dropped.length} items`}:`}</strong>
        {dismiss}
      </div>
      {notice.dropped.length > 0 && (
        <ul className="error rule-errors">
          {notice.dropped.map((d, i) => (
            <li key={i}>
              {d.field}: {d.message}
            </li>
          ))}
        </ul>
      )}
      <p className="help">
        Nothing has been simulated yet: click Run to see the results.{upgraded}
      </p>
    </section>
  );
}
