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

export type UserMergeCategory = "AUTOMATIC" | "BLOCKER" | "PRESERVE";
type UserMergeItemStatus = "automatic" | "blocked" | "preserved";

interface UserMergePlanItem {
  key: string;
  category: UserMergeCategory;
  domain: string;
  count: number;
  status: UserMergeItemStatus;
  detail: string;
}

export interface UserMergeImpact {
  personFactsReparented: number;
  competitiveFactsRetired: number;
  credentialsRetained: number;
  transientFactsClosed: number;
  historicalActorFactsPreserved: number;
}

export interface UserMergePreflight {
  canonicalUserId: string;
  mergedUserId: string;
  fingerprint: string;
  executable: boolean;
  items: UserMergePlanItem[];
  summary: Record<UserMergeCategory, number>;
  impact: UserMergeImpact;
}

type RuleMode = "reparent" | "preserve" | "special" | "delete";
interface UserReferenceRule {
  table: string;
  column: string;
  domain: string;
  mode: RuleMode;
}

/** Every direct FK to users.id has an explicit owner and merge policy. */
export const USER_REFERENCE_RULES: readonly UserReferenceRule[] = [
  { table: "admin_invite_claims", column: "user_id", domain: "管理员邀请领取", mode: "special" },
  { table: "community_awards", column: "submitted_by_user_id", domain: "社区奖项提交人", mode: "preserve" },
  { table: "community_awards", column: "reviewed_by_user_id", domain: "社区奖项审核人", mode: "preserve" },
  { table: "community_awards", column: "recipient_user_id", domain: "社区奖项获奖人", mode: "reparent" },
  { table: "community_awards", column: "outcome_by_user_id", domain: "社区奖项处理人", mode: "preserve" },
  { table: "community_award_evidence", column: "submitted_by_user_id", domain: "社区奖项证据提交人", mode: "preserve" },
  { table: "community_award_evidence", column: "candidate_user_id", domain: "社区奖项候选人", mode: "reparent" },
  { table: "competition_entries", column: "representative_user_id", domain: "参赛条目代表人", mode: "reparent" },
  { table: "competition_entry_participants", column: "user_id", domain: "参赛条目参与人", mode: "special" },
  { table: "competition_entry_participants", column: "invited_by_user_id", domain: "参赛邀请发起人", mode: "preserve" },
  { table: "competition_entry_active_claims", column: "user_id", domain: "当前参赛承诺", mode: "special" },
  { table: "competition_entry_roster_members", column: "user_id", domain: "参赛名单成员", mode: "special" },
  { table: "competition_entry_representative_changes", column: "from_user_id", domain: "代表人变更历史", mode: "preserve" },
  { table: "competition_entry_representative_changes", column: "to_user_id", domain: "代表人变更历史", mode: "preserve" },
  { table: "event_roster_members", column: "user_id", domain: "赛事冻结名单成员", mode: "special" },
  { table: "competitive_rank_facts", column: "user_id", domain: "竞技段位资料", mode: "special" },
  { table: "user_competitive_roles", column: "user_id", domain: "竞技位置资料", mode: "special" },
  { table: "user_map_preferences", column: "user_id", domain: "地图熟练度资料", mode: "special" },
  { table: "disciplinary_cases", column: "subject_user_id", domain: "纪律处分对象", mode: "reparent" },
  { table: "education_verifications", column: "user_id", domain: "教育认证记录", mode: "reparent" },
  { table: "identity_link_requests", column: "user_id", domain: "身份绑定请求", mode: "delete" },
  { table: "user_identities", column: "user_id", domain: "已验证登录身份", mode: "special" },
  { table: "user_merge_authorizations", column: "initiating_user_id", domain: "归并授权发起人", mode: "preserve" },
  { table: "user_merge_authorizations", column: "counterparty_user_id", domain: "归并授权对方", mode: "preserve" },
  { table: "user_merge_ledger", column: "canonical_user_id", domain: "归并历史保留账号", mode: "preserve" },
  { table: "user_merge_ledger", column: "merged_user_id", domain: "归并历史旧账号", mode: "preserve" },
  { table: "user_merge_ledger", column: "executed_by_user_id", domain: "归并执行人", mode: "preserve" },
  { table: "match_rosters", column: "submitted_by", domain: "比赛名单提交人", mode: "preserve" },
  { table: "match_time_proposals", column: "proposed_by", domain: "比赛时间提议人", mode: "preserve" },
  { table: "match_time_proposals", column: "force_assigned_by", domain: "比赛时间强制安排人", mode: "preserve" },
  { table: "match_mvp_votes", column: "player_user_id", domain: "MVP 候选人", mode: "reparent" },
  { table: "match_mvp_votes", column: "voter_user_id", domain: "MVP 投票人", mode: "special" },
  { table: "match_player_stats", column: "user_id", domain: "比赛数据选手", mode: "special" },
  { table: "post_event_adjudications", column: "target_user_id", domain: "赛后裁定对象", mode: "reparent" },
  { table: "tournament_honors", column: "user_id", domain: "赛事荣誉获得人", mode: "reparent" },
  { table: "match_commentators", column: "user_id", domain: "比赛解说", mode: "special" },
  { table: "match_commentators", column: "added_by_user_id", domain: "解说安排人", mode: "preserve" },
  { table: "post_match_reports", column: "submitted_by_user_id", domain: "赛后报告提交人", mode: "preserve" },
  { table: "recruitment_intents", column: "user_id", domain: "当前招募意向", mode: "special" },
  { table: "recruitment_interests", column: "user_id", domain: "招募兴趣", mode: "special" },
  { table: "season_registrations", column: "user_id", domain: "赛季报名", mode: "special" },
  { table: "season_admin_grants", column: "user_id", domain: "赛季管理员权限", mode: "special" },
  { table: "season_admin_grants", column: "granted_by_user_id", domain: "权限授予人", mode: "preserve" },
  { table: "teams", column: "creator_user_id", domain: "队伍创建人", mode: "preserve" },
  { table: "teams", column: "captain_user_id", domain: "当前队长", mode: "special" },
  { table: "team_memberships", column: "user_id", domain: "队伍成员关系", mode: "special" },
  { table: "team_memberships", column: "invited_by_user_id", domain: "队伍邀请发起人", mode: "preserve" },
  { table: "team_captain_changes", column: "from_user_id", domain: "队长变更历史", mode: "preserve" },
  { table: "team_captain_changes", column: "to_user_id", domain: "队长变更历史", mode: "preserve" },
  { table: "team_invitations", column: "invited_user_id", domain: "队伍邀请对象", mode: "special" },
  { table: "team_invitations", column: "invited_by_user_id", domain: "队伍邀请发起人", mode: "preserve" },
  { table: "team_invitations", column: "responded_by_user_id", domain: "队伍邀请处理人", mode: "preserve" },
  { table: "user_sessions", column: "user_id", domain: "登录会话", mode: "delete" },
  { table: "users", column: "merged_into_user_id", domain: "旧账号别名", mode: "preserve" },
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

type CollisionFacts = Record<string, number>;

export async function buildUserMergePreflight(
  queryable: MergeQueryable,
  input: { canonicalUserId: string; mergedUserId: string },
  options: { evidenceClass?: ExecuteUserMergeInput["evidenceClass"] } = {},
): Promise<UserMergePreflight> {
  if (input.canonicalUserId === input.mergedUserId) throw new AppError(ErrorCode.VALIDATION_FAILED, "保留账号与待归并账号不能相同。");
  await assertUserReferenceRegistryCoverage(queryable);
  const pairResult = await queryable.execute(sql`
    SELECT id, status, role, steam64
    FROM users
    WHERE id IN (${input.canonicalUserId}, ${input.mergedUserId})
    ORDER BY id
  `);
  const pair = pairResult.rows as Array<{ id: string; status: string; role: string; steam64: string | null }>;
  const canonical = pair.find((row) => row.id === input.canonicalUserId);
  const merged = pair.find((row) => row.id === input.mergedUserId);
  if (!canonical || !merged) throw new AppError(ErrorCode.NOT_FOUND, "归并候选账号不存在。");
  if (canonical.status !== "active" || merged.status !== "active") throw new AppError(ErrorCode.VALIDATION_FAILED, "归并双方都必须是 active 账号。");

  const facts = await loadCollisionFacts(queryable, input);
  const items: UserMergePlanItem[] = [
    item("profile:canonical", "PRESERVE", "保留账号资料", 1, "preserved", "只保留你选中的账号资料；不会用待归并账号覆盖它。"),
  ];
  const evidenceClass = options.evidenceClass ?? "dual_identity_control";

  if (evidenceClass === "dual_identity_control" && (canonical.role === "super_admin" || merged.role === "super_admin")) {
    items.push(item("authorization:super-admin-pair", "BLOCKER", "高权限账号", 1, "blocked", "高权限账号不能使用自助归并，请由另一名超级管理员进行人工审核。"));
  }
  const canonicalSteam = canonical.steam64?.trim() || null;
  const mergedSteam = merged.steam64?.trim() || null;
  if (canonicalSteam && mergedSteam && canonicalSteam !== mergedSteam) {
    items.push(item(
      "profile:steam64-conflict",
      evidenceClass === "dual_identity_control" ? "BLOCKER" : "PRESERVE",
      "Steam 身份",
      1,
      evidenceClass === "dual_identity_control" ? "blocked" : "preserved",
      evidenceClass === "dual_identity_control" ? "两个账号绑定了不同的 Steam64，无法由自助流程替你判断。" : "人工审核保留所选账号的 Steam64，不自动覆盖。",
    ));
  }

  for (const rule of USER_REFERENCE_RULES) {
    if (rule.mode === "special") continue;
    const count = await countReference(queryable, rule.table, rule.column, input.mergedUserId);
    if (!count) continue;
    items.push(item(
      `reference:${rule.table}.${rule.column}`,
      rule.mode === "preserve" ? "PRESERVE" : rule.mode === "delete" ? "AUTOMATIC" : "AUTOMATIC",
      rule.domain,
      count,
      rule.mode === "preserve" ? "preserved" : "automatic",
      rule.mode === "preserve" ? "保留原始执行人和历史来源，不把 actor provenance 改写成保留账号。" : rule.mode === "delete" ? "归并时关闭或删除临时状态。" : "安全的个人事实归到保留账号。",
    ));
  }

  pushCount(items, "identity:credentials", "AUTOMATIC", "已验证登录身份", facts.identity_rows, "automatic", "保留所有非重复 credential，并作为保留账号的 secondary identity。重复 credential 留存为 retired 记录。 ");
  pushCount(items, "competitive:loser-profile", "AUTOMATIC", "待归并竞技资料", facts.competitive_rows, "automatic", "删除待归并账号的段位、位置和地图资料；保留账号的竞技资料完全不变。 ");
  pushCount(items, "team:same-team-dedupe", "AUTOMATIC", "同队重复成员关系", facts.same_team_membership_duplicate, "automatic", "同一队伍重叠成员关系按保留账号优先确定性去重。 ");
  pushCount(items, "registration:same-season", "AUTOMATIC", "同赛季报名", facts.registration_same_season, "automatic", "同赛季报名由保留账号优先；不会因为这一项阻断归并。 ");
  pushCount(items, "registration:approved-migrate", "AUTOMATIC", "已批准报名迁移", facts.registration_approved_migrate, "automatic", "待归并账号独有且已批准的报名迁移到保留账号。 ");
  pushCount(items, "competition:participant-dedupe", "AUTOMATIC", "参赛条目重复参与人", facts.participant_duplicate, "automatic", "未形成确认承诺的重复参与人按保留账号优先去重。 ");
  pushCount(items, "competition:claim-union", "AUTOMATIC", "当前参赛承诺", facts.claim_union, "automatic", "不冲突的当前参赛承诺取并集；同一条目只保留一份。 ");
  pushCount(items, "competition:roster-dedupe", "AUTOMATIC", "可编辑参赛名单", facts.roster_duplicate, "automatic", "可编辑名单中的重复成员按保留账号优先去重。 ");
  pushCount(items, "competition:event-roster", "AUTOMATIC", "赛事正式名单", facts.frozen_event_rows, "automatic", "在没有重复成员冲突时，将自然人的名单归到保留账号，同时保留原有名单和比赛阵容事实。 ");
  pushCount(items, "stats:deterministic-dedupe", "AUTOMATIC", "同图比赛数据", facts.stats_duplicate, "automatic", "非冲突比赛数据按保留账号优先确定性去重；仅待归并账号有数据时迁移。 ");
  pushCount(items, "honors:deterministic-dedupe", "AUTOMATIC", "重复荣誉槽位", facts.honor_duplicate, "automatic", "同一荣誉槽位保留 A 侧记录，B 侧记录标记为重复撤销后归到保留账号，完整保留审计链。 ");
  pushCount(items, "mvp:reparent", "AUTOMATIC", "MVP 结果与投票", facts.mvp_rows, "automatic", "MVP 选手引用归到保留账号；投票冲突由保留账号的投票优先，不阻断归并。 ");
  pushCount(items, "authorization:claims-union", "AUTOMATIC", "权限领取与赛季权限", facts.admin_claim_union + facts.grant_union, "automatic", "不冲突的管理员领取和赛季权限取并集并去重。 ");
  pushCount(items, "transient:close", "AUTOMATIC", "临时状态", facts.transient_rows, "automatic", "招募意向关闭，待处理邀请和身份请求取消，会话失效。 ");
  pushCount(items, "history:actor-preserved", "PRESERVE", "历史执行人", facts.preserved_actor_rows, "preserved", "历史 actor、审核人和冻结事实继续指向原始账号。 ");

  const blockers: Array<[keyof CollisionFacts, string, string]> = [
    ["team_current_conflict", "team:current-conflict", "两个账号当前属于不同队伍，不能自动选择当前队伍。"],
    ["team_membership_overlap", "team:history-overlap", "两个账号在不同队伍的历史成员时间区间重叠，必须先人工核对。"],
    ["active_captaincy_conflict", "team:captaincy-conflict", "两个账号分别担任不同 active 队伍队长，不能自动选择。"],
    ["competition_commitment_conflict", "competition:confirmed-different-entry", "两个账号在同一赛事形成了不同参赛条目的确认承诺。"],
    ["competition_roster_conflict", "competition:approved-or-frozen-duplicate", "已批准或已确认/冻结名单中出现无法确定归属的重复成员。"],
    ["stats_conflict", "stats:formal-conflict", "同一场比赛同一张地图存在两份正式比赛数据，不能自动选择其中一份。"],
  ];
  for (const [field, key, detail] of blockers) pushCount(items, key, "BLOCKER", key.split(":")[0]!, facts[field], "blocked", detail);

  items.sort((left, right) => left.category.localeCompare(right.category) || left.key.localeCompare(right.key));
  const summary = emptySummary();
  for (const planItem of items) summary[planItem.category] += planItem.count;
  const snapshotHash = await loadSnapshotHash(queryable, input);
  const fingerprint = createHash("sha256").update(JSON.stringify({ input, evidenceClass, snapshotHash, items })).digest("hex");
  const personFactsReparented = items.filter((entry) => entry.key.startsWith("reference:") && entry.category === "AUTOMATIC")
    .reduce((sum, entry) => sum + entry.count, 0);
  return {
    ...input,
    fingerprint,
    executable: !items.some((entry) => entry.status === "blocked"),
    items,
    summary,
    impact: {
      personFactsReparented,
      competitiveFactsRetired: facts.competitive_rows,
      credentialsRetained: facts.identity_rows,
      transientFactsClosed: facts.transient_rows,
      historicalActorFactsPreserved: facts.preserved_actor_rows,
    },
  };
}

async function loadCollisionFacts(queryable: MergeQueryable, input: { canonicalUserId: string; mergedUserId: string }): Promise<CollisionFacts> {
  const result = await queryable.execute(sql`
    SELECT
      (SELECT count(*)::int FROM user_identities WHERE user_id = ${input.mergedUserId}) AS identity_rows,
      (SELECT count(*)::int FROM competitive_rank_facts WHERE user_id = ${input.mergedUserId})
        + (SELECT count(*)::int FROM user_competitive_roles WHERE user_id = ${input.mergedUserId})
        + (SELECT count(*)::int FROM user_map_preferences WHERE user_id = ${input.mergedUserId}) AS competitive_rows,
      (SELECT count(*)::int FROM team_memberships b JOIN team_memberships a ON a.user_id = ${input.canonicalUserId} AND a.team_id = b.team_id
        AND tstzrange(a.started_at, coalesce(a.ended_at, 'infinity'::timestamptz), '[)') && tstzrange(b.started_at, coalesce(b.ended_at, 'infinity'::timestamptz), '[)')
        WHERE b.user_id = ${input.mergedUserId}) AS same_team_membership_duplicate,
      (SELECT count(*)::int FROM team_memberships b JOIN team_memberships a ON a.user_id = ${input.canonicalUserId}
        AND a.team_id <> b.team_id AND b.ended_at IS NULL AND a.ended_at IS NULL WHERE b.user_id = ${input.mergedUserId}) AS team_current_conflict,
      (SELECT count(*)::int FROM team_memberships b JOIN team_memberships a ON a.user_id = ${input.canonicalUserId} AND a.team_id <> b.team_id
        AND tstzrange(a.started_at, coalesce(a.ended_at, 'infinity'::timestamptz), '[)') && tstzrange(b.started_at, coalesce(b.ended_at, 'infinity'::timestamptz), '[)')
        WHERE b.user_id = ${input.mergedUserId}) AS team_membership_overlap,
      (SELECT count(*)::int FROM teams b JOIN teams a ON a.captain_user_id = ${input.canonicalUserId} AND a.id <> b.id AND a.status = 'active' AND b.status = 'active'
        WHERE b.captain_user_id = ${input.mergedUserId}) AS active_captaincy_conflict,
      (SELECT count(*)::int FROM season_registrations b JOIN season_registrations a ON a.user_id = ${input.canonicalUserId} AND a.season_id = b.season_id
        WHERE b.user_id = ${input.mergedUserId}) AS registration_same_season,
      (SELECT count(*)::int FROM season_registrations b WHERE b.user_id = ${input.mergedUserId} AND b.status = 'approved'
        AND NOT EXISTS (SELECT 1 FROM season_registrations a WHERE a.user_id = ${input.canonicalUserId} AND a.season_id = b.season_id)) AS registration_approved_migrate,
      (SELECT count(*)::int FROM competition_entry_participants b JOIN competition_entry_participants a ON a.user_id = ${input.canonicalUserId} AND a.entry_id = b.entry_id
        WHERE b.user_id = ${input.mergedUserId}) AS participant_duplicate,
      (SELECT count(*)::int FROM competition_entry_active_claims b JOIN competition_entry_active_claims a ON a.user_id = ${input.canonicalUserId} AND a.competition_id = b.competition_id
        WHERE b.user_id = ${input.mergedUserId}) AS claim_union,
      (SELECT count(*)::int FROM competition_entry_roster_members b JOIN competition_entry_roster_members a ON a.user_id = ${input.canonicalUserId} AND a.revision_id = b.revision_id
        WHERE b.user_id = ${input.mergedUserId}) AS roster_duplicate,
      (SELECT count(*)::int FROM event_roster_members m JOIN event_rosters r ON r.id = m.event_roster_id
        WHERE m.user_id = ${input.mergedUserId} AND r.status = 'frozen') AS frozen_event_rows,
      (SELECT count(*)::int FROM match_player_stats b JOIN match_player_stats a ON a.user_id = ${input.canonicalUserId} AND a.map_id = b.map_id
        WHERE b.user_id = ${input.mergedUserId}) AS stats_duplicate,
      (SELECT count(*)::int FROM match_player_stats b JOIN match_player_stats a ON a.user_id = ${input.canonicalUserId} AND a.map_id = b.map_id
        WHERE b.user_id = ${input.mergedUserId}
          AND (a.verified_by_admin IS NOT NULL OR a.verified_at IS NOT NULL)
          AND (b.verified_by_admin IS NOT NULL OR b.verified_at IS NOT NULL)) AS stats_conflict,
      (SELECT count(*)::int FROM tournament_honors b JOIN tournament_honors a ON a.user_id = ${input.canonicalUserId} AND a.season_id = b.season_id AND a.honor_key = b.honor_key AND a.state = 'valid'
        WHERE b.user_id = ${input.mergedUserId} AND b.state = 'valid') AS honor_duplicate,
      (SELECT count(*)::int FROM matches WHERE mvp_winner_user_id = ${input.mergedUserId})
        + (SELECT count(*)::int FROM match_mvp_votes WHERE voter_user_id = ${input.mergedUserId} OR player_user_id = ${input.mergedUserId}) AS mvp_rows,
      (SELECT count(*)::int FROM admin_invite_claims WHERE user_id = ${input.mergedUserId}) AS admin_claim_union,
      (SELECT count(*)::int FROM season_admin_grants WHERE user_id = ${input.mergedUserId}) AS grant_union,
      (SELECT count(*)::int FROM recruitment_intents WHERE user_id = ${input.mergedUserId})
        + (SELECT count(*)::int FROM recruitment_interests WHERE user_id = ${input.mergedUserId})
        + (SELECT count(*)::int FROM team_invitations WHERE invited_user_id = ${input.mergedUserId} AND status = 'pending')
        + (SELECT count(*)::int FROM identity_link_requests WHERE user_id = ${input.mergedUserId} AND status = 'pending')
        + (SELECT count(*)::int FROM user_sessions WHERE user_id = ${input.mergedUserId}) AS transient_rows,
      (SELECT count(*)::int FROM community_awards WHERE submitted_by_user_id = ${input.mergedUserId} OR reviewed_by_user_id = ${input.mergedUserId} OR outcome_by_user_id = ${input.mergedUserId})
        + (SELECT count(*)::int FROM community_award_evidence WHERE submitted_by_user_id = ${input.mergedUserId})
        + (SELECT count(*)::int FROM competition_entry_participants WHERE invited_by_user_id = ${input.mergedUserId})
        + (SELECT count(*)::int FROM competition_entry_representative_changes WHERE from_user_id = ${input.mergedUserId} OR to_user_id = ${input.mergedUserId})
        + (SELECT count(*)::int FROM match_commentators WHERE added_by_user_id = ${input.mergedUserId})
        + (SELECT count(*)::int FROM post_match_reports WHERE submitted_by_user_id = ${input.mergedUserId})
        + (SELECT count(*)::int FROM season_admin_grants WHERE granted_by_user_id = ${input.mergedUserId})
        + (SELECT count(*)::int FROM team_memberships WHERE invited_by_user_id = ${input.mergedUserId})
        + (SELECT count(*)::int FROM team_invitations WHERE invited_by_user_id = ${input.mergedUserId} OR responded_by_user_id = ${input.mergedUserId}) AS preserved_actor_rows,
      (SELECT count(*)::int FROM competition_entry_active_claims b JOIN competition_entry_active_claims a ON a.user_id = ${input.canonicalUserId} AND a.competition_id = b.competition_id
        WHERE b.user_id = ${input.mergedUserId} AND a.entry_id <> b.entry_id)
        + (SELECT count(*)::int FROM competition_entry_participants b JOIN competition_entries eb ON eb.id = b.entry_id JOIN competition_entry_participants a ON a.user_id = ${input.canonicalUserId} AND a.status = 'confirmed' JOIN competition_entries ea ON ea.id = a.entry_id AND ea.competition_id = eb.competition_id
        WHERE b.user_id = ${input.mergedUserId} AND b.status = 'confirmed' AND ea.id <> eb.id)
        + (SELECT count(*)::int FROM event_roster_members b JOIN event_rosters rb ON rb.id = b.event_roster_id JOIN competition_entries eb ON eb.id = rb.entry_id JOIN event_roster_members a ON a.user_id = ${input.canonicalUserId} JOIN event_rosters ra ON ra.id = a.event_roster_id AND ra.status IN ('confirmed', 'frozen') JOIN competition_entries ea ON ea.id = ra.entry_id AND ea.competition_id = eb.competition_id
        WHERE b.user_id = ${input.mergedUserId} AND rb.status IN ('confirmed', 'frozen') AND ea.id <> eb.id) AS competition_commitment_conflict,
      (SELECT count(*)::int FROM competition_entry_participants b JOIN competition_entry_participants a ON a.user_id = ${input.canonicalUserId} AND a.entry_id = b.entry_id JOIN competition_entries e ON e.id = b.entry_id
        WHERE b.user_id = ${input.mergedUserId} AND (e.registration_status = 'approved' OR EXISTS (SELECT 1 FROM competition_entry_roster_members rb JOIN competition_entry_roster_revisions rr ON rr.id = rb.revision_id JOIN competition_entry_roster_members ra ON ra.user_id = ${input.canonicalUserId} AND ra.revision_id = rb.revision_id WHERE rb.user_id = ${input.mergedUserId} AND rr.status = 'approved') OR EXISTS (SELECT 1 FROM event_roster_members eb JOIN event_rosters er ON er.id = eb.event_roster_id JOIN event_roster_members ea ON ea.user_id = ${input.canonicalUserId} AND ea.event_roster_id = eb.event_roster_id WHERE eb.user_id = ${input.mergedUserId} AND er.status IN ('confirmed', 'frozen'))))
        + (SELECT count(*)::int FROM event_roster_members b JOIN event_roster_members a ON a.user_id = ${input.canonicalUserId} AND a.event_roster_id = b.event_roster_id JOIN event_rosters r ON r.id = b.event_roster_id WHERE b.user_id = ${input.mergedUserId} AND r.status IN ('confirmed', 'frozen')) AS competition_roster_conflict
  `);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return new Proxy({}, { get: (_target, property: string) => integer(row?.[property]) }) as CollisionFacts;
}

async function loadSnapshotHash(queryable: MergeQueryable, input: { canonicalUserId: string; mergedUserId: string }): Promise<string> {
  const result = await queryable.execute(sql`
    WITH snapshot AS (
      SELECT 'users' AS source, id::text AS item_key, row_to_json(u)::text AS item_value FROM users u WHERE id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'admin_invite_claims', invite_id::text || ':' || user_id::text, row_to_json(c)::text FROM admin_invite_claims c WHERE user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'community_awards', id::text, row_to_json(a)::text FROM community_awards a WHERE submitted_by_user_id IN (${input.canonicalUserId}, ${input.mergedUserId}) OR reviewed_by_user_id IN (${input.canonicalUserId}, ${input.mergedUserId}) OR recipient_user_id IN (${input.canonicalUserId}, ${input.mergedUserId}) OR outcome_by_user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'community_award_evidence', id::text, row_to_json(e)::text FROM community_award_evidence e WHERE submitted_by_user_id IN (${input.canonicalUserId}, ${input.mergedUserId}) OR candidate_user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'entries', id::text, row_to_json(e)::text FROM competition_entries e WHERE representative_user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'identities', id::text, row_to_json(i)::text FROM user_identities i WHERE user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'participants', id::text, row_to_json(p)::text FROM competition_entry_participants p WHERE user_id IN (${input.canonicalUserId}, ${input.mergedUserId}) OR invited_by_user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'claims', competition_id::text || ':' || user_id::text, row_to_json(c)::text FROM competition_entry_active_claims c WHERE user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'roster_members', id::text, row_to_json(rm)::text FROM competition_entry_roster_members rm WHERE user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'representative_changes', id::text, row_to_json(c)::text FROM competition_entry_representative_changes c WHERE from_user_id IN (${input.canonicalUserId}, ${input.mergedUserId}) OR to_user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'registrations', id::text, row_to_json(r)::text FROM season_registrations r WHERE user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'memberships', id::text, row_to_json(m)::text FROM team_memberships m WHERE user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'event_members', id::text, row_to_json(em)::text FROM event_roster_members em WHERE user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'education', id::text, row_to_json(e)::text FROM education_verifications e WHERE user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'discipline', id::text, row_to_json(d)::text FROM disciplinary_cases d WHERE subject_user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'adjudications', id::text, row_to_json(a)::text FROM post_event_adjudications a WHERE target_user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'stats', id::text, row_to_json(s)::text FROM match_player_stats s WHERE user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'honors', id::text, row_to_json(h)::text FROM tournament_honors h WHERE user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'votes', id::text, row_to_json(v)::text FROM match_mvp_votes v WHERE voter_user_id IN (${input.canonicalUserId}, ${input.mergedUserId}) OR player_user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'mvp', id::text, row_to_json(m)::text FROM matches m WHERE mvp_winner_user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'match_rosters', id::text, row_to_json(r)::text FROM match_rosters r WHERE submitted_by IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'match_time_proposals', id::text, row_to_json(p)::text FROM match_time_proposals p WHERE proposed_by IN (${input.canonicalUserId}, ${input.mergedUserId}) OR force_assigned_by IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'commentators', match_id::text || ':' || user_id::text, row_to_json(c)::text FROM match_commentators c WHERE user_id IN (${input.canonicalUserId}, ${input.mergedUserId}) OR added_by_user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'reports', match_id::text, row_to_json(r)::text FROM post_match_reports r WHERE submitted_by_user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'recruitment_intents', id::text, row_to_json(i)::text FROM recruitment_intents i WHERE user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'recruitment_interests', id::text, row_to_json(i)::text FROM recruitment_interests i WHERE user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'season_grants', season_id::text || ':' || user_id::text, row_to_json(g)::text FROM season_admin_grants g WHERE user_id IN (${input.canonicalUserId}, ${input.mergedUserId}) OR granted_by_user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'teams', id::text, row_to_json(t)::text FROM teams t WHERE creator_user_id IN (${input.canonicalUserId}, ${input.mergedUserId}) OR captain_user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'rank', id::text, row_to_json(r)::text FROM competitive_rank_facts r WHERE user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'roles', id::text, row_to_json(r)::text FROM user_competitive_roles r WHERE user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'maps', user_id::text, row_to_json(m)::text FROM user_map_preferences m WHERE user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'captain_changes', id::text, row_to_json(c)::text FROM team_captain_changes c WHERE from_user_id IN (${input.canonicalUserId}, ${input.mergedUserId}) OR to_user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'team_memberships_as_actor', id::text, row_to_json(m)::text FROM team_memberships m WHERE invited_by_user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'team_invitations', id::text, row_to_json(i)::text FROM team_invitations i WHERE invited_user_id IN (${input.canonicalUserId}, ${input.mergedUserId}) OR invited_by_user_id IN (${input.canonicalUserId}, ${input.mergedUserId}) OR responded_by_user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'sessions', user_id::text, row_to_json(s)::text FROM user_sessions s WHERE user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'identity_link_requests', id::text, row_to_json(r)::text FROM identity_link_requests r WHERE user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'merge_authorizations', id::text, row_to_json(a)::text FROM user_merge_authorizations a WHERE initiating_user_id IN (${input.canonicalUserId}, ${input.mergedUserId}) OR counterparty_user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
      UNION ALL SELECT 'merge_ledger', id::text, row_to_json(l)::text FROM user_merge_ledger l WHERE canonical_user_id IN (${input.canonicalUserId}, ${input.mergedUserId}) OR merged_user_id IN (${input.canonicalUserId}, ${input.mergedUserId}) OR executed_by_user_id IN (${input.canonicalUserId}, ${input.mergedUserId})
    )
    SELECT md5(coalesce(string_agg(source || ':' || item_key || ':' || item_value, '|' ORDER BY source, item_key, item_value), '')) AS snapshot_hash FROM snapshot
  `);
  return String((result.rows[0] as { snapshot_hash?: unknown } | undefined)?.snapshot_hash ?? "");
}

function item(key: string, category: UserMergeCategory, domain: string, count: number, status: UserMergeItemStatus, detail: string): UserMergePlanItem {
  return { key, category, domain, count, status, detail };
}

function pushCount(items: UserMergePlanItem[], key: string, category: UserMergeCategory, domain: string, count: number, status: UserMergeItemStatus, detail: string): void {
  if (count > 0) items.push(item(key, category, domain, count, status, detail));
}

async function countReference(queryable: MergeQueryable, table: string, column: string, userId: string): Promise<number> {
  const result = await queryable.execute(sql`SELECT count(*)::int AS count FROM ${sql.raw(`"${table}"`)} WHERE ${sql.raw(`"${column}"`)} = ${userId}`);
  return integer((result.rows[0] as Record<string, unknown> | undefined)?.count);
}

function integer(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function emptySummary(): Record<UserMergeCategory, number> {
  return { AUTOMATIC: 0, BLOCKER: 0, PRESERVE: 0 };
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
  const locked = await tx.select({ id: users.id }).from(users).where(inArray(users.id, [input.canonicalUserId, input.mergedUserId].sort())).orderBy(users.id).for("update");
  if (locked.length !== 2) throw new AppError(ErrorCode.NOT_FOUND, "归并候选账号不存在。");
  const preflight = await buildUserMergePreflight(tx, input, { evidenceClass: input.evidenceClass });
  if (preflight.fingerprint !== input.expectedFingerprint) throw new AppError(ErrorCode.VALIDATION_FAILED, "归并事实已变化，请重新查看并确认。");
  if (!preflight.executable) throw new AppError(ErrorCode.VALIDATION_FAILED, "存在未解决冲突，系统拒绝执行归并。");
  const authorizationId = await verifyMergeAuthorityInTx(tx, input);

  await mergeTeamFactsInTx(tx, input.canonicalUserId, input.mergedUserId);
  await mergeSeasonRegistrationsInTx(tx, input.canonicalUserId, input.mergedUserId);
  await tx.execute(sql`SET LOCAL rivalhub.identity_merge_reparent = 'on'`);
  await mergeCompetitionFactsInTx(tx, input.canonicalUserId, input.mergedUserId);
  await mergeCompetitiveFactsInTx(tx, input.canonicalUserId, input.mergedUserId);
  await mergeMatchStatsInTx(tx, input.canonicalUserId, input.mergedUserId);
  await mergeHonorFactsInTx(tx, input.canonicalUserId, input.mergedUserId);
  await mergeMvpFactsInTx(tx, input.canonicalUserId, input.mergedUserId);
  await mergeUnionFactsInTx(tx, input.canonicalUserId, input.mergedUserId);
  await closeTransientFactsInTx(tx, input.canonicalUserId, input.mergedUserId);
  await mergeIdentitiesInTx(tx, input.canonicalUserId, input.mergedUserId);
  for (const rule of USER_REFERENCE_RULES.filter((entry) => entry.mode === "reparent" && !["match_player_stats.user_id", "match_mvp_votes.player_user_id", "tournament_honors.user_id"].includes(`${entry.table}.${entry.column}`))) {
    await updateReference(tx, rule.table, rule.column, input.canonicalUserId, input.mergedUserId);
  }

  const now = new Date();
  await tx.update(userMergeAuthorizations).set({ status: "cancelled", consumedAt: now }).where(and(
    eq(userMergeAuthorizations.status, "available"),
    sql`(${userMergeAuthorizations.initiatingUserId} = ${input.mergedUserId} OR ${userMergeAuthorizations.counterpartyUserId} = ${input.mergedUserId})`,
    authorizationId ? sql`${userMergeAuthorizations.id} <> ${authorizationId}` : sql`true`,
  ));
  if (authorizationId) await tx.update(userMergeAuthorizations).set({ status: "consumed", consumedAt: now }).where(eq(userMergeAuthorizations.id, authorizationId));
  await tx.update(users).set({ status: "merged", mergedIntoUserId: input.canonicalUserId, mergedAt: now, authId: null, role: "user", updatedAt: now }).where(eq(users.id, input.mergedUserId));
  await tx.insert(userMergeLedger).values({
    canonicalUserId: input.canonicalUserId,
    mergedUserId: input.mergedUserId,
    executedByUserId: input.actorUserId,
    evidenceClass: input.evidenceClass,
    reason: input.reason.trim(),
    planFingerprint: preflight.fingerprint,
    authorizationId,
    domainSummary: { ...preflight.summary, ...preflight.impact },
    mergedAt: now,
  });
  await tx.insert(auditLogs).values({ action: "user_identity.merge", actorId: input.actorUserId, targetId: input.canonicalUserId, targetType: "user", meta: { mergedUserId: input.mergedUserId, evidenceClass: input.evidenceClass, planFingerprint: preflight.fingerprint, summary: preflight.summary } });
  await assertMergePostflightInTx(tx, input.canonicalUserId, input.mergedUserId);
  return preflight;
}

async function verifyMergeAuthorityInTx(tx: TxDb, input: ExecuteUserMergeInput): Promise<string | undefined> {
  if (!input.reason.trim()) throw new AppError(ErrorCode.VALIDATION_FAILED, "归并原因不能为空。");
  if (input.evidenceClass === "super_admin_review") {
    const [actor] = await tx.select({ role: users.role, status: users.status }).from(users).where(eq(users.id, input.actorUserId)).for("update");
    if (!actor || actor.status !== "active" || actor.role !== "super_admin") throw new AppError(ErrorCode.FORBIDDEN, "只有超级管理员可以执行人工归并。");
    return undefined;
  }
  if (!input.authorizationId) throw new AppError(ErrorCode.FORBIDDEN, "自助归并缺少双方身份控制授权。");
  const [authorization] = await tx.select().from(userMergeAuthorizations).where(eq(userMergeAuthorizations.id, input.authorizationId)).for("update");
  if (!authorization || authorization.status !== "available" || authorization.expiresAt <= new Date() || authorization.initiatingUserId !== input.actorUserId || !sameUserPair(authorization.initiatingUserId, authorization.counterpartyUserId, input.canonicalUserId, input.mergedUserId)) throw new AppError(ErrorCode.FORBIDDEN, "双方身份控制授权无效或已过期。");
  const [proof] = await tx.select({ userId: userIdentities.userId, status: userIdentities.status, verifiedAt: userIdentities.verifiedAt }).from(userIdentities).where(eq(userIdentities.id, authorization.provenIdentityId)).for("update");
  if (!proof || proof.userId !== authorization.counterpartyUserId || proof.status !== "active" || !proof.verifiedAt) throw new AppError(ErrorCode.FORBIDDEN, "第二账号的身份控制证明不再有效。");
  return authorization.id;
}

async function mergeTeamFactsInTx(tx: TxDb, canonicalUserId: string, mergedUserId: string): Promise<void> {
  const mergedRows = await tx.execute(sql`SELECT id, team_id, started_at, ended_at FROM team_memberships WHERE user_id = ${mergedUserId} ORDER BY started_at, id`);
  for (const row of mergedRows.rows as Array<{ id: string; team_id: string; started_at: Date; ended_at: Date | null }>) {
    const [duplicate] = (await tx.execute(sql`SELECT id FROM team_memberships WHERE user_id = ${canonicalUserId} AND team_id = ${row.team_id} AND tstzrange(started_at, coalesce(ended_at, 'infinity'::timestamptz), '[)') && tstzrange(${row.started_at}, coalesce(${row.ended_at}, 'infinity'::timestamptz), '[)') ORDER BY started_at, id LIMIT 1`)).rows as Array<{ id: string }>;
    if (duplicate) {
      await tx.execute(sql`UPDATE competition_entry_roster_members SET team_membership_id = ${duplicate.id} WHERE team_membership_id = ${row.id}`);
      await tx.execute(sql`DELETE FROM team_memberships WHERE id = ${row.id}`);
    } else await tx.execute(sql`UPDATE team_memberships SET user_id = ${canonicalUserId} WHERE id = ${row.id}`);
  }
  const captainTeams = (await tx.execute(sql`SELECT id FROM teams WHERE captain_user_id = ${mergedUserId} ORDER BY id`)).rows as Array<{ id: string }>;
  for (const team of captainTeams) {
    await tx.execute(sql`
      INSERT INTO team_captain_changes (team_id, from_user_id, to_user_id, changed_at, changed_by_actor_id)
      VALUES (
        ${team.id},
        ${mergedUserId},
        ${canonicalUserId},
        (SELECT coalesce(max(changed_at), now()) + interval '1 microsecond' FROM team_captain_changes WHERE team_id = ${team.id}),
        'identity-merge'
      )
    `);
    await tx.execute(sql`UPDATE teams SET captain_user_id = ${canonicalUserId}, updated_at = now() WHERE id = ${team.id}`);
  }
}

async function mergeSeasonRegistrationsInTx(tx: TxDb, canonicalUserId: string, mergedUserId: string): Promise<void> {
  const bRows = (await tx.execute(sql`SELECT id, season_id, status FROM season_registrations WHERE user_id = ${mergedUserId} ORDER BY created_at, id`)).rows as Array<{ id: string; season_id: string; status: string }>;
  for (const row of bRows) {
    const [winner] = (await tx.execute(sql`SELECT id FROM season_registrations WHERE user_id = ${canonicalUserId} AND season_id = ${row.season_id} LIMIT 1`)).rows as Array<{ id: string }>;
    if (winner) await tx.execute(sql`UPDATE competition_entries SET source_registration_id = ${winner.id} WHERE source_registration_id = ${row.id}`);
    else if (row.status === "approved") await tx.execute(sql`UPDATE season_registrations SET user_id = ${canonicalUserId}, updated_at = now() WHERE id = ${row.id}`);
    else await tx.execute(sql`UPDATE competition_entries SET source_registration_id = NULL WHERE source_registration_id = ${row.id}`);
    if (winner || row.status !== "approved") await tx.execute(sql`DELETE FROM season_registrations WHERE id = ${row.id}`);
  }
}

async function mergeCompetitionFactsInTx(tx: TxDb, canonicalUserId: string, mergedUserId: string): Promise<void> {
  const claims = (await tx.execute(sql`SELECT competition_id, entry_id, participant_id, created_at FROM competition_entry_active_claims WHERE user_id = ${mergedUserId} ORDER BY competition_id`)).rows as Array<{ competition_id: string; entry_id: string; participant_id: string; created_at: Date }>;
  await tx.execute(sql`DELETE FROM competition_entry_active_claims WHERE user_id = ${mergedUserId}`);
  const bParticipants = (await tx.execute(sql`SELECT id, entry_id FROM competition_entry_participants WHERE user_id = ${mergedUserId} ORDER BY id`)).rows as Array<{ id: string; entry_id: string }>;
  const aParticipants = (await tx.execute(sql`SELECT id, entry_id FROM competition_entry_participants WHERE user_id = ${canonicalUserId} ORDER BY id`)).rows as Array<{ id: string; entry_id: string }>;
  const participantMap = new Map<string, string>();
  for (const row of bParticipants) participantMap.set(row.id, aParticipants.find((candidate) => candidate.entry_id === row.entry_id)?.id ?? row.id);

  // Update B-only participants before their roster rows so every aggregate
  // trigger observes the same person on participant and roster records.
  for (const row of bParticipants) {
    if ((participantMap.get(row.id) ?? row.id) === row.id) {
      await tx.execute(sql`UPDATE competition_entry_participants SET user_id = ${canonicalUserId}, updated_at = now() WHERE id = ${row.id}`);
    }
  }

  const rosterRows = (await tx.execute(sql`SELECT id, revision_id, participant_id, team_membership_id, is_primary_starter FROM competition_entry_roster_members WHERE user_id = ${mergedUserId} ORDER BY id`)).rows as Array<{ id: string; revision_id: string; participant_id: string; team_membership_id: string | null; is_primary_starter: boolean }>;
  for (const row of rosterRows) {
    const targetParticipant = participantMap.get(row.participant_id) ?? row.participant_id;
    const [winner] = (await tx.execute(sql`SELECT id, team_membership_id, is_primary_starter FROM competition_entry_roster_members WHERE user_id = ${canonicalUserId} AND revision_id = ${row.revision_id} LIMIT 1`)).rows as Array<{ id: string; team_membership_id: string | null; is_primary_starter: boolean }>;
    if (winner) {
      await tx.execute(sql`UPDATE competition_entry_roster_members SET team_membership_id = coalesce(team_membership_id, ${row.team_membership_id}), is_primary_starter = is_primary_starter OR ${row.is_primary_starter} WHERE id = ${winner.id}`);
      await tx.execute(sql`DELETE FROM competition_entry_roster_members WHERE id = ${row.id}`);
    }
    else await tx.execute(sql`UPDATE competition_entry_roster_members SET user_id = ${canonicalUserId}, participant_id = ${targetParticipant} WHERE id = ${row.id}`);
  }

  const eventRows = (await tx.execute(sql`SELECT em.id, em.event_roster_id, em.participant_id, em.education_verification_id, em.is_primary_starter, er.status FROM event_roster_members em JOIN event_rosters er ON er.id = em.event_roster_id WHERE em.user_id = ${mergedUserId} ORDER BY em.id`)).rows as Array<{ id: string; event_roster_id: string; participant_id: string | null; education_verification_id: string | null; is_primary_starter: boolean; status: string }>;
  for (const row of eventRows) {
    const targetParticipant = row.participant_id ? participantMap.get(row.participant_id) ?? row.participant_id : null;
    const [winner] = (await tx.execute(sql`SELECT id, education_verification_id, is_primary_starter FROM event_roster_members WHERE user_id = ${canonicalUserId} AND event_roster_id = ${row.event_roster_id} LIMIT 1`)).rows as Array<{ id: string; education_verification_id: string | null; is_primary_starter: boolean }>;
    if (winner) {
      await tx.execute(sql`UPDATE event_roster_members SET education_verification_id = coalesce(education_verification_id, ${row.education_verification_id}), is_primary_starter = is_primary_starter OR ${row.is_primary_starter} WHERE id = ${winner.id}`);
      await tx.execute(sql`DELETE FROM match_roster_players loser USING match_roster_players winner WHERE loser.event_roster_member_id = ${row.id} AND winner.event_roster_member_id = ${winner.id} AND loser.roster_id = winner.roster_id`);
      await tx.execute(sql`UPDATE match_roster_players SET event_roster_member_id = ${winner.id} WHERE event_roster_member_id = ${row.id}`);
      await tx.execute(sql`DELETE FROM event_roster_members WHERE id = ${row.id}`);
    } else await tx.execute(sql`UPDATE event_roster_members SET user_id = ${canonicalUserId}, participant_id = ${targetParticipant} WHERE id = ${row.id}`);
  }
  for (const row of bParticipants) {
    const target = participantMap.get(row.id);
    if (target && target !== row.id) await tx.execute(sql`DELETE FROM competition_entry_participants WHERE id = ${row.id}`);
  }
  const canonicalClaims = (await tx.execute(sql`SELECT competition_id FROM competition_entry_active_claims WHERE user_id = ${canonicalUserId}`)).rows as Array<{ competition_id: string }>;
  const canonicalCompetitions = new Set(canonicalClaims.map((row) => row.competition_id));
  for (const claim of claims) {
    if (canonicalCompetitions.has(claim.competition_id)) continue;
    const participantId = participantMap.get(claim.participant_id) ?? claim.participant_id;
    await tx.execute(sql`INSERT INTO competition_entry_active_claims (competition_id, user_id, entry_id, participant_id, created_at) VALUES (${claim.competition_id}, ${canonicalUserId}, ${claim.entry_id}, ${participantId}, ${claim.created_at})`);
    canonicalCompetitions.add(claim.competition_id);
  }
  await tx.execute(sql`UPDATE competition_entries SET representative_user_id = ${canonicalUserId}, updated_at = now() WHERE representative_user_id = ${mergedUserId}`);
}

async function mergeCompetitiveFactsInTx(tx: TxDb, canonicalUserId: string, mergedUserId: string): Promise<void> {
  await tx.execute(sql`DELETE FROM competitive_rank_facts WHERE user_id = ${mergedUserId}`);
  await tx.execute(sql`DELETE FROM user_competitive_roles WHERE user_id = ${mergedUserId}`);
  await tx.execute(sql`DELETE FROM user_map_preferences WHERE user_id = ${mergedUserId}`);
}

type StatRow = Record<string, unknown> & { id: string; map_id: string; user_id: string; perfect_name: string; verified_by_admin: string | null; verified_at: Date | null; created_at: Date };

async function mergeMatchStatsInTx(tx: TxDb, canonicalUserId: string, mergedUserId: string): Promise<void> {
  const result = await tx.execute(sql`SELECT * FROM match_player_stats WHERE user_id IN (${canonicalUserId}, ${mergedUserId}) ORDER BY map_id, created_at, id`);
  const grouped = new Map<string, StatRow[]>();
  for (const row of result.rows as unknown as StatRow[]) grouped.set(row.map_id, [...(grouped.get(row.map_id) ?? []), row]);
  for (const rows of grouped.values()) {
    const winner = [...rows].sort((left, right) => Number(isFormal(right)) - Number(isFormal(left)) || Number(right.user_id === canonicalUserId) - Number(left.user_id === canonicalUserId) || dateValue(right.verified_at) - dateValue(left.verified_at) || dateValue(right.created_at) - dateValue(left.created_at) || left.id.localeCompare(right.id))[0];
    if (!winner) continue;
    const losers = rows.filter((row) => row.id !== winner.id).map((row) => row.id);
    if (winner.user_id === mergedUserId) await tx.execute(sql`UPDATE match_player_stats SET user_id = ${canonicalUserId} WHERE id = ${winner.id}`);
    await deleteByIds(tx, "match_player_stats", losers);
  }
}

async function mergeHonorFactsInTx(tx: TxDb, canonicalUserId: string, mergedUserId: string): Promise<void> {
  const rows = (await tx.execute(sql`SELECT id, season_id, honor_key, state FROM tournament_honors WHERE user_id = ${mergedUserId} ORDER BY season_id, honor_key, id`)).rows as Array<{ id: string; season_id: string; honor_key: string; state: string }>;
  for (const row of rows) {
    const [winner] = (await tx.execute(sql`SELECT id FROM tournament_honors WHERE user_id = ${canonicalUserId} AND season_id = ${row.season_id} AND honor_key = ${row.honor_key} AND state = 'valid' LIMIT 1`)).rows as Array<{ id: string }>;
    if (winner && row.state === "valid") {
      await tx.execute(sql`UPDATE tournament_honors SET state = 'revoked', revoked_by = 'identity-merge', revoked_at = now(), revocation_reason = 'duplicate_after_canonical_merge', updated_at = now(), user_id = ${canonicalUserId} WHERE id = ${row.id}`);
    } else {
      await tx.execute(sql`UPDATE tournament_honors SET user_id = ${canonicalUserId}, updated_at = now() WHERE id = ${row.id}`);
    }
  }
}

function isFormal(row: StatRow): boolean { return Boolean(row.verified_by_admin || row.verified_at); }
function dateValue(value: Date | null | undefined): number { return value ? new Date(value).getTime() : 0; }

async function mergeMvpFactsInTx(tx: TxDb, canonicalUserId: string, mergedUserId: string): Promise<void> {
  await tx.execute(sql`UPDATE matches SET mvp_winner_user_id = ${canonicalUserId}, updated_at = now() WHERE mvp_winner_user_id = ${mergedUserId}`);
  await tx.execute(sql`UPDATE match_mvp_votes SET player_user_id = ${canonicalUserId} WHERE player_user_id = ${mergedUserId}`);
  await tx.execute(sql`DELETE FROM match_mvp_votes loser USING match_mvp_votes winner WHERE loser.voter_user_id = ${mergedUserId} AND winner.voter_user_id = ${canonicalUserId} AND loser.match_id = winner.match_id`);
  await tx.execute(sql`UPDATE match_mvp_votes SET voter_user_id = ${canonicalUserId} WHERE voter_user_id = ${mergedUserId}`);
}

async function mergeUnionFactsInTx(tx: TxDb, canonicalUserId: string, mergedUserId: string): Promise<void> {
  for (const surface of [{ table: "admin_invite_claims", key: "invite_id" }, { table: "season_admin_grants", key: "season_id" }] as const) {
    const table = sql.raw(`"${surface.table}"`);
    await tx.execute(sql`DELETE FROM ${table} AS loser USING ${table} AS winner WHERE loser.user_id = ${mergedUserId} AND winner.user_id = ${canonicalUserId} AND winner.${sql.raw(`"${surface.key}"`)} = loser.${sql.raw(`"${surface.key}"`)}`);
    await tx.execute(sql`UPDATE ${table} SET user_id = ${canonicalUserId} WHERE user_id = ${mergedUserId}`);
  }
  await tx.execute(sql`DELETE FROM match_commentators loser USING match_commentators winner WHERE loser.user_id = ${mergedUserId} AND winner.user_id = ${canonicalUserId} AND loser.match_id = winner.match_id`);
  await tx.execute(sql`UPDATE match_commentators SET user_id = ${canonicalUserId} WHERE user_id = ${mergedUserId}`);
}

async function closeTransientFactsInTx(tx: TxDb, canonicalUserId: string, mergedUserId: string): Promise<void> {
  void canonicalUserId;
  await tx.execute(sql`UPDATE recruitment_intents SET status = 'closed', updated_at = now() WHERE user_id = ${mergedUserId}`);
  await tx.execute(sql`DELETE FROM recruitment_interests WHERE user_id = ${mergedUserId}`);
  await tx.execute(sql`UPDATE team_invitations SET status = 'revoked', updated_at = now() WHERE invited_user_id = ${mergedUserId} AND status = 'pending'`);
  await tx.update(identityLinkRequests).set({ status: "cancelled", completedAt: new Date() }).where(and(eq(identityLinkRequests.userId, mergedUserId), eq(identityLinkRequests.status, "pending")));
  await tx.execute(sql`DELETE FROM user_sessions WHERE user_id = ${mergedUserId}`);
}

async function mergeIdentitiesInTx(tx: TxDb, canonicalUserId: string, mergedUserId: string): Promise<void> {
  const rows = (await tx.execute(sql`SELECT id, user_id, status, kind, provider, provider_subject, normalized_value FROM user_identities WHERE user_id IN (${canonicalUserId}, ${mergedUserId}) ORDER BY id FOR UPDATE`)).rows as Array<{ id: string; user_id: string; status: string; kind: string; provider: string; provider_subject: string; normalized_value: string | null }>;
  const canonicalRows = rows.filter((row) => row.user_id === canonicalUserId);
  for (const row of rows.filter((candidate) => candidate.user_id === mergedUserId)) {
    const duplicate = row.status === "active" && canonicalRows.some((candidate) => candidate.status === "active" && (candidate.provider === row.provider && candidate.provider_subject === row.provider_subject || candidate.kind === row.kind && candidate.normalized_value !== null && candidate.normalized_value === row.normalized_value));
    if (duplicate) await tx.execute(sql`UPDATE user_identities SET status = 'retired', is_primary = false, retired_at = now(), retired_reason = 'duplicate_after_canonical_merge' WHERE id = ${row.id}`);
    else await tx.execute(sql`UPDATE user_identities SET user_id = ${canonicalUserId}, is_primary = false WHERE id = ${row.id}`);
  }
}

async function updateReference(tx: TxDb, tableName: string, columnName: string, canonicalUserId: string, mergedUserId: string): Promise<void> {
  await tx.execute(sql`UPDATE ${sql.raw(`"${tableName}"`)} SET ${sql.raw(`"${columnName}"`)} = ${canonicalUserId} WHERE ${sql.raw(`"${columnName}"`)} = ${mergedUserId}`);
}

async function deleteByIds(tx: TxDb, tableName: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await tx.execute(sql`DELETE FROM ${sql.raw(`"${tableName}"`)} WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
}

async function assertMergePostflightInTx(tx: TxDb, canonicalUserId: string, mergedUserId: string): Promise<void> {
  await assertUserReferenceRegistryCoverage(tx);
  const leftovers: string[] = [];
  for (const rule of USER_REFERENCE_RULES.filter((entry) => entry.mode === "reparent")) {
    const count = await countReference(tx, rule.table, rule.column, mergedUserId);
    if (count) leftovers.push(`${rule.table}.${rule.column}=${count}`);
  }
  const result = await tx.execute(sql`
    SELECT
      (SELECT count(*)::int FROM user_identities WHERE user_id = ${mergedUserId}) AS identities,
      (SELECT count(*)::int FROM competitive_rank_facts WHERE user_id = ${mergedUserId}) + (SELECT count(*)::int FROM user_competitive_roles WHERE user_id = ${mergedUserId}) + (SELECT count(*)::int FROM user_map_preferences WHERE user_id = ${mergedUserId}) AS competitive,
      (SELECT count(*)::int FROM team_memberships WHERE user_id = ${mergedUserId}) AS memberships,
      (SELECT count(*)::int FROM teams WHERE captain_user_id = ${mergedUserId}) AS captains,
      (SELECT count(*)::int FROM season_registrations WHERE user_id = ${mergedUserId}) AS registrations,
      (SELECT count(*)::int FROM competition_entry_participants WHERE user_id = ${mergedUserId}) AS participants,
      (SELECT count(*)::int FROM competition_entry_active_claims WHERE user_id = ${mergedUserId}) AS claims,
      (SELECT count(*)::int FROM competition_entry_roster_members WHERE user_id = ${mergedUserId}) AS roster_members,
      (SELECT count(*)::int FROM event_roster_members WHERE user_id = ${mergedUserId}) AS event_members,
      (SELECT count(*)::int FROM match_player_stats WHERE user_id = ${mergedUserId}) AS stats,
      (SELECT count(*)::int FROM match_mvp_votes WHERE voter_user_id = ${mergedUserId} OR player_user_id = ${mergedUserId}) AS votes,
      (SELECT count(*)::int FROM matches WHERE mvp_winner_user_id = ${mergedUserId}) AS mvp,
      (SELECT count(*)::int FROM match_commentators WHERE user_id = ${mergedUserId}) AS commentators,
      (SELECT count(*)::int FROM recruitment_intents WHERE user_id = ${mergedUserId} AND status = 'open') AS open_recruitment,
      (SELECT count(*)::int FROM team_invitations WHERE invited_user_id = ${mergedUserId} AND status = 'pending') AS pending_invites,
      (SELECT count(*)::int FROM identity_link_requests WHERE user_id = ${mergedUserId} AND status = 'pending') AS pending_links,
      (SELECT count(*)::int FROM user_sessions WHERE user_id = ${mergedUserId}) AS sessions
  `);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  for (const [key, value] of Object.entries(row ?? {})) if (integer(value)) leftovers.push(`${key}=${integer(value)}`);
  const [alias] = await tx.select({ status: users.status, mergedIntoUserId: users.mergedIntoUserId }).from(users).where(eq(users.id, mergedUserId));
  const canonicalId = await resolveCanonicalUserId(tx, mergedUserId);
  if (leftovers.length || alias?.status !== "merged" || alias.mergedIntoUserId !== canonicalUserId || canonicalId !== canonicalUserId) throw new AppError(ErrorCode.INTERNAL_ERROR, `归并 postflight 失败：${leftovers.join("；") || "alias invariant"}`);
}

function sameUserPair(leftA: string, leftB: string, rightA: string, rightB: string): boolean {
  return (leftA === rightA && leftB === rightB) || (leftA === rightB && leftB === rightA);
}
