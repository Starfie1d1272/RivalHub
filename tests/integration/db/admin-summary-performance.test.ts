import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createLocalPool } from "./harness/database";
import { loadSeasonWorkspaceOverview } from "@/lib/admin/season-workspace/overview";
import { getPlatformOperationsOverview } from "@/lib/admin/platform-operations/overview";
import { buildPlatformOperationsGrowth, getPlatformOperationsGrowthStart, summarizePlayerPool, summarizeTeamSizes, type PlatformOperationsGrowthEvent } from "@/lib/admin/platform-operations/types";
import { getAdminUsersList, normalizeAdminUsersQuery } from "@/lib/admin/users";
import { getAdminInviteHistory, normalizeAdminInviteQuery, resolveAdminInviteState } from "@/lib/admin/invites";

vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));

it("matches independent membership and historical-event projections across CST midnight", async () => {
  const pool = createLocalPool();
  const people = Array.from({ length: 5 }, () => randomUUID());
  const teamIds = Array.from({ length: 3 }, () => randomUUID());
  const institution = randomUUID();
  const now = new Date("2051-05-10T16:00:00Z");
  const eventTime = "2051-05-10T15:59:59Z";
  try {
    const setup = await pool.connect();
    try {
      await setup.query("begin");
    for (const [i, id] of people.entries()) await setup.query("insert into users (id,email,status,created_at,merged_into_user_id,merged_at) values ($1,$2,$3,$4,$5,$6)", [id, `${id}@fixture.test`, i === 4 ? "merged" : "active", eventTime, i === 4 ? people[0] : null, i === 4 ? eventTime : null]);
    for (const [i, id] of teamIds.entries()) await setup.query("insert into teams (id,slug,name,creator_user_id,captain_user_id,status,disbanded_at,created_at) values ($1::uuid,$1::text,'fixture',$2,$2,$3,$4,$5)", [id, people[i === 1 ? 3 : i], i === 2 ? "disbanded" : "active", i === 2 ? eventTime : null, eventTime]);
    await setup.query("insert into team_memberships (team_id,user_id,started_at) values ($1,$2,$5),($1,$3,$5),($1,$4,$5)", [teamIds[0], people[0], people[1], people[4], eventTime]);
    await setup.query("insert into team_memberships (team_id,user_id,started_at) values ($1,$2,$3)", [teamIds[1], people[3], eventTime]);
    for (const [i, id] of teamIds.entries()) {
      await setup.query("insert into team_captain_changes (team_id,to_user_id,changed_by_actor_id) values ($1,$2,'fixture')", [id, people[i === 1 ? 3 : i]]);
      await setup.query("insert into team_name_changes (team_id,new_name,changed_by_actor_id) values ($1,'fixture','fixture')", [id]);
    }
    await setup.query("insert into team_memberships (team_id,user_id,started_at,ended_at,ended_reason,status) values ($1,$2,$3,$3,'left','left')", [teamIds[2], people[2], eventTime]);
    await setup.query("insert into institutions (id,name,source,source_version) values ($1,'fixture','manual','fixture')", [institution]);
    for (const user of [people[0], people[0], people[2], people[4]]) await setup.query("insert into education_verifications (user_id,institution_id,academic_status,evidence_type,status,reviewed_at) values ($1,$2,'enrolled','manual_other','approved',$3)", [user, institution, eventTime]);
    await setup.query("insert into user_sessions (user_id,last_active_at) values ($1,$2),($3,$4),($5,$6)", [people[0], "2051-05-10T16:00:00Z", people[1], "2051-05-03T16:00:00Z", people[2], "2051-04-10T16:00:00Z"]);
      await setup.query("commit");
    } catch (error) { await setup.query("rollback"); throw error; }
    finally { setup.release(); }
    const memberships = await pool.query<{ teamId: string; userId: string | null }>(`select t.id as "teamId", case when u.id is not null then tm.user_id else null end as "userId"
      from teams t left join team_memberships tm on tm.team_id=t.id and tm.ended_at is null
      left join users u on u.id=tm.user_id and u.status='active' where t.status='active'`);
    const certified = await pool.query<{ id: string }>("select distinct ev.user_id as id from education_verifications ev join users u on u.id=ev.user_id where u.status='active' and ev.status='approved'");
    const events = await pool.query<PlatformOperationsGrowthEvent>(`select 'user_created' as kind,id as "entityId",created_at as "occurredAt" from users where created_at >= $1 and created_at < $2
      union all select 'team_created',id,created_at from teams where created_at >= $1 and created_at < $2
      union all select 'membership_started',id,started_at from team_memberships where started_at >= $1 and started_at < $2
      union all select 'education_approval',user_id,reviewed_at from education_verifications where status='approved' and reviewed_at >= $1 and reviewed_at < $2`, [getPlatformOperationsGrowthStart(now), now]);
    const result = await getPlatformOperationsOverview(now);
    expect(result.teams).toEqual(summarizeTeamSizes(memberships.rows));
    expect(result.playerPool).toEqual(summarizePlayerPool({ currentMemberships: memberships.rows, certifiedUserIds: certified.rows.map(row => row.id), publicPlayerLft: result.playerPool.publicPlayerLft, publicTeamRecruiting: result.playerPool.publicTeamRecruiting }));
    expect(result.growth).toEqual(buildPlatformOperationsGrowth(now, events.rows));
    expect(result.growth.find(day => day.date === "2051-05-10")).toMatchObject({ newUsers: 5, newTeams: 3, newMemberships: 5, newEducationApprovals: 3 });
    expect(result.growth.at(-1)).toMatchObject({ date: "2051-05-11", newUsers: 0 });
    expect(result.population).toMatchObject({ activeUsers24h: 1, activeUsers7d: 1, activeUsers30d: 2 });
  } finally {
    const cleanup = await pool.connect();
    try {
      await cleanup.query("begin");
      // Isolated worker fixture cleanup only; business setup uses all real constraints.
      await cleanup.query("set local session_replication_role = replica");
      await cleanup.query("delete from team_captain_changes where team_id=any($1::uuid[])", [teamIds]);
      await cleanup.query("delete from team_name_changes where team_id=any($1::uuid[])", [teamIds]);
    await cleanup.query("delete from team_memberships where team_id=any($1::uuid[])", [teamIds]);
    await cleanup.query("delete from teams where id=any($1::uuid[])", [teamIds]);
    await cleanup.query("delete from education_verifications where institution_id=$1", [institution]);
    await cleanup.query("delete from institutions where id=$1", [institution]);
    await cleanup.query("delete from user_sessions where user_id=any($1::uuid[])", [people]);
    await cleanup.query("delete from users where id=$1", [people[4]]);
    await cleanup.query("delete from users where id=any($1::uuid[])", [people]);
      await cleanup.query("commit");
    } catch (error) { await cleanup.query("rollback"); throw error; }
    finally { cleanup.release(); }
    await pool.end();
  }
});

