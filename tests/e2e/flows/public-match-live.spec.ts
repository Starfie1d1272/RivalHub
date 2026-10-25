import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { redactText } from "../../../src/lib/observability/redact";
import { test, expect, type Request as BrowserRequest } from "@playwright/test";
import { assertPageResponse, navigateAndWaitForResponse } from "../helpers/page-health";
const execute = promisify(execFile);
const tsx = resolve("node_modules/.bin/tsx");
const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --conditions=react-server` };
const fixture = "scripts/db/mizar-live-fixture.ts";
const browserFixture = "scripts/db/public-live-browser-fixture.ts";
async function run(script: string, ...args: string[]) {
  return (await execute(tsx, [script, ...args], { env, timeout: 15000 })).stdout;
}

const stream = (matchId: string) => new Promise<ChildProcess>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", browserFixture, "stream", matchId], { env, stdio: ["ignore", "pipe", "pipe"] });
    let diagnostics = "";
    const deadline = setTimeout(() => { child.kill(); reject(new Error(`Producer readiness deadline: ${redactText(diagnostics)}`)); }, 10000);
    child.stderr!.on("data", chunk => { diagnostics = (diagnostics + String(chunk)).slice(-4096); });
    child.stdout!.on("data", chunk => {
      if (String(chunk).includes("PUBLIC_LIVE_READY")) { clearTimeout(deadline); resolve(child); }
    });
    child.once("exit", code => { clearTimeout(deadline); reject(new Error(`Producer exited ${code}: ${redactText(diagnostics)}`)); });
    child.once("error", error => { clearTimeout(deadline); reject(error); });
  });

test("public match consumes private Broadcast and recovers across navigation and map changes", async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const seasonId = randomUUID();
  let producer: ChildProcess | undefined;

  // Observe only bounded transport metadata, never headers, credentials or payloads.
  const startedAt = performance.now();
  type Pending = { method: string; path: string; resourceType: string; navigation: boolean; startedMs: number; responseStatus?: number; serverAction?: string };
  const pending = new Map<BrowserRequest, Pending>();
  const actionOwners = new Map<string, string>();
  const actionOwner = (request: BrowserRequest): string | undefined => {
    // Inspect only this public build reference; never serialize headers or reference values.
    const reference = request.headers()["next-action"];
    if (!reference) return;
    const known = actionOwners.get(reference);
    if (known) return known;
    try {
      const manifest = JSON.parse(readFileSync(".next/dev/server/server-reference-manifest.json", "utf8"));
      const entry = manifest.node?.[reference];
      const owner = typeof entry?.filename === "string" && typeof entry?.exportedName === "string"
        ? `${entry.filename}:${entry.exportedName}`.slice(0, 300) : "unmapped_server_reference";
      if (actionOwners.size < 16) actionOwners.set(reference, owner);
      return owner;
    } catch { return "manifest_unavailable"; }
  };
  const timeline: Array<Pending & { phase: string; elapsedMs: number; error?: string }> = [];
  let omitted = 0;
  let failed = false;
  let documentPath = "";
  const viewerRequests = { started: 0, responses: 0, finished: 0, failed: 0 };
  const isViewer = (url: string) => new URL(url).pathname.endsWith("/live-viewer");
  const postInitiators = new Map<string, { count: number; frames: Array<{ functionName: string; path: string; line: number }> }>();
  const diagnostics = await page.context().newCDPSession(page);
  await diagnostics.send("Network.enable");
  diagnostics.on("Network.requestWillBeSent", event => {
    if (event.request.method !== "POST" || new URL(event.request.url).pathname !== documentPath) return;
    const frames = (event.initiator.stack?.callFrames ?? []).slice(0, 8).map(frame => ({
      functionName: frame.functionName.slice(0, 120), path: (() => { try { return new URL(frame.url).pathname.slice(0, 300); } catch { return "unknown"; } })(), line: frame.lineNumber,
    }));
    const key = JSON.stringify(frames);
    const previous = postInitiators.get(key);
    if (previous) previous.count++;
    else if (postInitiators.size < 8) postInitiators.set(key, { count: 1, frames });
  });
  const record = (row: Pending, phase: string, error?: string) => {
    if (timeline.length >= 256) { omitted++; timeline.shift(); }
    timeline.push({ ...row, phase, elapsedMs: Math.round(performance.now() - startedAt), ...(error ? { error: redactText(error).slice(0, 300) } : {}) });
  };
  page.on("request", request => {
    if (isViewer(request.url())) viewerRequests.started++;
    if (pending.size >= 64) { omitted++; return; }
    const row = { method: request.method(), path: new URL(request.url()).pathname.slice(0, 300),
      resourceType: request.resourceType(), navigation: request.isNavigationRequest(), startedMs: Math.round(performance.now() - startedAt), serverAction: actionOwner(request) };
    pending.set(request, row); record(row, "request");
  });
  page.on("response", response => {
    if (isViewer(response.url())) viewerRequests.responses++;
    const row = pending.get(response.request());
    if (row) { row.responseStatus = response.status(); record(row, "response"); }
  });
  page.on("requestfinished", request => {
    if (isViewer(request.url())) viewerRequests.finished++;
    const row = pending.get(request);
    if (row) { record(row, "finished"); pending.delete(request); }
  });
  page.on("requestfailed", request => {
    if (isViewer(request.url())) viewerRequests.failed++;
    const row = pending.get(request);
    if (row) { record(row, "failed", request.failure()?.errorText); pending.delete(request); }
  });

  try {
    const output = await run(fixture, "create", seasonId);
    const line = output.split("\n").find(value => value.startsWith("LIVE_FIXTURE "));
    if (!line) throw new Error("Local live fixture did not return context");
    const { matchId, otherMatchId } = JSON.parse(line.slice("LIVE_FIXTURE ".length)) as { matchId: string; otherMatchId: string };
    await run(browserFixture, "prepare", matchId);
    const url = `/${seasonId}/matches/${matchId}`;
    documentPath = url;
    producer = await stream(matchId);
    let viewerJoins = 0;
    // Dev Strict Mode aborts its first token fetch. Count actual channel joins,
    // not those disposable setup requests, to detect duplicate subscriptions.
    page.on("websocket", socket => {
      if (!socket.url().includes("/realtime/v1/websocket")) return;
      socket.on("framesent", ({ payload }) => {
        const message = JSON.parse(String(payload)) as unknown;
        if (!Array.isArray(message)) return;
        const [, , topic, event] = message; // Supabase Realtime v2 wire envelope.
        if (event === "phx_join" && topic === `realtime:match-live:${matchId}`) viewerJoins++;
      });
    });
    const tokenResponse = await navigateAndWaitForResponse(page, url,
      response => response.url().endsWith(`/api/matches/${matchId}/live-viewer`));
    expect(tokenResponse.status()).toBe(200);
    const live = page.getByTestId("match-realtime").filter({ visible: true });
    await expect(live.getByText("FalleN", { exact: true })).toBeVisible();
    await expect(live.locator("canvas")).toBeVisible();
    expect(viewerJoins).toBe(1);
    await expect(page.getByLabel("系列赛比分").filter({ visible: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "BP 结果与地图" }).getByText("2 : 0", { exact: true })).toBeVisible();
    await expect(page.getByText("暂无直播", { exact: true })).toBeVisible();
    producer?.kill(); producer = undefined;
    await expect(live.getByText("实时数据暂时中断", { exact: true })).toBeVisible({ timeout: 6000 });
    const radarFrozen = await live.locator("canvas").evaluate(canvas => new Promise<boolean>(resolve => {
      const surface = canvas as HTMLCanvasElement;
      const first = surface.toDataURL();
      let frames = 0;
      const check = () => {
        if (surface.toDataURL() !== first) resolve(false);
        else if (++frames === 8) resolve(true);
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    }));
    expect(radarFrozen).toBe(true);
    // Retain one real disconnect/recovery; this does not prove exact age boundaries.
    producer = await stream(matchId);
    await expect(live.getByText("FalleN", { exact: true })).toBeVisible();
    // Real Next Link navigation mounts the list row initially outside its
    // visibility subscription. This must not revoke the shared cache proof.
    const storedSequence = () => page.evaluate(matchId => {
      const key = Object.keys(sessionStorage).find(key => key.startsWith("rivalhub:previous-live:v1:"));
      return key ? JSON.parse(sessionStorage.getItem(key)!).find((entry: { matchId: string }) => entry.matchId === matchId)?.snapshot?.delivery?.sequence ?? 0 : 0;
    }, matchId);
    const beforeListSequence = await storedSequence();
    expect(beforeListSequence).toBeGreaterThan(0);
    await page.getByRole("link", { name: "← 返回赛程总览" }).click();
    await expect(page).toHaveURL(new RegExp(`/${seasonId}/matches$`));
    const matchLink = page.locator(`a[href="${url}"]`).filter({ has: page.getByTestId("match-list-live-score") });
    await expect(matchLink.getByLabel("本图回合比分")).toBeVisible();
    await matchLink.click();
    await expect(live.locator("canvas")).toBeVisible();
    // Wait for the running receiver to persist a later legitimate frame;
    // restoring an old entry alone would conceal a deleted shared proof.
    expect(viewerJoins).toBe(1);
    await expect.poll(storedSequence).toBeGreaterThan(beforeListSequence);
    producer?.kill(); producer = undefined;
    await assertPageResponse(await page.reload());
    const previous = live.getByTestId("previous-live-view");
    await expect(previous.getByText("FalleN", { exact: true })).toBeVisible();
    await expect(live.getByText(/上次画面/)).toBeVisible();
    await expect(live.locator("canvas")).toHaveCount(0);
    if (process.env.RIVALHUB_LIVE_SCREENSHOTS_DIR) {
      await page.screenshot({ path: resolve(process.env.RIVALHUB_LIVE_SCREENSHOTS_DIR, "desktop-previous.png"), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: resolve(process.env.RIVALHUB_LIVE_SCREENSHOTS_DIR, "narrow-previous.png"), fullPage: true });
      await page.setViewportSize({ width: 1280, height: 720 });
    }
    producer = await stream(matchId);
    await expect(live.locator("canvas")).toBeVisible();
    await expect(previous).toHaveCount(0);
    await assertPageResponse(await page.goto(`/${seasonId}/matches/${otherMatchId}`));
    await expect(page.getByText("FalleN", { exact: true })).toHaveCount(0);
    await assertPageResponse(await page.goto(url));
    await expect(live.locator("canvas")).toBeVisible();
    producer?.kill(); producer = undefined;
    await run(browserFixture, "switch-map", matchId);
    producer = await stream(matchId);
    await assertPageResponse(await page.reload());
    await expect(live.getByText("上下层", { exact: true })).toBeVisible();
    await expect(live.locator("canvas")).toBeVisible();
    await expect(live.getByText("Ancient", { exact: true })).toHaveCount(0);
    producer?.kill(); producer = undefined;

  } catch (error) {
    failed = true;
    throw error;
  } finally {
    const evidence = { sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      environment: "local Next HTTP + Local Supabase + Chromium", failed, elapsedMs: Math.round(performance.now() - startedAt),
      pending: [...pending.values()], omitted, viewerRequests, postInitiators: [...postInitiators.values()], timeline };
    const directory = resolve(".agent-tmp/g-live-http", seasonId);
    mkdirSync(directory, { recursive: true });
    const evidencePath = resolve(directory, "requests.json");
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    await testInfo.attach("live-http-pending.json", { path: evidencePath, contentType: "application/json" });
    console.info("LIVE_HTTP_PENDING", JSON.stringify({ ...evidence, timeline: undefined }));
    await diagnostics.detach().catch(() => {});
    producer?.kill();
    await run(fixture, "cleanup", seasonId);
  }
});
