/** Preparation smoke only. Formal comparisons require root-frozen source SHAs. */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, expect, type BrowserContext, type Page } from "@playwright/test";
import { buildLocalAppEnvironment, parseLocalSupabaseStatus } from "../db/local-environment";
import { createMajorBrowserScenarioFixture, cleanupMajorBrowserScenarioFixture } from "../db/major-browser-fixture";
import { createPredictionBrowserFixture, removePredictionBrowserFixture } from "../../tests/e2e/helpers/prediction-fixture";
import { RUNTIME_RESOURCE_NAMES } from "../../src/lib/observability/runtime-resources";
import { redactText } from "../../src/lib/observability/redact";
import { operateBetInTx, joinBetInTx } from "../../src/lib/bet/service";
import { db, disposeDatabaseBinding } from "../../src/db/client-runtime";
import { createLocalTelemetryResourceFixture } from "./local-telemetry-resource-fixture";
import { parseResourceReading } from "./resource-readings";
import { createMizarResourceDriver } from "./mizar-resource-driver";
import type { ResourceHttpFixture } from "./resource-integration-contract";

const base = "http://127.0.0.1:3107";
type RequestResult = { kind: string; phase: string; producer?: number; startedMs: number; durationMs: number; status: number | null; bytes: number; requestBytes?: number; outcome?: string; reason?: string; error?: string };
type ResourceSample = ReturnType<typeof parseResourceReading>;
const workload = { version: 1, liveProducers: 2, documents: ["bet", "profile", "telemetry"], warmRounds: 1, concurrentRounds: 2, idleMs: 65_000 };
const execute = (file: string, args: string[], env?: NodeJS.ProcessEnv) => execFileSync(file, args, { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }).trim();

