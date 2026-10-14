// Limits of the URL scenario format (see "URL scenario format" in docs/spec.md).

/** The fragment that carries a scenario: `#s=<base64url(compact JSON)>`. Never the query string. */
export const FRAGMENT_PREFIX = "#s=";

/**
 * Hard cap on the WHOLE link (origin + path + fragment), in characters. RFC 9110 §4.1 recommends
 * that senders and recipients support URIs of at least 8,000 octets; it is also the practical limit
 * of many chat, mail and CDN tools a shared link passes through. The fragment never reaches a
 * server, so HTTP request limits do not apply; the tools in between do.
 */
export const MAX_URL_CHARS = 8000;

/** Loading rejects any fragment longer than this BEFORE decoding anything (bounded allocation). */
export const MAX_FRAGMENT_CHARS = MAX_URL_CHARS;

/** Bracket nesting deeper than this is rejected before JSON.parse (a real payload nests ≤ 6). */
export const MAX_JSON_DEPTH = 16;

/** Target for a "typical" scenario (see the size test), counting a site-address allowance. */
export const TYPICAL_URL_BUDGET = 2000;
export const ORIGIN_ALLOWANCE = 60;

/** Unknown top-level keys reported individually before summarising the rest. */
export const MAX_REPORTED_UNKNOWN_KEYS = 5;

// Parameter sweeps (session 20). Enforced by validateSweep (src/sweep/validate.ts), which
// validateScenario runs, so the UI, the link loader and the worker's runSweep all apply the same caps.

/** At most this many values per sweep axis: a sweep is at most 20 × 20 = 400 cells. */
export const MAX_SWEEP_STEPS = 20;

/** At most this many simulated sessions in one sweep, over all its cells. */
export const MAX_SWEEP_SESSIONS = 1_000_000;

/** Every cell gets at least this many sessions, or the sweep is rejected (never silently thinner). */
export const MIN_SWEEP_CELL_SESSIONS = 500;
