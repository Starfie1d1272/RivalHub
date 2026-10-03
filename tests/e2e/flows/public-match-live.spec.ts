import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
const execute = promisify(execFile);
const tsx = resolve("node_modules/.bin/tsx");
const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --conditions=react-server` };
const fixture = "scripts/db/mizar-live-fixture.ts";
const browserFixture = "scripts/db/public-live-browser-fixture.ts";
async function run(script: string, ...args: string[]) {
  return (await execute(tsx, [script, ...args], { env, timeout: 30000 })).stdout;
}

test("public match consumes private Broadcast and recovers with canonical layout", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "One real producer fixture checks desktop, 390px and 320px together.");
  test.setTimeout(180000);
  const seasonId = randomUUID();
  let producer: ChildProcess | undefined;
  const stream = (matchId: string) => {
    return spawn(process.execPath, ["--import", "tsx", browserFixture, "stream", matchId], { env, stdio: "ignore" });
  };
  try {
    const output = await run(fixture, "create", seasonId);
    const line = output.split("\n").find(value => value.startsWith("LIVE_FIXTURE "));
    if (!line) throw new Error("Local live fixture did not return context");
    const { matchId, otherMatchId } = JSON.parse(line.slice("LIVE_FIXTURE ".length)) as { matchId: string; otherMatchId: string };
    await run(browserFixture, "prepare", matchId);
    const url = `/${seasonId}/matches/${matchId}`;
    producer = stream(matchId);
    await page.goto(url);
    const live = page.getByTestId("match-realtime");
    await expect(live.getByText("FalleN", { exact: true })).toBeVisible();
    await expect(live.locator("canvas")).toBeVisible();
    await expect(page.getByText("暂无直播入口，可以继续查看比赛数据。")).toBeVisible();
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
      await testInfo.attach(`public-live-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    }
    producer?.kill(); producer = undefined;
    await expect(live.getByText("实时数据暂时中断", { exact: true })).toBeVisible({ timeout: 6000 });
    const clock = await live.getByLabel("回合时钟").textContent();
    await page.waitForTimeout(500);
    await expect(live.getByLabel("回合时钟")).toHaveText(clock!);
    await expect(live.getByText("实时数据暂不可用", { exact: true })).toBeVisible({ timeout: 12000 });
    await expect(live.locator("canvas")).toHaveCount(0);
    producer = stream(matchId);
    await expect(live.getByText("FalleN", { exact: true })).toBeVisible();
    await page.reload();
    await expect(live.locator("canvas")).toBeVisible();
    await page.goto(`/${seasonId}/matches/${otherMatchId}`);
    await expect(page.getByText("FalleN", { exact: true })).toHaveCount(0);
    await page.goto(url);
    await expect(live.locator("canvas")).toBeVisible();
    await page.route("**/vendor/radar/**/assets/cs2/objective/*.svg", route => route.abort());
    await page.reload();
    await expect(live.getByText("雷达暂不可用，比赛数据仍可查看")).toBeVisible();
    await expect(live.getByText("FalleN", { exact: true })).toBeVisible();
    await page.unrouteAll();
    producer?.kill(); producer = undefined;
    for (const [phase, label] of [["pre", "等待 BP"], ["bp", "BP 进行中"], ["waiting", "等待正式对局"], ["inter_map", "图间休息"], ["post", null]] as const) {
      await run(browserFixture, "phase", matchId, phase);
      await page.reload();
      if (label) await expect(page.getByText(label, { exact: true })).toBeVisible();
      else await expect(live).toHaveCount(0);
      await testInfo.attach(`public-${phase}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    }
  } finally {
    producer?.kill();
    await run(fixture, "cleanup", seasonId);
  }
});