export async function runResourceIntegrationSmoke(image: string, seed: string, adapter?: string, build = false) {
  if (!/^sha256:[0-9a-f]{64}$/.test(image) || !/^[a-z0-9-]{1,48}$/.test(seed)) throw new Error("INVALID_LOCAL_SMOKE_ARGUMENTS");
  process.umask(0o077);
  const { assertBaselineReadiness } = await import("./resource-baseline.mjs");
  const root = process.cwd();
  const sha = execute("git", ["rev-parse", "HEAD"]);
  const releaseTag = "v0.0.0-local-resource";
  const directory = resolve(".agent-tmp", `resource-smoke-${seed}-${Date.now()}`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const started = performance.now();
  const sourceFiles = ["resource-integration.ts", "resource-integration-contract.ts", "mizar-resource-driver.ts", "local-telemetry-resource-fixture.ts", "resource-readings.ts", "resource-baseline.mjs"];
  const harnessHashes = Object.fromEntries(sourceFiles.map(file => [file, createHash("sha256").update(readFileSync(resolve("scripts/observability", file))).digest("hex")]));
  const report = { appNode: execute(realpathSync("node_modules/.bin/node"), ["--version"]), buildId: "", browserVersion: "", mizarFixtureSource: "", harnessHashes, purpose: "harness-preparation-not-optimization-evidence", sha, releaseTag, seed, workload,
    workloadHash: createHash("sha256").update(JSON.stringify(workload)).digest("hex"),
    requests: [] as RequestResult[], resources: [] as ResourceSample[], runtime: [] as Record<string, unknown>[],
    logins: [] as { role: string; hydrationVerified: boolean; statuses: number[]; finalRoute: string; feedback: string[] }[],
    timeline: [] as { phase: string; atMs: number }[], errors: [] as { phase: string; name: string; message: string }[], blockers: [] as string[],
    telemetry: [] as { path: string; status: number; bytes: number }[], verification: {} as Record<string, number | boolean>,
    appState: {} as Record<string, number | boolean | string>, observedResourceNames: [] as string[], unobservedResourceNames: [] as string[],
    cleanup: {} as Record<string, boolean>, coverage: {} as Record<string, boolean>, passed: false };
  const observeBrowser = (page: Page, kind: string) => {
    const record = (error: Error) => { if (report.errors.length < 32) report.errors.push({ phase: `${kind}.browser`, ...safeError(error) }); };
    page.on("pageerror", record);
    page.on("console", message => { if (message.type() === "error" && /Minified React error|hydration|Hydration/.test(message.text())) record(new Error(message.text())); });
  };
  const mark = (phase: string) => report.timeline.push({ phase, atMs: performance.now() - started });
  const docker = (...args: string[]) => execute("docker", args);
  const status = parseLocalSupabaseStatus(execute(resolve("node_modules/.bin/supabase"), ["status", "-o", "json"]));
  const env = buildLocalAppEnvironment(status, { NODE_ENV: "production", RIVALHUB_RELEASE_TAG: releaseTag, RIVALHUB_RELEASE_COMMIT: sha });
  const sensitive = Object.entries(env).filter(([key]) => /KEY|SECRET|PASSWORD|TOKEN/.test(key)).map(([, value]) => value).filter((value): value is string => Boolean(value));
  const safeError = (error: unknown) => {
    let message = error instanceof Error ? error.message : "UnknownError";
    for (const secret of sensitive) message = message.replaceAll(secret, "[REDACTED]");
    return { name: error instanceof Error ? error.name : "UnknownError", message: redactText(message, 200) };
  };
  const scenarioId = `resource-${seed}`;
  const credentials = resolve(directory, "scenario.credentials.json");
  const container = `rivalhub-resource-smoke-${process.pid}`;
  const uid = process.getuid?.(); const gid = process.getgid?.();
  if (uid === undefined || gid === undefined) throw new Error("LINUX_DOCKER_FIXTURE_REQUIRED");
  let scenarioCreated = false;
  let applicationCreated = false;
  let predictionId: string | undefined;
  let live: ResourceHttpFixture | undefined;
  let telemetry: Awaited<ReturnType<typeof createLocalTelemetryResourceFixture>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let appLogs: ChildProcess | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let phase = "setup";
  function sample() {
    const fields = docker("exec", container, "cat", "/proc/1/status", "/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory.peak",
      "/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory.swap.max", "/sys/fs/cgroup/pids.max", "/sys/fs/cgroup/cpu.max");
    const item = parseResourceReading(fields, performance.now() - started);
    if (report.resources.length < 600) report.resources.push(item);
  }
  async function login(context: BrowserContext, email: string, password: string, role: "user" | "admin") {
    const page = await context.newPage();
    observeBrowser(page, `login.${role}`);
    const result = { role, hydrationVerified: false, statuses: [] as number[], finalRoute: "unknown", feedback: [] as string[] };
    report.logins.push(result);
    page.on("response", response => { if (response.request().method() === "POST" && new URL(response.url()).pathname === "/login") result.statuses.push(response.status()); });
    try {
      await page.goto(`${base}/login?next=/my`, { waitUntil: "load" });
      // Pure local state only: do not send credentials until real handlers work.
      await page.getByRole("button", { name: "注册", exact: true }).click();
      await expect(page.getByLabel("确认密码", { exact: true })).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: "登录", exact: true }).click();
      await expect(page.getByLabel("确认密码", { exact: true })).toHaveCount(0);
      result.hydrationVerified = true;
      await page.getByLabel("邮箱地址").fill(email);
      await page.getByLabel("密码", { exact: true }).fill(password);
      await page.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(`${base}/my`, { timeout: 30_000 });
    } finally {
      const path = new URL(page.url()).pathname;
      result.finalRoute = ["/login", "/my", "/settings", "/"].includes(path) ? path : "/other";
      for (const message of await page.locator('[role="alert"], [data-sonner-toast]').allTextContents().catch(() => [])) result.feedback.push(safeError(new Error(message)).message);
      await page.close();
    }
  }
  async function document(page: Page, kind: string, path: string, title: string, stage: string) {
    const at = performance.now();
    const record: RequestResult = { kind, phase: stage, startedMs: at - started, durationMs: 0, status: null, bytes: 0 };
    report.requests.push(record);
    try {
      const response = await page.goto(base + path, { waitUntil: "domcontentloaded", timeout: 45_000 });
      record.status = response?.status() ?? null;
      if (record.status !== 200) throw new Error("DOCUMENT_HTTP_FAILURE");
      await expect(page.getByRole("heading", { name: title, exact: true }).first()).toBeVisible({ timeout: 30_000 });
      if (kind === "profile") {
        await expect(page.getByRole("heading", { name: "长期资料", exact: true })).toBeVisible();
        await expect(page.getByText("竞技统计暂时无法加载，请稍后重试。", { exact: true })).toHaveCount(0);
      }
      if (kind === "telemetry") await expect(page.getByText(/尚未配置遥测查询|暂时无法读取遥测分析/)).toHaveCount(0);
      record.bytes = (await response!.body()).byteLength;
      record.durationMs = performance.now() - at;
    } catch (error) { record.durationMs = performance.now() - at; record.error = error instanceof Error ? error.name : "UnknownError"; throw error; }
  }
  try {
    mark("fixture.begin"); phase = "fixture.auth";
    const scenario = await createMajorBrowserScenarioFixture(scenarioId, credentials, "stats", env);
    scenarioCreated = true; sensitive.push(scenario.password);
    const user = scenario.accounts.find(account => account.key === "player2")!;
    const admin = scenario.accounts.find(account => account.key === "admin")!;
    Object.assign(process.env, env);
    phase = "fixture.bet";
    const prediction = await createPredictionBrowserFixture(user.userId);
    predictionId = prediction.seasonId;
    await db.transaction(tx => operateBetInTx(tx, { operation: "enable", seasonId: prediction.seasonId, actorId: admin.userId }));
    await db.transaction(tx => joinBetInTx(tx, prediction.seasonId, user.userId));
    if (adapter) {
      phase = "fixture.mizar";
      const source = await createMizarResourceDriver(adapter, resolve(directory, "mizar-http-resource.json"), env);
      live = source; report.mizarFixtureSource = source.sourceSha;
      if (live.producers.length !== 2) throw new Error("EXPECTED_TWO_HTTP_PRODUCERS");
      for (const producer of live.producers) {
        if (producer.steps.length < 1 || producer.steps.length > 256 || producer.intervalMs < 50 || producer.intervalMs > 5000) throw new Error("HTTP_PRODUCER_PLAN_UNBOUNDED");
        sensitive.push(producer.credential);
      }
      report.workloadHash = createHash("sha256").update(JSON.stringify({ workload, producerPlan: live.producers.map(producer => ({ intervalMs: producer.intervalMs, steps: producer.steps.map(step => step.operation) })) })).digest("hex");
    } else report.blockers.push("G_HTTP_FIXTURE_NOT_SUPPLIED");
    await disposeDatabaseBinding();
    phase = "fixture.telemetry";
    telemetry = await createLocalTelemetryResourceFixture(directory, seed);
    sensitive.push(telemetry.secret);
    report.telemetry = telemetry.requests;
    mark("fixture.ready");
    if (build) {
      phase = "build";
      execute("pnpm", ["build:local"], { ...process.env, ...env });
    }
    report.buildId = readFileSync(resolve(".next/BUILD_ID"), "utf8").trim();
    const appEnv = { ...env, NODE_EXTRA_CA_CERTS: telemetry.ca, PRODUCT_TELEMETRY_ADMIN_KEY: telemetry.secret,
      PRODUCT_TELEMETRY_ENDPOINT: telemetry.endpoint, RIVALHUB_RUNTIME_HEALTH_ENABLED: "1" };
    const envFile = resolve(directory, "application.env");
    writeFileSync(envFile, Object.entries(appEnv).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}=${value}`).join("\n"), { mode: 0o600 });
    phase = "application.start";
    docker("run", "--detach", "--name", container, "--user", `${uid}:${gid}`, "--network", "host",
      "--memory", "512m", "--memory-swap", "512m", "--cpus", "1", "--pids-limit", "128", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
      "--env-file", envFile, "--volume", `${root}:${root}`, "--workdir", root, "--entrypoint", realpathSync("node_modules/.bin/node"), image,
      resolve("node_modules/next/dist/bin/next"), "start", "-p", "3107", "-H", "127.0.0.1");
    applicationCreated = true;
    appLogs = spawn("docker", ["logs", "--follow", container], { stdio: ["ignore", "pipe", "pipe"] });
    let partial = "";
    appLogs.stdout!.on("data", chunk => {
      partial = (partial + String(chunk)).slice(-131072);
      const lines = partial.split("\n"); partial = lines.pop()!;
      for (const line of lines) {
        try { const event = JSON.parse(line) as Record<string, unknown>;
          if (typeof event.event === "string" && (event.event.startsWith("runtime.") || event.event === "mizar.live.outcome_window") && report.runtime.length < 256) report.runtime.push(event);
        } catch { /* Do not retain banners, URLs, free text, or payloads. */ }
      }
    });
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        const response = await fetch(`${base}/api/system/release`, { redirect: "manual", signal: AbortSignal.timeout(2000) });
        await assertBaselineReadiness(response, { releaseTag, releaseCommit: sha });
        ready = true; break;
      } catch { await delay(500); }
    }
    if (!ready) throw new Error("EXACT_BUILD_NOT_READY");
    mark("application.ready"); sample();
    interval = setInterval(() => { try { sample(); } catch (error) { if (report.errors.length < 32) report.errors.push({ phase: "resource.sample", ...safeError(error) }); } }, 1000);
    phase = "browser.launch";
    browser = await chromium.launch({ headless: true });
    report.browserVersion = browser.version();
    const userContext = await browser.newContext(); const adminContext = await browser.newContext();
    phase = "login.user";
    await login(userContext, user.email, scenario.password, "user");
    phase = "login.admin";
    await login(adminContext, admin.email, scenario.password, "admin");
    mark("login.ready");
    const documents = [
      { page: await userContext.newPage(), kind: "bet", path: `/${prediction.slug}/bet`, title: "预测与竞猜" },
      { page: await userContext.newPage(), kind: "profile", path: `/players/${user.userId}`, title: "Browser player2" },
      { page: await adminContext.newPage(), kind: "telemetry", path: "/admin/telemetry", title: "产品使用与体验" },
    ];
    for (const doc of documents) observeBrowser(doc.page, doc.kind);
    phase = "combination";
    mark("combination.barrier");
    const tasks: Promise<unknown>[] = documents.map(async doc => {
      for (let repeat = 0; repeat < workload.concurrentRounds; repeat++) await document(doc.page, doc.kind, doc.path, doc.title, repeat === 0 ? "cold-combination" : "warm-combination");
    });
    for (const [producer, source] of (live?.producers ?? []).entries()) tasks.push((async () => {
      mark(`producer.${producer}.start`);
      for (const step of source.steps) {
        const at = performance.now();
        const record: RequestResult = { kind: step.operation, phase: "combination", producer, startedMs: at - started, durationMs: 0, status: null, bytes: 0 };
        report.requests.push(record);
        try {
          const body = JSON.stringify(step.body(new Date().toISOString()));
          record.requestBytes = Buffer.byteLength(body);
          const response = await fetch(`${base}/api/mizar/${step.operation}`, { method: "POST", headers: { authorization: `Bearer ${source.credential}`,
            "content-type": "application/json", "x-rivalhub-authority": String(step.authorityRevision) }, body, redirect: "error", signal: AbortSignal.timeout(15_000) });
          record.status = response.status;
          const bytes = await response.arrayBuffer(); record.bytes = bytes.byteLength;
          if (!response.ok) throw new Error("PRODUCER_HTTP_FAILURE");
          const result = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
          record.outcome = step.check(response.status, result);
          if (typeof result.reason === "string" && ["frame_expired", "contended", "delivery_dropped", "broadcast_unavailable", "capacity"].includes(result.reason)) record.reason = result.reason;
          if (record.outcome === "unknown") throw new Error("PRODUCER_OUTCOME_UNKNOWN");
        } catch (error) { record.error = error instanceof Error ? error.name : "UnknownError"; throw error; }
        finally { record.durationMs = performance.now() - at; }
        await delay(source.intervalMs);
      }
      mark(`producer.${producer}.end`);
    })());
    const results = await Promise.allSettled(tasks);
    if (results.some(result => result.status === "rejected")) throw new Error("COMBINATION_REQUEST_FAILED_NO_REPLAY");
    mark("combination.end"); sample();
    phase = "documents.warm";
    for (const doc of documents) await document(doc.page, doc.kind, doc.path, doc.title, "warm-single");
    phase = "idle";
    await delay(workload.idleMs); sample(); mark("idle.end");
    if (live) report.verification = await live.verify();
    report.observedResourceNames = [...new Set(report.runtime.filter(event => event.event === "runtime.resource.sample").map(event => String(event.operation)))];
    report.unobservedResourceNames = RUNTIME_RESOURCE_NAMES.filter(name => !report.observedResourceNames.includes(name));
    report.coverage = { runtimeHealth: report.runtime.some(event => event.event === "runtime.health.sample"),
      poolWaiting: report.runtime.some(event => event.event === "runtime.pool.waiting"), telemetryHttps: report.telemetry.some(request => request.path === "/admin/analysis" && request.status === 200),
      twoHttpProducers: report.requests.some(request => request.kind === "live" && request.producer === 0 && request.outcome === "accepted") && report.requests.some(request => request.kind === "live" && request.producer === 1 && request.outcome === "accepted"),
      reliableHttp: report.requests.some(request => request.kind === "reliable" && request.status === 200) };
    if (!report.coverage.runtimeHealth || !report.coverage.poolWaiting || !report.coverage.telemetryHttps) throw new Error("OBSERVATION_COVERAGE_MISSING");
    report.passed = report.blockers.length === 0 && report.errors.length === 0 && Object.values(report.coverage).every(Boolean);
  } catch (error) { report.errors.push({ phase, ...safeError(error) }); }
  finally {
    if (interval) clearInterval(interval);
    try { await browser?.close(); report.cleanup.browser = true; } catch { report.cleanup.browser = false; }
    if (applicationCreated) {
      try { const state = JSON.parse(docker("inspect", "--format", "{{json .State}}", container));
        report.appState = { oomKilled: state.OOMKilled, exitCode: state.ExitCode, status: state.Status };
        if (state.OOMKilled) { report.passed = false; report.errors.push({ phase: "application", name: "OOMKilled", message: "APPLICATION_CGROUP_OOM" }); }
        if (state.Status !== "running" || state.ExitCode !== 0) report.errors.push({ phase: "application", name: "Error", message: "APPLICATION_NOT_RUNNING" });
      } catch { report.errors.push({ phase: "application", name: "Error", message: "APPLICATION_STATE_UNAVAILABLE" }); }
    }
    try { if (applicationCreated) docker("rm", "--force", container); report.cleanup.application = true; } catch { report.cleanup.application = false; }
    appLogs?.kill();
    try { await telemetry?.close(); report.cleanup.telemetry = true; } catch { report.cleanup.telemetry = false; }
    try {
      if (live && !Object.keys(report.verification).length) report.verification = await live.verify(false);
    } catch { report.errors.push({ phase: "mizar.verify", name: "Error", message: "G_READ_ONLY_VERIFY_FAILED" }); }
    try { await live?.cleanup(); report.cleanup.mizar = true; } catch { report.cleanup.mizar = false; }
    try { if (predictionId) await removePredictionBrowserFixture(predictionId); report.cleanup.bet = true; } catch { report.cleanup.bet = false; }
    try { if (scenarioCreated) await cleanupMajorBrowserScenarioFixture(scenarioId, credentials, "stats", env); report.cleanup.auth = true; } catch { report.cleanup.auth = false; }
    await disposeDatabaseBinding();
    for (const file of ["application.env", "telemetry.key", "telemetry.pem"]) rmSync(resolve(directory, file), { force: true });
    report.passed &&= Object.values(report.cleanup).every(Boolean) && report.errors.length === 0;
    writeFileSync(resolve(directory, "report.json"), JSON.stringify(report, null, 2));
  }
  console.info(JSON.stringify({ report: resolve(directory, "report.json"), passed: report.passed, blockers: report.blockers, errors: report.errors, cleanup: report.cleanup }));
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve("scripts/observability/resource-integration.ts")) {
  const [image, seed = "resource-prepare-v1", adapter] = process.argv.slice(2).filter(value => value !== "--build");
  if (!image) throw new Error("Expected existing Docker image ID, optional seed and complete G fixture worktree");
  void runResourceIntegrationSmoke(image, seed, adapter, process.argv.includes("--build")).then(result => {
    process.exitCode = result.passed ? 0 : result.errors.length ? 1 : 2;
  }).catch(() => { console.error("RESOURCE_PREPARATION_FAILED"); process.exitCode = 1; });
}
