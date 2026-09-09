import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test as base, type Page, type TestInfo } from "@playwright/test";

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const binSuffix = process.platform === "win32" ? ".cmd" : "";
const tsxBin = resolve(projectRoot, `node_modules/.bin/tsx${binSuffix}`);
const fixtureScript = resolve(projectRoot, "scripts/db/major-browser-fixture.ts");

export type E2EFixtureCredentials = {
  scenarioId: string;
  seasonId: string;
  slug: string;
  seasonName: string;
  password: string;
  accounts: Array<{ key: "captain" | "player1" | "player2" | "player3" | "player4" | "admin"; email: string; userId: string }>;
};

type E2EAttemptRecord = {
  scenarioId: string;
  project: string;
  retry: number;
  repeatEachIndex: number;
  status: string;
  expectedStatus: string;
  durationMs: number;
  outputDir: string;
};

export const test = base.extend<{ scenario: E2EFixtureCredentials }>({
  scenario: async ({}, applyFixture, testInfo) => {
    const scenarioId = buildScenarioId(testInfo);
    const attemptDir = resolve(process.env.RIVALHUB_E2E_ARTIFACT_DIR ?? resolve(projectRoot, ".agent-tmp", "e2e-attempts"));
    const credentialsPath = resolve(attemptDir, `${scenarioId}.credentials.json`);
    const attemptPath = resolve(attemptDir, `${scenarioId}.attempt.json`);
    const env = { ...process.env };
    mkdirSync(attemptDir, { recursive: true });

    let setupAttempted = false;
    let operationError: unknown;
    let cleanupError: unknown;
    try {
      setupAttempted = true;
      await runFixtureCommand(["create", scenarioId, credentialsPath], env, scenarioId);
      const scenario = readCredentials(credentialsPath, scenarioId);
      await applyFixture(scenario);
    } catch (error) {
      operationError = error;
    } finally {
      if (setupAttempted) {
        try {
          await runFixtureCommand(["cleanup", scenarioId], env, scenarioId);
        } catch (error) {
          cleanupError = error;
        }
      }
      writeAttemptRecord(attemptPath, testInfo, scenarioId);
      if (!cleanupError) rmSync(credentialsPath, { force: true });
    }

    if (operationError) throw operationError;
    if (cleanupError) throw cleanupError;
  },
});

export { expect };

export async function signInProgrammatically(
  page: Page,
  account: E2EFixtureCredentials["accounts"][number],
  scenario: E2EFixtureCredentials,
  next: string,
): Promise<void> {
  const response = await page.request.post("/api/test/e2e/auth", {
    data: { email: account.email, password: scenario.password },
  });
  if (!response.ok()) throw new Error(`E2E programmatic auth failed for scenario ${scenario.scenarioId}.`);
  await page.goto(next);
  await expect(page).toHaveURL((url) => url.pathname === next);
}

function buildScenarioId(testInfo: TestInfo): string {
  const readable = testInfo.testId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 34);
  const hash = createHash("sha256").update(testInfo.testId).digest("hex").slice(0, 8);
  return `e2e-${readable || "test"}-${hash}-w${testInfo.workerIndex}-r${testInfo.retry}-x${testInfo.repeatEachIndex}-p${process.pid}`;
}

async function runFixtureCommand(args: readonly string[], env: NodeJS.ProcessEnv, scenarioId: string): Promise<void> {
  try {
    await execFileAsync(tsxBin, [fixtureScript, ...args], {
      cwd: projectRoot,
      env,
      maxBuffer: 64 * 1024,
    });
  } catch {
    throw new Error(`E2E fixture command failed for scenario ${scenarioId}.`);
  }
}

function readCredentials(path: string, scenarioId: string): E2EFixtureCredentials {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as E2EFixtureCredentials;
    if (value.scenarioId !== scenarioId || !value.password || !Array.isArray(value.accounts)) throw new Error("invalid");
    return value;
  } catch {
    throw new Error(`E2E fixture credentials missing for scenario ${scenarioId}.`);
  }
}

function writeAttemptRecord(path: string, testInfo: TestInfo, scenarioId: string): void {
  const record: E2EAttemptRecord = {
    scenarioId,
    project: testInfo.project.name,
    retry: testInfo.retry,
    repeatEachIndex: testInfo.repeatEachIndex,
    status: testInfo.status ?? "unknown",
    expectedStatus: testInfo.expectedStatus,
    durationMs: testInfo.duration,
    outputDir: relative(projectRoot, testInfo.outputDir),
  };
  writeFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
}
