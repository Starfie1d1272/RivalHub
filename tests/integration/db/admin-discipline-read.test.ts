import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createLocalPool } from "./harness/database";
import { getSeasonSanctionsAdminReadModel, normalizeDisciplineAdminQuery } from "@/lib/discipline/admin-review";
import { resolveSanctionStatus } from "@/lib/discipline/service";

it("keeps canonical sanction windows/search/order while bounding long evidence to the selected page", async () => {
  const pool = createLocalPool();
  const season = randomUUID(), otherSeason = randomUUID();
  const active = randomUUID(), inactive = randomUUID();
  const now = new Date("2051-05-10T16:00:00Z");
  const before = new Date(now.getTime() - 1000), after = new Date(now.getTime() + 1000);
  const evidence = "内部中文证据".repeat(1000);
  const facts = Array.from({ length: 67 }, (_, i) => ({
    id: randomUUID(), status: (["active", "draft", "expired", "revoked"] as const)[i % 4]!,
    effectiveFrom: i % 7 === 0 ? after : before,
    effectiveUntil: i % 7 === 0 ? null : i % 3 === 0 ? now : null,
  }));
  try {
    for (const id of [season, otherSeason]) await pool.query("insert into seasons(id,slug,name,kind) values ($1::uuid,$1::text,'fixture','custom')", [id]);
    await pool.query("insert into users(id,email,display_name) values ($1,$2,'查询甲 ABC')", [active, `${active}@fixture.test`]);
    await pool.query("insert into users(id,email,status,merged_into_user_id,merged_at) values ($1,$2,'merged',$3,now())", [inactive, `${inactive}@fixture.test`, active]);
    for (const row of facts) await pool.query(`insert into disciplinary_cases(id,season_id,subject_user_id,status,effective_from,effective_until,revoked_at,issued_by,internal_evidence,created_at)
      values($1,$2,$3,$4,$5,$6,$7,'fixture',$8,'2051-01-01T00:00:00Z')`, [row.id, season, active, row.status, row.effectiveFrom, row.effectiveUntil, row.status === "revoked" ? now : null, evidence]);
    for (const [s, u] of [[season, inactive], [otherSeason, active]]) await pool.query("insert into disciplinary_cases(season_id,subject_user_id,status,issued_by,internal_evidence) values($1,$2,'active','fixture','must not escape')", [s, u]);
    for (const status of ["all", "active", "draft", "expired", "revoked"] as const) {
      const expected = facts.filter(row => status === "all" || resolveSanctionStatus(row, now) === status).sort((a, b) => b.id.localeCompare(a.id));
      const result = await getSeasonSanctionsAdminReadModel(season, normalizeDisciplineAdminQuery({ status, q: "甲 abc", page: "999" }), now);
      expect(result.total).toBe(expected.length);
      expect(result.page).toBe(Math.max(1, Math.ceil(expected.length / 25)));
      expect(result.rows.map(row => row.id)).toEqual(expected.slice((result.page - 1) * 25, result.page * 25).map(row => row.id));
      expect(result.rows.length).toBeLessThanOrEqual(25);
      for (const row of result.rows) {
        expect(row.internalEvidence).toBe(evidence);
        expect(row.resolvedStatus).toBe(resolveSanctionStatus(facts.find(fact => fact.id === row.id)!, now));
      }
      expect(JSON.stringify(result)).not.toContain("must not escape");
    }
    const absent = await getSeasonSanctionsAdminReadModel(season, normalizeDisciplineAdminQuery({ q: "not present" }), now);
    expect(absent).toMatchObject({ rows: [], total: 0, page: 1, hasAnyRecords: true });
  } finally {
    await pool.query("delete from disciplinary_cases where season_id=any($1::uuid[])", [[season, otherSeason]]);
    await pool.query("delete from seasons where id=any($1::uuid[])", [[season, otherSeason]]);
    await pool.query("delete from users where id=$1", [inactive]);
    await pool.query("delete from users where id=$1", [active]);
    await pool.end();
  }
});
