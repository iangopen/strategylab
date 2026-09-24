import { describe, expect, it } from "vitest";
import { defaultScenario } from "../scenario";
import { bytesToBase64url } from "./base64url";
import { decodeScenarioLink, encodeScenarioLink, jsonDepthExceeds, type LoadResult } from "./link";
import { FRAGMENT_PREFIX, MAX_FRAGMENT_CHARS, MAX_JSON_DEPTH } from "./limits";
import { fragmentOf } from "./testLinks";

// A link is attacker-controlled. Every hostile input below must produce a BOUNDED error (or a
// bounded partial load), never throw, never hang, and never grow memory: each decode is asserted
// to finish under TIME_LIMIT_MS and to grow the heap by less than HEAP_LIMIT_BYTES (the input
// itself is allocated before measuring), and every message is short.
const TIME_LIMIT_MS = 50;
const HEAP_LIMIT_BYTES = 2 * 1024 * 1024;
const MESSAGE_LIMIT = 600;
const DROPPED_LIMIT = 40;

type NodeProcess = { memoryUsage(): { heapUsed: number } };
const proc = (globalThis as unknown as { process: NodeProcess }).process;

const good = { v: 2, g: "european", b: 1000, bb: 10, tn: 1, sw: 1100, r: 1000, n: 10000, sd: 12345, st: [["flat"], ["kelly", { fraction: 0.5 }]] };
const goodJson = JSON.stringify(good);

function measuredDecode(hash: string): LoadResult {
  // V8 builds long concatenations lazily and flattens them on first character access. A real
  // location.hash is already flat, so flatten the INPUT here, before measuring the decoder.
  void hash.charCodeAt(hash.length - 1);
  const heap0 = proc.memoryUsage().heapUsed;
  const t0 = performance.now();
  let r: LoadResult | undefined;
  expect(() => (r = decodeScenarioLink(hash))).not.toThrow();
  const ms = performance.now() - t0;
  const heap = proc.memoryUsage().heapUsed - heap0;
  expect(ms, `decode took ${ms.toFixed(1)} ms`).toBeLessThan(TIME_LIMIT_MS);
  expect(heap, `heap grew ${heap} bytes`).toBeLessThan(HEAP_LIMIT_BYTES);
  if (r!.kind === "error") expect(r!.message.length).toBeLessThan(MESSAGE_LIMIT);
  if (r!.kind === "loaded") {
    expect(r!.dropped.length).toBeLessThan(DROPPED_LIMIT);
    for (const d of r!.dropped) expect(d.field.length + d.message.length).toBeLessThan(MESSAGE_LIMIT);
  }
  return r!;
}

const errorOf = (hash: string) => {
  const r = measuredDecode(hash);
  expect(r.kind, hash.slice(0, 80)).toBe("error");
  return r.kind === "error" ? r.message : "";
};

function prototypeIsClean() {
  const probe: Record<string, unknown> = {};
  for (const k of ["polluted", "fraction", "units", "isAdmin", "v"]) expect(probe[k], k).toBeUndefined();
  expect(Object.keys(Object.prototype)).toEqual([]);
  expect(Object.keys(Array.prototype)).toEqual([]);
}

