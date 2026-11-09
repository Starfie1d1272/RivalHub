import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { test, expect } from "../fixtures";
import { assertLocalDatabaseUrl } from "../../../scripts/db/local-environment";

test.use({ scenarioProfile: "layout" });
test.setTimeout(90_000);
test.skip(({ isMobile }) => isMobile, "服务端读取权限与视口无关");

test("后台 Flight 保留公告、赛事信息与教育材料的读取范围", async ({ request, scenario }) => {
  const actor = scenario.accounts.find(account => account.key === "player2")!;
  const admin = scenario.accounts.find(account => account.key === "admin")!;
  const pool = new Pool({ connectionString: assertLocalDatabaseUrl(process.env.DATABASE_URL), ssl: false });
  const foreign = randomUUID(), announcement = randomUUID(), foreignAnnouncement = randomUUID();
  const institution = randomUUID(), verification = randomUUID();
  const title = `fixture announcement ${announcement}`;
  const body = `body-marker-${announcement}`;
  const foreignBody = `body-marker-${foreignAnnouncement}`;
  const contact = `contact-marker-${randomUUID()}`;
  const school = `school-marker-${randomUUID()}`;
  const code = randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();

  async function signIn(email: string) {
    expect((await request.post("/api/test/e2e/auth", { data: { email, password: scenario.password } })).ok()).toBe(true);
  }

  async function flight(path: string) {
    const response = await request.get(path, { headers: { RSC: "1" } });
    expect(response.ok() || response.status() === 404).toBe(true);
    expect(response.headers()["content-type"]).toContain("text/x-component");
    return response.text();
  }

  try {
    await pool.query("insert into season_admin_grants(season_id,user_id) values($1,$2)", [scenario.seasonId, actor.userId]);
    await pool.query("insert into seasons(id,slug,name,kind) values($1::uuid,$1::text,'foreign fixture','custom')", [foreign]);
    await pool.query(
      "insert into announcements(id,scope,season_id,title,body,status) values($1,'season',$2,$3,$4,'draft'),($5,'season',$6,'foreign announcement',$7,'draft')",
      [announcement, scenario.seasonId, title, body, foreignAnnouncement, foreign, foreignBody],
    );
    await pool.query("insert into season_contacts(season_id,label,value) values($1,'fixture contact',$2)", [scenario.seasonId, contact]);
    await pool.query("insert into institutions(id,name,source,source_version) values($1,$2,'manual','fixture')", [institution, school]);
    await pool.query("insert into education_verifications(id,user_id,institution_id,academic_status,evidence_type,status,evidence_code) values($1,$2,$3,'enrolled','chsi_enrollment_report','pending',$4)", [verification, actor.userId, institution, code]);

    await signIn(actor.email);
    const announcements = `/admin/${scenario.slug}/announcements`;
    const list = await flight(announcements);
    expect(list).toContain(title);
    expect(list).not.toContain(body);
    expect(await flight(`${announcements}/${announcement}`)).toContain(body);
    expect(await flight(`${announcements}/${foreignAnnouncement}`)).not.toContain(foreignBody);

    const directory = await flight("/admin/operations/season-info");
    expect(directory).toContain(scenario.slug);
    expect(directory).not.toContain(contact);
    expect(await flight(`/admin/operations/season-info/${scenario.slug}`)).toContain(contact);

    const education = await flight("/admin/education-verifications");
    expect(education).toContain("没有访问此管理页面所需的权限");
    expect(education).not.toContain(code);
    await signIn(admin.email);
    expect(await flight(`/admin/education-verifications?q=${school}&status=all`)).toContain(code);
  } finally {
    await pool.query("delete from education_verifications where id=$1", [verification]);
    await pool.query("delete from institutions where id=$1", [institution]);
    await pool.query("delete from announcements where season_id=any($1::uuid[])", [[scenario.seasonId, foreign]]);
    await pool.query("delete from season_contacts where season_id=$1", [scenario.seasonId]);
    await pool.query("delete from season_admin_grants where season_id=$1 and user_id=$2", [scenario.seasonId, actor.userId]);
    await pool.query("delete from seasons where id=$1", [foreign]);
    await pool.end();
  }
});
