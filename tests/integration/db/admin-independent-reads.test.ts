import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { getDraftAdminData } from "@/lib/draft/data";
import { loadCompetitivePlatformCatalog } from "@/lib/competitive/catalog";
import { readPreviousApprovedRevisionIds } from "@/lib/admin/season-workspace/previous-approved-revision";
import { createLocalPool } from "./harness/database";

it("bounds approved history and overlaps only independent pool reads with identical draft/catalog results", async () => {
  const pool = createLocalPool();
  const season = randomUUID(), entries = [randomUUID(), randomUUID()];
  const users = Array.from({ length: 6 }, () => randomUUID());
  const registrations = users.map(() => randomUUID());
  const revisions = Array.from({ length: 101 }, () => randomUUID());
  try {
    await pool.query("insert into seasons(id,slug,name,kind) values($1::uuid,$1::text,'independent fixture','custom')", [season]);
    for (let i = 0; i < users.length; i++) {
      await pool.query("insert into users(id,email) values($1::uuid,$1::text||'@fixture.test')", [users[i]]);
      await pool.query(`insert into season_registrations(id,user_id,season_id,primary_position,secondary_position,peak_rank,peak_rank_season,peak_rating,current_season_peak_rank,current_rating,gameplay_style,status)
        values($1,$2,$3,'rifler','awper','A','fixture',1.5,'A',1,'fixture','approved')`, [registrations[i], users[i], season]);
    }
    const secondRevision = randomUUID();
    const client = await pool.connect();
    try {
      await client.query("begin"); await client.query("set constraints all deferred");
      for (let i = 0; i < entries.length; i++) {
        const revision = i === 0 ? revisions[0] : secondRevision;
        await client.query(`insert into competition_entries(id,competition_id,source,name,representative_user_id,formation_order,source_registration_id,current_roster_revision_id)
          values($1,$2,'event_native','draft team',$3,$4,$5,$6)`, [entries[i], season, users[i], i + 1, registrations[i], revision]);
        await client.query("insert into competition_entry_roster_revisions(id,entry_id,revision_number,status,created_by,approved_at) values($1,$2,1,'approved','fixture',now())", [revision, entries[i]]);
        await client.query("insert into competition_entry_representative_changes(entry_id,to_user_id,changed_by_actor_id) values($1,$2,'fixture')", [entries[i], users[i]]);
      }
    for (let i = 1; i < revisions.length; i++) await client.query(`insert into competition_entry_roster_revisions(id,entry_id,revision_number,status,created_by,approved_at)
      values($1,$2,$3,'approved','fixture',case when $3<101 then now() else null end)`, [revisions[i], entries[0], i + 1]);
    await client.query("update competition_entries set current_roster_revision_id=$2 where id=$1", [entries[0], revisions.at(-1)]);
      await client.query("commit");
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
    const baseline = await pool.query<{ id: string }>("select id from competition_entry_roster_revisions where entry_id=$1 and approved_at is not null order by revision_number", [entries[0]]);
    const narrow = await readPreviousApprovedRevisionIds(db, entries);
    expect(narrow.get(entries[0]!)).toBe(baseline.rows.at(-2)?.id);
    expect(narrow.has(entries[1]!)).toBe(false);
    expect(narrow.size).toBe(1);
    expect(await readPreviousApprovedRevisionIds(db, [])).toEqual(new Map());
    await pool.query("insert into draft_state(season_id,current_entry_id,is_active) values($1,$2,true)", [season, entries[0]]);
    await pool.query("insert into draft_picks(season_id,entry_id,registration_id,round,pick_number) values($1,$2,$3,1,1)", [season, entries[0], registrations[2]]);

    const applicationPool = (db as typeof db & { $client: Pool }).$client;
    const original = applicationPool.query;
    async function delayed<T>(read: () => Promise<T>) {
      let active = 0, maximum = 0, queries = 0;
      const spy = vi.spyOn(applicationPool, "query").mockImplementation((function(this: Pool, ...args: unknown[]) {
        const config = args[0] as { text: string };
        const text = typeof config === "string" ? config : config.text;
        const wrapped = `with injected_delay as materialized (select pg_sleep(0.025)) select q.* from (${text}) q cross join injected_delay`;
        args[0] = typeof config === "string" ? wrapped : { ...config, text: wrapped };
        active++; queries++; maximum = Math.max(maximum, active);
        return Reflect.apply(original, this, args).finally(() => { active--; });
      }) as typeof original);
      const start = performance.now();
      try { return { value: await read(), maximum, queries, elapsedMs: performance.now() - start }; } finally { spy.mockRestore(); }
    }
    const before = await delayed(() => getDraftAdminData(season, { concurrent: false }));
    const after = await delayed(() => getDraftAdminData(season));
    expect(after.value).toEqual(before.value);
    expect(after.value.totalPicks).toBe(1);
    expect(after.value.remainingPlayerCount).toBe(3);
    expect(before.maximum).toBe(1); expect(after.maximum).toBe(3);
    const catalogBefore = await delayed(() => loadCompetitivePlatformCatalog(db));
    const catalogAfter = await delayed(() => loadCompetitivePlatformCatalog(db, { concurrent: true }));
    expect(catalogAfter.value).toEqual(catalogBefore.value);
    expect(catalogBefore.maximum).toBe(1); expect(catalogAfter.maximum).toBe(3);
    console.info("ADMIN_INDEPENDENT_READS", JSON.stringify({ historyRowsBefore: baseline.rows.length, historyRowsAfter: narrow.size,
      draft: { before: { maximum: before.maximum, queries: before.queries, elapsedMs: before.elapsedMs }, after: { maximum: after.maximum, queries: after.queries, elapsedMs: after.elapsedMs } },
      catalog: { before: { maximum: catalogBefore.maximum, queries: catalogBefore.queries, elapsedMs: catalogBefore.elapsedMs }, after: { maximum: catalogAfter.maximum, queries: catalogAfter.queries, elapsedMs: catalogAfter.elapsedMs } } }));
  } finally {
    await pool.query("delete from draft_picks where season_id=$1", [season]);
    await pool.query("delete from draft_state where season_id=$1", [season]);
    const cleanup = await pool.connect();
    try {
      await cleanup.query("begin"); await cleanup.query("set local session_replication_role=replica");
      await cleanup.query("delete from competition_entry_representative_changes where entry_id=any($1::uuid[])", [entries]);
      await cleanup.query("delete from competition_entry_roster_revisions where entry_id=any($1::uuid[])", [entries]);
      await cleanup.query("delete from competition_entries where id=any($1::uuid[])", [entries]);
      await cleanup.query("commit");
    } catch (error) { await cleanup.query("rollback"); throw error; } finally { cleanup.release(); }
    await pool.query("delete from season_registrations where season_id=$1", [season]);
    await pool.query("delete from seasons where id=$1", [season]);
    await pool.query("delete from users where id=any($1::uuid[])", [users]);
    await pool.end();
  }
});
