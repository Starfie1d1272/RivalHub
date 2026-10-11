import { describe, expect, it } from "vitest";
import { extractErrorDigest, safeErrorDigest } from "@/lib/observability/error-digest";
import { sanitizeSafeContext } from "@/lib/observability/redact";

describe("error diagnostic trust boundary", () => {
  it("preserves hashes exactly and rejects arbitrary text instead of trimming or truncating", () => {
    for (const digest of ["0", "1234567890", "1".repeat(20)]) {
      expect(safeErrorDigest(digest)).toBe(digest);
      expect(sanitizeSafeContext({ errorDigest: digest })).toEqual({ errorDigest: digest });
    }
    for (const value of [undefined, null, 123, ["123"], "", "1".repeat(21), " 123", "123\n", "123-secret", "user@example.test", "<script>", "NEXT_REDIRECT", "１２３", { toString() { throw new Error("coercion"); } }]) {
      expect(safeErrorDigest(value)).toBeUndefined();
      expect(sanitizeSafeContext({ errorDigest: value })).toEqual({});
    }
  });
  it("survives missing or hostile digest properties without reading the raw cause", () => {
    expect(extractErrorDigest(null)).toBeUndefined();
    expect(extractErrorDigest(new Error("private"))).toBeUndefined();
    const hostile = Object.defineProperty({}, "digest", { get() { throw new Error("private"); } });
    expect(extractErrorDigest(hostile)).toBeUndefined();
    const error = Object.defineProperty({ digest: "123" }, "message", { get() { throw new Error("must not read"); } });
    expect(extractErrorDigest(error)).toBe("123");
  });
});
