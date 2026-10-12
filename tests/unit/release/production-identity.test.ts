import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { freezeCanonicalProductionIdentity } from "../../../scripts/release/production-identity";

const environmentKeys = [
  "RIVALHUB_PRODUCTION_BASE_URL",
  "RIVALHUB_PREVIOUS_RELEASE_TAG",
  "RIVALHUB_PREVIOUS_RELEASE_COMMIT",
  "RIVALHUB_REQUIRE_EXPLICIT_PREVIOUS_RELEASE",
  "RIVALHUB_RELEASE_MODE",
  "RIVALHUB_RETRY_PREVIOUS_RELEASE_TAG",
  "RIVALHUB_RETRY_PREVIOUS_RELEASE_COMMIT",
  "RIVALHUB_MIGRATION_HEAD_SHA",
  "RELEASE_TAG",
  "GITHUB_ENV",
] as const;
const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
const fixtureDirectories: string[] = [];

afterEach(() => {
  for (const key of environmentKeys) {
    const value = originalEnvironment.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  while (fixtureDirectories.length > 0) {
    const directory = fixtureDirectories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe("canonical previous production identity", () => {

  it("fails closed when same-tag resume omits the original previous Production pair", async () => {
    const fixture = createFixture();

    await expect(
      freezeCanonicalProductionIdentity({
        cwd: fixture.directory,
        env: {
          RIVALHUB_PRODUCTION_BASE_URL: "https://production.example.test",
          RELEASE_TAG: "v2.9.7",
        },
        fetcher: async () => jsonResponse({ releaseTag: "v2.9.7", releaseCommit: fixture.candidateCommit }),
        candidateHead: fixture.candidateCommit,
      }),
    ).rejects.toThrow(/安全重试必须同时提供/);
  });

  it("rejects a canonical identity whose tag and commit do not match", async () => {
    const fixture = createFixture();

    await expect(
      freezeCanonicalProductionIdentity({
        cwd: fixture.directory,
        env: {
          RIVALHUB_PRODUCTION_BASE_URL: "https://production.example.test",
          RELEASE_TAG: "v2.9.7",
        },
        fetcher: async () => jsonResponse({ releaseTag: "v2.9.5", releaseCommit: "f".repeat(40) }),
        candidateHead: fixture.candidateCommit,
      }),
    ).rejects.toThrow(/不匹配/);
  });

});

interface Fixture {
  directory: string;
  previousCommit: string;
  candidateCommit: string;
}

function createFixture(options: { intermediateTag?: string } = {}): Fixture {
  const directory = mkdtempSync(join(tmpdir(), "rivalhub-production-identity-"));
  fixtureDirectories.push(directory);
  runGit(directory, ["init", "-q"]);
  runGit(directory, ["config", "user.email", "production-identity@example.test"]);
  runGit(directory, ["config", "user.name", "Production Identity Test"]);

  writeFixtureFile(directory, "src/release.ts", "export const release = 'v2.9.5';\n");
  writeFixtureFile(directory, "scripts/release-marker.ts", "export const marker = true;\n");
  runGit(directory, ["add", "."]);
  runGit(directory, ["commit", "-q", "-m", "previous production"]);
  const previousCommit = runGit(directory, ["rev-parse", "HEAD"]);
  runGit(directory, ["tag", "v2.9.5"]);

  if (options.intermediateTag) {
    writeFixtureFile(directory, "src/release.ts", "export const release = 'failed intermediate';\n");
    runGit(directory, ["add", "."]);
    runGit(directory, ["commit", "-q", "-m", "failed intermediate"]);
    runGit(directory, ["tag", options.intermediateTag]);
  }

  writeFixtureFile(directory, "src/release.ts", "export const release = 'candidate';\n");
  runGit(directory, ["add", "."]);
  runGit(directory, ["commit", "-q", "-m", "candidate"]);
  const candidateCommit = runGit(directory, ["rev-parse", "HEAD"]);
  runGit(directory, ["tag", "v2.9.7"]);

  return { directory, previousCommit, candidateCommit };
}

function writeFixtureFile(directory: string, path: string, content: string): void {
  const absolutePath = join(directory, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

function runGit(directory: string, args: string[]): string {
  return execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
