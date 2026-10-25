import { request as httpRequest } from "node:http";
import { expect, test, signInProgrammatically } from "../fixtures";

test.use({ scenarioProfile: "auth" });
test("local auth transport unknown is recoverable and the action envelope respects the actual body limit", async ({ page, scenario, baseURL }, info) => {
  test.setTimeout(120000); // Cold login compilation plus three bounded real HTTP uploads.
  const account = scenario.accounts.find(row => row.key === "player3")!;
  let actionId = ""; let calls = 0;
  await page.route("**/login**", async route => {
    if (route.request().method() !== "POST" || !route.request().headers()["next-action"]) { await route.continue(); return; }
    calls++; actionId = route.request().headers()["next-action"]!; await route.abort();
  });
  await page.goto("/login", { waitUntil: "load" });
  await page.getByLabel("邮箱地址").fill(account.email);
  await page.getByLabel("密码", { exact: true }).fill(scenario.password);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText("登录请求未完成，请检查网络连接后重试。")).toBeVisible();
  await expect(page.locator('button[type="submit"]')).toBeEnabled();
  expect(calls).toBe(3); expect(actionId).toBeTruthy();
  // Invalid email rejects before clock/provider/DB. No credential or provider call is needed to exercise decoding.
  const envelope = JSON.stringify(["invalid", "", { padding: "x".repeat(4 * Math.ceil(7 * 1024 * 1024 / 3)) }]);
  const url = new URL("/login", baseURL);
  const upload = async (body: string, slow = false) => new Promise<{ status: number; text: string; elapsedMs: number }>((resolve, reject) => {
    const started = performance.now();
    const req = httpRequest(url, { method: "POST", headers: { "next-action": actionId, "content-type": "text/plain;charset=UTF-8", origin: url.origin, "content-length": Buffer.byteLength(body) } }, res => {
      let text = ""; res.on("data", chunk => { text += chunk; }); res.on("end", () => resolve({ status: res.statusCode!, text, elapsedMs: performance.now() - started }));
    });
    req.on("error", reject); req.setTimeout(20000, () => req.destroy(new Error("bounded upload deadline")));
    if (!slow) { req.end(body); return; }
    let offset = 0;
    const send = () => { const end = Math.min(body.length, offset + 64 * 1024); req.write(body.slice(offset, end)); offset = end; if (offset === body.length) req.end(); else setTimeout(send, 50); };
    send();
  });
  const accepted = await upload(envelope);
  expect(accepted.status).toBe(200); expect(accepted.text).toContain("VALIDATION_FAILED");
  const paced = await upload(envelope, true);
  expect(paced.status).toBe(200); expect(paced.text).toContain("VALIDATION_FAILED");
  const rejected = await upload(JSON.stringify(["invalid", "", { padding: "x".repeat(10 * 1024 * 1024) }]));
  expect(rejected.status).toBe(500);
  expect(rejected.text).toContain("Body exceeded 10mb limit"); // Current Next dev action transport wraps the limit error as HTTP 500.
  await signInProgrammatically(page, account, scenario, "/settings/security");
  await page.goto("/settings/security", { waitUntil: "load" });
  await expect(page.getByRole("heading", { name: "账号与安全" })).toBeVisible();
  await info.attach("local-action-body-budget", { body: JSON.stringify({ transportAttemptsBeforeGuidance: calls, imageBudgetMiB: 7, envelopeBytes: Buffer.byteLength(envelope), accepted: accepted.status, paced: paced.status, rejected: rejected.status, pacedElapsedMs: paced.elapsedMs, pacedChunkBytes: 64 * 1024, pacedChunkIntervalMs: 50, productionProxyVerified: false }), contentType: "application/json" });
});
