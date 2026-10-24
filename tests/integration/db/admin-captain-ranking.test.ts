import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { getAdminCaptainRanking, getPublicCaptainVotingData } from "@/lib/captains/data";
import { createLocalPool } from "./harness/database";

it("keeps canonical eight seeds and total without reading noncandidate voters", async () => {
  const pool = createLocalPool();
  const season = randomUUID();
  const users = Array.from({ length: 102 }, () => randomUUID());
  const registrations = users.map(() => randomUUID());
  const applicationPool = (db as typeof db & { $client: Pool }).$client;
  const original = applicationPool.query;
  async function measure<T>(read: () => Promise<T>) {
    const cost = { queries: 0, rows: 0, jsonBytes: 0 };
    const spy = vi.spyOn(applicationPool, "query").mockImplementation((function(this: Pool, ...args: unknown[]) {
      const pending = Reflect.apply(original, this, args);
      return pending.then((result: { rows: unknown[] }) => {
        cost.queries++; cost.rows += result.rows.length; cost.jsonBytes += Buffer.byteLength(JSON.stringify(result.rows));
        return result;
      });
    }) as typeof original);
    try { return { value: await read(), cost }; } finally { spy.mockRestore(); }
  }
  try {
    await pool.query("insert into seasons(id,slug,name,kind) values($1::uuid,$1::text,'ranking fixture','custom')", [season]);
    for (let i = 0; i < users.length; i++) {
      await pool.query("insert into users(id,email,status,merged_into_user_id,merged_at) values($1::uuid,$1::text||'@fixture.test',$2::user_status,$3::uuid,case when $2::user_status='merged' then now() else null end)", [users[i], i === 100 ? "merged" : "active", i === 100 ? users[0] : null]);
      await pool.query(`insert into season_registrations(id,user_id,season_id,primary_position,secondary_position,peak_rank,peak_rank_season,peak_rating,current_season_peak_rank,current_rating,gameplay_style,status,willing_to_be_captain,created_at)
        values($1,$2,$3,'rifler','awper','A','fixture',1.5,'A',1,'fixture',$4,$5,'2051-01-01'::timestamptz + $6 * interval '1 second')`,
      [registrations[i], users[i], season, i === 101 ? "pending" : "approved", i < 12 || i >= 100, i]);
    }
    await pool.query("insert into captain_votes(voter_registration_id,candidate_registration_id) values($1,$2),($3,$2)", [registrations[20], registrations[5], registrations[21]]);
    const baseline = await measure(() => getPublicCaptainVotingData(season));
    const candidate = await measure(() => getAdminCaptainRanking(season));
    expect(baseline.value.voters).toHaveLength(100);
    expect(candidate.value.candidateCount).toBe(12);
    expect(candidate.value.seeds.map(row => row.id)).toEqual(baseline.value.candidates.slice(0, 8).map(row => row.id));
    expect(candidate.value.seeds[0]?.id).toBe(registrations[5]);
    expect(candidate.value.seeds[0]).not.toHaveProperty("peakRank");
    expect(candidate.cost.rows).toBeLessThan(baseline.cost.rows / 2);
    expect(Buffer.byteLength(JSON.stringify(candidate.value))).toBeLessThan(Buffer.byteLength(JSON.stringify(baseline.value)) / 5);
    console.info("ADMIN_CAPTAINS_COST", JSON.stringify({ baseline: baseline.cost, candidate: candidate.cost,
      baselineDtoBytes: Buffer.byteLength(JSON.stringify(baseline.value)), candidateDtoBytes: Buffer.byteLength(JSON.stringify(candidate.value)) }));
  } finally {
    await pool.query("delete from captain_votes where voter_registration_id=any($1::uuid[]) or candidate_registration_id=any($1::uuid[])", [registrations]);
    await pool.query("delete from season_registrations where season_id=$1", [season]);
    await pool.query("delete from seasons where id=$1", [season]);
    await pool.query("update users set status='active',merged_into_user_id=null,merged_at=null where id=any($1::uuid[])", [users]);
    await pool.query("delete from users where id=any($1::uuid[])", [users]);
    await pool.end();
  }
});
