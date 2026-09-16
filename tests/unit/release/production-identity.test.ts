import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  freezeCanonicalProductionIdentity,
  PREVIOUS_RELEASE_COMMIT_ENV,
  PREVIOUS_RELEASE_TAG_ENV,
  RELEASE_MODE_ENV,
  RETRY_PREVIOUS_RELEASE_COMMIT_ENV,
  RETRY_PREVIOUS_RELEASE_TAG_ENV,
  resolveConfiguredPreviousProductionIdentity,
} from "../../../scripts/release/production-identity";

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
  it("freezes canonical previous Production for a fresh release", async () => {
    const fixture = createFixture({ intermediateTag: "v2.9.6" });
    const githubEnv = join(fixture.directory, "github.env");
    const fetcher = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      expect(String(input)).toBe("https://production.example.test/api/system/release");
      return jsonResponse({ releaseTag: "v2.9.5", releaseCommit: fixture.previousCommit });
    });

    const identity = await freezeCanonicalProductionIdentity({
      cwd: fixture.directory,
      env: {
        RIVALHUB_PRODUCTION_BASE_URL: "https://production.example.test",
        RELEASE_TAG: "v2.9.7",
        GITHUB_ENV: githubEnv,
      },
      fetcher,
      candidateHead: fixture.candidateCommit,
    });

    expect(identity).toEqual({ releaseTag: "v2.9.5", releaseCommit: fixture.previousCommit });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(readFileSync(githubEnv, "utf8")).toBe(
      `${PREVIOUS_RELEASE_TAG_ENV}=v2.9.5\n` +
        `${PREVIOUS_RELEASE_COMMIT_ENV}=${fixture.previousCommit}\n` +
        "RIVALHUB_REQUIRE_EXPLICIT_PREVIOUS_RELEASE=1\n" +
        `${RELEASE_MODE_ENV}=fresh\n`,
    );
  });

  it("enters resume mode when the candidate is already canonical Production", async () => {
    const fixture = createFixture();
    const githubEnv = join(fixture.directory, "github.env");

    const identity = await freezeCanonicalProductionIdentity({
      cwd: fixture.directory,
      env: {
        RIVALHUB_PRODUCTION_BASE_URL: "https://production.example.test",
        RELEASE_TAG: "v2.9.7",
        [RETRY_PREVIOUS_RELEASE_TAG_ENV]: "v2.9.5",
        [RETRY_PREVIOUS_RELEASE_COMMIT_ENV]: fixture.previousCommit,
        GITHUB_ENV: githubEnv,
      },
      fetcher: async () => jsonResponse({ releaseTag: "v2.9.7", releaseCommit: fixture.candidateCommit }),
      candidateHead: fixture.candidateCommit,
    });

    expect(identity).toEqual({ releaseTag: "v2.9.5", releaseCommit: fixture.previousCommit });
    expect(readFileSync(githubEnv, "utf8")).toContain(`${RELEASE_MODE_ENV}=resume\n`);
  });

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

  it("rejects retry baseline inputs when canonical Production is still the previous release", async () => {
    const fixture = createFixture();

    await expect(
      freezeCanonicalProductionIdentity({
        cwd: fixture.directory,
        env: {
          RIVALHUB_PRODUCTION_BASE_URL: "https://production.example.test",
          RELEASE_TAG: "v2.9.7",
          [RETRY_PREVIOUS_RELEASE_TAG_ENV]: "v2.9.5",
          [RETRY_PREVIOUS_RELEASE_COMMIT_ENV]: fixture.previousCommit,
        },
        fetcher: async () => jsonResponse({ releaseTag: "v2.9.5", releaseCommit: fixture.previousCommit }),
        candidateHead: fixture.candidateCommit,
      }),
    ).rejects.toThrow(/仅用于 candidate 已经成为 canonical Production/);
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

  it("requires the complete explicit pair instead of silently returning a fallback", () => {
    const fixture = createFixture();

    expect(() => resolveConfiguredPreviousProductionIdentity(
      fixture.directory,
      { [PREVIOUS_RELEASE_TAG_ENV]: "v2.9.5" },
      fixture.candidateCommit,
    )).toThrow(/必须同时提供/);
  });

  it("rejects a previous identity that points at the candidate source", () => {
    const fixture = createFixture();

    expect(() => resolveConfiguredPreviousProductionIdentity(
      fixture.directory,
      {
        [PREVIOUS_RELEASE_TAG_ENV]: "v2.9.7",
        [PREVIOUS_RELEASE_COMMIT_ENV]: fixture.candidateCommit,
      },
      fixture.candidateCommit,
    )).toThrow(/与候选版本相同/);
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
