import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildReleasePlan, type BuildReleasePlanOptions } from "../../../scripts/release/plan";

let fixtureDirectory: string;
let releaseSha: string;
let previousReleaseCommit: string;

beforeAll(() => {
  fixtureDirectory = mkdtempSync(join(tmpdir(), "rivalhub-release-plan-test-"));
  runGit(["init", "--quiet"]);
  runGit(["config", "user.email", "rivalhub-release-plan@example.invalid"]);
  runGit(["config", "user.name", "RivalHub Release Plan Test"]);
  writePackageVersion("2.10.0");
  writeReleaseTimeCapabilities(false);
  runGit(["add", "package.json"]);
  runGit(["add", "scripts/release/release-time-capabilities.json"]);
  runGit(["commit", "--quiet", "-m", "baseline"]);
  previousReleaseCommit = runGit(["rev-parse", "HEAD"]);
  writePackageVersion("2.10.1");
  runGit(["add", "package.json"]);
  runGit(["commit", "--quiet", "-m", "candidate"]);
  releaseSha = runGit(["rev-parse", "HEAD"]);
});

afterAll(() => {
  rmSync(fixtureDirectory, { recursive: true, force: true });
});

function plan(entries: BuildReleasePlanOptions["entries"], migrationContents?: Record<string, string>) {
  return buildReleasePlan({ cwd: fixtureDirectory, releaseSha, previousReleaseCommit, entries, migrationContents });
}

function runGit(args: readonly string[]): string {
  return execFileSync("git", args, { cwd: fixtureDirectory, encoding: "utf8" }).trim();
}

function writePackageVersion(version: string): void {
  writeFileSync(join(fixtureDirectory, "package.json"), JSON.stringify({
    name: "rivalhub-release-plan-fixture",
    version,
    packageManager: "pnpm@12.3.4",
    scripts: { build: "next build" },
    dependencies: { next: "16.0.0" },
  }, null, 2) + "\n");
}

function writeReleaseTimeCapabilities(storageMutation: boolean): void {
  const path = join(fixtureDirectory, "scripts/release/release-time-capabilities.json");
  mkdirSync(join(fixtureDirectory, "scripts/release"), { recursive: true });
  writeFileSync(path, JSON.stringify({ storageMutation }, null, 2) + "\n");
}

describe("release plan", () => {
  it("classifies release metadata without treating package version as application code", () => {
    const result = plan([
      { status: "D", paths: [".changeset/release.md"] },
      { status: "M", paths: ["CHANGELOG.md"] },
      { status: "M", paths: ["package.json"] },
    ]);

    expect(result.applicationChanged).toBe(false);
    expect(result.migrationRisk).toBe("none");
    expect(result.requiresMigrationRehearsal).toBe(false);
  });

  it("requires rehearsal and production migration for forward-compatible SQL", () => {
    const result = plan(
      [{ status: "A", paths: ["drizzle/migrations/0052_expand.sql"] }],
      { "drizzle/migrations/0052_expand.sql": "ALTER TABLE teams ADD COLUMN display_name text;" },
    );

    expect(result.migrationChanged).toBe(true);
    expect(result.migrationRisk).toBe("forward-compatible");
    expect(result.requiresMigrationRehearsal).toBe(true);
    expect(result.requiresProductionMigration).toBe(true);
    expect(result.requiresDbCheckpoint).toBe(false);
  });

  it("requires a DB-only checkpoint for destructive or unrecognised SQL", () => {
    const result = plan(
      [{ status: "M", paths: ["drizzle/migrations/0053_contract.sql"] }],
      { "drizzle/migrations/0053_contract.sql": "UPDATE teams SET display_name = 'rewritten';" },
    );

    expect(result.migrationRisk).toBe("irreversible");
    expect(result.requiresDbCheckpoint).toBe(true);
    expect(result.requiresFullCheckpoint).toBe(false);
  });

  it("fails closed when a migration change has no SQL body to classify", () => {
    const result = plan([{ status: "M", paths: ["drizzle/migrations/meta/_journal.json"] }]);

    expect(result.migrationRisk).toBe("irreversible");
    expect(result.requiresDbCheckpoint).toBe(true);
  });

  it("does not confuse application Storage callers with release-time Storage mutation", () => {
    const result = plan([
      { status: "M", paths: ["src/components/teams/TeamLogoUpload.tsx"] },
      { status: "M", paths: ["src/actions/season-public-info.ts"] },
      { status: "M", paths: ["src/lib/education/retention.ts"] },
      { status: "M", paths: ["src/app/admin/settings/page.tsx"] },
      { status: "M", paths: ["src/components/admin/SchedulerHealthPanel.tsx"] },
      { status: "M", paths: ["src/lib/scheduler/execution.ts"] },
      { status: "M", paths: ["package.json"] },
      { status: "M", paths: ["scripts/release/plan.ts"] },
      { status: "M", paths: ["scripts/db/recovery/manifest.ts"] },
    ]);

    expect(result.applicationChanged).toBe(true);
    expect(result.storageMutationChanged).toBe(false);
    expect(result.schedulerChanged).toBe(false);
    expect(result.releaseInfraChanged).toBe(true);
    expect(result.recoveryInfraChanged).toBe(true);
    expect(result.requiresFullCheckpoint).toBe(false);
  });

  it("requires a full checkpoint only when the release-time capability declares a Storage mutation", () => {
    writeReleaseTimeCapabilities(true);
    runGit(["add", "scripts/release/release-time-capabilities.json"]);
    runGit(["commit", "--quiet", "-m", "enable release-time storage capability"]);
    const capabilityReleaseSha = runGit(["rev-parse", "HEAD"]);
    const result = buildReleasePlan({
      cwd: fixtureDirectory,
      releaseSha: capabilityReleaseSha,
      previousReleaseCommit,
      entries: [{ status: "M", paths: ["scripts/release/release-time-capabilities.json"] }],
    });

    expect(result.storageMutationChanged).toBe(true);
    expect(result.requiresFullCheckpoint).toBe(true);
  });

  it("only provisions the production scheduler for its provisioning contract", () => {
    const runtime = plan([{ status: "M", paths: ["src/lib/scheduler/execution.ts"] }]);
    const route = plan([{ status: "M", paths: ["src/app/api/cron/draft-timeout/route.ts"] }]);
    const definitions = plan([{ status: "M", paths: ["src/lib/scheduler/definitions.ts"] }]);
    const unknownOwnerPath = plan([{ status: "A", paths: ["src/lib/scheduler/provider-contract.ts"] }]);

    expect(runtime.schedulerChanged).toBe(false);
    expect(runtime.requiresSchedulerProvision).toBe(false);
    expect(route.schedulerChanged).toBe(false);
    expect(definitions.schedulerChanged).toBe(true);
    expect(unknownOwnerPath.schedulerChanged).toBe(true);
  });
});
