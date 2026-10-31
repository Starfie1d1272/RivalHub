import { describe, expect, it } from "vitest";
import { parseStatsProjectionArguments, statsProjectionDatabaseTarget, STATS_PROJECTION_WRITE_CONFIRMATION } from "../../../scripts/db/stats-projections";

describe("transport backfill command", () => {
  it("defaults to read-only and accepts a bounded resumable apply", () => {
    expect(parseStatsProjectionArguments(["transport-backfill"])).toMatchObject({ mode: "transport-backfill", apply: false });
    expect(parseStatsProjectionArguments(["transport-backfill", "--apply", "--limit", "5", "--cursor", "cursor"])).toMatchObject({ apply: true, limit: 5, cursor: "cursor" });
    expect(() => parseStatsProjectionArguments(["coverage", "--apply"])).toThrow();
  });
  it("requires the protected production write target and explicit confirmation for apply", () => {
    const env = { NODE_ENV: "test" as const, RIVALHUB_DB_TARGET: "production", DATABASE_URL: "postgres://example.invalid/db", RIVALHUB_PROTECTED_READ_ONLY_TARGET: "production" };
    expect(statsProjectionDatabaseTarget(false, env).target).toBe("production");
    expect(() => statsProjectionDatabaseTarget(true, env)).toThrow();
    const writable = { ...env, RIVALHUB_PROTECTED_WRITE_TARGET: "production" };
    expect(() => statsProjectionDatabaseTarget(true, writable)).toThrow();
    expect(statsProjectionDatabaseTarget(true, { ...writable, RIVALHUB_STATS_PROJECTION_WRITE_CONFIRM: STATS_PROJECTION_WRITE_CONFIRMATION }).target).toBe("production");
  });
});
