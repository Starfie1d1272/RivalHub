import { expect, it } from "vitest";
import { safeStatsReturn } from "./return-context";
// A return link must never turn profile navigation into an external redirect.
it("accepts a local stats context and rejects external or unrelated destinations", () => {
  expect(safeStatsReturn("/stats?event=history&tab=players&sort=adr&page=2")).toBe("/stats?event=history&tab=players&sort=adr&page=2");
  for (const value of ["https://evil.example/stats", "//evil.example/stats", "/admin?event=x", "/stats?redirect=https://evil.example", "/stats?x=1\n"]) expect(safeStatsReturn(value)).toBeNull();
});
