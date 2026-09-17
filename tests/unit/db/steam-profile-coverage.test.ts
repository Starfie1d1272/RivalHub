import { describe, expect, it, vi } from "vitest";
import { assertSteamProfileCoverage, inspectSteamProfileCoverage } from "../../../scripts/db/steam-profile-coverage";

function clientFor(row: Record<string, string>) {
  return { query: vi.fn().mockResolvedValue({ rows: [row] }) };
}

describe("Steam profile coverage gate", () => {
  it("reports a ready cache and legacy shadow", async () => {
    const client = clientFor({
      active_primary_users: "2",
      cached_profiles: "2",
      missing_profiles: "0",
      legacy_shadow_mismatches: "0",
    });

    const report = await inspectSteamProfileCoverage(client);

    expect(report).toEqual({
      mode: "read-only",
      activePrimaryUsers: 2,
      cachedProfiles: 2,
      missingProfiles: 0,
      legacyShadowMismatches: 0,
      coveragePercent: 100,
      ready: true,
    });
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("IS DISTINCT FROM"));
    expect(() => assertSteamProfileCoverage(report)).not.toThrow();
  });

  it("fails closed for unresolved profiles or a stale rollback shadow", async () => {
    const report = await inspectSteamProfileCoverage(clientFor({
      active_primary_users: "2",
      cached_profiles: "1",
      missing_profiles: "1",
      legacy_shadow_mismatches: "1",
    }));

    expect(report.ready).toBe(false);
    expect(() => assertSteamProfileCoverage(report)).toThrow(/missing=1/);
  });
});
