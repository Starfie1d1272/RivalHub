import type { BrowserContext, Page, Request } from "@playwright/test";
import { expect, signInProgrammatically, test } from "../fixtures";

test.use({ scenarioProfile: "education" });

test("新生可以提交录取通知书并由 super admin 查看后审核", async ({ browser, page, scenario }, testInfo) => {
  const player = scenario.accounts.find((account) => account.key === "player1");
  const admin = scenario.accounts.find((account) => account.key === "admin");
  if (!player || !admin) throw new Error(`E2E scenario ${scenario.scenarioId} 缺少教育流程账号。`);
  const playerSearch = encodeURIComponent(player.email);
  const playerLabel = player.email.split("@")[0];
  const stages: Array<{ stage: string; durationMs: number }> = [];
  const requests = new Map<string, { count: number; failed: number; pending: number; maxTtfbMs: number; maxTotalMs: number }>();
  let currentStage = "准备浏览器";
  const detach: Array<() => void> = [];
  const observePage = (observed: Page) => {
    const requestStages = new WeakMap<Request, string>();
    const started = (request: Request) => {
      if (requestStages.has(request)) return;
      // Aggregate fixed classifications only; never retain URLs, headers, payloads or identities.
      const key = `${currentStage}:${request.resourceType()}:${request.method()}`;
      const row = requests.get(key) ?? { count: 0, failed: 0, pending: 0, maxTtfbMs: 0, maxTotalMs: 0 };
      row.pending += 1;
      requests.set(key, row);
      requestStages.set(request, key);
    };
    const finished = (request: Request) => {
      const key = requestStages.get(request);
      if (!key) return;
      requestStages.delete(request); // A request settles once, even if both terminal callbacks fire.
      const row = requests.get(key)!;
      row.pending -= 1;
      const timing = request.timing();
      row.count += 1;
      row.failed += Number(Boolean(request.failure()));
      if (timing.responseStart >= 0) row.maxTtfbMs = Math.max(row.maxTtfbMs, Math.round(timing.responseStart));
      if (timing.responseEnd >= 0) row.maxTotalMs = Math.max(row.maxTotalMs, Math.round(timing.responseEnd));
      requests.set(key, row);
    };
    observed.on("request", started);
    observed.on("requestfinished", finished);
    observed.on("requestfailed", finished);
    detach.push(() => {
      observed.off("request", started);
      observed.off("requestfinished", finished);
      observed.off("requestfailed", finished);
    });
  };
  const stage = async (name: string, work: () => Promise<void>) => test.step(name, async () => {
    currentStage = name;
    const started = performance.now();
    console.info("E2E_EDUCATION_STAGE", JSON.stringify({ stage: name, status: "started" }));
    try { await work(); }
    finally {
      const timing = { stage: name, durationMs: Math.round(performance.now() - started) };
      stages.push(timing);
      console.info("E2E_EDUCATION_STAGE", JSON.stringify({ ...timing, status: "ended" }));
    }
  });
  observePage(page);
  let adminContext: BrowserContext | undefined;
  let operationFailed = false;
  try {
    await stage("新生登录并打开教育认证", async () => {
      await signInProgrammatically(page, player, scenario, "/settings/education");
      const manualToggle = page.locator('button[aria-controls="education-manual-fallback"]');
      await expect.poll(async () => {
        if (await manualToggle.getAttribute("aria-expanded") !== "true") await manualToggle.click();
        return (await manualToggle.getAttribute("aria-expanded")) === "true";
      }).toBe(true);
      await expect(page.getByRole("heading", { name: "录取通知书人工审核" })).toBeVisible();
    });

    await stage("提交录取通知书证据", async () => {
      await page.locator("#manual-institution-search").fill("南京大学");
      await page.getByRole("button", { name: "搜索高校" }).last().click();
      await page.getByRole("button", { name: /南京大学/ }).last().click();
      await page.locator("#admission-notice-file").setInputFiles({
        name: "original-private-name.pdf",
        mimeType: "image/png",
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      });
      await page.getByRole("button", { name: "提交录取通知书" }).click();
      await expect(page.getByText("教育认证已提交，等待管理员审核。", { exact: true })).toBeVisible();
    });

    adminContext = await browser.newContext();
    adminContext.on("page", observePage);
    const adminPage = await adminContext.newPage();
    await stage("超管登录并读取待审核申请", async () => {
      await signInProgrammatically(adminPage, admin, scenario, "/admin");
      await adminPage.goto(`/admin/education-verifications?status=all&q=${playerSearch}`);
      await expect(adminPage.getByText("材料：录取通知书材料", { exact: true })).toBeVisible();
    });

    await stage("超管查看私有录取证据", async () => {
      const viewEvidence = adminPage.getByRole("link", { name: "查看材料" }).last();
      await expect(viewEvidence).toBeVisible();
      await expect(viewEvidence).toHaveAttribute("target", "_blank");
      await expect(viewEvidence).toHaveAttribute("rel", "noopener noreferrer");
      const [evidencePage] = await Promise.all([
        adminContext!.waitForEvent("page"),
        viewEvidence.click(),
      ]);
      await evidencePage.waitForURL(/education-evidence/);
      await evidencePage.close();
    });

    await stage("超管审核通过", async () => {
      const approve = adminPage.getByRole("button", { name: "通过" }).last();
      await expect(approve).toBeVisible();
      adminPage.on("dialog", (dialog) => dialog.accept(""));
      await approve.click();
      await expect(adminPage.getByText("认证已通过", { exact: true })).toBeVisible();
    });
    await stage("核对最终审核结果", async () => {
      await expect(adminPage.getByText(`${playerLabel} · 已通过`, { exact: true })).toBeVisible();
    });
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    const cleanupErrors: unknown[] = [];
    const cleanup = async (phase: string, work: () => Promise<void>) => {
      try { await work(); }
      catch (error) {
        cleanupErrors.push(error);
        console.warn("E2E_EDUCATION_CLEANUP_FAILURE", JSON.stringify({ phase }));
      }
    };
    await cleanup("timings_attachment", () => testInfo.attach("education-stage-timings", {
      body: Buffer.from(JSON.stringify({ stages, network: [...requests].map(([group, timing]) => ({ group, ...timing })) })),
      contentType: "application/json",
    }));
    await cleanup("network_listeners", async () => { detach.forEach(remove => remove()); });
    await cleanup("admin_context", async () => { await adminContext?.close(); });
    if (!operationFailed && cleanupErrors.length) throw cleanupErrors[0];
  }
});
