import "server-only";
import { sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { AppError, ErrorCode } from "@/lib/errors";

type RuleMode = "reparent" | "preserve" | "special" | "delete";
interface UserReferenceRule {
  table: string;
  column: string;
  label: string;
  mode: RuleMode;
}

/** Every direct FK to users.id has an explicit owner and merge policy. */
export const USER_REFERENCE_RULES: readonly UserReferenceRule[] = [
  {
    table: "operator_scoreboard_receipts",
    column: "actor_user_id",
    label: "OCR 原始提交回执操作人",
    mode: "preserve",
  },
  { table: "admin_invite_claims", column: "user_id", label: "管理员邀请领取", mode: "special" },
  { table: "announcements", column: "created_by", label: "公告创建人", mode: "preserve" },
  { table: "announcements", column: "updated_by", label: "公告最后更新人", mode: "preserve" },
  {
    table: "community_awards",
    column: "submitted_by_user_id",
    label: "社区奖项提交人",
    mode: "preserve",
  },
  {
    table: "community_awards",
    column: "reviewed_by_user_id",
    label: "社区奖项审核人",
    mode: "preserve",
  },
  {
    table: "community_awards",
    column: "recipient_user_id",
    label: "社区奖项获奖人",
    mode: "reparent",
  },
  {
    table: "community_awards",
    column: "outcome_by_user_id",
    label: "社区奖项处理人",
    mode: "preserve",
  },
  {
    table: "community_award_recipients",
    column: "user_id",
    label: "社区奖完整获奖名单",
    mode: "reparent",
  },
  {
    table: "community_award_evidence",
    column: "verified_by_user_id",
    label: "社区奖候选核验人",
    mode: "preserve",
  },
  {
    table: "community_award_evidence",
    column: "submitted_by_user_id",
    label: "社区奖项证据提交人",
    mode: "preserve",
  },
  {
    table: "community_award_evidence",
    column: "candidate_user_id",
    label: "社区奖项候选人",
    mode: "reparent",
  },
  {
    table: "competition_entries",
    column: "representative_user_id",
    label: "参赛条目代表人",
    mode: "reparent",
  },
  {
    table: "competition_entry_participants",
    column: "user_id",
    label: "参赛条目参与人",
    mode: "special",
  },
  {
    table: "competition_entry_participants",
    column: "invited_by_user_id",
    label: "参赛邀请发起人",
    mode: "preserve",
  },
  {
    table: "competition_entry_active_claims",
    column: "user_id",
    label: "当前参赛承诺",
    mode: "special",
  },
  {
    table: "competition_entry_roster_members",
    column: "user_id",
    label: "参赛名单成员",
    mode: "special",
  },
  {
    table: "competition_entry_representative_changes",
    column: "from_user_id",
    label: "代表人变更历史",
    mode: "preserve",
  },
  {
    table: "competition_entry_representative_changes",
    column: "to_user_id",
    label: "代表人变更历史",
    mode: "preserve",
  },
  { table: "event_roster_members", column: "user_id", label: "赛事冻结名单成员", mode: "special" },
  { table: "feedback_reports", column: "user_id", label: "用户反馈提交人", mode: "preserve" },
  { table: "competitive_rank_facts", column: "user_id", label: "竞技段位资料", mode: "special" },
  { table: "user_competitive_roles", column: "user_id", label: "竞技位置资料", mode: "special" },
  { table: "user_map_preferences", column: "user_id", label: "地图熟练度资料", mode: "special" },
  {
    table: "disciplinary_cases",
    column: "subject_user_id",
    label: "纪律处分对象",
    mode: "reparent",
  },
  {
    table: "dak_pairing_intents",
    column: "authorized_by_user_id",
    label: "DAK 配对授权人",
    mode: "preserve",
  },
  { table: "dak_pairings", column: "user_id", label: "DAK 连接所有人", mode: "reparent" },
  {
    table: "mizar_pairing_intents",
    column: "authorized_by_user_id",
    label: "Mizar 配对授权人",
    mode: "preserve",
  },
  {
    table: "mizar_installations",
    column: "authorized_by_user_id",
    label: "Mizar 设备授权人",
    mode: "reparent",
  },
  { table: "education_verifications", column: "user_id", label: "教育认证记录", mode: "reparent" },
  { table: "identity_link_requests", column: "user_id", label: "身份绑定请求", mode: "delete" },
  { table: "user_identities", column: "user_id", label: "已验证登录身份", mode: "special" },
  {
    table: "user_gameplay_steam_ids",
    column: "user_id",
    label: "历史游戏 Steam 身份",
    mode: "reparent",
  },
  {
    table: "user_gameplay_steam_ids",
    column: "confirmed_by_user_id",
    label: "历史游戏 Steam 身份确认人",
    mode: "preserve",
  },
  {
    table: "user_gameplay_steam_ids",
    column: "retired_by_user_id",
    label: "历史游戏 Steam 身份撤销人",
    mode: "preserve",
  },
  {
    table: "user_merge_authorizations",
    column: "initiating_user_id",
    label: "归并授权发起人",
    mode: "preserve",
  },
  {
    table: "user_merge_authorizations",
    column: "counterparty_user_id",
    label: "归并授权对方",
    mode: "preserve",
  },
  {
    table: "user_merge_ledger",
    column: "canonical_user_id",
    label: "归并历史保留账号",
    mode: "preserve",
  },
  {
    table: "user_merge_ledger",
    column: "merged_user_id",
    label: "归并历史旧账号",
    mode: "preserve",
  },
  {
    table: "user_merge_ledger",
    column: "executed_by_user_id",
    label: "归并执行人",
    mode: "preserve",
  },
  { table: "match_rosters", column: "submitted_by", label: "比赛名单提交人", mode: "preserve" },
  { table: "match_veto_appeals", column: "resolved_by", label: "BP 申诉处理人", mode: "preserve" },
  { table: "match_veto_appeals", column: "submitted_by", label: "BP 申诉提交人", mode: "preserve" },
  {
    table: "match_veto_sessions",
    column: "entry_a_start_requested_by",
    label: "BP A 方开始请求人",
    mode: "preserve",
  },
  {
    table: "match_veto_sessions",
    column: "entry_b_start_requested_by",
    label: "BP B 方开始请求人",
    mode: "preserve",
  },
  { table: "match_veto_sessions", column: "paused_by", label: "BP 暂停操作人", mode: "preserve" },
  { table: "match_veto_steps", column: "actor_user_id", label: "BP 步骤操作人", mode: "preserve" },
  {
    table: "match_veto_timeout_incidents",
    column: "representative_user_id",
    label: "BP 超时责任代表",
    mode: "preserve",
  },
  {
    table: "match_time_proposals",
    column: "proposed_by",
    label: "比赛时间提议人",
    mode: "preserve",
  },
  {
    table: "match_time_proposals",
    column: "force_assigned_by",
    label: "比赛时间强制安排人",
    mode: "preserve",
  },
  { table: "match_mvp_votes", column: "player_user_id", label: "MVP 候选人", mode: "reparent" },
  { table: "match_mvp_votes", column: "voter_user_id", label: "MVP 投票人", mode: "special" },
  { table: "match_player_stats", column: "user_id", label: "比赛数据选手", mode: "special" },
  {
    table: "post_event_adjudications",
    column: "target_user_id",
    label: "赛后裁定对象",
    mode: "reparent",
  },
  { table: "tournament_honors", column: "user_id", label: "赛事荣誉获得人", mode: "reparent" },
  { table: "match_commentators", column: "user_id", label: "比赛解说", mode: "special" },
  {
    table: "match_commentators",
    column: "added_by_user_id",
    label: "解说安排人",
    mode: "preserve",
  },
  {
    table: "post_match_reports",
    column: "submitted_by_user_id",
    label: "赛后报告提交人",
    mode: "preserve",
  },
  { table: "recruitment_intents", column: "user_id", label: "当前招募意向", mode: "special" },
  { table: "recruitment_interests", column: "user_id", label: "招募兴趣", mode: "special" },
  { table: "season_registrations", column: "user_id", label: "赛季报名", mode: "special" },
  { table: "season_admin_grants", column: "user_id", label: "赛季管理员权限", mode: "special" },
  {
    table: "season_admin_grants",
    column: "granted_by_user_id",
    label: "权限授予人",
    mode: "preserve",
  },
  { table: "teams", column: "creator_user_id", label: "队伍创建人", mode: "preserve" },
  { table: "teams", column: "captain_user_id", label: "当前队长", mode: "special" },
  { table: "team_memberships", column: "user_id", label: "队伍成员关系", mode: "special" },
  {
    table: "team_memberships",
    column: "invited_by_user_id",
    label: "队伍邀请发起人",
    mode: "preserve",
  },
  {
    table: "team_captain_changes",
    column: "from_user_id",
    label: "队长变更历史",
    mode: "preserve",
  },
  { table: "team_captain_changes", column: "to_user_id", label: "队长变更历史", mode: "preserve" },
  { table: "team_invitations", column: "invited_user_id", label: "队伍邀请对象", mode: "special" },
  {
    table: "team_invitations",
    column: "invited_by_user_id",
    label: "队伍邀请发起人",
    mode: "preserve",
  },
  {
    table: "team_invitations",
    column: "responded_by_user_id",
    label: "队伍邀请处理人",
    mode: "preserve",
  },
  { table: "application_sessions", column: "user_id", label: "应用登录会话", mode: "delete" },
  {
    table: "application_session_controls",
    column: "user_id",
    label: "会话撤销边界",
    mode: "preserve",
  },
  { table: "user_sessions", column: "user_id", label: "登录会话", mode: "delete" },
  { table: "users", column: "merged_into_user_id", label: "旧账号别名", mode: "preserve" },
  {
    table: "free_prediction_choices",
    column: "user_id",
    label: "免费预测原始选择",
    mode: "preserve",
  },
  {
    table: "free_prediction_requests",
    column: "user_id",
    label: "免费预测原始修订",
    mode: "preserve",
  },
  { table: "bet_accounts", column: "user_id", label: "BET 积分账户", mode: "special" },
  { table: "prediction_accounts", column: "user_id", label: "观赛预测账户", mode: "special" },
] as const;

interface SeasonRegistrationReferenceRule {
  table: string;
  column: string;
  label: string;
}

/** Every direct FK to season_registrations.id has an explicit merge owner. */
const SEASON_REGISTRATION_REFERENCE_RULES: readonly SeasonRegistrationReferenceRule[] = [
  { table: "competition_entries", column: "source_registration_id", label: "参赛条目报名来源" },
  { table: "draft_picks", column: "registration_id", label: "选秀选手报名" },
  { table: "captain_votes", column: "voter_registration_id", label: "队长投票人报名" },
  { table: "captain_votes", column: "candidate_registration_id", label: "队长候选人报名" },
] as const;

type MergeQueryable = Pick<DB, "execute">;

async function assertReferenceCoverage(
  queryable: MergeQueryable,
  parentTable: string,
  rules: readonly SeasonRegistrationReferenceRule[],
): Promise<void> {
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
      AND parent.relname = ${parentTable}
      AND parent_column.attname = 'id'
    ORDER BY child.relname, child_column.attname
  `);
  const actual = result.rows
    .map((row) => `${String(row.table_name)}.${String(row.column_name)}`)
    .sort();
  const expected = rules.map((rule) => `${rule.table}.${rule.column}`).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const expectedSet = new Set(expected);
    const actualSet = new Set(actual);
    const differences = [
      ...actual.filter((key) => !expectedSet.has(key)).map((key) => `unclassified ${key}`),
      ...expected.filter((key) => !actualSet.has(key)).map((key) => `missing ${key}`),
    ];
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      `${parentTable} owner registry 与 PostgreSQL schema 不一致：${differences.join("；")}`,
    );
  }
}

export async function assertMergeReferenceCoverage(queryable: MergeQueryable): Promise<void> {
  await assertReferenceCoverage(queryable, "users", USER_REFERENCE_RULES);
  await assertReferenceCoverage(
    queryable,
    "season_registrations",
    SEASON_REGISTRATION_REFERENCE_RULES,
  );
}
