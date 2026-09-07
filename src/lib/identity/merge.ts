import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB, TxDb } from "@/db/client";
import {
  auditLogs,
  identityLinkRequests,
  userIdentities,
  userMergeAuthorizations,
  userMergeLedger,
  users,
} from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { resolveCanonicalUserId } from "@/lib/identity/canonical";
import type { MapPreference } from "@/types/season";

export type UserMergeCategory = "REPARENT" | "DEDUPE" | "RECONCILE" | "BLOCKER" | "PRESERVE";
export type UserMergeItemStatus = "automatic" | "preserved" | "unresolved";

export interface UserMergePlanItem {
  key: string;
  category: UserMergeCategory;
  domain: string;
  count: number;
  status: UserMergeItemStatus;
  detail: string;
}

export interface UserMergePreflight {
  canonicalUserId: string;
  mergedUserId: string;
  fingerprint: string;
  executable: boolean;
  items: UserMergePlanItem[];
  summary: Record<UserMergeCategory, number>;
}

type RuleMode = "reparent" | "preserve" | "special" | "delete";
interface UserReferenceRule {
  table: string;
  column: string;
  domain: string;
  mode: RuleMode;
}

/**
 * Canonical semantic registry for every direct public FK to users.id.
 * PostgreSQL catalog coverage is checked on every preflight; an unclassified
 * future FK makes the whole merge fail closed.
 */
export const USER_REFERENCE_RULES: readonly UserReferenceRule[] = [
  { table: "admin_invite_claims", column: "user_id", domain: "admin claims", mode: "special" },
  { table: "community_awards", column: "submitted_by_user_id", domain: "community award actor", mode: "preserve" },
  { table: "community_awards", column: "reviewed_by_user_id", domain: "community award actor", mode: "preserve" },
  { table: "community_awards", column: "recipient_user_id", domain: "community award recipient", mode: "reparent" },
  { table: "community_awards", column: "outcome_by_user_id", domain: "community award actor", mode: "preserve" },
  { table: "community_award_evidence", column: "submitted_by_user_id", domain: "community award actor", mode: "preserve" },
  { table: "community_award_evidence", column: "candidate_user_id", domain: "community award candidate", mode: "reparent" },
  { table: "competition_entries", column: "representative_user_id", domain: "CompetitionEntry representative", mode: "reparent" },
  { table: "competition_entry_participants", column: "user_id", domain: "CompetitionEntry participant", mode: "special" },
  { table: "competition_entry_participants", column: "invited_by_user_id", domain: "CompetitionEntry actor", mode: "preserve" },
  { table: "competition_entry_active_claims", column: "user_id", domain: "CompetitionEntry current claim", mode: "special" },
  { table: "competition_entry_roster_members", column: "user_id", domain: "roster revision member", mode: "special" },
  { table: "competition_entry_representative_changes", column: "from_user_id", domain: "representative provenance", mode: "preserve" },
  { table: "competition_entry_representative_changes", column: "to_user_id", domain: "representative provenance", mode: "preserve" },
  { table: "event_roster_members", column: "user_id", domain: "frozen EventRoster", mode: "preserve" },
  { table: "competitive_rank_facts", column: "user_id", domain: "competitive rank facts", mode: "special" },
  { table: "user_competitive_roles", column: "user_id", domain: "competitive roles", mode: "special" },
  { table: "user_map_preferences", column: "user_id", domain: "map preferences", mode: "special" },
  { table: "disciplinary_cases", column: "subject_user_id", domain: "personal sanctions", mode: "reparent" },
  { table: "education_verifications", column: "user_id", domain: "education verification", mode: "reparent" },
  { table: "identity_link_requests", column: "user_id", domain: "identity challenge", mode: "delete" },
  { table: "user_identities", column: "user_id", domain: "credentials", mode: "special" },
  { table: "user_merge_authorizations", column: "initiating_user_id", domain: "merge proof provenance", mode: "preserve" },
  { table: "user_merge_authorizations", column: "counterparty_user_id", domain: "merge proof provenance", mode: "preserve" },
  { table: "user_merge_ledger", column: "canonical_user_id", domain: "merge provenance", mode: "preserve" },
  { table: "user_merge_ledger", column: "merged_user_id", domain: "merge provenance", mode: "preserve" },
  { table: "user_merge_ledger", column: "executed_by_user_id", domain: "merge actor provenance", mode: "preserve" },
  { table: "match_rosters", column: "submitted_by", domain: "match roster actor", mode: "preserve" },
  { table: "match_time_proposals", column: "proposed_by", domain: "match scheduling actor", mode: "preserve" },
  { table: "match_time_proposals", column: "force_assigned_by", domain: "match scheduling actor", mode: "preserve" },
  { table: "match_mvp_votes", column: "player_user_id", domain: "MVP candidate", mode: "reparent" },
  { table: "match_mvp_votes", column: "voter_user_id", domain: "MVP vote", mode: "special" },
  { table: "match_player_stats", column: "user_id", domain: "match player stats", mode: "reparent" },
  { table: "post_event_adjudications", column: "target_user_id", domain: "post-event person ruling", mode: "reparent" },
  { table: "tournament_honors", column: "user_id", domain: "tournament honor", mode: "reparent" },
  { table: "match_commentators", column: "user_id", domain: "match commentator", mode: "special" },
  { table: "match_commentators", column: "added_by_user_id", domain: "commentator actor", mode: "preserve" },
  { table: "post_match_reports", column: "submitted_by_user_id", domain: "post-match actor", mode: "preserve" },
  { table: "recruitment_intents", column: "user_id", domain: "current recruitment intent", mode: "special" },
  { table: "recruitment_interests", column: "user_id", domain: "recruitment interest", mode: "special" },
  { table: "season_registrations", column: "user_id", domain: "season registration", mode: "special" },
  { table: "season_admin_grants", column: "user_id", domain: "season admin grants", mode: "special" },
  { table: "season_admin_grants", column: "granted_by_user_id", domain: "admin grant actor", mode: "preserve" },
  { table: "teams", column: "creator_user_id", domain: "Team creator provenance", mode: "preserve" },
  { table: "teams", column: "captain_user_id", domain: "current Team captain", mode: "special" },
  { table: "team_memberships", column: "user_id", domain: "Team membership", mode: "special" },
  { table: "team_memberships", column: "invited_by_user_id", domain: "Team membership actor", mode: "preserve" },
  { table: "team_captain_changes", column: "from_user_id", domain: "captain provenance", mode: "preserve" },
  { table: "team_captain_changes", column: "to_user_id", domain: "captain provenance", mode: "preserve" },
  { table: "team_invitations", column: "invited_user_id", domain: "Team invitation target", mode: "special" },
  { table: "team_invitations", column: "invited_by_user_id", domain: "Team invitation actor", mode: "preserve" },
  { table: "team_invitations", column: "responded_by_user_id", domain: "Team invitation actor", mode: "preserve" },
  { table: "user_sessions", column: "user_id", domain: "application session", mode: "delete" },
  { table: "users", column: "merged_into_user_id", domain: "historical user alias", mode: "preserve" },
] as const;

