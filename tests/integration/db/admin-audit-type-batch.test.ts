import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createLocalPool } from "./harness/database";
import { createPredictionBrowserFixture, removePredictionBrowserFixture } from "../../e2e/helpers/prediction-fixture";
import { resolveAuditTargets, auditTargetKey, type AuditTargetRef } from "@/lib/audit/targets";

it("resolves audit target labels and missing entries across target types", async () => {
  const fixturePool = createLocalPool();
  const actor = randomUUID();
  await fixturePool.query("insert into users(id,email) values($1::uuid,$1::text||'@fixture.test')", [actor]);
  const fixture = await createPredictionBrowserFixture(actor);
  try {
    const announcement = await fixturePool.query<{ id: string }>("insert into announcements(scope,season_id,title,body,status) values('season',$1,'audit fixture','fixture body','draft') returning id", [fixture.seasonId]);
    const group = await fixturePool.query<{ id: string }>("insert into community_groups(season_id,label,group_number) values($1,'audit group','123456789') returning id", [fixture.seasonId]);
    const map = await fixturePool.query<{ id: string; match_id: string }>("insert into match_maps(match_id,map_order,map_name) select id,1,'de_nuke' from matches where season_id=$1 order by id limit 1 returning id,match_id", [fixture.seasonId]);
  const types = ["user", "season", "competition_entry", "competitive_platform", "competitive_platform_rank", "competitive_platform_season",
    "admin_invite", "announcement", "captain_vote", "community_award", "community_award_evidence", "community_group", "dak_pairing",
    "disciplinary_case", "draft_pick", "draft_state", "education_verification", "feedback_report", "major_final_result", "major_prestart_entrant",
    "major_prestart_state", "major_stage_run", "major_tournament_entrant", "match", "match_demo_import", "match_map", "match_roster",
    "match_time_proposal", "mizar_installation", "post_event_adjudication"];
  // Never sample arbitrary entities from earlier specs in a reused worker DB.
  // Match/map deliberately overlap to exercise request-local label deduplication.
  const known: Record<string, string> = { user: actor, season: fixture.seasonId,
    announcement: announcement.rows[0]!.id, community_group: group.rows[0]!.id,
    match: map.rows[0]!.match_id, match_map: map.rows[0]!.id };
  const seeds: Record<string, [string, string, string | null]> = {
    competition_entry: ["competition_entries", "id", "competition_id"],
    major_stage_run: ["major_stage_runs", "id", "season_id"],
    major_tournament_entrant: ["major_tournament_entrants", "id", "season_id"],
    competitive_platform: ["competitive_platforms", "key", null],
    competitive_platform_rank: ["competitive_platform_ranks", "id", null],
    competitive_platform_season: ["competitive_platform_seasons", "id", null],
  };
  let existing = 0;
  const refs: AuditTargetRef[] = [];
  for (const type of types) {
    const source = seeds[type];
    const found = known[type] ?? (source ? (await fixturePool.query<{ id: string }>(
      `select "${source[1]}" as id from "${source[0]}"${source[2] ? ` where "${source[2]}"=$1` : ""} order by "${source[1]}" limit 1`,
      source[2] ? [fixture.seasonId] : [],
    )).rows[0]?.id : undefined);
    if (found) existing++;
    refs.push({ targetType: type, targetId: found ?? randomUUID() });
  }
  expect(existing).toBeGreaterThanOrEqual(10);
  refs.push(...refs.slice(0, 20));
  expect(refs).toHaveLength(50); expect(types).toHaveLength(30);
  const resolved = await resolveAuditTargets(refs);
  expect(Object.keys(resolved)).toHaveLength(30);
  expect(Object.values(resolved).filter(value => value.found).length).toBeGreaterThanOrEqual(10);
  expect(Object.values(resolved).filter(value => !value.found).length).toBeGreaterThan(0);
  expect(resolved[auditTargetKey("announcement", announcement.rows[0]!.id)]).toMatchObject({ found: true, label: "audit fixture" });
  expect(resolved[auditTargetKey("community_group", group.rows[0]!.id)]).toMatchObject({ found: true, label: "群组 · audit group" });
  } finally {
    await fixturePool.query("delete from announcements where season_id=$1", [fixture.seasonId]);
    await fixturePool.query("delete from community_groups where season_id=$1", [fixture.seasonId]);
    await removePredictionBrowserFixture(fixture.seasonId);
    await fixturePool.query("delete from users where id=$1", [actor]);
    await fixturePool.end();
  }

});
