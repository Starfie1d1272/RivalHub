import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { createLocalPool } from "./harness/database";
import { createPredictionBrowserFixture, removePredictionBrowserFixture } from "../../e2e/helpers/prediction-fixture";

const auth = vi.hoisted(() => vi.fn(async () => ({ userId: "fixture" })));
vi.mock("@/lib/auth/session", async (importOriginal) => ({ ...await importOriginal<object>(), requireSeasonAdmin: auth }));
import { db } from "@/db/client";
import { matches } from "@/db/schema";
import { loadAdminMatchWorkspace } from "@/lib/admin/matches/overview";
import { getStartingLineupPreflightInTx } from "@/lib/match-rosters/service";
import { requireCompetitionMatch } from "@/lib/matches/competition-context";

it("attributes the authorized workspace and transaction lineup reads to their exact owners", async () => {
  const previousEndpoint = process.env.PRODUCT_TELEMETRY_ENDPOINT, previousKey = process.env.DB_TRAFFIC_KEY;
  process.env.PRODUCT_TELEMETRY_ENDPOINT = "https://telemetry.invalid/v1/batches";
  process.env.DB_TRAFFIC_KEY = "fixture-key".repeat(4);
  const pool = createLocalPool(), user = randomUUID();
  await pool.query("insert into users(id,email) values($1,$2)", [user, `${user}@fixture.test`]);
  const fixture = await createPredictionBrowserFixture(user);
  try {
    await loadAdminMatchWorkspace(fixture.slug);
    const state = (process as unknown as Record<symbol, { rows: Map<string, { queries: number }> }>)[Symbol.for("rivalhub.db-traffic.v3")];
    expect(state.rows.get("admin.matches.read:q78c49e4225197219")?.queries).toBe(1);
    const before = state.rows.get("admin.matches.read:q78c49e4225197219")?.queries;
    auth.mockRejectedValueOnce(new Error("forbidden"));
    await expect(loadAdminMatchWorkspace(fixture.slug)).rejects.toThrow("forbidden");
    expect(state.rows.get("admin.matches.read:q78c49e4225197219")?.queries).toBe(before);
    const [match] = await db.select().from(matches).where(eq(matches.seasonId, fixture.seasonId)).limit(1);
    await expect(db.transaction(tx => getStartingLineupPreflightInTx(tx, { match: requireCompetitionMatch(match!), entryId: match!.entryAId!, starterIds: [] }))).rejects.toThrow("本队缺少已锁定的赛事名单");
    expect(state.rows.get("match.lineup.read:q3db995fb0bd12e2d")?.queries).toBe(1);
  } finally {
    await removePredictionBrowserFixture(fixture.seasonId);
    await pool.query("delete from users where id=$1", [user]);
    await pool.end();
    if (previousEndpoint === undefined) delete process.env.PRODUCT_TELEMETRY_ENDPOINT; else process.env.PRODUCT_TELEMETRY_ENDPOINT = previousEndpoint;
    if (previousKey === undefined) delete process.env.DB_TRAFFIC_KEY; else process.env.DB_TRAFFIC_KEY = previousKey;
  }
});
