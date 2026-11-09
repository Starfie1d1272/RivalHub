import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import { assertLocalDatabaseUrl, assertLocalHttpUrl } from "../../../scripts/db/local-environment";
import { requireSupabaseSecretKey } from "../../../src/lib/runtime/supabase-keys";
import { expect, test } from "../fixtures";

test.use({ scenarioProfile: "team-invite", trace: "off" });
test.skip(({ isMobile }) => isMobile, "一次性票据校验与视口无关");

test("错误账号的确认提交保留一次性票据给申请人", async ({ page, scenario, baseURL }) => {
  assertLocalHttpUrl(baseURL, "E2E app URL");
  const owner = scenario.accounts.find((account) => account.key === "player1")!;
  const other = scenario.accounts.find((account) => account.key === "player2")!;
  const apiUrl = assertLocalHttpUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, "local auth URL");
  const service = createClient(apiUrl, requireSupabaseSecretKey(process.env.SUPABASE_SECRET_KEY, apiUrl), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const pool = new Pool({ connectionString: assertLocalDatabaseUrl(process.env.DATABASE_URL), ssl: false });
  const requestId = randomUUID();
  const email = `secondary-${requestId}@fixture.invalid`;
  const state = randomBytes(32).toString("base64url");
  let authId: string | undefined;

  async function signIn(email: string) {
    const response = await page.request.post("/api/test/e2e/auth", { data: { email, password: scenario.password } });
    expect(response.ok()).toBe(true);
  }

  try {
    const created = await service.auth.admin.createUser({ email, email_confirm: true });
    if (created.error) throw new Error("本地备用邮箱 fixture 创建失败");
    authId = created.data.user.id;
    const proof = await service.auth.admin.generateLink({ type: "magiclink", email });
    if (proof.error) throw new Error("本地邮箱票据生成失败");

    await pool.query(
      `insert into identity_link_requests(id,user_id,normalized_email,state_token_hash,expires_at)
       values($1,$2,$3,$4,now()+interval '30 minutes')`,
      [requestId, owner.userId, email, createHash("sha256").update(state).digest("hex")],
    );
    const path = `/auth/confirmation?${new URLSearchParams({
      flow: "link_identity",
      request: requestId,
      state,
      token_hash: proof.data.properties.hashed_token,
      type: "magiclink",
    })}`;
    const confirm = page.getByRole("button", { name: "验证并继续" });
    const wrongAccount = page.getByRole("alert").filter({ hasText: "登录发起绑定的 RivalHub 账号" });

    await signIn(other.email);
    await page.goto(path);
    await expect(wrongAccount).toBeVisible();
    await expect(page.getByRole("link", { name: "查看当前账号" })).toHaveAttribute("href", "/settings/security");
    await expect(confirm).toHaveCount(0);

    await signIn(owner.email);
    await page.goto(path, { waitUntil: "networkidle" });
    // Keep the eligible page open while the application cookie changes.
    await signIn(other.email);
    await confirm.click();
    await expect(wrongAccount).toBeVisible();

    await signIn(owner.email);
    await page.goto(path, { waitUntil: "networkidle" });
    await confirm.click();
    await expect(page).toHaveURL(/\/settings\/education$/);
    const { rows } = await pool.query("select status from identity_link_requests where id=$1", [requestId]);
    expect(rows).toEqual([{ status: "completed" }]);
    const identities = await pool.query("select user_id from user_identities where normalized_value=$1 and status='active'", [email]);
    expect(identities.rows).toEqual([{ user_id: owner.userId }, { user_id: owner.userId }]);
  } finally {
    await pool.end();
    if (authId) await service.auth.admin.deleteUser(authId);
  }
});
