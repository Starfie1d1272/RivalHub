import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Pool } from "pg";
import { expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { createLocalPool } from "./harness/database";
import { createPredictionBrowserFixture, removePredictionBrowserFixture } from "../../e2e/helpers/prediction-fixture";
import { loadAdminMatchOverview } from "@/lib/admin/matches/overview";
import { loadAdminPostMatchTaskPage } from "@/lib/admin/matches/postmatch-tasks";

const auth = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/auth/session", () => ({ requireSeasonAdmin: vi.fn(async () => ({ userId: auth.userId })) }));

it.skipIf(process.env.RIVALHUB_ADMIN_LIST_BENCHMARK !== "1")("measures the same local match fixture against the exact pre-pagination readers", async () => {
  const beforeOverview = await import(/* @vite-ignore */ resolve("src/lib/admin/matches/overview-list-baseline.ts")) as { loadAdminMatchOverview: typeof loadAdminMatchOverview };
  const beforeMaterials = await import(/* @vite-ignore */ resolve("src/lib/admin/matches/postmatch-tasks-list-baseline.ts")) as { loadAdminPostMatchTasks: (seasonId: string) => Promise<unknown[]> };
  const pool = createLocalPool(); auth.userId = randomUUID();
  await pool.query("insert into users(id,email) values($1,$2)", [auth.userId, `${auth.userId}@fixture.test`]);
  const fixture = await createPredictionBrowserFixture(auth.userId);
  const applicationPool = (db as typeof db & { $client: Pool }).$client;
  const original = applicationPool.query;
  let cost = { queries: 0, rows: 0, jsonBytes: 0 };
  const spy = vi.spyOn(applicationPool, "query").mockImplementation((function(this: Pool, ...args: unknown[]) {
    const pending = Reflect.apply(original, this, args);
    if (!pending || typeof pending.then !== "function") return pending;
    return pending.then((result: { rows: unknown[] }) => { cost.queries++; cost.rows += result.rows.length; cost.jsonBytes += Buffer.byteLength(JSON.stringify(result.rows)); return result; });
  }) as typeof original);
  const samples: unknown[] = [], ids: string[] = [];
  try {
    const first = (await pool.query<{ entry_a_id: string; entry_b_id: string }>("select entry_a_id,entry_b_id from matches where season_id=$1 limit 1", [fixture.seasonId])).rows[0]!;
    const recording = JSON.stringify([{ id: randomUUID(), commentatorUserId: auth.userId, title: "fixture", url: `https://fixture.test/${"r".repeat(1500)}` }]);
    for (const size of [100, 500]) {
      const added = Array.from({ length: size - ids.length }, () => randomUUID()); ids.push(...added);
      await pool.query(`insert into matches(id,season_id,entry_a_id,entry_b_id,stage,round,format,status,score_a,score_b,completed_at,recordings)
        select id,$2,$3,$4,'stage1',1,'bo3','finished',2,0,'2051-01-01T00:00:00Z',$5::jsonb from unnest($1::uuid[]) id`, [added, fixture.seasonId, first.entry_a_id, first.entry_b_id, recording]);
      const query = { seasonSlug: fixture.slug, stage: "stage1" };
      const originalTasks = await beforeMaterials.loadAdminPostMatchTasks(fixture.seasonId);
      const page = await loadAdminPostMatchTaskPage(fixture.seasonId, {});
      expect(page.total).toBe(originalTasks.length); expect(page.rows).toEqual(originalTasks.slice(0, 25));
      const readers = [
        { name: "execution", before: () => beforeOverview.loadAdminMatchOverview(query), after: () => loadAdminMatchOverview(query) },
        { name: "schedule", before: () => beforeOverview.loadAdminMatchOverview({ ...query, view: "schedule" }), after: () => loadAdminMatchOverview({ ...query, view: "schedule" }) },
        { name: "materials", before: () => beforeMaterials.loadAdminPostMatchTasks(fixture.seasonId), after: () => loadAdminPostMatchTaskPage(fixture.seasonId, {}) },
      ];
      for (const reader of readers) for (let round = 0; round < 3; round++) for (const version of (round % 2 ? ["after", "before"] : ["before", "after"]) as ("before" | "after")[]) {
        cost = { queries: 0, rows: 0, jsonBytes: 0 }; const started = performance.now();
        await reader[version](); samples.push({ finishedMatches: size, activeMatches: 8, reader: reader.name, version, round, elapsedMs: performance.now() - started, ...cost });
      }
    }
    const report = { baseline: "06d0ea5074e15b866e2695b34e8f43ab761a9851", fixture: "same isolated PG fixture per paired reader; 8 active, 100/500 finished, one valid 1.5KB recording URL per finished match", limitations: ["3 alternating samples; not p95", "result JSON bytes, not DB wire bytes", "schedule retains full runtime facts; only presentation paged", "materials scans exact canonical facts within filters before paging; not raw LIMIT"], samples };
    if (process.env.RIVALHUB_ADMIN_LIST_OUTPUT) writeFileSync(process.env.RIVALHUB_ADMIN_LIST_OUTPUT, JSON.stringify(report, null, 2));
  } finally {
    spy.mockRestore(); await removePredictionBrowserFixture(fixture.seasonId);
    await pool.query("delete from users where id=$1", [auth.userId]); await pool.end();
  }
});
