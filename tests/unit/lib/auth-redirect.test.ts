import { describe, expect, it } from "vitest";
import { safeLocalRedirect } from "@/lib/auth/redirect";

describe("safeLocalRedirect", () => {
  it.each([
    ["/settings", "/settings"],
    ["/2026-nju-rivals/draft?tab=history", "/2026-nju-rivals/draft?tab=history"],
  ])("keeps safe local paths (%s)", (raw, expected) => {
    expect(safeLocalRedirect(raw)).toBe(expected);
  });

  it.each([
    ["https://evil.example/", "/"],
    ["//evil.example/", "/"],
    ["/\\\\evil.example/", "/"],
    ["/\u0000evil", "/"],
  ])("rejects unsafe redirect targets (%s)", (raw, expected) => {
    expect(safeLocalRedirect(raw)).toBe(expected);
  });

  it("supports a safe fallback used by the logged-in login page", () => {
    expect(safeLocalRedirect("//evil.example/", "/settings")).toBe("/settings");
    expect(safeLocalRedirect("/captains", "/settings")).toBe("/captains");
  });
});