it("filters invitation states before paging, preserving precedence, null expiry and stable ties", async () => {
  const pool = createLocalPool();
  const season = randomUUID();
  const user = randomUUID();
  const now = new Date("2051-06-01T12:00:00Z");
  const ids = Array.from({ length: 65 }, () => randomUUID());
  try {
    await pool.query("insert into seasons (id,slug,name,kind) values ($1::uuid,$1::text,'fixture','custom')", [season]);
    await pool.query("insert into users (id,email) values ($1,$2)", [user, `${user}@fixture.test`]);
    for (const [i, id] of ids.entries()) {
      await pool.query("insert into admin_invites (id,code,created_by,role,season_id,max_uses,expires_at,is_active,created_at) values ($1::uuid,$1::text,'fixture','season_admin',$2,1,$3,$4,$5)", [id, season, i % 3 === 0 ? null : i % 3 === 1 ? now : new Date(now.getTime() + 1000), i % 5 !== 0, now]);
      if (i % 4 === 0) await pool.query("insert into admin_invite_claims (invite_id,user_id) values ($1,$2)", [id, user]);
    }
    const truth = (await pool.query<{ id: string; isActive: boolean; expiresAt: Date | null; maxUses: number; claimCount: number }>(`select i.id,i.is_active as "isActive",i.expires_at as "expiresAt",i.max_uses as "maxUses", count(c.user_id)::int as "claimCount"
      from admin_invites i left join admin_invite_claims c on c.invite_id=i.id where i.season_id=$1 group by i.id`, [season])).rows;
    for (const state of ["all", "usable", "expired", "exhausted", "revoked"] as const) {
      const expected = truth.filter(row => state === "all" || resolveAdminInviteState(row, now) === state).sort((a, b) => b.id.localeCompare(a.id));
      const query = normalizeAdminInviteQuery({ season, state, page: "999" });
      const result = await getAdminInviteHistory(query, now);
      expect(result.total).toBe(expected.length);
      expect(result.rows.map(row => row.id)).toEqual(expected.slice((result.page - 1) * 25, result.page * 25).map(row => row.id));
      expect(result.rows.length).toBeLessThanOrEqual(25);
    }
    const expiry = await getAdminInviteHistory(normalizeAdminInviteQuery({ season, sort: "expires_soon" }), now);
    expect(expiry.rows.every(row => row.expiresAt !== null)).toBe(true);
  } finally {
    await pool.query("delete from admin_invites where season_id=$1", [season]);
    await pool.query("delete from seasons where id=$1", [season]);
    await pool.query("delete from users where id=$1", [user]);
    await pool.end();
  }
});

