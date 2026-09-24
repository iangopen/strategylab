// Theme preference (System / Light / Dark). UI preference only: NOT part of ScenarioConfig.
import { useEffect, useState } from "react";

export type ThemePref = "system" | "light" | "dark";
const KEY = "betting-lab.theme";

export function loadThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/** Sets data-theme on <html> ("system" removes it so the OS setting applies). */
export function applyThemePref(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // Storage unavailable (private mode, blocked): the choice still applies for this page.
  }
}

/** The theme actually in effect: the header choice, or the OS setting under "System". */
export function effectiveTheme(): "light" | "dark" {
  const forced = document.documentElement.dataset.theme;
  if (forced === "light" || forced === "dark") return forced;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * A counter that changes whenever the effective theme may have changed (data-theme attribute
 * or the OS color scheme). Charts use it as a redraw dependency, since canvas pixels do not
 * follow CSS variables on their own.
 */
export function useThemeVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const mo = new MutationObserver(bump);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", bump);
    return () => {
      mo.disconnect();
      mq.removeEventListener("change", bump);
    };
  }, []);
  return version;
}
