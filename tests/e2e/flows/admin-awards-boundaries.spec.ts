import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { test, expect, signInProgrammatically } from "../fixtures";
import { assertLocalDatabaseUrl } from "../../../scripts/db/local-environment";
import { createPredictionBrowserFixture, removePredictionBrowserFixture } from "../helpers/prediction-fixture";

test.use({ scenarioProfile: "layout", trace: "on" });
test.setTimeout(150_000);
test("后台社区奖首屏摘要、展开完整证据、审核后刷新与撤权拒绝", async ({ page, scenario }) => {
  const actor = scenario.accounts.find(account => account.key === "player2")!;
  const fixture = await createPredictionBrowserFixture(actor.userId);
  const pool = new Pool({ connectionString: assertLocalDatabaseUrl(process.env.DATABASE_URL), ssl: false });
  const awardIds = [randomUUID(), randomUUID()];
  const marker = `award-body-${randomUUID()}`;
  const conditions = awardIds.map((_id, index) => `${marker}-${index} ${"完整获奖条件。".repeat(100)}`);
  const names = awardIds.map((_id, index) => `fixture award ${index}`);
  try {
    await pool.query("update seasons set has_community_awards=true where id=$1", [fixture.seasonId]);
    await pool.query("insert into season_admin_grants(season_id,user_id) values($1,$2)", [fixture.seasonId, actor.userId]);
    const match = (await pool.query<{ id: string }>("select id from matches where season_id=$1 limit 1", [fixture.seasonId])).rows[0]!;
    for (let index = 0; index < awardIds.length; index++) {
      await pool.query("insert into community_awards(id,season_id,submitted_by_user_id,name,condition,prize,settlement_policy) values($1,$2,$3,$4,$5,'fixture gift','event_verified')", [awardIds[index], fixture.seasonId, actor.userId, names[index], conditions[index]]);
      await pool.query("insert into community_award_evidence(award_id,submitted_by_user_id,candidate_user_id,match_id,explanation) values($1,$2,$2,$3,$4)", [awardIds[index], actor.userId, match.id, `${marker} evidence ${index}`]);
    }
    const route = `/admin/${fixture.slug}/community-awards`;
    await signInProgrammatically(page, actor, scenario, route);
    await expect(page.getByText(names[0]!, { exact: true })).toBeVisible();
    expect(await page.locator("body").textContent()).not.toContain(marker);
    const flight = await page.request.get(route, { headers: { RSC: "1" } });
    expect(flight.ok()).toBe(true); expect(flight.headers()["content-type"]).toContain("text/x-component");
    expect(await flight.text()).not.toContain(marker);
    const first = page.locator("details").filter({ has: page.getByText(names[0]!, { exact: true }) });
    await first.locator("summary").first().click();
    await expect(first.getByText(conditions[0]!, { exact: false })).toBeVisible();
    await expect(first.getByText(`${marker} evidence 0`, { exact: true })).toBeVisible();
    const notes = first.getByRole("textbox", { name: "审核备注 / 要求补充的内容（选填）" });
    await notes.fill("fixture draft");
    await first.locator("summary").first().click(); await first.locator("summary").first().click();
    await expect(notes).toHaveValue("fixture draft");
    const second = page.locator("details").filter({ has: page.getByText(names[1]!, { exact: true }) });
    await second.locator("summary").first().click();
    await expect(second.getByText(conditions[1]!, { exact: false })).toBeVisible();
    await first.getByRole("button", { name: "通过并公开", exact: true }).click();
    const published = page.locator("section").filter({ has: page.getByRole("heading", { name: "已公开待结奖", exact: true }) });
    await expect(published.getByText(names[0]!, { exact: true })).toBeVisible();
    const states = await pool.query<{ id: string; status: string }>("select id,status from community_awards where id=any($1::uuid[])", [awardIds]);
    expect(states.rows.find(row => row.id === awardIds[0])?.status).toBe("approved");
    expect(states.rows.find(row => row.id === awardIds[1])?.status).toBe("pending_review");
    await pool.query("delete from season_admin_grants where season_id=$1 and user_id=$2", [fixture.seasonId, actor.userId]);
    await page.reload();
    await expect(page.getByRole("alert").filter({ hasText: "FORBIDDEN" })).toContainText("没有访问此管理页面所需的权限");
    console.info("ADMIN_AWARD_BROWSER", JSON.stringify({ initialFlightHasEvidence: false, openedCompleteEvidence: true, closedDraftPreserved: true, reviewRefreshedStatus: true, otherAwardUnchanged: true, revokedNewRequestDenied: true }));
  } finally {
    await pool.query("delete from community_award_evidence where award_id=any($1::uuid[])", [awardIds]);
    await pool.query("delete from community_award_recipients where award_id=any($1::uuid[])", [awardIds]);
    await pool.query("delete from community_awards where id=any($1::uuid[])", [awardIds]);
    await removePredictionBrowserFixture(fixture.seasonId); await pool.end();
  }
});
