import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MIGRATION_RISK_ANNOTATION } from "../../../scripts/db/migration-risk";
import { checkReleaseCompatibility } from "../../../scripts/db/release-compat";

const ENVIRONMENT_KEYS = [
  "RIVALHUB_MIGRATION_BASE_SHA",
  "RIVALHUB_MIGRATION_HEAD_SHA",
  "RIVALHUB_PREVIOUS_RELEASE_TAG",
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
    const fixture = createFixture({ migration: `${MIGRATION_RISK_ANNOTATION}\n${sql}`, source });
    const result = checkReleaseCompatibility(fixture.directory);

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatch(/drizzle\/migrations\/0002_next\.sql:2 \[(?:drop|rename)\]/);
    expect(result.failures[0]).toContain("src/db/schema/teams.ts:");
    expect(result.failures[0]).toContain("previous stable");
  });

  it("fails a column contract even when migration-risk annotation exists", () => {
    const fixture = createFixture({
      migration: `${MIGRATION_RISK_ANNOTATION}\nALTER TABLE "teams" DROP COLUMN "old_column";`,
      source: OLD_TEAMS_SOURCE,
    });
    const result = checkReleaseCompatibility(fixture.directory);

    expect(result.findings[0]).toMatchObject({ status: "fail", finding: { category: "drop" } });
    expect(result.failures[0]).toContain("annotation 只声明 cleanup 意图");
  });

  it("passes after previous stable has switched to the new column owner", () => {
    const fixture = createFixture({
      migration: `${MIGRATION_RISK_ANNOTATION}\nALTER TABLE "teams" DROP COLUMN "old_column";`,
      source: NEW_TEAMS_SOURCE,
    });
    const result = checkReleaseCompatibility(fixture.directory);

    expect(result.failures).toEqual([]);
    expect(result.findings[0]).toMatchObject({ status: "pass", finding: { category: "drop" } });
  });

  it("finds a previous stable Drizzle property consumer outside the schema directory", () => {
    const fixture = createFixture({
      migration: `${MIGRATION_RISK_ANNOTATION}\nALTER TABLE "teams" DROP COLUMN "old_column";`,
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
    const fixture = createFixture({ migration: `${MIGRATION_RISK_ANNOTATION}\n${sql}`, source: NEW_TEAMS_SOURCE });
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

  it("uses an explicit previous revision when it is resolvable", () => {
    const fixture = createFixture({ migration: `ALTER TABLE "teams" ADD COLUMN "new_column" text;` });
    process.env.RIVALHUB_PREVIOUS_RELEASE_TAG = fixture.baselineCommit;

    const result = checkReleaseCompatibility(fixture.directory);

    expect(result.previousRelease.ref).toBe(fixture.baselineCommit);
    expect(result.failures).toEqual([]);
  });

  it("selects the latest reachable stable tag and ignores prereleases", () => {
    const fixture = createFixture({
      migration: `ALTER TABLE "teams" ADD COLUMN "new_column" text;`,
      stableTags: ["v1.1.0"],
      prereleaseTag: "v1.2.0-rc.1",
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
}

interface Fixture {
  directory: string;
  baselineCommit: string;
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

  if (options.migration) writeFixtureFile(directory, "drizzle/migrations/0002_next.sql", options.migration);
  else writeFixtureFile(directory, "README.md", "candidate\n");
  runGit(directory, ["add", "."]);
  runGit(directory, ["commit", "-q", "-m", "candidate"]);
  if (options.prereleaseTag) runGit(directory, ["tag", options.prereleaseTag]);

  expect(readFileSync(join(directory, "src/db/schema/teams.ts"), "utf8")).toBe(options.source ?? NEW_TEAMS_SOURCE);
  return { directory, baselineCommit };
}

function writeFixtureFile(directory: string, path: string, content: string): void {
  const absolutePath = join(directory, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

function runGit(directory: string, args: string[]): string {
  return execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
}
