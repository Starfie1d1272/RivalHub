import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import * as readline from "node:readline";
import { expect, test } from "@playwright/test";

test.skip(({ viewport }) => (viewport?.width ?? 0) < 800, "Mizar LIVE 系统契约只在桌面 Chrome 执行，移动端不重复运行。");
test.describe.configure({ retries: 0 });

class LiveFixtureWorker {
  private child: ChildProcess;
  private rl: readline.Interface;
  private pending = new Map<number, { resolve: (val: any) => void; reject: (err: Error) => void }>();
  private nextId = 1;

  constructor(seasonId: string) {
    this.child = spawn(
      resolve("node_modules/.bin/tsx"),
      ["scripts/db/run-server-cli.ts", "scripts/db/mizar-live-fixture.ts", "worker", seasonId],
      { env: process.env, stdio: ["pipe", "pipe", "inherit"] }
    );
    this.rl = readline.createInterface({ input: this.child.stdout! });
    this.rl.on("line", line => {
      try {
        const msg = JSON.parse(line);
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.ok) p.resolve(msg.result);
          else p.reject(new Error(msg.error));
        }
      } catch {}
    });
    this.child.on("exit", (code, signal) => {
      for (const p of this.pending.values()) {
        p.reject(new Error(`Live fixture worker exited prematurely: code=${code}, signal=${signal}`));
      }
      this.pending.clear();
    });
    this.child.on("error", err => {
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    });
  }

  send<T>(action: string, ...args: unknown[]): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin!.write(JSON.stringify({ id, action, args }) + "\n");
    });
  }

  async close(): Promise<void> {
    try {
      await this.send("exit");
    } catch {}
    this.rl.close();
    this.child.kill();
  }
}

test("public LIVE receives real private Broadcast and degrades after interruption; old authority cannot replace handover", async ({ page }) => {
  test.setTimeout(45_000);
  const seasonId = randomUUID();
  const fixture = new LiveFixtureWorker(seasonId);

  try {
    const ids = await test.step("setup fixture and wait for WebSocket join", async () => {
      const created = await fixture.send<{ matchId: string; seasonId: string }>("create");
      const joined = new Promise<void>((resolveJoin, rejectJoin) => {
        const timer = setTimeout(() => rejectJoin(new Error(`WebSocket join deadline (15s) exceeded for match ${created.matchId}`)), 15_000);
        page.on("websocket", socket => {
          if (!socket.url().includes("/realtime/v1/websocket")) return;
          socket.on("framereceived", ({ payload }) => {
            const text = typeof payload === "string" ? payload : Buffer.isBuffer(payload) ? payload.toString("utf8") : new TextDecoder().decode(payload);
            if (text.includes(created.matchId) && text.includes("phx_reply") && text.includes("ok")) {
              clearTimeout(timer);
              resolveJoin();
            }
          });
        });
      });
      await page.goto(`/${seasonId}/matches/${created.matchId}`);
      await joined;
      return created;
    });

    await test.step("publish score 7:0 and assert fresh projection", async () => {
      const pub1 = await fixture.send<{ accepted?: boolean }>("publish", 1, 7);
      expect(pub1).toEqual({ accepted: true });
      await expect(page.getByText("7 : 0", { exact: true })).toBeVisible({ timeout: 5_000 });
    });

    await test.step("observe freshness degradation to stale", async () => {
      await expect(page.getByRole("status").filter({ hasText: "实时数据暂时中断" })).toBeVisible({ timeout: 6_000 });
    });

    await test.step("observe freshness degradation to unavailable", async () => {
      await expect(page.getByRole("status").filter({ hasText: "等待正式对局实时数据" })).toBeVisible({ timeout: 10_000 });
    });

    await test.step("handover authority and publish score 8:0", async () => {
      const handover = await fixture.send<Record<string, unknown>>("handover");
      expect(handover).toMatchObject({ claimed: true, authorityRevision: 2 });
      const pub2 = await fixture.send<{ accepted?: boolean }>("publish", 2, 8);
      expect(pub2).toEqual({ accepted: true });
      await expect(page.getByText("8 : 0", { exact: true })).toBeVisible({ timeout: 5_000 });
    });

    await test.step("reject old authority and assert isolation", async () => {
      const pubOld = await fixture.send<{ rejected?: boolean }>("publish", 1, 99);
      expect(pubOld).toEqual({ rejected: true });
      await expect(page.getByText("99 : 0", { exact: true })).toHaveCount(0);
      await expect(page.getByText("8 : 0", { exact: true })).toBeVisible();
      await expect(page.getByText("你的赛务", { exact: true })).toHaveCount(0);
    });
  } finally {
    await page.close();
    await fixture.close().catch(() => null);
  }
});
