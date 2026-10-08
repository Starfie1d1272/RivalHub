import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { redactText } from "../../../src/lib/observability/redact";
import { test, expect } from "@playwright/test";
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

test("public test match consumes private Broadcast and recovers across navigation and map changes", async ({ page }) => {
  test.setTimeout(180000);
  const seasonId = randomUUID();
  let producer: ChildProcess | undefined;

  try {
    const output = await run(fixture, "create-test", seasonId);
    const line = output.split("\n").find(value => value.startsWith("LIVE_FIXTURE "));
    if (!line) throw new Error("Local live fixture did not return context");
    const { matchId, otherMatchId } = JSON.parse(line.slice("LIVE_FIXTURE ".length)) as { matchId: string; otherMatchId: string };
    await run(browserFixture, "prepare", matchId);
    const url = `/${seasonId}/matches/${matchId}`;
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
    // Observe the initial credential while the first route compiles. Its deadline
    // must cover navigation; a 10s request timer raced the cold Next compile.
    const [tokenResponse] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith(`/api/matches/${matchId}/live-viewer`), { timeout: 30000 }),
      page.goto(url),
    ]);
    expect(tokenResponse.status()).toBe(200);
    await expect(page.getByText("测试赛 · 不计入正式赛程与统计", { exact: true })).toBeVisible();
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
    // Exact stale/unavailable time boundaries and frozen clock are covered by
    // MatchRealtime.test.tsx; retain one real disconnect/recovery here.
    producer = await stream(matchId);
    await expect(live.getByText("FalleN", { exact: true })).toBeVisible();
    await page.reload();
    await expect(live.locator("canvas")).toBeVisible();
    await page.goto(`/${seasonId}/matches/${otherMatchId}`);
    await expect(page.getByText("FalleN", { exact: true })).toHaveCount(0);
    await page.goto(url);
    await expect(live.locator("canvas")).toBeVisible();
    producer?.kill(); producer = undefined;
    await run(browserFixture, "switch-map", matchId);
    producer = await stream(matchId);
    await page.reload();
    await expect(live.getByText("上下层", { exact: true })).toBeVisible();
    await expect(live.locator("canvas")).toBeVisible();
    await expect(live.getByText("Ancient", { exact: true })).toHaveCount(0);
    producer?.kill(); producer = undefined;

  } finally {
    producer?.kill();
    await run(fixture, "cleanup", seasonId);
  }
});