it("counts distinct participation only for displayed users while filtering before pagination", async () => {
  const pool = createLocalPool();
  const people = Array.from({ length: 3 }, () => randomUUID());
  const seasons = [randomUUID(), randomUUID()];
  const marker = `user-list-${randomUUID()}`;
  try {
    for (const id of people) await pool.query("insert into users (id,email,created_at) values ($1,$2,'2051-01-01Z')", [id, `${id}@${marker}.test`]);
    for (const id of seasons) await pool.query("insert into seasons (id,slug,name,kind) values ($1::uuid,$1::text,'fixture','custom')", [id]);
    for (const [person, season] of [[people[0], seasons[0]], [people[0], seasons[1]], [people[1], seasons[0]]]) {
      await pool.query(`insert into season_registrations (user_id,season_id,primary_position,secondary_position,peak_rank,peak_rank_season,peak_rating,current_season_peak_rank,current_rating,gameplay_style)
        values ($1,$2,'entry','support','A','S1',1.2,'A',1.2,'fixture')`, [person, season]);
    }
    for (const filter of ["all", "participated", "none"] as const) {
      const result = await getAdminUsersList(normalizeAdminUsersQuery({ q: marker, filter, page: "999" }));
      const counts = new Map(result.rows.map(row => [row.id, Number(row.season_count)]));
      expect(result.total).toBe(filter === "all" ? 3 : filter === "participated" ? 2 : 1);
      if (filter !== "none") { expect(counts.get(people[0]!)).toBe(2); expect(counts.get(people[1]!)).toBe(1); }
      if (filter !== "participated") expect(counts.get(people[2]!)).toBe(0);
    }
  } finally {
    await pool.query("delete from season_registrations where user_id=any($1::uuid[])", [people]);
    await pool.query("delete from seasons where id=any($1::uuid[])", [seasons]);
    await pool.query("delete from users where id=any($1::uuid[])", [people]);
    await pool.end();
  }
});

it("keeps preparation readiness separate from started Major summary consumers", async () => {
  const pool = createLocalPool();
  const ids: string[] = [];
  try {
    for (const status of ["draft", "registration", "playing", "finished", "archived"]) {
      const id = randomUUID(); ids.push(id);
      await pool.query("insert into seasons (id,slug,name,kind,competition_template,status) values ($1::uuid,$1::text,'fixture','major','major',$2)", [id, status]);
      const result = await loadSeasonWorkspaceOverview(id);
      expect(result?.summary).toMatchObject({ entrantCount: 0, frozenEntrantCount: 0, matchCount: 0, finalResultPendingConfirmation: false });
      if (status === "draft" || status === "registration") expect(result?.readiness).not.toBeNull();
      else { expect(result?.readiness).toBeNull(); expect(result?.prestartPhase).toBeNull(); }
    }
  } finally {
    await pool.query("delete from seasons where id=any($1::uuid[])", [ids]);
    await pool.end();
  }
});
