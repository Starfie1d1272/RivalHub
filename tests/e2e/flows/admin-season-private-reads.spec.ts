import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { assertLocalDatabaseUrl } from "../../../scripts/db/local-environment";
import { expect, test } from "../fixtures";

test.use({ scenarioProfile: "layout" });
test.skip(({ isMobile }) => isMobile, "服务端读取权限与视口无关");

test("报名审核的 Flight 只向本届管理员和超级管理员返回私有报名数据", async ({ request, scenario }) => {
  const actor = scenario.accounts.find((account) => account.key === "player2")!;
  const admin = scenario.accounts.find((account) => account.key === "admin")!;
  const seasonId = randomUUID();
  const slug = `admin-read-${seasonId}`;
  const seasonName = `未公开赛事 ${randomUUID()}`;
  const notes = `私有报名备注 ${randomUUID()}`;
  const pool = new Pool({ connectionString: assertLocalDatabaseUrl(process.env.DATABASE_URL), ssl: false });

  async function signIn(email: string) {
    const response = await request.post("/api/test/e2e/auth", { data: { email, password: scenario.password } });
    expect(response.ok()).toBe(true);
  }

  async function readFlight() {
    const response = await request.get(`/admin/${slug}/registrations?status=all&_rsc`, {
      headers: { RSC: "1" },
      maxRedirects: 0,
    });
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("text/x-component");
    return response.text();
  }

  function expectPrivateDataAbsent(flight: string) {
    expect(flight).not.toContain(seasonName);
    expect(flight).not.toContain(notes);
  }

  try {
    await pool.query("insert into seasons(id,slug,name,kind) values($1,$2,$3,'custom')", [seasonId, slug, seasonName]);
    await pool.query(
      `insert into season_registrations(season_id,user_id,primary_position,secondary_position,peak_rank,peak_rank_season,peak_rating,current_season_peak_rank,current_rating,gameplay_style,notes)
       values($1,$2,'igl','anchor','A','S1',1.2,'A',1.2,'fixture',$3)`,
      [seasonId, admin.userId, notes],
    );

    const anonymous = await readFlight();
    expect(anonymous).toContain("NEXT_REDIRECT;replace;/login?next=/admin;");
    expectPrivateDataAbsent(anonymous);

    await signIn(actor.email);
    const ordinary = await readFlight();
    expect(ordinary).toContain("没有访问此管理页面所需的权限");
    expectPrivateDataAbsent(ordinary);

    await pool.query("insert into season_admin_grants(season_id,user_id) values($1,$2)", [scenario.seasonId, actor.userId]);
    const foreign = await readFlight();
    expect(foreign).toContain("没有访问此管理页面所需的权限");
    expectPrivateDataAbsent(foreign);

    await pool.query("insert into season_admin_grants(season_id,user_id) values($1,$2)", [seasonId, actor.userId]);
    expect(await readFlight()).toContain(notes);

    await signIn(admin.email);
    expect(await readFlight()).toContain(notes);
  } finally {
    try {
      await pool.query("delete from season_registrations where season_id=$1", [seasonId]);
      await pool.query("delete from seasons where id=$1", [seasonId]);
    } finally {
      await pool.end();
    }
  }
});
