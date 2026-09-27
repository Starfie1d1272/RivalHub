import { describe, expect, it, vi } from "vitest";
import { assertSteamProfileCoverage, inspectSteamProfileCoverage } from "../../../scripts/db/steam-profile-coverage";

function clientFor(row: Record<string, string>) {
  return { query: vi.fn().mockResolvedValue({ rows: [row] }) };
}

describe("Steam profile coverage gate", () => {
  it("reports a ready cache when all active primary Steam64 users are covered", async () => {
    const client = clientFor({
      active_primary_users: "2",
      cached_profiles: "2",
      missing_profiles: "0",
    });

    const report = await inspectSteamProfileCoverage(client);

    expect(report).toEqual({
      mode: "read-only",
      activePrimaryUsers: 2,
      cachedProfiles: 2,
      missingProfiles: 0,
      coveragePercent: 100,
      ready: true,
    });
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("FILTER (WHERE steam_profiles.steam64 IS NULL)"));
    expect(() => assertSteamProfileCoverage(report)).not.toThrow();
  });

  it("fails closed for unresolved profiles", async () => {
    const report = await inspectSteamProfileCoverage(clientFor({
      active_primary_users: "2",
      cached_profiles: "1",
      missing_profiles: "1",
    }));

    expect(report.ready).toBe(false);
    expect(() => assertSteamProfileCoverage(report)).toThrow(/missing=1/);
  });
});
