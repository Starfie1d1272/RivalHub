import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { expect, it, vi } from "vitest";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { createLocalPool } from "./harness/database";
import { createPredictionBrowserFixture, removePredictionBrowserFixture } from "../../e2e/helpers/prediction-fixture";
import { resolveAuditTargets, type AuditTargetRef } from "@/lib/audit/targets";

it("keeps all labels equal for fifty refs across thirty target types with bounded actual PostgreSQL reads", async () => {
  const fixturePool = createLocalPool();
  const actor = randomUUID();
  await fixturePool.query("insert into users(id,email) values($1::uuid,$1::text||'@fixture.test')", [actor]);
  const fixture = await createPredictionBrowserFixture(actor);
  try {
    await fixturePool.query("insert into announcements(scope,season_id,title,body,status) values('season',$1,'audit fixture','fixture body','draft')", [fixture.seasonId]);
    await fixturePool.query("insert into community_groups(season_id,label,group_number) values($1,'audit group','123456789')", [fixture.seasonId]);
    await fixturePool.query("insert into match_maps(match_id,map_order,map_name) select id,1,'de_nuke' from matches where season_id=$1 limit 1", [fixture.seasonId]);
  const applicationPool = (db as typeof db & { $client: Pool }).$client;
  // An alternate executor uses the existing serial contract on the same DB/pool.
  const serialExecutor = drizzle(applicationPool, { schema });
  const types = ["user", "season", "competition_entry", "competitive_platform", "competitive_platform_rank", "competitive_platform_season",
    "admin_invite", "announcement", "captain_vote", "community_award", "community_award_evidence", "community_group", "dak_pairing",
    "disciplinary_case", "draft_pick", "draft_state", "education_verification", "feedback_report", "major_final_result", "major_prestart_entrant",
    "major_prestart_state", "major_stage_run", "major_tournament_entrant", "match", "match_demo_import", "match_map", "match_roster",
    "match_time_proposal", "mizar_installation", "post_event_adjudication"];
  const seeds: Record<string, [string, string]> = {
    announcement: ["announcements", "id"],
    user: ["users", "id"], season: ["seasons", "id"], competition_entry: ["competition_entries", "id"],
    competitive_platform: ["competitive_platforms", "key"], competitive_platform_rank: ["competitive_platform_ranks", "id"],
    competitive_platform_season: ["competitive_platform_seasons", "id"], match: ["matches", "id"], match_map: ["match_maps", "id"],
    education_verification: ["education_verifications", "id"], major_stage_run: ["major_stage_runs", "id"],
    major_tournament_entrant: ["major_tournament_entrants", "id"], community_group: ["community_groups", "id"],
  };
  let existing = 0;
  const refs: AuditTargetRef[] = [];
  for (const type of types) {
    const source = seeds[type];
    const found = source ? (await applicationPool.query<{ id: string }>(`select "${source[1]}" as id from "${source[0]}" limit 1`)).rows[0]?.id : undefined;
    if (found) existing++;
    refs.push({ targetType: type, targetId: found ?? randomUUID() });
  }
  expect(existing).toBeGreaterThanOrEqual(10);
  refs.push(...refs.slice(0, 20));
  expect(refs).toHaveLength(50); expect(types).toHaveLength(30);
  const original = applicationPool.query;
  async function measure<T>(read: () => Promise<T>) {
    const cost = { queries: 0, rows: 0, jsonBytes: 0, maximum: 0, active: 0 };
    const spy = vi.spyOn(applicationPool, "query").mockImplementation((function(this: Pool, ...args: unknown[]) {
      const config = args[0] as { text: string };
      const text = typeof config === "string" ? config : config.text;
      const wrapped = `with isolated_delay as materialized (select pg_sleep(0.025)) select q.* from (${text}) q cross join isolated_delay`;
      args[0] = typeof config === "string" ? wrapped : { ...config, text: wrapped };
      cost.active++; cost.maximum = Math.max(cost.maximum, cost.active);
      return Reflect.apply(original, this, args).then((result: { rows: unknown[] }) => {
        cost.queries++; cost.rows += result.rows.length; cost.jsonBytes += Buffer.byteLength(JSON.stringify(result.rows)); return result;
      }).finally(() => { cost.active--; });
    }) as typeof original);
    const start = performance.now();
    try { return { value: await read(), cost, elapsedMs: performance.now() - start }; } finally { spy.mockRestore(); }
  }
  const before = await measure(() => resolveAuditTargets(refs, serialExecutor));
  const after = await measure(() => resolveAuditTargets(refs));
  expect(after.value).toEqual(before.value);
  expect(Object.keys(after.value)).toHaveLength(30);
  expect(Object.values(after.value).filter(value => value.found).length).toBeGreaterThanOrEqual(10);
  expect(Object.values(after.value).filter(value => !value.found).length).toBeGreaterThan(0);
  expect(before.cost.maximum).toBe(1);
  expect(after.cost.maximum).toBe(3);
  expect(after.cost.queries).toBeLessThanOrEqual(before.cost.queries);
  console.info("ADMIN_AUDIT_30_TYPES", JSON.stringify({ types: 30, refs: 50, seededExistingTypes: existing,
    resolved: Object.values(after.value).filter(value => value.found).length,
    before: { ...before.cost, elapsedMs: before.elapsedMs }, after: { ...after.cost, elapsedMs: after.elapsedMs } }));
  } finally {
    await fixturePool.query("delete from announcements where season_id=$1", [fixture.seasonId]);
    await fixturePool.query("delete from community_groups where season_id=$1", [fixture.seasonId]);
    await removePredictionBrowserFixture(fixture.seasonId);
    await fixturePool.query("delete from users where id=$1", [actor]);
    await fixturePool.end();
  }

});
