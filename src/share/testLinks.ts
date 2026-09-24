// Test-only helper: a fragment carrying an arbitrary (possibly hostile) payload, built the same way
// the app builds real links. Not imported by production code.
import { bytesToBase64url } from "./base64url";
import { FRAGMENT_PREFIX } from "./limits";

export function fragmentOf(payload: unknown): string {
  return FRAGMENT_PREFIX + bytesToBase64url(new TextEncoder().encode(typeof payload === "string" ? payload : JSON.stringify(payload)));
}
