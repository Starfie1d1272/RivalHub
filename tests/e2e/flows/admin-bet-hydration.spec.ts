import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { test, expect, signInProgrammatically } from "../fixtures";
import { createPredictionBrowserFixture, removePredictionBrowserFixture } from "../helpers/prediction-fixture";
import { assertLocalDatabaseUrl } from "../../../scripts/db/local-environment";
import * as schema from "@/db/schema";

test.use({ scenarioProfile: "auth" });
test.setTimeout(90_000);

test("后台 BET 主体完成 hydration 后可进入并提交启用确认", async ({ page, scenario }, testInfo) => {
  const actor = scenario.accounts[0]!;
  const fixture = await createPredictionBrowserFixture(actor.userId);
  const pool = new Pool({ connectionString: assertLocalDatabaseUrl(process.env.DATABASE_URL), ssl: false });
  const database = drizzle(pool, { schema });
  const failures: string[] = [];
  page.on("pageerror", error => failures.push(`${error.name}: ${error.message}`));
  page.on("requestfailed", request => {
    if (request.resourceType() === "script" && new URL(request.url()).origin === new URL(page.url()).origin) failures.push(`script: ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`);
  });
  try {
    await database.insert(schema.seasonAdminGrants).values({ seasonId: fixture.seasonId, userId: actor.userId });
    await signInProgrammatically(page, actor, scenario, `/admin/${fixture.slug}/bet`);
    const enable = page.getByRole("button", { name: "启用 BET", exact: true });
    await expect(enable).toBeEnabled({ timeout: 20_000 });
    expect(failures).toEqual([]);
    await enable.click();
    const confirmation = page.getByRole("region", { name: "BET 操作确认", exact: true });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "启用 BET", exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(page.getByRole("button", { name: "暂停投入", exact: true })).toBeEnabled();
    const [program] = await database.select().from(schema.betPrograms).where(eq(schema.betPrograms.seasonId, fixture.seasonId));
    expect(program).toBeDefined();
    expect(failures).toEqual([]);
  } finally {
    await testInfo.attach("admin-bet-client-failures", { body: JSON.stringify(failures), contentType: "application/json" });
    await removePredictionBrowserFixture(fixture.seasonId);
    await pool.end();
  }
});
