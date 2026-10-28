import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createLocalPool } from "./harness/database";
import { createPredictionBrowserFixture, removePredictionBrowserFixture } from "../../e2e/helpers/prediction-fixture";
import { loadMajorSwissMatchRecord, loadMajorSwissStageReadModel } from "@/lib/matches/stage-read-model";

it("keeps frozen Swiss record parity across scoped matches", async () => {
  const pool = createLocalPool();
  const user = randomUUID();
  await pool.query("insert into users(id,email) values($1,$2)", [user, `${user}@fixture.test`]);
  const fixture = await createPredictionBrowserFixture(user);
  const target = (await pool.query<{ id: string; entry_a_id: string; entry_b_id: string }>("select id,entry_a_id,entry_b_id from matches where season_id=$1 order by managed_key limit 1", [fixture.seasonId])).rows[0]!;
  async function parity(matchId: string) {
    const full = await loadMajorSwissStageReadModel(fixture.seasonId, "stage1");
    const record = full?.rounds.flatMap(round => round.groups).find(group => group.matchups.some(match => match.matchId === matchId))?.record;
    const narrow = await loadMajorSwissMatchRecord(fixture.seasonId, "stage1", matchId);
    expect(narrow?.record).toBe(record);
    if (narrow) expect(narrow.stageName).toBe(full?.stageName);
    return narrow;
  }
  try {
    expect((await parity(target.id))?.record).toBe("0:0");
    await pool.query("update matches set status='finished',score_a=1,score_b=0,completed_at=now() where season_id=$1", [fixture.seasonId]);
    await pool.query("update major_stage_runs set finalized_round=1 where season_id=$1", [fixture.seasonId]);
    expect((await parity(target.id))?.record).toBe("0:0");
    const sides = (await pool.query<{ entry_a_id: string }>("select entry_a_id from matches where season_id=$1 order by managed_key limit 2", [fixture.seasonId])).rows;
    const future = randomUUID();
    await pool.query(`insert into matches(id,season_id,entry_a_id,entry_b_id,stage,round,format,ownership,major_stage_run_id,managed_key)
      select $1,$2,$3,$4,'stage1',2,'bo1','major_stage',id,'record-fixture-r2' from major_stage_runs where season_id=$2`, [future, fixture.seasonId, sides[0]!.entry_a_id, sides[1]!.entry_a_id]);
    expect((await parity(future))?.record).toBe("1:0");
    await pool.query("update matches set entry_b_id=$2 where id=$1", [future, target.entry_b_id]);
    expect((await parity(future))?.record).toBe("1:0 | 0:1");
    await pool.query("update seasons set stage_plan='[]'::json where id=$1", [fixture.seasonId]);
    expect((await parity(future))?.record).toBe("1:0 | 0:1");
    expect(await loadMajorSwissMatchRecord(randomUUID(), "stage1", target.id)).toBeNull();
    expect(await loadMajorSwissMatchRecord(fixture.seasonId, "stage2", target.id)).toBeNull();
    expect(await loadMajorSwissMatchRecord(fixture.seasonId, "stage1", randomUUID())).toBeNull();
    await pool.query("update major_stage_runs set finalized_round=2 where season_id=$1", [fixture.seasonId]);
    expect(await loadMajorSwissStageReadModel(fixture.seasonId, "stage1")).toBeNull();
    expect(await loadMajorSwissMatchRecord(fixture.seasonId, "stage1", future)).toBeNull();
  } finally {
    await removePredictionBrowserFixture(fixture.seasonId);
    await pool.query("delete from users where id=$1", [user]);
    await pool.end();
  }
});
