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
  it("runs missing-season repair in the protected data phase without schema replay", () => {
    const result = plan([{ status: "A", paths: ["src/lib/competitive/profile-repair.ts"] }]);
    expect(result.requiresCompetitiveProfileRepair).toBe(true);
    expect(result.requiresProductionMigration).toBe(true);
    expect(result.requiresMigrationRehearsal).toBe(false);
    expect(result.requiresDbCheckpoint).toBe(false);
    expect(plan([{ status: "M", paths: ["src/lib/competitive/normalize-profile.ts"] }]).requiresCompetitiveProfileRepair).toBe(false);
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

  it("requires the protected Steam profile gate when a migration creates its cache", () => {
    const result = plan(
      [{ status: "A", paths: ["drizzle/migrations/0052_expand.sql"] }],
      { "drizzle/migrations/0052_expand.sql": 'CREATE TABLE "steam_profiles" (steam64 text NOT NULL);' },
    );

    expect(result.requiresSteamProfileBackfill).toBe(true);
  });

  it("requires projection backfill before routing a new table or reducer version", () => {
    const schema = plan(
      [{ status: "A", paths: ["drizzle/migrations/0067_projection.sql"] }],
      { "drizzle/migrations/0067_projection.sql": 'CREATE TABLE "match_demo_stat_projections" (import_id uuid NOT NULL);' },
    );
    expect(schema.requiresStatsProjectionBackfill).toBe(true);
    const version = plan([{ status: "M", paths: ["src/lib/stats/projection-version.ts"] }]);
    expect(version.requiresStatsProjectionBackfill).toBe(true);
    expect(version.requiresProductionMigration).toBe(true);
    expect(version.requiresMigrationRehearsal).toBe(false);
    expect(plan([{ status: "M", paths: ["src/lib/stats/format.ts"] }]).requiresStatsProjectionBackfill).toBe(false);
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

});

// A main ancestry check cannot prove the reader was actually shipped before publication.
it("gates new BET subjects on frozen previous Production, including skipped/combined releases",()=>{
  const dir=mkdtempSync(join(tmpdir(),"rivalhub-bet-upgrade-"));
  const git=(args:string[])=>execFileSync("git",args,{cwd:dir,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
  const commit=(message:string)=>{git(["add","."]);git(["commit","--quiet","-m",message]);return git(["rev-parse","HEAD"]);};
  const contract=(readerVersion:number,publisherVersion:number)=>writeFileSync(join(dir,"src/lib/bet/catalog-contract.json"),JSON.stringify({readerVersion,publisherVersion}));
  try {
    git(["init","--quiet"]);git(["config","user.email","bet-upgrade@example.invalid"]);git(["config","user.name","BET Upgrade Test"]);
    mkdirSync(join(dir,"src/lib/bet"),{recursive:true});writeFileSync(join(dir,"package.json"),'{}');
    const legacy=commit("legacy");
    contract(2,1);const compatibility=commit("compatibility reader only");
    contract(2,2);const publication=commit("new publisher");
    const build=(previousReleaseCommit:string,releaseSha:string)=>buildReleasePlan({cwd:dir,previousReleaseCommit,releaseSha});
    expect(()=>build(legacy,compatibility)).not.toThrow();
    expect(()=>build(legacy,publication)).toThrow(/必须先独立发布兼容读取版本/);
    expect(()=>build(compatibility,publication)).not.toThrow();
    // Relief's global v3 switch cannot authorize BO3 publication.
    contract(3,2);const reliefReader=commit("relief reader only");
    const capability=(readerVersion:number,publisherVersion:number)=>writeFileSync(join(dir,"src/lib/bet/catalog-contract.json"),JSON.stringify({readerVersion:3,publisherVersion:3,capabilities:{bo3BpPresence:{readerVersion,publisherVersion}}}));
    capability(1,0);const presenceReader=commit("relief publisher plus BO3 reader only");
    capability(1,1);const presencePublisher=commit("BO3 presence publisher");
    expect(()=>build(reliefReader,presenceReader)).not.toThrow();
    expect(()=>build(reliefReader,presencePublisher)).toThrow(/capability bo3BpPresence compatibility gate/);
    expect(()=>build(presenceReader,presencePublisher)).not.toThrow();
    contract(3,3);const presenceDowngrade=commit("drop presence capability");
    expect(()=>build(presencePublisher,presenceDowngrade)).toThrow(/capability bo3BpPresence compatibility gate/);
    capability(0,1);const invalidCapability=commit("invalid BO3 capability");
    expect(()=>build(presenceReader,invalidCapability)).toThrow(/capability bo3BpPresence 无效/);
    contract(1,1);const downgrade=commit("incompatible reader downgrade");
    expect(()=>build(publication,downgrade)).toThrow(/compatibility gate/);
    contract(1,2);const malformed=commit("invalid contract");
    expect(()=>build(compatibility,malformed)).toThrow(/contract 无效/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
