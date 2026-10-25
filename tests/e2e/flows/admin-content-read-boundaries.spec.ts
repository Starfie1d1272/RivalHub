import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { test, expect, signInProgrammatically } from "../fixtures";
import { createPredictionBrowserFixture, removePredictionBrowserFixture } from "../helpers/prediction-fixture";
import { assertLocalDatabaseUrl } from "../../../scripts/db/local-environment";
import * as schema from "@/db/schema";

test.use({ scenarioProfile: "layout", trace: "on" });
test.setTimeout(180_000);

test("后台3信息+6公告入口使用摘要和scoped完整详情，教育权限保持fresh", async ({ page, scenario }) => {
  const actor = scenario.accounts.find(account => account.key === "player2")!;
  const superAdmin = scenario.accounts.find(account => account.key === "admin")!;
  const fixture = await createPredictionBrowserFixture(actor.userId);
  const pool = new Pool({ connectionString: assertLocalDatabaseUrl(process.env.DATABASE_URL), ssl: false });
  const database = drizzle(pool, { schema });
  const foreign = randomUUID(), foreignAnnouncement = randomUUID(), institution = randomUUID(), verification = randomUUID();
  const ids = Array.from({ length: 65 }, () => randomUUID());
  const bodyMarker = `body-marker-${randomUUID()}`;
  const body = `${bodyMarker}\n${"公告完整正文。".repeat(400)}`;
  const contact = `contact-marker-${randomUUID()}`;
  const school = `school-marker-${randomUUID()}`;
  const code = randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
  async function flightText() {
    await page.waitForLoadState("networkidle");
    return page.evaluate(async () => {
      const response = await fetch(window.location.href, { headers: { RSC: "1" }, cache: "no-store" });
      if (!response.ok || !response.headers.get("content-type")?.includes("text/x-component")) throw new Error("未得到授权Flight响应");
      return response.text();
    });
  }
  try {
    await database.insert(schema.seasonAdminGrants).values({ seasonId: fixture.seasonId, userId: actor.userId });
    await pool.query("insert into seasons(id,slug,name,kind) values($1::uuid,$1::text,'foreign fixture','custom')", [foreign]);
    await pool.query(`insert into announcements(id,scope,season_id,title,body,status,updated_at)
      select id,'season',$2,'fixture announcement',$3,'draft','2051-01-01T00:00:00Z' from unnest($1::uuid[]) id`, [ids, fixture.seasonId, body]);
    await pool.query("insert into announcements(id,scope,season_id,title,body,status) values($1,'season',$2,'foreign announcement','foreign body','draft')", [foreignAnnouncement, foreign]);
    await pool.query("insert into community_groups(season_id,label,group_number) values($1,'fixture group','123456789')", [fixture.seasonId]);
    await pool.query("insert into season_contacts(season_id,label,value) values($1,'fixture contact',$2)", [fixture.seasonId, contact]);
    await pool.query("insert into institutions(id,name,source,source_version) values($1,$2,'manual','fixture')", [institution, school]);
    await pool.query("insert into education_verifications(id,user_id,institution_id,academic_status,evidence_type,status,evidence_code) values($1,$2,$3,'enrolled','chsi_enrollment_report','pending',$4)", [verification, actor.userId, institution, code]);
    await signInProgrammatically(page, actor, scenario, "/admin/operations/announcements");
    await expect(page.locator("article")).toHaveCount(20);
    expect(await flightText()).not.toContain(bodyMarker);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await expect(page).toHaveURL(/page=2/); await expect(page.locator("article")).toHaveCount(20);
    await page.goBack(); await expect(page).not.toHaveURL(/page=2/);
    await page.goto(`/admin/${fixture.slug}/announcements`);
    await expect(page.locator("article")).toHaveCount(20); expect(await flightText()).not.toContain(bodyMarker);
    for (const path of ["/admin/operations/announcements/new", `/admin/${fixture.slug}/announcements/new`]) {
      await page.goto(path); await expect(page.getByLabel("标题", { exact: true })).toBeVisible();
      await expect(page.getByLabel("正文", { exact: true })).toHaveValue(""); expect(await flightText()).not.toContain(bodyMarker);
    }
    for (const path of [`/admin/operations/announcements/${ids[0]}`, `/admin/${fixture.slug}/announcements/${ids[0]}`]) {
      await page.goto(path); await expect(page.getByLabel("正文", { exact: true })).toHaveValue(body);
    }
    await page.goto(`/admin/${fixture.slug}/announcements/${foreignAnnouncement}`);
    await expect(page.getByText("foreign body", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("正文", { exact: true })).toHaveCount(0);
    await page.goto("/admin/operations/season-info");
    await expect(page.getByText("1 个交流群 · 1 条联系方式")).toBeVisible(); expect(await flightText()).not.toContain(contact);
    for (const path of [`/admin/operations/season-info/${fixture.slug}`, `/admin/${fixture.slug}/information`]) {
      await page.goto(path); await expect(page.locator(`input[value="${contact}"]`)).toBeVisible();
    }
    await page.goto("/admin/education-verifications");
    await expect(page.getByRole("alert").filter({ hasText: "FORBIDDEN" })).toContainText("没有访问此管理页面所需的权限");
    expect(await flightText()).not.toContain(code);
    await signInProgrammatically(page, superAdmin, scenario, "/admin/education-verifications");
    await page.goto(`/admin/education-verifications?q=${school}&status=all`);
    await expect(page.getByText(code, { exact: true })).toBeVisible();
    const [stored] = await database.select({ body: schema.announcements.body, status: schema.announcements.status }).from(schema.announcements).where(eq(schema.announcements.id, ids[0]!));
    expect(stored).toEqual({ body, status: "draft" });
  } finally {
    await pool.query("delete from education_verifications where id=$1", [verification]);
    await pool.query("delete from institutions where id=$1", [institution]);
    await pool.query("delete from announcements where season_id=any($1::uuid[])", [[fixture.seasonId, foreign]]);
    await pool.query("delete from community_groups where season_id=$1", [fixture.seasonId]);
    await pool.query("delete from season_contacts where season_id=$1", [fixture.seasonId]);
    await pool.query("delete from season_public_info where season_id=$1", [fixture.seasonId]);
    await pool.query("delete from seasons where id=$1", [foreign]);
    await removePredictionBrowserFixture(fixture.seasonId); await pool.end();
  }
});
