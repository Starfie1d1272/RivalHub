import { fork } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

for (const lateJoin of [false, true]) test(lateJoin ? "图一结果缺失时，Mizar 中途接入图二恢复实时展示且不补写赛果" : "当前 Mizar 双解说认领、HTTP 上传、真实 Broadcast、网页恢复与正式比分", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  expect(process.env.RIVALHUB_MIZAR_CHECKOUT, "Run with the pinned Mizar checkout and Local Supabase Realtime").toBeTruthy();
  const worker = fork(resolve("tests/e2e/helpers/mizar-producer.ts"), [baseURL!, lateJoin ? "late" : "normal"], {
    execArgv: ["--conditions=react-server", "--import", "tsx"], stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  const ready = await new Promise<{ matchId: string; slug: string }>((accept, reject) => {
    worker.once("message", message => accept(message as { matchId: string; slug: string }));
    worker.once("exit", code => reject(new Error(`Mizar fixture exited: ${code}`)));
  });
  let id = 0;
  const command = (command: string) => new Promise<unknown>((accept, reject) => {
    const current = ++id;
    const handler = (message: { id?: number; result?: unknown; error?: string }) => {
      if (message.id !== current) return;
      worker.off("message", handler);
      if (message.error) reject(new Error(message.error)); else accept(message.result);
    };
    worker.on("message", handler);
    worker.send({ id: current, command });
  });
  try {
    // Compile the actual machine route before the client's production deadlines.
    await page.request.get("/api/mizar/match", { timeout: 60_000 });
    await page.goto(`/${ready.slug}/matches/${ready.matchId}`);
    const live = page.getByTestId("match-realtime");
    const connected = live.getByText("● 实时", { exact: true });
    await expect(live).toBeVisible();
    await command("start");
    await expect(connected).toBeVisible({ timeout: 25_000 });
    await expect(live.getByLabel("A 本图比分", { exact: true })).toHaveText("3");
    await command("score");
    await expect(live.getByLabel("A 本图比分", { exact: true })).toHaveText("4");
    await command("pause");
    await expect(connected).not.toBeVisible({ timeout: 15_000 });
    await command("resume");
    await expect(connected).toBeVisible();
    await page.reload();
    await expect(connected).toBeVisible();
    expect(await command("finish")).toMatchObject({ scoreA: 13, scoreB: 9 });
    await page.reload();
    if (lateJoin) await expect(connected).not.toBeVisible();
    else await expect(live.getByLabel("上一图比分与地图胜场")).toContainText("13:9");
  } finally {
    const exited = once(worker, "exit");
    if (worker.connected) worker.send({ command: "close" });
    const [code] = await exited;
    expect(code, "Producer releases its SQLite/DB handles and fixture rows").toBe(0);
  }
});