type MergeQueryable = Pick<DB, "execute">;

export async function assertUserReferenceRegistryCoverage(queryable: MergeQueryable): Promise<void> {
  const result = await queryable.execute(sql`
    SELECT child.relname AS table_name, child_column.attname AS column_name
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS child ON child.oid = constraint_row.conrelid
    JOIN pg_namespace AS child_namespace ON child_namespace.oid = child.relnamespace
    JOIN pg_class AS parent ON parent.oid = constraint_row.confrelid
    JOIN pg_namespace AS parent_namespace ON parent_namespace.oid = parent.relnamespace
    JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY AS child_key(attnum, ordinal) ON true
    JOIN LATERAL unnest(constraint_row.confkey) WITH ORDINALITY AS parent_key(attnum, ordinal) ON parent_key.ordinal = child_key.ordinal
    JOIN pg_attribute AS child_column ON child_column.attrelid = child.oid AND child_column.attnum = child_key.attnum
    JOIN pg_attribute AS parent_column ON parent_column.attrelid = parent.oid AND parent_column.attnum = parent_key.attnum
    WHERE constraint_row.contype = 'f'
      AND child_namespace.nspname = 'public'
      AND parent_namespace.nspname = 'public'
      AND parent.relname = 'users'
      AND parent_column.attname = 'id'
    ORDER BY child.relname, child_column.attname
  `);
  const actual = result.rows.map((row) => `${String(row.table_name)}.${String(row.column_name)}`).sort();
  const expected = USER_REFERENCE_RULES.map((rule) => `${rule.table}.${rule.column}`).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const expectedSet = new Set(expected);
    const actualSet = new Set(actual);
    const differences = [
      ...actual.filter((key) => !expectedSet.has(key)).map((key) => `unclassified ${key}`),
      ...expected.filter((key) => !actualSet.has(key)).map((key) => `missing ${key}`),
    ];
    throw new AppError(ErrorCode.INTERNAL_ERROR, `user identity owner registry 与 PostgreSQL schema 不一致：${differences.join("；")}`);
  }
}

const PROFILE_FIELDS = [
  "student_id",
  "qq",
  "perfect_name",
  "display_name",
  "steam_name",
  "steam64",
  "steam_profile_url",
  "live_stream_url",
  "avatar_url",
] as const;

type ProfileField = (typeof PROFILE_FIELDS)[number];
type UserRow = Record<ProfileField, string | null> & { id: string; status: string; role: "user" | "super_admin" };

export async function buildUserMergePreflight(
  queryable: MergeQueryable,
  input: { canonicalUserId: string; mergedUserId: string },
): Promise<UserMergePreflight> {
  if (input.canonicalUserId === input.mergedUserId) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "canonical user 与待归并 user 不能相同。");
  }
  await assertUserReferenceRegistryCoverage(queryable);
  const pairResult = await queryable.execute(sql`
    SELECT id, status, role, student_id, qq, perfect_name, display_name, steam_name,
      steam64, steam_profile_url, live_stream_url, avatar_url
    FROM users
    WHERE id IN (${input.canonicalUserId}, ${input.mergedUserId})
    ORDER BY id
  `);
  const pair = pairResult.rows as unknown as UserRow[];
  const canonical = pair.find((row) => row.id === input.canonicalUserId);
  const merged = pair.find((row) => row.id === input.mergedUserId);
  if (!canonical || !merged) throw new AppError(ErrorCode.NOT_FOUND, "归并候选用户不存在。");
  if (canonical.status !== "active" || merged.status !== "active") {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "归并双方都必须是 active canonical user。");
  }

  const items: UserMergePlanItem[] = [];
  for (const rule of USER_REFERENCE_RULES) {
    if (rule.mode === "special") continue;
    const count = await countReference(queryable, rule.table, rule.column, input.mergedUserId);
    if (count === 0) continue;
    if (rule.mode === "preserve") {
      items.push(item(`reference:${rule.table}.${rule.column}`, "PRESERVE", rule.domain, count, "preserved", "保留原 account identity，并由 alias resolver 关联 canonical user。"));
    } else if (rule.mode === "delete") {
      items.push(item(`reference:${rule.table}.${rule.column}`, "DEDUPE", rule.domain, count, "automatic", "归并时撤销过期 challenge 或 session，不迁移临时状态。"));
    } else {
      items.push(item(`reference:${rule.table}.${rule.column}`, "REPARENT", rule.domain, count, "automatic", "安全事实归到 canonical user；原始业务行与 evidence 保留。"));
    }
  }

  addProfileItems(items, canonical, merged);
  await addCompetitiveItems(queryable, input, items);
  await addCollisionItems(queryable, input, items);
  for (const rule of USER_REFERENCE_RULES) {
    if (rule.mode !== "special" || ["competitive_rank_facts", "user_competitive_roles", "user_map_preferences"].includes(rule.table)) continue;
    const count = await countReference(queryable, rule.table, rule.column, input.mergedUserId);
    pushCount(items, `owned:${rule.table}.${rule.column}`, "REPARENT", rule.domain, count, "automatic", "通过该 domain 的 collision/dedupe 规则后归到 canonical user。" );
  }

  const mvpWinnerCount = await countReference(queryable, "matches", "mvp_winner_user_id", input.mergedUserId);
  if (mvpWinnerCount > 0) {
    items.push(item("logical:matches.mvp_winner_user_id", "PRESERVE", "frozen match result", mvpWinnerCount, "preserved", "已锁定 MVP 胜者保持历史 account id；展示通过 alias 解析。"));
  }
  items.push(item("coverage:users.id", "PRESERVE", "schema coverage", USER_REFERENCE_RULES.length, "preserved", "PostgreSQL catalog 中每个 users.id FK 均有显式语义分类。"));

  items.sort((left, right) => left.category.localeCompare(right.category) || left.key.localeCompare(right.key));
  const summary = emptySummary();
  for (const planItem of items) summary[planItem.category] += planItem.count;
  const executable = items.every((planItem) => planItem.status !== "unresolved");
  const fingerprint = createHash("sha256").update(JSON.stringify({
    canonicalUserId: input.canonicalUserId,
    mergedUserId: input.mergedUserId,
    items,
  })).digest("hex");
  return { ...input, fingerprint, executable, items, summary };
}

