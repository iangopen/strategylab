import { describe, expect, it } from "vitest";
import { base64urlToBytes, bytesToBase64url } from "./base64url";

describe("base64url", () => {
  it("round-trips every length 0..64 and every byte value", () => {
    for (let n = 0; n <= 64; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff);
      const s = bytesToBase64url(bytes);
      expect(s).toMatch(/^[A-Za-z0-9_-]*$/);
      const back = base64urlToBytes(s);
      expect(back.ok && Array.from(back.bytes)).toEqual(Array.from(bytes));
    }
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    const back = base64urlToBytes(bytesToBase64url(all));
    expect(back.ok && Array.from(back.bytes)).toEqual(Array.from(all));
  });

  it("matches the RFC 4648 test vectors (§10), unpadded, and the url-safe alphabet", () => {
    const enc = (s: string) => bytesToBase64url(new TextEncoder().encode(s));
    expect(["", "f", "fo", "foo", "foob", "fooba", "foobar"].map(enc)).toEqual(["", "Zg", "Zm8", "Zm9v", "Zm9vYg", "Zm9vYmE", "Zm9vYmFy"]);
    expect(bytesToBase64url(Uint8Array.from([0xfb, 0xff, 0xbf]))).toBe("-_-_"); // 62 -> "-", 63 -> "_"
  });

  it("rejects invalid characters with a position, and impossible lengths, without throwing", () => {
    expect(base64urlToBytes("abc!")).toEqual({ ok: false, error: "The link contains a character that can't be part of a scenario (position 4)." });
    expect(base64urlToBytes("ab+/").ok).toBe(false); // standard base64 characters are not base64url
    expect(base64urlToBytes("ab=").ok).toBe(false); // no padding
    expect(base64urlToBytes("aé").ok).toBe(false);
    expect(base64urlToBytes("abcde")).toEqual({ ok: false, error: "The link is cut off (its data has an impossible length). Copy the whole link again." });
    expect(base64urlToBytes("")).toEqual({ ok: true, bytes: new Uint8Array(0) });
  });
});
