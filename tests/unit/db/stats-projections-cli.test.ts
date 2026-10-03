import { describe, expect, it } from "vitest";
import { parseStatsProjectionArguments, statsProjectionDatabaseTarget, STATS_PROJECTION_WRITE_CONFIRMATION } from "../../../scripts/db/stats-projections";

describe("statistics projection rebuild boundary", () => {
  it("defaults to dry-run and limits only explicit backfills", () => {
    expect(parseStatsProjectionArguments(["backfill"])).toEqual({ mode: "backfill", apply: false, limit: undefined });
    expect(parseStatsProjectionArguments(["--", "backfill", "--apply", "--limit", "2"])).toEqual({ mode: "backfill", apply: true, limit: 2 });
    expect(() => parseStatsProjectionArguments(["coverage", "--apply"])).toThrow();
    expect(() => parseStatsProjectionArguments(["backfill", "--limit", "0"])).toThrow();
  });

  it("accepts explicit coverage budgets without weakening read-only mode", () => {
    expect(parseStatsProjectionArguments(["coverage", "--scan-limit", "20000", "--batch-size", "100", "--max-duration-ms", "120000"]))
      .toMatchObject({ mode: "coverage", apply: false, coverageOptions: { scanLimit: 20000, batchSize: 100, maxDurationMs: 120000 } });
    expect(() => parseStatsProjectionArguments(["coverage", "--scan-limit", "0"])).toThrow();
  });

  it("requires protected remote authorization and a separate write confirmation", () => {
    const remote = { NODE_ENV: "test" as const, RIVALHUB_DB_TARGET: "production", DATABASE_URL: "postgresql://example.invalid/database" };
    expect(() => statsProjectionDatabaseTarget(false, remote)).toThrow("protected");
    expect(() => statsProjectionDatabaseTarget(true, { ...remote, RIVALHUB_PROTECTED_WRITE_TARGET: "production" })).toThrow("RIVALHUB_STATS_PROJECTION_WRITE_CONFIRM");
    expect(statsProjectionDatabaseTarget(true, {
      ...remote, RIVALHUB_PROTECTED_WRITE_TARGET: "production", RIVALHUB_STATS_PROJECTION_WRITE_CONFIRM: STATS_PROJECTION_WRITE_CONFIRMATION,
    }).target).toBe("production");
    expect(() => statsProjectionDatabaseTarget(true, { ...remote, RIVALHUB_DB_TARGET: "local" })).toThrow();
    expect(statsProjectionDatabaseTarget(false, { NODE_ENV: "test", RIVALHUB_DB_TARGET: "local", DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/test" }).target).toBe("local");
  });
});