function addProfileItems(items: UserMergePlanItem[], canonical: UserRow, merged: UserRow): void {
  for (const field of PROFILE_FIELDS) {
    const canonicalValue = canonical[field]?.trim() || null;
    const mergedValue = merged[field]?.trim() || null;
    if (!mergedValue) continue;
    if (!canonicalValue) {
      items.push(item(`profile:${field}`, "REPARENT", "long-lived profile", 1, "automatic", `${field} 仅待归并账号有值，写入 canonical profile。`));
    } else if (canonicalValue === mergedValue) {
      items.push(item(`profile:${field}`, "DEDUPE", "long-lived profile", 1, "automatic", `${field} 两侧相同，保留单一 canonical 值。`));
    } else {
      items.push(item(`profile:${field}`, "RECONCILE", "long-lived profile", 1, "unresolved", `${field} 两侧值不同；必须先明确身份字段取值，不能按新旧或非空静默覆盖。`));
    }
  }
  if (merged.role === "super_admin" && canonical.role !== "super_admin") {
    items.push(item("authorization:global-role", "REPARENT", "authorization", 1, "automatic", "双重控制已证明；canonical user 继承受控账号的 super_admin role。"));
  }
}

async function addCompetitiveItems(
  queryable: MergeQueryable,
  input: { canonicalUserId: string; mergedUserId: string },
  items: UserMergePlanItem[],
): Promise<void> {
  const rankResult = await queryable.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE winner.id IS NULL)::int AS reparent_count,
      COUNT(*) FILTER (WHERE winner.id IS NOT NULL AND NOT (
        loser.status IS NOT DISTINCT FROM winner.status
        AND loser.rank IS NOT DISTINCT FROM winner.rank
        AND loser.rating IS NOT DISTINCT FROM winner.rating
        AND (loser.stars IS NULL OR winner.stars IS NULL OR loser.stars = winner.stars)
        AND (loser.achieved_season_key IS NULL OR winner.achieved_season_key IS NULL OR loser.achieved_season_key = winner.achieved_season_key)
      ))::int AS conflict_count,
      COUNT(*) FILTER (WHERE winner.id IS NOT NULL AND (
        loser.status IS NOT DISTINCT FROM winner.status
        AND loser.rank IS NOT DISTINCT FROM winner.rank
        AND loser.rating IS NOT DISTINCT FROM winner.rating
        AND (loser.stars IS NULL OR winner.stars IS NULL OR loser.stars = winner.stars)
        AND (loser.achieved_season_key IS NULL OR winner.achieved_season_key IS NULL OR loser.achieved_season_key = winner.achieved_season_key)
      ))::int AS dedupe_count
    FROM competitive_rank_facts AS loser
    LEFT JOIN competitive_rank_facts AS winner
      ON winner.user_id = ${input.canonicalUserId}
     AND winner.platform = loser.platform
     AND winner.kind = loser.kind
     AND coalesce(winner.platform_season_key, '') = coalesce(loser.platform_season_key, '')
    WHERE loser.user_id = ${input.mergedUserId}
  `);
  const rank = rankResult.rows[0] as Record<string, unknown> | undefined;
  pushCount(items, "competitive:rank-reparent", "REPARENT", "competitive rank facts", integer(rank?.reparent_count), "automatic", "无同 identity rank fact，保留原事实并归到 canonical user。");
  pushCount(items, "competitive:rank-dedupe", "DEDUPE", "competitive rank facts", integer(rank?.dedupe_count), "automatic", "同 platform/kind/season 的事实等价或单侧信息更完整，确定性合并并保留较丰富字段。");
  pushCount(items, "competitive:rank-conflict", "RECONCILE", "competitive rank facts", integer(rank?.conflict_count), "unresolved", "同 platform/kind/season 的段位事实冲突，拒绝按最高或最新自动选择。");

  const roleResult = await queryable.execute(sql`
    SELECT role, is_primary, user_id
    FROM user_competitive_roles
    WHERE user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
    ORDER BY role, user_id
  `);
  const roles = roleResult.rows as Array<{ role: string; is_primary: boolean; user_id: string }>;
  const canonicalRoles = new Map(roles.filter((row) => row.user_id === input.canonicalUserId).map((row) => [row.role, row]));
  const mergedRoles = roles.filter((row) => row.user_id === input.mergedUserId);
  const roleDuplicates = mergedRoles.filter((row) => canonicalRoles.has(row.role)).length;
  const roleReparents = mergedRoles.length - roleDuplicates;
  const canonicalPrimary = roles.find((row) => row.user_id === input.canonicalUserId && row.is_primary)?.role;
  const mergedPrimary = roles.find((row) => row.user_id === input.mergedUserId && row.is_primary)?.role;
  pushCount(items, "competitive:role-reparent", "REPARENT", "competitive roles", roleReparents, "automatic", "role set 取并集，不制造 duplicate role。");
  pushCount(items, "competitive:role-dedupe", "DEDUPE", "competitive roles", roleDuplicates, "automatic", "两侧相同 role 去重。");
  if (canonicalPrimary && mergedPrimary && canonicalPrimary !== mergedPrimary) {
    items.push(item("competitive:primary-role", "RECONCILE", "competitive roles", 1, "unresolved", "双方 primary role 不同，必须先重新确认 primary。"));
  }

  const mapResult = await queryable.execute(sql`
    SELECT user_id, map_preferences
    FROM user_map_preferences
    WHERE user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
    ORDER BY user_id
  `);
  const preferences = mapResult.rows as Array<{ user_id: string; map_preferences: unknown }>;
  const canonicalMaps = parseMapPreferences(preferences.find((row) => row.user_id === input.canonicalUserId)?.map_preferences);
  const mergedMaps = parseMapPreferences(preferences.find((row) => row.user_id === input.mergedUserId)?.map_preferences);
  const mapConflicts = [...mergedMaps].filter(([map, level]) => canonicalMaps.has(map) && canonicalMaps.get(map) !== level).length;
  const mapDedupe = [...mergedMaps].filter(([map, level]) => canonicalMaps.get(map) === level).length;
  const mapReparent = [...mergedMaps].filter(([map]) => !canonicalMaps.has(map)).length;
  pushCount(items, "competitive:map-reparent", "REPARENT", "map preferences", mapReparent, "automatic", "稀疏地图事实取并集。");
  pushCount(items, "competitive:map-dedupe", "DEDUPE", "map preferences", mapDedupe, "automatic", "同地图相同 level 去重。");
  pushCount(items, "competitive:map-conflict", "RECONCILE", "map preferences", mapConflicts, "unresolved", "同地图 level 不同，拒绝取 max 或 latest。");
}

async function addCollisionItems(
  queryable: MergeQueryable,
  input: { canonicalUserId: string; mergedUserId: string },
  items: UserMergePlanItem[],
): Promise<void> {
  const result = await queryable.execute(sql`
    SELECT
      (SELECT count(*)::int FROM season_registrations loser JOIN season_registrations winner ON winner.user_id = ${input.canonicalUserId} AND winner.season_id = loser.season_id WHERE loser.user_id = ${input.mergedUserId}) AS registration_collision,
      (SELECT count(*)::int FROM competition_entry_participants loser JOIN competition_entry_participants winner ON winner.user_id = ${input.canonicalUserId} AND winner.entry_id = loser.entry_id WHERE loser.user_id = ${input.mergedUserId}) AS participant_collision,
      (SELECT count(*)::int FROM competition_entry_roster_members loser JOIN competition_entry_roster_members winner ON winner.user_id = ${input.canonicalUserId} AND winner.revision_id = loser.revision_id WHERE loser.user_id = ${input.mergedUserId}) AS roster_collision,
      (SELECT count(*)::int FROM event_roster_members loser JOIN event_roster_members winner ON winner.user_id = ${input.canonicalUserId} AND winner.event_roster_id = loser.event_roster_id WHERE loser.user_id = ${input.mergedUserId}) AS event_roster_collision,
      (SELECT count(*)::int FROM competition_entry_active_claims loser JOIN competition_entry_active_claims winner ON winner.user_id = ${input.canonicalUserId} AND winner.competition_id = loser.competition_id WHERE loser.user_id = ${input.mergedUserId}) AS active_claim_collision,
      (SELECT count(*)::int FROM team_memberships loser JOIN team_memberships winner ON winner.user_id = ${input.canonicalUserId} WHERE loser.user_id = ${input.mergedUserId} AND loser.ended_at IS NULL AND winner.ended_at IS NULL) AS current_team_collision,
      (SELECT count(*)::int FROM team_memberships loser JOIN team_memberships winner ON winner.user_id = ${input.canonicalUserId} AND winner.team_id = loser.team_id WHERE loser.user_id = ${input.mergedUserId} AND tstzrange(loser.started_at, coalesce(loser.ended_at, 'infinity'::timestamptz), '[)') && tstzrange(winner.started_at, coalesce(winner.ended_at, 'infinity'::timestamptz), '[)')) AS membership_overlap,
      (SELECT count(*)::int FROM teams loser JOIN teams winner ON winner.captain_user_id = ${input.canonicalUserId} AND winner.status = 'active' WHERE loser.captain_user_id = ${input.mergedUserId} AND loser.status = 'active') AS captaincy_collision,
      (SELECT count(*)::int FROM recruitment_intents loser JOIN recruitment_intents winner ON winner.user_id = ${input.canonicalUserId} WHERE loser.user_id = ${input.mergedUserId}) AS recruitment_intent_collision,
      (SELECT count(*)::int FROM team_invitations loser JOIN team_invitations winner ON winner.invited_user_id = ${input.canonicalUserId} AND winner.team_id = loser.team_id AND winner.status = 'pending' WHERE loser.invited_user_id = ${input.mergedUserId} AND loser.status = 'pending') AS invitation_collision,
      (SELECT count(*)::int FROM match_mvp_votes loser JOIN match_mvp_votes winner ON winner.voter_user_id = ${input.canonicalUserId} AND winner.match_id = loser.match_id WHERE loser.voter_user_id = ${input.mergedUserId} AND (CASE WHEN loser.player_user_id = ${input.mergedUserId} THEN ${input.canonicalUserId}::uuid ELSE loser.player_user_id END) IS DISTINCT FROM (CASE WHEN winner.player_user_id = ${input.mergedUserId} THEN ${input.canonicalUserId}::uuid ELSE winner.player_user_id END)) AS mvp_vote_conflict,
      (SELECT count(*)::int FROM match_mvp_votes loser JOIN match_mvp_votes winner ON winner.voter_user_id = ${input.canonicalUserId} AND winner.match_id = loser.match_id WHERE loser.voter_user_id = ${input.mergedUserId} AND (CASE WHEN loser.player_user_id = ${input.mergedUserId} THEN ${input.canonicalUserId}::uuid ELSE loser.player_user_id END) IS NOT DISTINCT FROM (CASE WHEN winner.player_user_id = ${input.mergedUserId} THEN ${input.canonicalUserId}::uuid ELSE winner.player_user_id END)) AS mvp_vote_dedupe,
      (SELECT count(*)::int FROM admin_invite_claims loser JOIN admin_invite_claims winner ON winner.user_id = ${input.canonicalUserId} AND winner.invite_id = loser.invite_id WHERE loser.user_id = ${input.mergedUserId}) AS admin_claim_dedupe,
      (SELECT count(*)::int FROM season_admin_grants loser JOIN season_admin_grants winner ON winner.user_id = ${input.canonicalUserId} AND winner.season_id = loser.season_id WHERE loser.user_id = ${input.mergedUserId}) AS admin_grant_dedupe,
      (SELECT count(*)::int FROM recruitment_interests loser JOIN recruitment_interests winner ON winner.user_id = ${input.canonicalUserId} AND winner.recruitment_intent_id = loser.recruitment_intent_id WHERE loser.user_id = ${input.mergedUserId}) AS recruitment_interest_dedupe,
      (SELECT count(*)::int FROM match_commentators loser JOIN match_commentators winner ON winner.user_id = ${input.canonicalUserId} AND winner.match_id = loser.match_id WHERE loser.user_id = ${input.mergedUserId}) AS commentator_dedupe
  `);
  const facts = result.rows[0] as Record<string, unknown> | undefined;
  const blockers: Array<[string, string, string]> = [
    ["registration_collision", "registration:same-season", "同一 Season 双方均有 registration；必须按报名状态、实际参赛和 provenance 人工判断。"],
    ["participant_collision", "entry:same-participant", "同一 CompetitionEntry 双方同时存在，不能制造重复 participant。"],
    ["roster_collision", "entry:same-revision", "同一 roster revision 双方同时存在，不能改写名单语义。"],
    ["event_roster_collision", "entry:same-event-roster", "同一 EventRoster 双方同时存在；冻结事实禁止自动改变。"],
    ["active_claim_collision", "entry:same-competition-claim", "同一赛事双方均有 active Entry claim，不能形成一人两个 current commitment。"],
    ["current_team_collision", "team:current-membership", "双方均有 current Team membership，不能自动选择或合并。"],
    ["membership_overlap", "team:membership-overlap", "同一 Team 的历史 membership 时间区间重叠，必须人工核对 provenance。"],
    ["captaincy_collision", "team:active-captaincy", "双方分别担任 active Team captain，不能自动选择。"],
    ["recruitment_intent_collision", "recruitment:current-state", "双方均有 current recruitment intent，不能留下两条 one-user state。"],
    ["invitation_collision", "team:pending-invitation", "双方在同一 Team 均有 pending invitation，需要先处理当前状态。"],
    ["mvp_vote_conflict", "vote:same-match", "同场 MVP 投票选择不同，不能任选其一。"],
  ];
  for (const [field, key, detail] of blockers) {
    pushCount(items, key, "BLOCKER", key.split(":")[0]!, integer(facts?.[field]), "unresolved", detail);
  }
  const dedupe: Array<[string, string, string]> = [
    ["mvp_vote_dedupe", "vote:same-match-dedupe", "同场选择相同，保留一票。"],
    ["admin_claim_dedupe", "authorization:invite-claim", "同一 invite claim 去重，不扩大权限。"],
    ["admin_grant_dedupe", "authorization:season-grant", "同一 season grant 去重，不留下重复权限。"],
    ["recruitment_interest_dedupe", "recruitment:same-interest", "同一 recruitment interest 去重。"],
    ["commentator_dedupe", "postmatch:same-commentator", "同场相同 commentator 事实去重。"],
  ];
  for (const [field, key, detail] of dedupe) {
    pushCount(items, key, "DEDUPE", key.split(":")[0]!, integer(facts?.[field]), "automatic", detail);
  }
}

function item(
  key: string,
  category: UserMergeCategory,
  domain: string,
  count: number,
  status: UserMergeItemStatus,
  detail: string,
): UserMergePlanItem {
  return { key, category, domain, count, status, detail };
}

function pushCount(
  items: UserMergePlanItem[],
  key: string,
  category: UserMergeCategory,
  domain: string,
  count: number,
  status: UserMergeItemStatus,
  detail: string,
): void {
  if (count > 0) items.push(item(key, category, domain, count, status, detail));
}

async function countReference(queryable: MergeQueryable, table: string, column: string, userId: string): Promise<number> {
  const tableIdentifier = sql.raw(`"${table}"`);
  const columnIdentifier = sql.raw(`"${column}"`);
  const result = await queryable.execute(sql`SELECT count(*)::int AS count FROM ${tableIdentifier} WHERE ${columnIdentifier} = ${userId}`);
  return integer((result.rows[0] as Record<string, unknown> | undefined)?.count);
}

function parseMapPreferences(value: unknown): Map<string, MapPreference["level"]> {
  if (!Array.isArray(value)) return new Map();
  return new Map(value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const map = "map" in entry && typeof entry.map === "string" ? entry.map : null;
    const level = "level" in entry && typeof entry.level === "string" ? entry.level as MapPreference["level"] : null;
    return map && level ? [[map, level] as const] : [];
  }));
}

function integer(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function emptySummary(): Record<UserMergeCategory, number> {
  return { REPARENT: 0, DEDUPE: 0, RECONCILE: 0, BLOCKER: 0, PRESERVE: 0 };
}

export interface ExecuteUserMergeInput {
  canonicalUserId: string;
  mergedUserId: string;
  actorUserId: string;
  expectedFingerprint: string;
  evidenceClass: "dual_identity_control" | "super_admin_review";
  reason: string;
  authorizationId?: string;
}

export async function executeUserMergeInTx(tx: TxDb, input: ExecuteUserMergeInput): Promise<UserMergePreflight> {
  const locked = await tx.select({ id: users.id }).from(users)
    .where(inArray(users.id, [input.canonicalUserId, input.mergedUserId].sort())).orderBy(users.id).for("update");
  if (locked.length !== 2) throw new AppError(ErrorCode.NOT_FOUND, "归并候选用户不存在。");

  const preflight = await buildUserMergePreflight(tx, input);
  if (preflight.fingerprint !== input.expectedFingerprint) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "归并事实已变化，请重新查看 preflight 后确认。");
  }
  if (!preflight.executable) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "仍有 unresolved blocker 或 reconciliation，已拒绝归并。");
  }
  const authorizationId = await verifyMergeAuthorityInTx(tx, input);

  await mergeProfilesInTx(tx, input.canonicalUserId, input.mergedUserId);
  await mergeCompetitiveFactsInTx(tx, input.canonicalUserId, input.mergedUserId);
  await mergeDedupeSurfacesInTx(tx, input.canonicalUserId, input.mergedUserId);
  await mergeCompetitionEntryFactsInTx(tx, input.canonicalUserId, input.mergedUserId);
  await mergeSpecialOwnedSurfacesInTx(tx, input.canonicalUserId, input.mergedUserId);

  for (const rule of USER_REFERENCE_RULES.filter((entry) => entry.mode === "reparent")) {
    await updateReference(tx, rule.table, rule.column, input.canonicalUserId, input.mergedUserId);
  }

  const now = new Date();
  await tx.update(userIdentities).set({ isPrimary: false }).where(and(
    eq(userIdentities.userId, input.mergedUserId),
    eq(userIdentities.status, "active"),
  ));
  await tx.update(userIdentities).set({ userId: input.canonicalUserId })
    .where(eq(userIdentities.userId, input.mergedUserId));
  await tx.update(identityLinkRequests).set({ status: "cancelled", completedAt: now }).where(and(
    eq(identityLinkRequests.userId, input.mergedUserId),
    eq(identityLinkRequests.status, "pending"),
  ));
  await tx.execute(sql`DELETE FROM user_sessions WHERE user_id = ${input.mergedUserId}`);
  await tx.update(userMergeAuthorizations).set({ status: "cancelled", consumedAt: now }).where(and(
    eq(userMergeAuthorizations.status, "available"),
    sql`(${userMergeAuthorizations.initiatingUserId} = ${input.mergedUserId} OR ${userMergeAuthorizations.counterpartyUserId} = ${input.mergedUserId})`,
    authorizationId ? sql`${userMergeAuthorizations.id} <> ${authorizationId}` : sql`true`,
  ));
  if (authorizationId) {
    await tx.update(userMergeAuthorizations).set({ status: "consumed", consumedAt: now })
      .where(eq(userMergeAuthorizations.id, authorizationId));
  }

  await tx.update(users).set({
    status: "merged",
    mergedIntoUserId: input.canonicalUserId,
    mergedAt: now,
    authId: null,
    role: "user",
    updatedAt: now,
  }).where(eq(users.id, input.mergedUserId));
  await tx.insert(userMergeLedger).values({
    canonicalUserId: input.canonicalUserId,
    mergedUserId: input.mergedUserId,
    executedByUserId: input.actorUserId,
    evidenceClass: input.evidenceClass,
    reason: input.reason.trim(),
    planFingerprint: preflight.fingerprint,
    authorizationId,
    domainSummary: preflight.summary,
    mergedAt: now,
  });
  await tx.insert(auditLogs).values({
    action: "user_identity.merge",
    actorId: input.actorUserId,
    targetId: input.canonicalUserId,
    targetType: "user",
    meta: {
      mergedUserId: input.mergedUserId,
      evidenceClass: input.evidenceClass,
      planFingerprint: preflight.fingerprint,
      summary: preflight.summary,
    },
  });
  await assertMergePostflightInTx(tx, input.canonicalUserId, input.mergedUserId);
  return preflight;
}

async function verifyMergeAuthorityInTx(tx: TxDb, input: ExecuteUserMergeInput): Promise<string | undefined> {
  if (!input.reason.trim()) throw new AppError(ErrorCode.VALIDATION_FAILED, "归并原因不能为空。");
  if (input.evidenceClass === "super_admin_review") {
    const [actor] = await tx.select({ role: users.role, status: users.status }).from(users)
      .where(eq(users.id, input.actorUserId)).for("update");
    if (!actor || actor.status !== "active" || actor.role !== "super_admin") {
      throw new AppError(ErrorCode.FORBIDDEN, "只有 super_admin 可执行人工证据归并。");
    }
    return undefined;
  }
  if (!input.authorizationId) throw new AppError(ErrorCode.FORBIDDEN, "self-service merge 缺少双重 identity 控制授权。");
  const [authorization] = await tx.select().from(userMergeAuthorizations)
    .where(eq(userMergeAuthorizations.id, input.authorizationId)).for("update");
  if (
    !authorization ||
    authorization.status !== "available" ||
    authorization.expiresAt <= new Date() ||
    authorization.initiatingUserId !== input.actorUserId ||
    new Set([authorization.initiatingUserId, authorization.counterpartyUserId]).size !== 2 ||
    !sameUserPair(
      authorization.initiatingUserId,
      authorization.counterpartyUserId,
      input.canonicalUserId,
      input.mergedUserId,
    )
  ) {
    throw new AppError(ErrorCode.FORBIDDEN, "双重 identity 控制授权无效或已过期。");
  }
  const [proof] = await tx.select({ userId: userIdentities.userId, status: userIdentities.status, verifiedAt: userIdentities.verifiedAt })
    .from(userIdentities).where(eq(userIdentities.id, authorization.provenIdentityId)).for("update");
  if (!proof || proof.userId !== authorization.counterpartyUserId || proof.status !== "active" || !proof.verifiedAt) {
    throw new AppError(ErrorCode.FORBIDDEN, "第二账号 identity 控制证明不再有效。");
  }
  return authorization.id;
}

async function mergeProfilesInTx(tx: TxDb, canonicalUserId: string, mergedUserId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE users AS canonical
    SET
      student_id = coalesce(canonical.student_id, merged.student_id),
      qq = coalesce(canonical.qq, merged.qq),
      perfect_name = coalesce(canonical.perfect_name, merged.perfect_name),
      display_name = coalesce(canonical.display_name, merged.display_name),
      steam_name = coalesce(canonical.steam_name, merged.steam_name),
      steam64 = coalesce(canonical.steam64, merged.steam64),
      steam_profile_url = coalesce(canonical.steam_profile_url, merged.steam_profile_url),
      live_stream_url = coalesce(canonical.live_stream_url, merged.live_stream_url),
      avatar_url = coalesce(canonical.avatar_url, merged.avatar_url),
      role = CASE WHEN canonical.role = 'super_admin' OR merged.role = 'super_admin' THEN 'super_admin'::user_role ELSE 'user'::user_role END,
      updated_at = now()
    FROM users AS merged
    WHERE canonical.id = ${canonicalUserId} AND merged.id = ${mergedUserId}
  `);
}

