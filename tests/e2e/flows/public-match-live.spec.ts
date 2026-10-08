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

test("public match consumes private Broadcast and recovers across navigation and map changes", async ({ page, browser }) => {
  test.setTimeout(180000);
  const seasonId = randomUUID();
  let producer: ChildProcess | undefined;

  try {
    const output = await run(fixture, "create", seasonId);
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
    const tokenResponse = page.waitForResponse(response => response.url().endsWith(`/api/matches/${matchId}/live-viewer`), { timeout: 10000 });
    await page.goto(url);
    expect((await tokenResponse).status()).toBe(200);
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
    await live.evaluate(element => {
      const clock = element.querySelector('[aria-label="回合时钟"]')!.textContent;
      const observer = new MutationObserver(() => {
        const current = element.querySelector('[aria-label="回合时钟"]');
        if (!current) observer.disconnect();
        else if (current.textContent !== clock) (element as HTMLElement).dataset.clockMoved = "true";
      });
      observer.observe(element, { subtree: true, characterData: true, childList: true });
    });
    await expect(live.getByText("实时数据暂不可用", { exact: true })).toBeVisible({ timeout: 12000 });
    await expect(live).not.toHaveAttribute("data-clock-moved", "true");
    await expect(live.locator("canvas")).toHaveCount(0);
    producer = await stream(matchId);
    await expect(live.getByText("FalleN", { exact: true })).toBeVisible();
    await page.reload();
    await expect(live.locator("canvas")).toBeVisible();
    await page.goto(`/${seasonId}/matches/${otherMatchId}`);
    await expect(page.getByText("FalleN", { exact: true })).toHaveCount(0);
    await page.goto(url);
    await expect(live.locator("canvas")).toBeVisible();
    await page.goto(`/${seasonId}/matches`);
    const listCard = page.getByRole("article").filter({ has: page.locator(`a[href="${url}"]`) }).filter({ visible: true });
    await expect(listCard).toHaveCount(1);
    await listCard.scrollIntoViewIfNeeded();
    await expect(listCard.getByText("FURIA", { exact: true })).toBeVisible();
    await expect(listCard.getByText("G2.Esports", { exact: true })).toBeVisible();
    await expect(listCard.getByText("未知队伍", { exact: true })).toHaveCount(0);
    const listScore = listCard.getByTestId("match-list-live-score");
    await expect(listScore.getByLabel("本图回合比分")).toHaveText("2 : 0");
    await page.goto(url);
    await expect(live.locator("canvas")).toBeVisible();
    // A fresh context has no decoded image cache that can bypass a network failure.
    const failurePage = await browser.newPage({ viewport: { width: 390, height: 1000 } });
    let failedIcons = 0;
    try {
      await failurePage.route(/\/vendor\/radar\/.*\/assets\/cs2\/objective\/.*\.svg$/, route => { failedIcons++; return route.abort(); });
      await failurePage.goto(url);
      const failureLive = failurePage.getByTestId("match-realtime");
      await expect(failureLive.getByText("雷达暂不可用，比赛数据仍可查看")).toBeVisible();
      await expect(failureLive.getByText("FalleN", { exact: true })).toBeVisible();
      expect(failedIcons).toBeGreaterThan(0);
    } finally { await failurePage.close(); }
    await page.bringToFront();
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


test("registration test match streams LIVE to an anonymous browser with match-scoped authorization", async ({ page }) => {
  test.setTimeout(90000);
  const seasonId = randomUUID();
  let producer: ChildProcess | undefined;
  try {
    const output = await run(fixture, "create-test", seasonId);
    const line = output.split("\n").find(value => value.startsWith("LIVE_FIXTURE "));
    if (!line) throw new Error("Local live fixture did not return context");
    const { matchId, otherMatchId } = JSON.parse(line.slice("LIVE_FIXTURE ".length)) as { matchId: string; otherMatchId: string };
    await run(browserFixture, "prepare", matchId);
    const denied = await page.request.get(`/api/matches/${otherMatchId}/live-viewer`);
    expect(denied.status()).toBe(400);
    expect(await denied.json()).toEqual({ error: "比赛实时数据不可用。" });
    const response = await page.request.get(`/api/matches/${matchId}/live-viewer`);
    expect(response.status()).toBe(200);
    const credential = await response.json();
    expect(credential.topic).toBe(`match-live:${matchId}`);
    expect(JSON.parse(Buffer.from(credential.token.split(".")[1], "base64url").toString())).toMatchObject({ matchId, scope: "live-viewer" });
    producer = await stream(matchId);
    await page.goto(`/${seasonId}/matches/${matchId}`, { timeout: 30000 });
    const live = page.getByTestId("match-realtime").filter({ visible: true });
    await expect(page.getByText("测试赛 · 不计入正式赛程与统计", { exact: true })).toBeVisible();
    await expect(live.getByText("FalleN", { exact: true })).toBeVisible();
    await expect(live.locator("canvas")).toBeVisible();
    await page.reload();
    await expect(live.getByText("FalleN", { exact: true })).toBeVisible();
    producer.kill(); producer = undefined;
    await run(browserFixture, "phase", matchId, "post");
    const ended = await page.request.get(`/api/matches/${matchId}/live-viewer`);
    expect(ended.status()).toBe(400);
    expect(await ended.json()).toEqual({ error: "比赛实时数据不可用。" });
  } finally {
    producer?.kill();
    await run(fixture, "cleanup", seasonId);
  }
});
