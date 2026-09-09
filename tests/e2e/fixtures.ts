import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test as base, type Page, type TestInfo } from "@playwright/test";
import { redactText } from "../../src/lib/observability/redact";

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const binSuffix = process.platform === "win32" ? ".cmd" : "";
const tsxBin = resolve(projectRoot, `node_modules/.bin/tsx${binSuffix}`);
const fixtureScript = resolve(projectRoot, "scripts/db/major-browser-fixture.ts");

export type E2EFixtureCredentials = {
  scenarioId: string;
  profile: E2EFixtureProfile;
  shortKey: string;
  seasonId: string;
  slug: string;
  seasonName: string;
  password: string;
  invitationTeam: { id: string; slug: string; name: string; captainUserId: string };
  accounts: Array<{ key: "captain" | "player1" | "player2" | "player3" | "player4" | "admin"; email: string; userId: string }>;
};

type FixtureManifest = E2EFixtureCredentials & { authUserIds: string[] };
export type E2EFixtureProfile = "auth" | "team-invite" | "major-entry" | "education";

const PROFILE_ACCOUNT_KEYS: Record<E2EFixtureProfile, readonly E2EFixtureCredentials["accounts"][number]["key"][]> = {
  auth: ["player3"],
  "team-invite": ["player1", "player2"],
  "major-entry": ["captain"],
  education: ["player1", "admin"],
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
  profile: E2EFixtureProfile;
};

export const test = base.extend<{ scenario: E2EFixtureCredentials; scenarioProfile: E2EFixtureProfile }>({
  scenarioProfile: ["major-entry", { option: true }],
  scenario: async ({ scenarioProfile }, applyFixture, testInfo) => {
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
      await runFixtureCommand(["create", scenarioId, credentialsPath, scenarioProfile], env, scenarioId);
      const scenario = readCredentials(credentialsPath, scenarioId);
      await applyFixture(scenario);
    } catch (error) {
      operationError = error;
    } finally {
      if (setupAttempted) {
        try {
          await runFixtureCommand(["cleanup", scenarioId, credentialsPath, scenarioProfile], env, scenarioId);
        } catch (error) {
          cleanupError = error;
        }
      }
      writeAttemptRecord(attemptPath, testInfo, scenarioId, scenarioProfile);
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
  const operation = args[0] ?? "unknown";
  try {
    await execFileAsync(tsxBin, [fixtureScript, ...args], {
      cwd: projectRoot,
      env,
      maxBuffer: 64 * 1024,
    });
  } catch (error) {
    const detail = error instanceof Error && "stderr" in error && typeof error.stderr === "string" && error.stderr.trim()
      ? error.stderr
      : error instanceof Error && "stdout" in error && typeof error.stdout === "string" && error.stdout.trim()
        ? error.stdout
        : error instanceof Error
          ? error.message
          : "unknown fixture error";
    const exitCode = error instanceof Error && "code" in error && (typeof error.code === "number" || typeof error.code === "string")
      ? String(error.code)
      : "unknown";
    const phase = detail.match(/failed during ([^:.\n]+)/i)?.[1]?.trim() ?? "unknown";
    throw new Error(`E2E fixture command failed: operation=${operation} scenario=${scenarioId} exit=${exitCode} phase=${phase}; ${redactText(detail)}`, { cause: error });
  }
}

function readCredentials(path: string, scenarioId: string): E2EFixtureCredentials {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as FixtureManifest;
    const profile = value.profile;
    const accountKeys = new Set(value.accounts?.map((account) => account.key));
    const expectedAccountKeys = new Set(PROFILE_ACCOUNT_KEYS[profile]);
    const player2 = value.accounts?.find((account) => account.key === "player2");
    if (
      value.scenarioId !== scenarioId
      || !Object.hasOwn(PROFILE_ACCOUNT_KEYS, profile)
      || !/^[0-9a-f]{12}$/.test(value.shortKey)
      || !value.password
      || !Array.isArray(value.authUserIds)
      || value.authUserIds.length !== expectedAccountKeys.size
      || !value.authUserIds.every((id) => isUuid(id))
      || !value.invitationTeam
      || !isUuid(value.invitationTeam.id)
      || !/^[a-z0-9-]+$/.test(value.invitationTeam.slug)
      || typeof value.invitationTeam.name !== "string"
      || (profile === "team-invite" && value.invitationTeam.captainUserId !== player2?.userId)
      || accountKeys.size !== expectedAccountKeys.size
      || [...expectedAccountKeys].some((key) => !accountKeys.has(key))
      || !Array.isArray(value.accounts)
      || !value.accounts.every((account) => isUuid(account.userId) && /^[^@\s]+@[^@\s]+$/.test(account.email))
    ) throw new Error("invalid");
    const { authUserIds: _authUserIds, ...credentials } = value;
    void _authUserIds;
    return credentials;
  } catch {
    throw new Error(`E2E fixture credentials missing for scenario ${scenarioId}.`);
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function writeAttemptRecord(path: string, testInfo: TestInfo, scenarioId: string, profile: E2EFixtureProfile): void {
  const record: E2EAttemptRecord = {
    scenarioId,
    project: testInfo.project.name,
    retry: testInfo.retry,
    repeatEachIndex: testInfo.repeatEachIndex,
    status: testInfo.status ?? "unknown",
    expectedStatus: testInfo.expectedStatus,
    durationMs: testInfo.duration,
    outputDir: relative(projectRoot, testInfo.outputDir),
    profile,
  };
  writeFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
}
