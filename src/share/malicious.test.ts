import { describe, expect, it, vi } from "vitest";
import { defaultScenario } from "../scenario";
import { base64urlToBytes, bytesToBase64url } from "./base64url";
import { decodeScenarioLink, encodeScenarioLink, jsonDepthExceeds, type LoadResult } from "./link";
import { FRAGMENT_PREFIX, MAX_FRAGMENT_CHARS, MAX_JSON_DEPTH } from "./limits";
import { fragmentOf } from "./testLinks";

// The decoder's base64 stage, wrapped so every call (and its input size) can be counted. The real
// function still does the work; link.ts imports this same wrapped export.
vi.mock("./base64url", async (importOriginal) => {
  const m = await importOriginal<{ base64urlToBytes: typeof base64urlToBytes }>();
  return { ...m, base64urlToBytes: vi.fn(m.base64urlToBytes) };
});

// A link is attacker-controlled. Every hostile input below must produce a BOUNDED error (or a
// bounded partial load), never throw, never hang, and never grow memory. The protection is asserted
// DETERMINISTICALLY by counting what each decode stage (base64, UTF-8, JSON.parse) is handed:
//   - a fragment over MAX_FRAGMENT_CHARS reaches NO stage at all (refused by length alone);
//   - otherwise base64 sees at most the cap, UTF-8 decoding at most 3/4 of it in bytes, and
//     JSON.parse runs at most once, only on text within the cap and within MAX_JSON_DEPTH.
// A generous wall-clock backstop (HANG_BACKSTOP_MS) only catches a real hang; a tight time limit
// flaked on shared CI runners (68 ms against 50 ms on an input refused by its length check).
// Heap growth is bounded too (the input itself is allocated before measuring), and every message is short.
const HANG_BACKSTOP_MS = 1000;
const HEAP_LIMIT_BYTES = 2 * 1024 * 1024;
const MESSAGE_LIMIT = 600;
const DROPPED_LIMIT = 40;

type NodeProcess = { memoryUsage(): { heapUsed: number } };
const proc = (globalThis as unknown as { process: NodeProcess }).process;

const good = { v: 2, g: "european", b: 1000, bb: 10, tn: 1, sw: 1100, r: 1000, n: 10000, sd: 12345, st: [["flat"], ["kelly", { fraction: 0.5 }]] };
const goodJson = JSON.stringify(good);

const base64Spy = vi.mocked(base64urlToBytes);

/** Runs one decode and returns the input sizes each decoding stage was handed. */
function countedDecode(hash: string): { r: LoadResult; base64: number[]; utf8: number[]; json: string[] } {
  base64Spy.mockClear();
  const utf8: number[] = [];
  const json: string[] = [];
  const realDecode = TextDecoder.prototype.decode;
  const realParse = JSON.parse;
  const decodeSpy = vi.spyOn(TextDecoder.prototype, "decode").mockImplementation(function (this: TextDecoder, input?: AllowSharedBufferSource, options?: TextDecodeOptions) {
    utf8.push(input ? input.byteLength : 0);
    return realDecode.call(this, input, options);
  });
  const parseSpy = vi.spyOn(JSON, "parse").mockImplementation((text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown) => {
    json.push(text);
    return realParse(text, reviver);
  });
  let r: LoadResult | undefined;
  try {
    expect(() => (r = decodeScenarioLink(hash))).not.toThrow();
  } finally {
    decodeSpy.mockRestore();
    parseSpy.mockRestore();
  }
  return { r: r!, base64: base64Spy.mock.calls.map(([s]) => s.length), utf8, json };
}

function measuredDecode(hash: string): LoadResult {
  // V8 builds long concatenations lazily and flattens them on first character access. A real
  // location.hash is already flat, so flatten the INPUT here, before measuring the decoder.
  void hash.charCodeAt(hash.length - 1);
  const heap0 = proc.memoryUsage().heapUsed;
  const t0 = performance.now();
  const { r, base64, utf8, json } = countedDecode(hash);
  const ms = performance.now() - t0;
  const heap = proc.memoryUsage().heapUsed - heap0;
  const stages = `base64 ${JSON.stringify(base64)}, utf8 ${JSON.stringify(utf8)}, JSON.parse ${json.length}`;
  if (hash.length > MAX_FRAGMENT_CHARS) {
    // Over the cap: refused by its length alone; not one character is decoded.
    expect(base64, stages).toEqual([]);
    expect(utf8, stages).toEqual([]);
    expect(json, stages).toEqual([]);
  } else {
    expect(base64.length, stages).toBeLessThanOrEqual(1);
    for (const n of base64) expect(n, stages).toBeLessThanOrEqual(MAX_FRAGMENT_CHARS - FRAGMENT_PREFIX.length);
    expect(utf8.length, stages).toBeLessThanOrEqual(1);
    for (const n of utf8) expect(n, stages).toBeLessThanOrEqual(Math.floor(((MAX_FRAGMENT_CHARS - FRAGMENT_PREFIX.length) * 3) / 4));
    expect(json.length, stages).toBeLessThanOrEqual(1);
    for (const text of json) {
      expect(text.length, stages).toBeLessThanOrEqual(MAX_FRAGMENT_CHARS);
      expect(jsonDepthExceeds(text, MAX_JSON_DEPTH), "JSON.parse was handed over-deep text").toBe(false);
    }
  }
  expect(ms, `decode took ${ms.toFixed(1)} ms (hang backstop only)`).toBeLessThan(HANG_BACKSTOP_MS);
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
    // Control: the stage counters do see a real decode (a valid link reaches each stage exactly once),
    // so the "no stage reached" assertions below are meaningful.
    const control = countedDecode(fragmentOf(good));
    expect(control.r.kind).toBe("loaded");
    expect([control.base64.length, control.utf8.length, control.json.length]).toEqual([1, 1, 1]);
    const huge = FRAGMENT_PREFIX + "A".repeat(20_000_000);
    expect(countedDecode(huge)).toMatchObject({ base64: [], utf8: [], json: [] });
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
      "This link needs a newer version of the app (it is scenario version 999999; this app reads up to version 4). Reload the page to get the latest version, then open the link again. Nothing was loaded.",
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