async function mergeCompetitiveFactsInTx(tx: TxDb, canonicalUserId: string, mergedUserId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE competitive_rank_facts AS winner
    SET stars = coalesce(winner.stars, loser.stars),
        achieved_season_key = coalesce(winner.achieved_season_key, loser.achieved_season_key),
        declared_at = least(winner.declared_at, loser.declared_at),
        updated_at = greatest(winner.updated_at, loser.updated_at)
    FROM competitive_rank_facts AS loser
    WHERE winner.user_id = ${canonicalUserId} AND loser.user_id = ${mergedUserId}
      AND winner.platform = loser.platform AND winner.kind = loser.kind
      AND coalesce(winner.platform_season_key, '') = coalesce(loser.platform_season_key, '')
  `);
  await tx.execute(sql`
    DELETE FROM competitive_rank_facts AS loser
    USING competitive_rank_facts AS winner
    WHERE loser.user_id = ${mergedUserId} AND winner.user_id = ${canonicalUserId}
      AND winner.platform = loser.platform AND winner.kind = loser.kind
      AND coalesce(winner.platform_season_key, '') = coalesce(loser.platform_season_key, '')
  `);
  await tx.execute(sql`UPDATE competitive_rank_facts SET user_id = ${canonicalUserId} WHERE user_id = ${mergedUserId}`);

  await tx.execute(sql`
    UPDATE user_competitive_roles AS winner
    SET is_primary = winner.is_primary OR loser.is_primary,
        updated_at = greatest(winner.updated_at, loser.updated_at)
    FROM user_competitive_roles AS loser
    WHERE winner.user_id = ${canonicalUserId} AND loser.user_id = ${mergedUserId} AND winner.role = loser.role
  `);
  await tx.execute(sql`
    DELETE FROM user_competitive_roles AS loser
    USING user_competitive_roles AS winner
    WHERE loser.user_id = ${mergedUserId} AND winner.user_id = ${canonicalUserId} AND winner.role = loser.role
  `);
  await tx.execute(sql`UPDATE user_competitive_roles SET user_id = ${canonicalUserId} WHERE user_id = ${mergedUserId}`);

  const mapRows = await tx.execute(sql`
    SELECT user_id, map_preferences FROM user_map_preferences
    WHERE user_id IN (${canonicalUserId}, ${mergedUserId}) ORDER BY user_id FOR UPDATE
  `);
  const rows = mapRows.rows as Array<{ user_id: string; map_preferences: unknown }>;
  const winner = rows.find((row) => row.user_id === canonicalUserId);
  const loser = rows.find((row) => row.user_id === mergedUserId);
  if (loser) {
    if (!winner) {
      await tx.execute(sql`UPDATE user_map_preferences SET user_id = ${canonicalUserId}, updated_at = now() WHERE user_id = ${mergedUserId}`);
    } else {
      const combined = new Map([...parseMapPreferences(winner.map_preferences), ...parseMapPreferences(loser.map_preferences)]);
      const value: MapPreference[] = [...combined].sort(([left], [right]) => left.localeCompare(right)).map(([map, level]) => ({ map, level }));
      await tx.execute(sql`UPDATE user_map_preferences SET map_preferences = ${JSON.stringify(value)}::jsonb, updated_at = now() WHERE user_id = ${canonicalUserId}`);
      await tx.execute(sql`DELETE FROM user_map_preferences WHERE user_id = ${mergedUserId}`);
    }
  }
}

async function mergeDedupeSurfacesInTx(tx: TxDb, canonicalUserId: string, mergedUserId: string): Promise<void> {
  const surfaces = [
    { table: "admin_invite_claims", key: "invite_id" },
    { table: "season_admin_grants", key: "season_id" },
    { table: "recruitment_interests", key: "recruitment_intent_id" },
    { table: "match_commentators", key: "match_id" },
  ] as const;
  for (const surface of surfaces) {
    const table = sql.raw(`"${surface.table}"`);
    const key = sql.raw(`"${surface.key}"`);
    await tx.execute(sql`
      DELETE FROM ${table} AS loser USING ${table} AS winner
      WHERE loser.user_id = ${mergedUserId} AND winner.user_id = ${canonicalUserId} AND winner.${key} = loser.${key}
    `);
    await tx.execute(sql`UPDATE ${table} SET user_id = ${canonicalUserId} WHERE user_id = ${mergedUserId}`);
  }
  await tx.execute(sql`UPDATE match_mvp_votes SET player_user_id = ${canonicalUserId} WHERE player_user_id = ${mergedUserId}`);
  await tx.execute(sql`
    DELETE FROM match_mvp_votes AS loser USING match_mvp_votes AS winner
    WHERE loser.voter_user_id = ${mergedUserId} AND winner.voter_user_id = ${canonicalUserId}
      AND winner.match_id = loser.match_id AND winner.player_user_id IS NOT DISTINCT FROM loser.player_user_id
  `);
  await tx.execute(sql`UPDATE match_mvp_votes SET voter_user_id = ${canonicalUserId} WHERE voter_user_id = ${mergedUserId}`);
}

async function mergeCompetitionEntryFactsInTx(tx: TxDb, canonicalUserId: string, mergedUserId: string): Promise<void> {
  const claimResult = await tx.execute(sql`
    DELETE FROM competition_entry_active_claims
    WHERE user_id = ${mergedUserId}
    RETURNING competition_id, entry_id, participant_id, created_at
  `);
  await tx.execute(sql`UPDATE competition_entry_participants SET user_id = ${canonicalUserId} WHERE user_id = ${mergedUserId}`);
  await tx.execute(sql`UPDATE competition_entry_roster_members SET user_id = ${canonicalUserId} WHERE user_id = ${mergedUserId}`);
  for (const row of claimResult.rows as Array<{ competition_id: string; entry_id: string; participant_id: string; created_at: Date }>) {
    await tx.execute(sql`
      INSERT INTO competition_entry_active_claims (competition_id, user_id, entry_id, participant_id, created_at)
      VALUES (${row.competition_id}, ${canonicalUserId}, ${row.entry_id}, ${row.participant_id}, ${row.created_at})
    `);
  }
}

async function mergeSpecialOwnedSurfacesInTx(tx: TxDb, canonicalUserId: string, mergedUserId: string): Promise<void> {
  await tx.execute(sql`UPDATE season_registrations SET user_id = ${canonicalUserId} WHERE user_id = ${mergedUserId}`);
  await tx.execute(sql`UPDATE recruitment_intents SET user_id = ${canonicalUserId} WHERE user_id = ${mergedUserId}`);
  await tx.execute(sql`UPDATE teams SET captain_user_id = ${canonicalUserId} WHERE captain_user_id = ${mergedUserId}`);
  await tx.execute(sql`UPDATE team_memberships SET user_id = ${canonicalUserId} WHERE user_id = ${mergedUserId}`);
  await tx.execute(sql`UPDATE team_invitations SET invited_user_id = ${canonicalUserId} WHERE invited_user_id = ${mergedUserId}`);
}

async function assertMergePostflightInTx(tx: TxDb, canonicalUserId: string, mergedUserId: string): Promise<void> {
  await assertUserReferenceRegistryCoverage(tx);
  const remainingRules = USER_REFERENCE_RULES.filter((rule) => rule.mode === "reparent" || (
    rule.mode === "special" && ![
      "identity_link_requests.user_id",
      "user_merge_authorizations.initiating_user_id",
      "user_merge_authorizations.counterparty_user_id",
      "user_merge_ledger.canonical_user_id",
      "user_merge_ledger.merged_user_id",
      "user_merge_ledger.executed_by_user_id",
    ].includes(`${rule.table}.${rule.column}`)
  ));
  const leftovers: string[] = [];
  for (const rule of remainingRules) {
    const count = await countReference(tx, rule.table, rule.column, mergedUserId);
    if (count > 0) leftovers.push(`${rule.table}.${rule.column}=${count}`);
  }
  const [alias] = await tx.select({ status: users.status, mergedIntoUserId: users.mergedIntoUserId })
    .from(users).where(eq(users.id, mergedUserId));
  const canonicalId = await resolveCanonicalUserId(tx, mergedUserId);
  if (leftovers.length > 0 || alias?.status !== "merged" || alias.mergedIntoUserId !== canonicalUserId || canonicalId !== canonicalUserId) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, `归并 postflight 失败：${leftovers.join("；") || "alias invariant"}`);
  }
}

async function updateReference(tx: TxDb, tableName: string, columnName: string, canonicalUserId: string, mergedUserId: string): Promise<void> {
  const table = sql.raw(`"${tableName}"`);
  const column = sql.raw(`"${columnName}"`);
  await tx.execute(sql`UPDATE ${table} SET ${column} = ${canonicalUserId} WHERE ${column} = ${mergedUserId}`);
}

function sameUserPair(leftA: string, leftB: string, rightA: string, rightB: string): boolean {
  return (leftA === rightA && leftB === rightB) || (leftA === rightB && leftB === rightA);
}
