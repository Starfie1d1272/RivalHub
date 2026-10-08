import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isPrimaryHealthHealthy } from "../../../src/lib/scheduler/health-contract";
import {
  assertUnchangedProduction,
  planProductionFallbacks,
  verifyProductionSource,
} from "../../../scripts/db/scheduler-watchdog-plan";

const directories: string[] = [];
const now = new Date("2026-10-02T12:00:00Z");
const registry = {
  definitions: [
    { key: "draft-timeout", staleAfterMs: 180_000 },
    { key: "resolve-match-veto-timeouts", staleAfterMs: 180_000 },
  ],
  isHealthy: isPrimaryHealthHealthy,
};
const healthy = (key: string) => ({
  job_key: key,
  last_primary_triggered_at: now,
  last_primary_dispatch_requested_at: null,
  last_primary_endpoint_succeeded_at: null,
});

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("deployed scheduler planning", () => {
  it("omits unreleased jobs, includes deployed BP timeouts and forces manual without reading DB", async () => {
    const readHealth = vi.fn();
    expect(await planProductionFallbacks(registry, "manual", readHealth)).toEqual([
      "draft-timeout", "resolve-match-veto-timeouts",
    ]);
    expect(readHealth).not.toHaveBeenCalled();
  });

  it("treats fresh idle primary checks as healthy without requiring unnecessary endpoint invocations", async () => {
    const readHealth = vi.fn(async () => registry.definitions.map((definition) => healthy(definition.key)));
    expect(await planProductionFallbacks(registry, "scheduled", readHealth, vi.fn(), now)).toEqual([]);
    expect(readHealth).toHaveBeenCalledWith(["draft-timeout", "resolve-match-veto-timeouts"]);
  });

  it.each(["missing", "stale", "pending"])("falls back for a deployed %s primary", async (state) => {
    const row = {
      ...healthy("resolve-match-veto-timeouts"),
      ...(state === "stale" ? { last_primary_triggered_at: new Date(now.getTime() - 180_001) } : {}),
      ...(state === "pending" ? { last_primary_dispatch_requested_at: now } : {}),
    };
    const readHealth = async () => [healthy("draft-timeout"), ...(state === "missing" ? [] : [row])];
    expect(await planProductionFallbacks(registry, "scheduled", readHealth, vi.fn(), now))
      .toEqual(["resolve-match-veto-timeouts"]);
  });

  it("DB failure falls back to every deployed task, without leaking connection errors", async () => {
    const warn = vi.fn();
    const readHealth = async () => { throw new Error("postgres://private-secret@host"); };
    expect(await planProductionFallbacks(registry, "scheduled", readHealth, warn, now))
      .toEqual(["draft-timeout", "resolve-match-veto-timeouts"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("all verified deployed targets"));
    expect(warn.mock.calls.flat().join(" ")).not.toContain("private-secret");
  });

  it("fails closed when either frozen release marker changes before execution", () => {
    const identity = { releaseTag: "v2.13.4", releaseCommit: "a".repeat(40) };
    expect(() => assertUnchangedProduction(identity, identity)).not.toThrow();
    expect(() => assertUnchangedProduction(identity, { ...identity, releaseTag: "v2.13.5" })).toThrow(/Production changed/);
    expect(() => assertUnchangedProduction(identity, { ...identity, releaseCommit: "b".repeat(40) })).toThrow(/Production changed/);
  });
});

describe("scheduler source integrity and real CLI", () => {
  it("accepts deployed ancestry and the same main SHA, but rejects a tag/SHA mismatch", () => {
    const { directory, identity } = fixture();
    expect(() => verifyProductionSource(identity, directory)).not.toThrow();
    writeFileSync(join(directory, "new-main.txt"), "future source");
    git(directory, ["add", "."]);
    git(directory, ["commit", "-qm", "main ahead"]);
    expect(() => verifyProductionSource(identity, directory)).not.toThrow();
    expect(() => verifyProductionSource({ ...identity, releaseCommit: git(directory, ["rev-parse", "HEAD"]) }, directory))
      .toThrow(/tag\/commit mismatch/);
  });

  it("rejects a valid tag on an unrelated history", () => {
    const { directory, identity } = fixture();
    git(directory, ["checkout", "--orphan", "unrelated"]);
    git(directory, ["commit", "-qm", "unrelated source"]);
    expect(() => verifyProductionSource(identity, directory)).toThrow(/not an ancestor/);
  });

  it("runs the current controller with production owners that predate the controller itself", () => {
    const { directory, identity } = fixture();
    const result = cli(directory, identity);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(["draft-timeout", "resolve-match-veto-timeouts"]);
  });

  it("rejects dirty deployed source before importing it", () => {
    const { directory, identity } = fixture();
    writeFileSync(join(directory, "src/lib/scheduler/definitions.ts"), "throw new Error('untrusted-import-executed');");
    const result = cli(directory, identity);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("checkout must be clean");
    expect(result.stderr).not.toContain("untrusted-import-executed");
  });
});

describe("workflow invocation boundary", () => {
  it("uses valid immutable action pins", () => {
    const workflow = readFileSync(".github/workflows/cron.yml", "utf8");
    const actions = [...workflow.matchAll(/uses: ([^\s]+)@([^\s]+)/g)];
    expect(actions.length).toBeGreaterThan(0);
    for (const [, , pin] of actions) expect(pin).toMatch(/^[a-f0-9]{40}$/);
  });

  it("attempts later deployed jobs after an HTTP failure and still fails the workflow", () => {
    const result = invokeWorkflow(0);
    expect(result.status).toBe(1);
    expect(result.calls).toEqual(["https://match.starfie1d.top/api/cron/first", "https://match.starfie1d.top/api/cron/second"]);
  });

  it("stops before the next request when the production identity check fails", () => {
    const result = invokeWorkflow(3);
    expect(result.status).toBe(2);
    expect(result.calls).toEqual(["https://match.starfie1d.top/api/cron/first"]);
  });
});

function invokeWorkflow(failCheckAt: number) {
  const directory = mkdtempSync(join(tmpdir(), "rivalhub-watchdog-shell-"));
  directories.push(directory);
  const calls = join(directory, "calls");
  writeFileSync(calls, "");
  writeFileSync(join(directory, "pnpm"), `#!/bin/bash
count=0
if [ -f "$CHECK_COUNT" ]; then read -r count < "$CHECK_COUNT"; fi
count=$((count + 1))
echo "$count" > "$CHECK_COUNT"
if [ "$count" -eq "$FAIL_CHECK_AT" ]; then exit 2; fi
`);
  writeFileSync(join(directory, "curl"), `#!/bin/bash
url="\${!#}"
echo "$url" >> "$CALLS"
if [[ "$url" == */first ]]; then exit 22; fi
`);
  chmodSync(join(directory, "pnpm"), 0o755);
  chmodSync(join(directory, "curl"), 0o755);
  const workflow = readFileSync(".github/workflows/cron.yml", "utf8");
  const invocation = workflow.split("      - name: Invoke required scheduler fallbacks")[1];
  const script = invocation.split("        run: |\n")[1].split("\n").map((line) => line.slice(10)).join("\n");
  const result = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, CALLS: calls,
      CHECK_COUNT: join(directory, "checks"), FAIL_CHECK_AT: String(failCheckAt),
      CRON_JOB_KEYS: '["first","second"]', CRON_SECRET: "synthetic", CRON_SOURCE: "github-watchdog" },
  });
  return { ...result, calls: readFileSync(calls, "utf8").trim().split("\n").filter(Boolean) };
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rivalhub-watchdog-"));
  directories.push(directory);
  const owner = join(directory, "src/lib/scheduler");
  mkdirSync(owner, { recursive: true });
  writeFileSync(join(owner, "definitions.ts"), `export const SCHEDULER_JOB_DEFINITIONS = ${JSON.stringify(registry.definitions)};`);
  writeFileSync(join(owner, "health-contract.ts"), readFileSync("src/lib/scheduler/health-contract.ts", "utf8"));
  git(directory, ["init", "-q"]);
  git(directory, ["config", "user.email", "watchdog@example.test"]);
  git(directory, ["config", "user.name", "Watchdog Test"]);
  git(directory, ["add", "."]);
  git(directory, ["commit", "-qm", "deployed source without new controller"]);
  git(directory, ["tag", "v2.13.4"]);
  return { directory, identity: { releaseTag: "v2.13.4", releaseCommit: git(directory, ["rev-parse", "HEAD"]) } };
}

function git(directory: string, args: string[]) {
  return execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function cli(directory: string, identity: { releaseTag: string; releaseCommit: string }) {
  // Controller/dependencies are from the operator checkout, while cwd supplies
  // the fixture Git ancestry; production has no helper script or node_modules.
  return spawnSync(process.execPath, [
    join(process.cwd(), "node_modules/tsx/dist/cli.mjs"),
    join(process.cwd(), "scripts/db/scheduler-watchdog-plan.ts"), "manual", directory,
  ], {
    cwd: directory,
    env: { ...process.env, DATABASE_URL: "", RIVALHUB_SCHEDULER_RELEASE_TAG: identity.releaseTag,
      RIVALHUB_SCHEDULER_RELEASE_COMMIT: identity.releaseCommit },
    encoding: "utf8",
  });
}
