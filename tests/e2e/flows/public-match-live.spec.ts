import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { redactText } from "../../../src/lib/observability/redact";
import { test, expect, type Page } from "@playwright/test";
const execute = promisify(execFile);
const tsx = resolve("node_modules/.bin/tsx");
const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --conditions=react-server` };
const fixture = "scripts/db/mizar-live-fixture.ts";
const browserFixture = "scripts/db/public-live-browser-fixture.ts";
async function run(script: string, ...args: string[]) {
  return (await execute(tsx, [script, ...args], { env, timeout: 15000 })).stdout;
}

test("public match consumes private Broadcast and recovers with canonical layout", async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "One real producer fixture checks desktop, 390px and 320px together.");
  test.setTimeout(180000);
  const seasonId = randomUUID();
  const capture = async (name: string, target: Page = page) => {
    // Scope the evidence font to this page; system installation changes unrelated visual baselines.
    const font = resolve(".agent-tmp/evidence-fonts/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc");
    if (existsSync(font)) {
      await target.route("**/__public-evidence-font", route => route.fulfill({ path: font, contentType: "font/collection" }));
      await target.evaluate(async () => {
        if (![...document.fonts].some(face => face.family === "Public Evidence" && face.status === "loaded")) {
          const response = await fetch("/__public-evidence-font");
          const face = new FontFace("Public Evidence", await response.arrayBuffer());
          await face.load();
          document.fonts.add(face);
        }
      });
      await target.addStyleTag({ content: 'body { --font-noto-sans-sc: "Public Evidence"; --font-sans: Arial, "Public Evidence", sans-serif; --font-display: Arial, "Public Evidence", sans-serif; --font-mono: "JetBrains Mono", ui-monospace, "Public Evidence", monospace; font-family: var(--font-sans); }' });
    }
    await target.evaluate(() => document.fonts.ready);
    await target.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    const body = await target.screenshot({ fullPage: true });
    await testInfo.attach(name, { body, contentType: "image/png" });
    const directory = resolve(".agent-tmp/public-match-live-evidence");
    mkdirSync(directory, { recursive: true });
    writeFileSync(resolve(directory, `${name}.png`), body);
  };
  let producer: ChildProcess | undefined;
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
  try {
    const output = await run(fixture, "create", seasonId);
    const line = output.split("\n").find(value => value.startsWith("LIVE_FIXTURE "));
    if (!line) throw new Error("Local live fixture did not return context");
    const { matchId, otherMatchId } = JSON.parse(line.slice("LIVE_FIXTURE ".length)) as { matchId: string; otherMatchId: string };
    await run(browserFixture, "prepare", matchId);
    const url = `/${seasonId}/matches/${matchId}`;
    producer = await stream(matchId);
    const tokenResponse = page.waitForResponse(response => response.url().endsWith(`/api/matches/${matchId}/live-viewer`), { timeout: 10000 });
    await page.goto(url);
    expect((await tokenResponse).status()).toBe(200);
    const live = page.getByTestId("match-realtime").filter({ visible: true });
    await expect(live.getByText("FalleN", { exact: true })).toBeVisible();
    await expect(live.locator("canvas")).toBeVisible();
    await expect(page.getByText("暂无直播入口，可继续查看比赛数据。")).toBeVisible();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      if (width === 1440) {
        const delta = await live.evaluate(element => {
          const tables = element.querySelectorAll("table");
          return Math.abs(tables[1].getBoundingClientRect().bottom - element.querySelector('[aria-label="比赛战术雷达"]')!.getBoundingClientRect().bottom);
        });
        expect(delta).toBeLessThanOrEqual(3);
      }
      await capture(`public-live-${width}`);
    }
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
    await capture("public-stale");
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
    await capture("public-unavailable");
    producer = await stream(matchId);
    await expect(live.getByText("FalleN", { exact: true })).toBeVisible();
    await page.reload();
    await expect(live.locator("canvas")).toBeVisible();
    await page.goto(`/${seasonId}/matches/${otherMatchId}`);
    await expect(page.getByText("FalleN", { exact: true })).toHaveCount(0);
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
      await capture("public-asset-failure", failurePage);
    } finally { await failurePage.close(); }
    await page.bringToFront();
    producer?.kill(); producer = undefined;
    await run(browserFixture, "switch-map", matchId);
    producer = await stream(matchId);
    await page.reload();
    await expect(live.getByText("上下层", { exact: true })).toBeVisible();
    await expect(live.locator("canvas")).toBeVisible();
    await expect(live.getByText("Ancient", { exact: true })).toHaveCount(0);
    await capture("public-map-change");
    producer?.kill(); producer = undefined;
    for (const [phase, label] of [["pre", "等待 BP"], ["bp", "BP 进行中"], ["waiting", "等待正式对局"], ["inter_map", "图间休息"], ["post", null]] as const) {
      await run(browserFixture, "phase", matchId, phase);
      await page.reload();
      if (label) await expect(page.getByText(label, { exact: true }).filter({ visible: true })).toBeVisible();
      else await expect(live).toHaveCount(0);
      if (phase === "inter_map") await expect(page.getByLabel("系列赛比分").filter({ visible: true })).toHaveText(/1\s*:\s*0/);
      if (phase === "post") await expect(page.getByLabel("系列赛比分").filter({ visible: true })).toHaveText(/2\s*:\s*0/);
      await capture(`public-${phase}`);
    }
  } finally {
    producer?.kill();
    await run(fixture, "cleanup", seasonId);
  }
});
