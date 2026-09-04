import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MIGRATION_CONTRACT_ANNOTATION, MIGRATION_LOCKING_ANNOTATION } from "../../../scripts/db/migration-risk";
import { checkReleaseCompatibility } from "../../../scripts/db/release-compat";

const ENVIRONMENT_KEYS = [
  "RIVALHUB_MIGRATION_BASE_SHA",
  "RIVALHUB_MIGRATION_HEAD_SHA",
  "RIVALHUB_PREVIOUS_RELEASE_TAG",
  "RIVALHUB_PRODUCTION_STABLE_REF",
] as const;
const originalEnvironment = new Map(ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]));
const fixtureDirectories: string[] = [];

const OLD_TEAMS_SOURCE = `export const teams = pgTable("teams", {
  oldColumn: text("old_column"),
});
`;
const NEW_TEAMS_SOURCE = `export const teams = pgTable("teams", {
  newColumn: text("new_column"),
});
`;

afterEach(() => {
  for (const key of ENVIRONMENT_KEYS) {
    const value = originalEnvironment.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  while (fixtureDirectories.length > 0) {
    const directory = fixtureDirectories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe("release compatibility gate", () => {
  it.each([
    ["DROP", `DROP TABLE "old_teams";`],
    ["RENAME", `ALTER TABLE "teams" RENAME COLUMN "old_column" TO "new_column";`],
  ])("fails when previous stable source still owns a %s contract", (_label, sql) => {
    const source = _label === "DROP"
      ? `export const oldTeams = pgTable("old_teams", { id: uuid("id") });\n`
      : OLD_TEAMS_SOURCE;
    const fixture = createFixture({ migration: `${MIGRATION_CONTRACT_ANNOTATION}\n${sql}`, source });
    const result = checkReleaseCompatibility(fixture.directory);

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatch(/drizzle\/migrations\/0002_next\.sql:2 \[(?:drop|rename)\]/);
    expect(result.failures[0]).toContain("src/db/schema/teams.ts:");
    expect(result.failures[0]).toContain("previous stable");
  });

  it("fails a column contract even when migration-risk annotation exists", () => {
    const fixture = createFixture({
      migration: `${MIGRATION_CONTRACT_ANNOTATION}\nALTER TABLE "teams" DROP COLUMN "old_column";`,
      source: OLD_TEAMS_SOURCE,
    });
    const result = checkReleaseCompatibility(fixture.directory);

    expect(result.findings[0]).toMatchObject({ status: "fail", finding: { category: "drop" } });
    expect(result.failures[0]).toContain("annotation 只声明 cleanup 意图");
  });

  it("passes after previous stable has switched to the new column owner", () => {
    const fixture = createFixture({
      migration: `${MIGRATION_CONTRACT_ANNOTATION}\nALTER TABLE "teams" DROP COLUMN "old_column";`,
      source: NEW_TEAMS_SOURCE,
    });
    const result = checkReleaseCompatibility(fixture.directory);

    expect(result.failures).toEqual([]);
    expect(result.findings[0]).toMatchObject({ status: "pass", finding: { category: "drop" } });
  });

  it("finds a previous stable Drizzle property consumer outside the schema directory", () => {
    const fixture = createFixture({
      migration: `${MIGRATION_CONTRACT_ANNOTATION}\nALTER TABLE "teams" DROP COLUMN "old_column";`,
      source: NEW_TEAMS_SOURCE,
      extraFiles: {
        "src/actions/legacy-reader.ts": `import { teams } from "@/db/schema";\nexport const read = (value: string) => eq(teams.oldColumn, value);\n`,
      },
    });
    const result = checkReleaseCompatibility(fixture.directory);

    expect(result.failures[0]).toContain("src/actions/legacy-reader.ts:");
  });

  it.each([
    ["alter-type", `ALTER TABLE "teams" ALTER COLUMN "old_column" TYPE text;`],
    ["set-not-null", `ALTER TABLE "teams" ALTER COLUMN "old_column" SET NOT NULL;`],
  ])("fails closed for %s", (_category, sql) => {
    const fixture = createFixture({ migration: `${MIGRATION_CONTRACT_ANNOTATION}\n${sql}`, source: NEW_TEAMS_SOURCE });
    const result = checkReleaseCompatibility(fixture.directory);

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatch(/fail closed/);
    expect(result.failures[0]).toContain("annotation 不能绕过此 gate");
  });

  it("passes additive migrations", () => {
    const fixture = createFixture({
      migration: `ALTER TABLE "teams" ADD COLUMN "new_column" text;`,
      source: OLD_TEAMS_SOURCE,
    });
    const result = checkReleaseCompatibility(fixture.directory);

    expect(result.changedMigrationFiles).toEqual(["drizzle/migrations/0002_next.sql"]);
    expect(result.findings).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it("keeps locking findings outside previous-app owner proof", () => {
    const fixture = createFixture({
      migration: `${MIGRATION_LOCKING_ANNOTATION}\nCREATE INDEX teams_name_idx ON teams (name);`,
      source: OLD_TEAMS_SOURCE,
    });
    const result = checkReleaseCompatibility(fixture.directory);

    expect(result.failures).toEqual([]);
    expect(result.findings).toMatchObject([{ status: "not-applicable", finding: { category: "rewrite-or-exclusive-lock" }, owners: [], evidence: [] }]);
  });

  it("passes when no active migration changed", () => {
    const fixture = createFixture({ source: OLD_TEAMS_SOURCE });
    const result = checkReleaseCompatibility(fixture.directory);

    expect(result.changedMigrationFiles).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it("rejects an explicitly invalid previous release ref instead of falling back", () => {
    const fixture = createFixture({ migration: `ALTER TABLE "teams" ADD COLUMN "new_column" text;` });
    process.env.RIVALHUB_PREVIOUS_RELEASE_TAG = "v9.9.9";

    expect(() => checkReleaseCompatibility(fixture.directory)).toThrow(/RIVALHUB_PREVIOUS_RELEASE_TAG/);
  });

  it("rejects an explicitly empty previous release ref instead of falling back", () => {
    const fixture = createFixture({ migration: `ALTER TABLE "teams" ADD COLUMN "new_column" text;` });
    process.env.RIVALHUB_PREVIOUS_RELEASE_TAG = "   ";

    expect(() => checkReleaseCompatibility(fixture.directory)).toThrow(/RIVALHUB_PREVIOUS_RELEASE_TAG/);
  });

  it("rejects an invalid production lineage ref instead of falling back", () => {
    const fixture = createFixture({ migration: `ALTER TABLE "teams" ADD COLUMN "new_column" text;` });
    process.env.RIVALHUB_PRODUCTION_STABLE_REF = "   ";

    expect(() => checkReleaseCompatibility(fixture.directory)).toThrow(/RIVALHUB_PRODUCTION_STABLE_REF/);
  });

  it("uses an explicit stable release tag when it is resolvable", () => {
    const fixture = createFixture({ migration: `ALTER TABLE "teams" ADD COLUMN "new_column" text;` });
    process.env.RIVALHUB_PREVIOUS_RELEASE_TAG = "v1.0.0";

    const result = checkReleaseCompatibility(fixture.directory);

    expect(result.previousRelease.ref).toBe("v1.0.0");
    expect(result.failures).toEqual([]);
  });

  it("rejects an explicitly resolvable prerelease ref", () => {
    const fixture = createFixture({ migration: `ALTER TABLE "teams" ADD COLUMN "new_column" text;` });
    process.env.RIVALHUB_PREVIOUS_RELEASE_TAG = "v1.1.0-rc.1";

    expect(() => checkReleaseCompatibility(fixture.directory)).toThrow(/production stable tag vX\.Y\.Z/);
  });

  it("selects the latest stable tag on the production lineage and ignores prereleases", () => {
    const fixture = createFixture({
      migration: `ALTER TABLE "teams" ADD COLUMN "new_column" text;`,
      stableTags: ["v1.1.0"],
      prereleaseTag: "v1.2.0-rc.1",
    });

    const result = checkReleaseCompatibility(fixture.directory);

    expect(result.previousRelease.ref).toBe("v1.1.0");
  });

  it("resolves the production stable tag across the release/dev topology", () => {
    const fixture = createDivergedTopologyFixture();

    expect(() => runGit(fixture.directory, ["merge-base", "--is-ancestor", fixture.productionCommit!, fixture.candidateCommit!])).toThrow();
    const result = checkReleaseCompatibility(fixture.directory);

    expect(result.previousRelease).toEqual({ ref: "v2.2.3", commit: fixture.productionCommit });
    expect(result.changedMigrationFiles).toEqual(["drizzle/migrations/0002_next.sql"]);
    expect(result.failures).toEqual([]);
  });

  it("uses the version immediately before a tagged candidate on retry", () => {
    const fixture = createFixture({
      migration: `ALTER TABLE "teams" ADD COLUMN "new_column" text;`,
      stableTags: ["v1.1.0", "v1.3.0"],
      candidateTag: "v1.2.0",
    });

    const result = checkReleaseCompatibility(fixture.directory);

    expect(result.previousRelease.ref).toBe("v1.1.0");
  });
});

interface FixtureOptions {
  migration?: string;
  source?: string;
  extraFiles?: Record<string, string>;
  stableTags?: string[];
  prereleaseTag?: string;
  candidateTag?: string;
}

interface Fixture {
  directory: string;
}

function createFixture(options: FixtureOptions): Fixture {
  const directory = mkdtempSync(join(tmpdir(), "rivalhub-release-compat-"));
  fixtureDirectories.push(directory);
  runGit(directory, ["init", "-q"]);
  runGit(directory, ["config", "user.email", "release-compat@example.test"]);
  runGit(directory, ["config", "user.name", "Release Compat Test"]);

  writeFixtureFile(directory, "src/db/schema/teams.ts", options.source ?? NEW_TEAMS_SOURCE);
  for (const [path, content] of Object.entries(options.extraFiles ?? {})) writeFixtureFile(directory, path, content);
  writeFixtureFile(directory, "drizzle/migrations/0001_base.sql", "CREATE TABLE teams (id uuid);\n");
  runGit(directory, ["add", "."]);
  runGit(directory, ["commit", "-q", "-m", "baseline"]);
  const baselineCommit = runGit(directory, ["rev-parse", "HEAD"]);
  runGit(directory, ["tag", "v1.0.0"]);
  for (const tag of options.stableTags ?? []) runGit(directory, ["tag", tag]);
  runGit(directory, ["update-ref", "refs/remotes/origin/main", baselineCommit]);
  if (options.prereleaseTag) runGit(directory, ["tag", options.prereleaseTag]);

  if (options.migration) writeFixtureFile(directory, "drizzle/migrations/0002_next.sql", options.migration);
  else writeFixtureFile(directory, "README.md", "candidate\n");
  runGit(directory, ["add", "."]);
  runGit(directory, ["commit", "-q", "-m", "candidate"]);
  if (options.candidateTag) runGit(directory, ["tag", options.candidateTag]);

  expect(readFileSync(join(directory, "src/db/schema/teams.ts"), "utf8")).toBe(options.source ?? NEW_TEAMS_SOURCE);
  return { directory };
}

function createDivergedTopologyFixture(): Fixture & { candidateCommit: string; productionCommit: string } {
  const directory = mkdtempSync(join(tmpdir(), "rivalhub-release-topology-"));
  fixtureDirectories.push(directory);
  runGit(directory, ["init", "-q"]);
  runGit(directory, ["config", "user.email", "release-compat@example.test"]);
  runGit(directory, ["config", "user.name", "Release Compat Test"]);

  writeFixtureFile(directory, "src/db/schema/teams.ts", NEW_TEAMS_SOURCE);
  writeFixtureFile(directory, "drizzle/migrations/0001_base.sql", "CREATE TABLE teams (id uuid);\n");
  runGit(directory, ["add", "."]);
  runGit(directory, ["commit", "-q", "-m", "base"]);
  const baselineCommit = runGit(directory, ["rev-parse", "HEAD"]);
  runGit(directory, ["tag", "v2.2.2"]);

  runGit(directory, ["checkout", "-q", "-b", "release", baselineCommit]);
  writeFixtureFile(directory, "release-bookkeeping.txt", "v2.2.3\n");
  runGit(directory, ["add", "."]);
  runGit(directory, ["commit", "-q", "-m", "release bookkeeping"]);
  const releaseBookkeepingCommit = runGit(directory, ["rev-parse", "HEAD"]);

  runGit(directory, ["checkout", "-q", "-b", "main", baselineCommit]);
  runGit(directory, ["merge", "--no-ff", "-q", "release", "-m", "release v2.2.3"]);
  const productionCommit = runGit(directory, ["rev-parse", "HEAD"]);
  runGit(directory, ["tag", "v2.2.3"]);

  runGit(directory, ["checkout", "-q", "-b", "dev", baselineCommit]);
  writeFixtureFile(directory, "release-bookkeeping.txt", "v2.2.3\n");
  runGit(directory, ["add", "."]);
  runGit(directory, ["commit", "-q", "-m", "sync release bookkeeping"]);
  writeFixtureFile(directory, "drizzle/migrations/0002_next.sql", "ALTER TABLE teams ADD COLUMN new_column text;\n");
  runGit(directory, ["add", "."]);
  runGit(directory, ["commit", "-q", "-m", "candidate"]);
  const candidateCommit = runGit(directory, ["rev-parse", "HEAD"]);
  runGit(directory, ["update-ref", "refs/remotes/origin/main", productionCommit]);

  expect(runGit(directory, ["rev-parse", "release"])).toBe(releaseBookkeepingCommit);
  return { directory, candidateCommit, productionCommit };
}

function writeFixtureFile(directory: string, path: string, content: string): void {
  const absolutePath = join(directory, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

function runGit(directory: string, args: string[]): string {
  return execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
}
