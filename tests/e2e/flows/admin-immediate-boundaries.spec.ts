import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { test as base, expect } from "../fixtures";
import { assertLocalDatabaseUrl } from "../../../scripts/db/local-environment";
import { createPredictionBrowserFixture, removePredictionBrowserFixture } from "../helpers/prediction-fixture";

// Keep concurrent runs of this probe out of the shared pg_stat_statements sample.
const test = base.extend<{ adminEvidenceIsolation: void }>({
  adminEvidenceIsolation: [async ({ scenarioProfile }, applyEvidence) => {
    void scenarioProfile;
    const pool = new Pool({ connectionString: assertLocalDatabaseUrl(process.env.DATABASE_URL), ssl: false });
    const client = await pool.connect();
    try {
      await client.query("select pg_advisory_lock($1,$2)", [1112, 20261024]);
      await applyEvidence();
    } finally {
      await client.query("select pg_advisory_unlock($1,$2)", [1112, 20261024]);
      client.release();
      await pool.end();
    }
  }, { auto: true }],
});

test.use({ scenarioProfile: "layout" });
test.setTimeout(180_000);

test("目录和审计的 Flight 合并数据库读取，撤权后拒绝新请求", async ({ request, scenario }) => {
  const actor = scenario.accounts.find(account => account.key === "player2")!;
  const admin = scenario.accounts.find(account => account.key === "admin")!;
  const fixture = await createPredictionBrowserFixture(actor.userId);
  const pool = new Pool({ connectionString: assertLocalDatabaseUrl(process.env.DATABASE_URL), ssl: false });
  const matchIds = [randomUUID(), randomUUID()];
  const mapIds = [randomUUID(), randomUUID()];
  const logIds = Array.from({ length: 4 }, () => randomUUID());
  async function signIn(email: string) {
    expect((await request.post("/api/test/e2e/auth", { data: { email, password: scenario.password } })).ok()).toBe(true);
  }

  async function flight(path: string) {
    const response = await request.get(path, { headers: { RSC: "1" } });
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("text/x-component");
    return response.text();
  }

  try {
    await pool.query("insert into season_admin_grants(season_id,user_id) values($1,$2)", [fixture.seasonId, actor.userId]);
    await signIn(actor.email);
    const extension = await pool.query<{ schema: string }>("select n.nspname as schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_stat_statements'");
    const namespace = extension.rows[0]?.schema;
    if (!namespace || !/^[a-z_]+$/.test(namespace)) throw new Error("本地pg_stat_statements不可读，不能声称真实RSC SQL去重通过");
    async function calls(pattern: string) {
      const result = await pool.query<{ calls: string }>(`select coalesce(sum(calls),0)::text as calls from "${namespace}".pg_stat_statements where dbid=(select oid from pg_database where datname=current_database()) and query like $1`, [pattern]);
      return BigInt(result.rows[0]!.calls);
    }
    const directoryPattern = '%"has_community_awards"%from "seasons"%order by "seasons"."created_at" desc%';
    const before = await calls(directoryPattern);
    const adminPath = `/admin/${fixture.slug}`;
    expect(await flight("/admin")).toContain(adminPath);
    expect(Number(await calls(directoryPattern) - before)).toBe(1);
    await pool.query("delete from season_admin_grants where season_id=$1 and user_id=$2", [fixture.seasonId, actor.userId]);
    const revoked = await flight("/admin");
    expect(revoked).toContain("没有访问此管理页面所需的权限");
    expect(revoked).not.toContain(adminPath);

    const source = (await pool.query<{ entry_a_id: string; entry_b_id: string }>("select entry_a_id,entry_b_id from matches where season_id=$1 limit 1", [fixture.seasonId])).rows[0]!;
    for (const id of matchIds) await pool.query("insert into matches(id,season_id,entry_a_id,entry_b_id,stage,format) values($1,$2,$3,$4,'stage1','bo1')", [id, fixture.seasonId, source.entry_a_id, source.entry_b_id]);
    for (let i = 0; i < mapIds.length; i++) await pool.query("insert into match_maps(id,match_id,map_order,map_name) values($1,$2,1,'de_nuke')", [mapIds[i], matchIds[i]]);
    const targets = [...matchIds.map(id => ({ type: "match", id })), ...mapIds.map(id => ({ type: "match_map", id }))];
    for (let i = 0; i < logIds.length; i++) {
      const target = targets[i % targets.length]!;
      await pool.query("insert into audit_logs(id,season_id,action,actor_id,target_type,target_id,created_at) values($1,$2,'fixture.audit.view',$3,$4,$5,'2051-01-01'::timestamptz+$6*interval '1 second')", [logIds[i], fixture.seasonId, admin.userId, target.type, target.id, i]);
    }
    await signIn(admin.email);
    const entry = await pool.query<{ name: string }>("select name from competition_entries where id=$1", [source.entry_a_id]);
    const labelPattern = '%"entry_a_id", "entry_b_id", "execution_context" from "matches"%';
    const labelBefore = await calls(labelPattern);
    expect(await flight(`/admin/logs?seasonId=${fixture.seasonId}`)).toContain(entry.rows[0]!.name);
    expect(Number(await calls(labelPattern) - labelBefore)).toBe(1);
  } finally {
    await pool.query("delete from audit_logs where id=any($1::uuid[])", [logIds]);
    await pool.query("delete from match_maps where id=any($1::uuid[])", [mapIds]);
    await removePredictionBrowserFixture(fixture.seasonId);
    await pool.end();
  }
});