describe("malicious links: bounded errors, no throw, no hang, bounded memory (verification 4)", () => {
  it("prototype-pollution keys at every level are ignored or reported; no prototype changes", () => {
    const payloads = [
      goodJson.replace(/}$/, ',"__proto__":{"polluted":true,"isAdmin":true}}'),
      goodJson.replace(/}$/, ',"constructor":{"prototype":{"polluted":true}}}'),
      goodJson.replace(/}$/, ',"prototype":{"polluted":true}}'),
      goodJson.replace('{"fraction":0.5}', '{"fraction":0.5,"__proto__":{"fraction":9,"units":9}}'),
      goodJson.replace('{"fraction":0.5}', '{"__proto__":null,"constructor":{"prototype":{"polluted":1}}}'),
      goodJson.replace('"st":[', '"st":[{"__proto__":{"polluted":1}},'),
      goodJson.replace('"g":"european"', '"g":{"__proto__":{"polluted":1}}'),
    ];
    for (const p of payloads) {
      const r = measuredDecode(fragmentOf(p));
      expect(r.kind).toBe("loaded");
      if (r.kind !== "loaded") continue;
      // Kelly's fraction comes only from its own key, never through a smuggled prototype.
      const kelly = r.scenario.strategies.find((s) => s.kind === "builtin" && s.strategyId === "kelly");
      if (kelly?.kind === "builtin") expect(Object.getPrototypeOf(kelly.config)).toBe(Object.prototype);
      for (const s of r.scenario.strategies) if (s.kind === "builtin") expect(s.config.units === 9 || s.config.fraction === 9).toBe(false);
      prototypeIsClean();
    }
  });

  it("deeply nested JSON is rejected before JSON.parse (inside the length cap)", () => {
    const deep = "[".repeat(5000);
    const hash = fragmentOf(deep);
    expect(hash.length).toBeLessThan(MAX_FRAGMENT_CHARS);
    expect(errorOf(hash)).toMatch(/nested too deeply/);
    // Nesting hidden inside an otherwise valid payload, and in objects.
    expect(errorOf(fragmentOf(goodJson.replace('"st":[', `"st":[${"[".repeat(40)}1${"]".repeat(40)},`)))).toMatch(/nested too deeply/);
    expect(errorOf(fragmentOf(`${'{"a":'.repeat(20)}1${"}".repeat(20)}`))).toMatch(/nested too deeply/);
    // Brackets inside strings don't count; a real payload's depth (≤ 6) is fine.
    expect(jsonDepthExceeds(`{"name":"${"[".repeat(100)}"}`, MAX_JSON_DEPTH)).toBe(false);
    expect(jsonDepthExceeds(`{"name":"\\"${"[".repeat(100)}"}`, MAX_JSON_DEPTH)).toBe(false);
    expect(jsonDepthExceeds("[".repeat(MAX_JSON_DEPTH), MAX_JSON_DEPTH)).toBe(false);
    expect(jsonDepthExceeds("[".repeat(MAX_JSON_DEPTH + 1), MAX_JSON_DEPTH)).toBe(true);
  });

  it("huge repeated strings: over the cap is refused without decoding; under it, a huge name is rejected by the rule validator", () => {
    const huge = FRAGMENT_PREFIX + "A".repeat(20_000_000);
    expect(errorOf(huge)).toMatch(/too long to be a Betting Lab scenario \(20,000,003 characters; the limit is 8,000\)/);
    expect(errorOf(FRAGMENT_PREFIX + "A".repeat(MAX_FRAGMENT_CHARS))).toMatch(/too long/);
    // Within the cap: a 5,000-character rule name.
    const r = measuredDecode(fragmentOf({ ...good, st: [["flat"], ["p", "x".repeat(5000), 1, [[["r"]]], [[["r"]]]]] }));
    expect(r.kind === "loaded" && r.dropped.map((d) => d.message)).toEqual(["name: must be at most 40 characters (got 5000); left out"]);
    // Within the cap: thousands of unknown keys, at the top and in a config, are summarised.
    const manyKeys = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`k${i}`, 1]));
    const manyHash = fragmentOf({ ...good, ...manyKeys, st: [["flat", manyKeys]] });
    expect(manyHash.length).toBeLessThanOrEqual(MAX_FRAGMENT_CHARS); // inside the cap, so it IS decoded
    const r2 = measuredDecode(manyHash);
    expect(r2.kind === "loaded" && r2.dropped.length).toBe(12); // 5 + summary, twice
    // Within the cap: a 2,000-element strategy list only has its first 8 looked at.
    const r3 = measuredDecode(fragmentOf({ ...good, st: Array.from({ length: 2000 }, () => 0) }));
    expect(r3.kind === "loaded" && r3.dropped.length).toBe(9);
  });

  it("invalid base64: bad characters, standard-base64 characters, padding, non-ASCII, percent-encoding", () => {
    const valid = fragmentOf(good).slice(FRAGMENT_PREFIX.length);
    for (const body of [`${valid.slice(0, 20)}!${valid.slice(21)}`, `+${valid.slice(1)}`, `${valid.slice(0, 10)}/${valid.slice(11)}`, `${valid}==`, `é${valid}`, "%7B%22v%22%3A2%7D", "<script>alert(1)</script>", " "]) {
      const msg = errorOf(FRAGMENT_PREFIX + body);
      expect(msg).toMatch(/Nothing was loaded\.$/);
    }
  });

  it("truncated base64: every cut of a real link is an error, never a half-loaded scenario", () => {
    const enc = encodeScenarioLink(defaultScenario(), "https://x/");
    if (!enc.ok) throw new Error(enc.message);
    for (let cut = FRAGMENT_PREFIX.length; cut < enc.fragment.length; cut++) {
      const r = measuredDecode(enc.fragment.slice(0, cut));
      expect(r.kind, `cut at ${cut}`).toBe("error");
    }
    expect(measuredDecode(enc.fragment).kind).toBe("loaded");
  });

  it("invalid UTF-8 and binary garbage", () => {
    for (const bytes of [[0xff, 0xfe, 0xfd], [0xc3], [0xed, 0xa0, 0x80], Array.from({ length: 3000 }, (_, i) => (i * 131) & 0xff)]) {
      errorOf(FRAGMENT_PREFIX + bytesToBase64url(Uint8Array.from(bytes)));
    }
  });

  it("a version field of 999999 asks for a newer app; other hostile versions are errors", () => {
    expect(errorOf(fragmentOf({ ...good, v: 999999 }))).toBe(
      "This link needs a newer version of the app (it is scenario version 999999; this app reads up to version 3). Reload the page to get the latest version, then open the link again. Nothing was loaded.",
    );
    for (const v of [1e308, -1, 0, 2.5, "2", [2], { v: 2 }, true, null]) errorOf(fragmentOf({ ...good, v }));
  });

  it("wrong top-level shapes: arrays, strings, numbers, null, nested payloads", () => {
    for (const p of ["[]", '"s"', "42", "null", "true", `[${goodJson}]`, `{"s":${goodJson}}`]) errorOf(fragmentOf(p));
  });

  it("wrong types everywhere inside an otherwise valid payload produce a bounded partial load, never a throw", () => {
    const hostile: unknown[] = [null, true, "x".repeat(300), 1e308, -1e308, [], {}, [[[]]], { a: { b: 1 } }];
    for (const bad of hostile) {
      for (const key of ["g", "b", "bb", "tn", "tx", "sw", "sl", "r", "f", "n", "sd", "st"]) measuredDecode(fragmentOf({ ...good, [key]: bad }));
      measuredDecode(fragmentOf({ ...good, st: [bad, ["kelly", bad], ["p", bad, bad, bad, bad], ["p", "n", 1, [bad], [[bad]]], ["q", bad, bad, bad], ["p", "n", 1, [[bad, bad]], [[["m", bad]]]]] }));
    }
    prototypeIsClean();
  });
});
