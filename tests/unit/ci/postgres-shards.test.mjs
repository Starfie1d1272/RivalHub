import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BaseSequencer } from "vitest/node";
import { parse } from "yaml";
import { classifyChangedFiles } from "../../../scripts/ci/plan.mjs";
import { integrationArgs } from "../../../scripts/db/pg17-integration.ts";

// A missing shard or a lost affected filter could falsely certify untested DB
// contracts. Discover the real config's files and use Vitest's own sequencer,
// rather than duplicating its hash/partition algorithm or starting a database.
describe("bounded PostgreSQL evidence", () => {
  it("runs the complete configured PG file set exactly once across two FULL shards", async () => {
    const plan = classifyChangedFiles([{ status: "M", paths: [".github/workflows/ci.yml"] }]);
    expect(plan.postgresMatrix).toEqual([{ shard: "1/2" }, { shard: "2/2" }]);
    const discovered = JSON.parse(execFileSync(resolve("node_modules/.bin/vitest"), [
      "list", "--config=vitest.integration.config.ts", "--filesOnly", "--json",
    ], { encoding: "utf8" }));
    const files = discovered.map(({ file }) => ({ moduleId: file }));
    expect(files.length).toBeGreaterThan(0);
    const shards = await Promise.all(plan.postgresMatrix.map(async ({ shard }) => {
      const [index, count] = shard.split("/").map(Number);
      const sequencer = new BaseSequencer({ config: { root: process.cwd(), shard: { index, count } } });
      return (await sequencer.shard(files)).map(({ moduleId }) => moduleId);
    }));
    expect(shards.every(shard => shard.length > 0)).toBe(true);
    expect(shards.flat().sort()).toEqual(files.map(({ moduleId }) => moduleId).sort());
    expect(new Set(shards.flat()).size).toBe(files.length);
  });

  it("keeps affected filters on one runner and forwards shard flags without replacing the selection", () => {
    const path = "tests/integration/db/bet-bp-reader-compat.test.ts";
    const affected = classifyChangedFiles([{ status: "M", paths: [path] }]);
    expect(affected.postgresMatrix).toEqual([{ shard: "1/1" }]);
    expect(affected.integrationSpecs).toEqual([path]);
    expect(integrationArgs([], {
      RIVALHUB_INTEGRATION_SPECS: JSON.stringify(affected.integrationSpecs), RIVALHUB_INTEGRATION_SHARD: "1/1",
    })).toEqual([path, "--shard=1/1"]);
    expect(integrationArgs([], { RIVALHUB_INTEGRATION_SPECS: "[]", RIVALHUB_INTEGRATION_SHARD: "2/2" }))
      .toEqual(["--shard=2/2"]);
    expect(integrationArgs(["--", path], { RIVALHUB_INTEGRATION_SHARD: "1/2" })).toEqual([path, "--shard=1/2"]);
    expect(integrationArgs([path], {})).toEqual([path]);
    expect(classifyChangedFiles([{ status: "M", paths: ["docs/testing.md"] }]).postgresMatrix).toEqual([]);
  });

  it("shards a migration-selected complete PG suite without escalating unrelated static/system evidence", () => {
    const migration = classifyChangedFiles([{ status: "A", paths: ["drizzle/migrations/0087_veto-lifecycle-scheduler-gate.sql"] }]);
    expect(migration.full).toBe(false);
    expect(migration.integrationSpecs).toEqual([]);
    expect(migration.postgresMatrix).toEqual([{ shard: "1/2" }, { shard: "2/2" }]);
    expect(integrationArgs([], { RIVALHUB_INTEGRATION_SPECS: "[]", RIVALHUB_INTEGRATION_SHARD: "1/2" })).toEqual(["--shard=1/2"]);
    expect(integrationArgs([], { RIVALHUB_INTEGRATION_SPECS: "[]", RIVALHUB_INTEGRATION_SHARD: "2/2" })).toEqual(["--shard=2/2"]);
  });

  it("rejects invalid or conflicting shard configuration", () => {
    for (const shard of ["", "0/2", "3/2", "1/3", "1/100"]) {
      expect(() => integrationArgs([], { RIVALHUB_INTEGRATION_SHARD: shard })).toThrow(/最多两个/);
    }
    expect(() => integrationArgs(["--shard=1/2"], { RIVALHUB_INTEGRATION_SHARD: "2/2" })).toThrow(/不能同时/);
    expect(() => integrationArgs([], { RIVALHUB_INTEGRATION_SPECS: "bad", RIVALHUB_INTEGRATION_SHARD: "1/1" }))
      .toThrow(/JSON 数组/);
  });

  // Workflow safety: both jobs must finish, any failure must reach the gate,
  // and the two timing artifacts must not overwrite each other.
  it("waits for the bounded matrix and preserves failure aggregation and separate artifacts", () => {
    const { jobs } = parse(readFileSync(resolve(".github/workflows/ci.yml"), "utf8"));
    const pg = jobs.postgres;
    expect(pg.strategy["fail-fast"]).toBe(false);
    expect(pg.strategy["max-parallel"]).toBe(2);
    expect(pg.strategy.matrix.include).toBe("${{ fromJSON(needs.plan.outputs.postgres_matrix) }}");
    expect(pg.env.RIVALHUB_INTEGRATION_SHARD).toBe("${{ matrix.shard }}");
    expect(pg.env.RIVALHUB_INTEGRATION_SPECS).toBe("${{ needs.plan.outputs.integration_specs }}");
    expect(pg.services.postgres.image).toBe("postgres:17");
    expect(pg["continue-on-error"]).toBeUndefined();
    expect(pg.steps.every(step => !step["continue-on-error"])).toBe(true);
    expect(pg.steps.find(step => step.name === "Preserve machine-readable evidence").with.name)
      .toBe("timing-${{ github.job }}-${{ strategy.job-index }}");
    expect(jobs.gate.needs).toContain("postgres");
    expect(jobs.gate.steps.find(step => step.name === "Validate required evidence").env.POSTGRES_RESULT)
      .toBe("${{ needs.postgres.result }}");
  });
});
