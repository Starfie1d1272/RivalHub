import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const exec = promisify(execFile);
async function fixture(command: string, seasonId: string, ...args: string[]) {
  const result = await exec(resolve("node_modules/.bin/tsx"), ["scripts/db/run-server-cli.ts", "scripts/db/mizar-live-fixture.ts", command, seasonId, ...args], { env: process.env });
  const line = result.stdout.split("\n").find(row => row.startsWith("LIVE_FIXTURE "));
  return line ? JSON.parse(line.slice("LIVE_FIXTURE ".length)) : null;
}

test("public LIVE receives real private Broadcast and degrades after interruption; old authority cannot replace handover", async ({ page }) => {
  test.setTimeout(120_000); // Includes the real freshness expiry and Supabase reconnect.
  const seasonId = randomUUID();
  try {
    const ids = await fixture("create", seasonId);
    const joined = new Promise<void>((resolveJoin, rejectJoin) => {
      const timer = setTimeout(() => rejectJoin(new Error(`WebSocket join timeout for match ${ids.matchId}`)), 30_000);
      page.on("websocket", socket => {
        if (!socket.url().includes("/realtime/v1/websocket")) return;
        socket.on("framereceived", ({ payload }) => {
          const text = typeof payload === "string" ? payload : Buffer.isBuffer(payload) ? payload.toString("utf8") : new TextDecoder().decode(payload);
          if (text.includes(ids.matchId) && text.includes("phx_reply") && text.includes("ok")) {
            clearTimeout(timer);
            resolveJoin();
          }
        });
      });
    });
    await page.goto(`/${seasonId}/matches/${ids.matchId}`);
    await joined;
    expect(await fixture("publish", seasonId, "1", "7")).toEqual({ accepted: true });
    await expect(page.getByText("7 : 0", { exact: true })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "实时数据暂时中断" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "等待正式对局实时数据" })).toBeVisible({ timeout: 15_000 });
    expect(await fixture("handover", seasonId)).toMatchObject({ claimed: true, authorityRevision: 2 });
    expect(await fixture("publish", seasonId, "2", "8")).toEqual({ accepted: true });
    await expect(page.getByText("8 : 0", { exact: true })).toBeVisible();
    expect(await fixture("publish", seasonId, "1", "99")).toEqual({ rejected: true });
    await expect(page.getByText("99 : 0", { exact: true })).toHaveCount(0);
    await expect(page.getByText("8 : 0", { exact: true })).toBeVisible();
    await expect(page.getByText("你的赛务", { exact: true })).toHaveCount(0);
  } finally {
    await page.close();
    await fixture("cleanup", seasonId).catch(() => null);
  }
});
