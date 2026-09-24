// Browser glue for scenario links: ONE loader per page lifetime (this module's lifetime), the
// initial load from the address bar, and keeping the address bar in its canonical form. Decoding
// and the once-per-fragment rule live in src/share (pure, tested); this file only touches location
// and history.
import { defaultScenario, type ScenarioConfig } from "../scenario";
import type { Dropped } from "../share/compact";
import { encodeScenarioLink } from "../share/link";
import { createLinkLoader, type AppliedResult } from "../share/linkLoader";

export const pageLinkLoader = createLinkLoader();

export type LinkNotice = { kind: "loaded"; dropped: Dropped[]; fromVersion: number } | { kind: "error"; message: string };

export function noticeOf(r: AppliedResult): LinkNotice {
  return r.kind === "error" ? { kind: "error", message: r.message } : { kind: "loaded", dropped: r.dropped, fromVersion: r.fromVersion };
}

/** Origin + path + query of the current page: everything a link keeps except the fragment. */
export function baseUrl(): string {
  return window.location.origin + window.location.pathname + window.location.search;
}

/** Puts `fragment` in the address bar WITHOUT a new history entry, and marks it as already applied. */
export function showInAddressBar(fragment: string): void {
  pageLinkLoader.markSeen(fragment);
  window.history.replaceState(window.history.state, "", baseUrl() + fragment);
}

/**
 * After applying a link: a loaded scenario is written back in its canonical form (so a reload
 * restores exactly what is on screen); an unreadable link is removed from the address bar (so a
 * reload does not repeat the error). replaceState only: loading never adds a history entry.
 */
export function canonicalizeAddressBar(r: AppliedResult): void {
  if (r.kind === "error") {
    window.history.replaceState(window.history.state, "", baseUrl());
    return;
  }
  const enc = encodeScenarioLink(r.scenario, baseUrl());
  if (enc.ok) showInAddressBar(enc.fragment);
}

interface Boot {
  scenario: ScenarioConfig;
  notice: LinkNotice | null;
  result: AppliedResult | null;
}
let boot: Boot | null = null;

/** The initial scenario: from the page's #s= link if it has one, else the defaults. Computed once per page. */
export function bootFromLocation(): Boot {
  if (boot) return boot;
  const b: Boot = { scenario: defaultScenario(), notice: null, result: null };
  pageLinkLoader.handle(window.location.hash, (r) => {
    b.result = r;
    b.notice = noticeOf(r);
    if (r.kind === "loaded") b.scenario = r.scenario; // an error keeps the defaults untouched
  });
  boot = b;
  return b;
}
