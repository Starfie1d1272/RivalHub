import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createLocalPool } from "./harness/database";
import { loadAdminAnnouncementPage } from "@/lib/admin/announcement-page";
import { getAnnouncementForAdmin } from "@/lib/announcements/read-model";

it("clamps summary pages within the same status/season authorization scope and preserves complete detail", async () => {
  const pool = createLocalPool();
  const season = randomUUID(), foreign = randomUUID();
  const ids = Array.from({ length: 65 }, () => randomUUID());
  const foreignId = randomUUID();
  const body = "内部公告中文正文".repeat(300);
  const access = { role: "season_admin" as const, seasonIds: [season], seasonId: season, scope: "season" as const };
  try {
    for (const id of [season, foreign]) await pool.query("insert into seasons(id,slug,name,kind) values($1::uuid,$1::text,'fixture','custom')", [id]);
    await pool.query(`insert into announcements(id,scope,season_id,title,body,status,updated_at)
      select id,'season',$2,'fixture',$3,'draft','2051-01-01T00:00:00Z' from unnest($1::uuid[]) id`, [ids, season, body]);
    await pool.query("insert into announcements(id,scope,season_id,title,body,status) values($1,'season',$2,'foreign',$3,'draft')", [foreignId, foreign, body]);
    const first = await loadAdminAnnouncementPage(access);
    expect(first.total).toBe(65);
    expect(first.items).toHaveLength(20);
    expect(first.items.map(row => row.id)).toEqual([...ids].sort((a, b) => b.localeCompare(a)).slice(0, 20));
    expect(JSON.stringify(first)).not.toContain(body);
    const last = await loadAdminAnnouncementPage({ ...access, page: "999" });
    expect(last).toMatchObject({ total: 65, page: 4, pageSize: 20 });
    expect(last.items).toHaveLength(5);
    expect((await loadAdminAnnouncementPage({ ...access, status: "published", page: "999" }))).toMatchObject({ total: 0, page: 1, items: [] });
    expect((await loadAdminAnnouncementPage({ ...access, seasonIds: [] }))).toMatchObject({ total: 0, items: [] });
    expect(await getAnnouncementForAdmin(ids[0]!, access)).toMatchObject({ body, seasonId: season });
    expect(await getAnnouncementForAdmin(foreignId, access)).toBeNull();
    expect(await getAnnouncementForAdmin(ids[0]!, { ...access, seasonId: foreign })).toBeNull();
  } finally {
    await pool.query("delete from announcements where season_id=any($1::uuid[])", [[season, foreign]]);
    await pool.query("delete from seasons where id=any($1::uuid[])", [[season, foreign]]);
    await pool.end();
  }
});
