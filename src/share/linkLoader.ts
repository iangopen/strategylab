// Applies scenario links at most ONCE per fragment per page lifetime. A page load is a new lifetime
// (so reloading a link restores it: the "lost on reload" fix); within one lifetime, React StrictMode
// double effects, hashchange + popstate firing together, and Back to an already-loaded fragment are
// all skipped. Pure: the browser glue in App passes the hash and what to do with a result.
import { decodeScenarioLink, type LoadResult } from "./link";

export type AppliedResult = Exclude<LoadResult, { kind: "none" }>;

/** Remembered fragments per page lifetime (oldest forgotten first; each is ≤ the length cap). */
export const MAX_REMEMBERED_LINKS = 50;

export interface LinkLoader {
  /** Decodes and applies `hash` unless it carries no scenario or was already applied/written this lifetime. */
  handle(hash: string, apply: (result: AppliedResult) => void): "none" | "skipped" | "applied";
  /** Marks a fragment as already applied (e.g. one the app itself just wrote into the address bar). */
  markSeen(hash: string): void;
}

export function createLinkLoader(decode: (hash: string) => LoadResult = decodeScenarioLink): LinkLoader {
  const seen: string[] = [];
  const remember = (hash: string) => {
    if (seen.includes(hash)) return;
    seen.push(hash);
    if (seen.length > MAX_REMEMBERED_LINKS) seen.shift();
  };
  return {
    handle(hash, apply) {
      const result = seen.includes(hash) ? null : decode(hash);
      if (result === null) return "skipped";
      if (result.kind === "none") return "none";
      remember(hash);
      apply(result);
      return "applied";
    },
    markSeen: remember,
  };
}
