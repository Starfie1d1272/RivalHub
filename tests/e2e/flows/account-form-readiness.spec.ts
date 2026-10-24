import { test, expect } from "../fixtures";
test.use({ scenarioProfile: "auth" });
test("records actual enabled settings forms separately from navigation and layout shifts", async ({ page, scenario }, info) => {
  test.setTimeout(120000); // Three independent settings routes.
  await page.addInitScript(() => {
    const entries: { startTime: number; value: number; hadRecentInput: boolean; sourceTags: string[] }[] = [];
    Object.assign(window, { accountFormShifts: entries });
    new PerformanceObserver(list => {
      for (const raw of list.getEntries()) {
        const entry = raw as PerformanceEntry & { value: number; hadRecentInput: boolean; sources?: { node?: Node }[] };
        entries.push({ startTime: entry.startTime, value: entry.value, hadRecentInput: entry.hadRecentInput, sourceTags: (entry.sources ?? []).map(source => source.node?.nodeName ?? "unknown") });
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  const account = scenario.accounts.find(row => row.key === "player3")!;
  expect((await page.request.post("/api/test/e2e/auth", { data: { email: account.email, password: scenario.password } })).ok()).toBe(true);
  const samples = [];
  for (const route of ["/settings/security", "/settings/competitive", "/settings/education"]) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    const form = route.endsWith("security") ? page.getByLabel("新密码", { exact: true }) : route.endsWith("education") ? page.getByLabel("学信网在线验证码") : page.getByRole("combobox").first();
    await expect(form).toBeVisible(); await expect(form).toBeEnabled();
    const readyMs = await page.evaluate(() => performance.now());
    await page.waitForLoadState("networkidle");
    const shifts = await page.evaluate(() => (window as unknown as { accountFormShifts: unknown[] }).accountFormShifts);
    samples.push({ route, enabledFormReadyMs: readyMs, shifts });
  }
  await info.attach("settings-actual-form-readiness", { body: JSON.stringify({ runtime: "canonical-runner-runtime-not-assumed-production", viewport: page.viewportSize(), samples }), contentType: "application/json" });
});
