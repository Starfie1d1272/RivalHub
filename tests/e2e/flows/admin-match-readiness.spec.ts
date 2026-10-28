import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { test, expect, signInProgrammatically } from "../fixtures";
import { createPredictionBrowserFixture, removePredictionBrowserFixture } from "../helpers/prediction-fixture";
import { assertLocalDatabaseUrl } from "../../../scripts/db/local-environment";
import * as schema from "@/db/schema";

test.use({ scenarioProfile: "auth", trace: "on" });
test.setTimeout(180_000);

test("后台三个视图可翻页并返回上一页", async ({ page, scenario }) => {
  const actor = scenario.accounts[0]!;
  const fixture = await createPredictionBrowserFixture(actor.userId);
  const pool = new Pool({ connectionString: assertLocalDatabaseUrl(process.env.DATABASE_URL), ssl: false });
  const database = drizzle(pool, { schema });
  try {
    await database.insert(schema.seasonAdminGrants).values({ seasonId: fixture.seasonId, userId: actor.userId });
    const match = await database.query.matches.findFirst({ where: eq(schema.matches.seasonId, fixture.seasonId) });
    if (!match?.entryAId || !match.entryBId) throw new Error("pagination fixture 缺少队伍");
    await database.insert(schema.matches).values(Array.from({ length: 100 }, () => ({
      id: randomUUID(), seasonId: fixture.seasonId, entryAId: match.entryAId!, entryBId: match.entryBId!,
      stage: "stage1", round: 1, format: "bo3" as const, status: "finished" as const,
      scoreA: 2, scoreB: 0, completedAt: new Date("2051-01-01T00:00:00Z"),
    })));
    await signInProgrammatically(page, actor, scenario, `/admin/${fixture.slug}/matches`);
    for (const view of ["execution", "schedule", "materials"]) {
      await page.goto(`/admin/${fixture.slug}/matches?view=${view}&stage=stage1`);
      const rows = view === "materials" ? page.locator('li[id^="material-"]') : page.locator('section[aria-labelledby="match-list-scope"] div[id^="match-"]');
      await expect(rows).toHaveCount(25);
      await page.getByRole("button", { name: "下一页", exact: true }).click();
      await expect(page).toHaveURL(/page=2/);
      await expect(rows).toHaveCount(25);
      await page.goBack();
      await expect(page).not.toHaveURL(/page=2/);
      await expect(rows).toHaveCount(25);
    }
  } finally {
    await removePredictionBrowserFixture(fixture.seasonId);
    await pool.end();
  }
});
