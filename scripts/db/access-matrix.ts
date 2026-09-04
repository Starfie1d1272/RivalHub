import type { Pool } from "pg";

const TABLE_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE"] as const;
type TablePrivilege = (typeof TABLE_PRIVILEGES)[number];

const ACCESS_TARGET_CLASSES = [
  "server_only",
  "client_read_rls",
  "client_write_rls",
  "realtime_only",
] as const;
type AccessTargetClass = (typeof ACCESS_TARGET_CLASSES)[number];

export interface DatabaseAccessEntry {
  table: string;
  domain: string;
  sensitivity: string;
  serverDrizzleConsumer: string;
  browserDataApiConsumer: string;
  realtimeConsumer: string;
  anonPrivileges: readonly TablePrivilege[];
  authenticatedPrivileges: readonly TablePrivilege[];
  rlsEnabled: boolean;
  policyNames: readonly string[];
  publicationMembership: boolean;
  targetClass: AccessTargetClass;
  reason: string;
}

export interface DatabaseAccessFacts {
  table_name: string;
  rls_enabled: boolean;
  anon_privileges: string[];
  authenticated_privileges: string[];
  policy_names: string[];
  publication_membership: boolean;
}

const NO_BROWSER_DATA_API = "无（仅服务端 Drizzle；浏览器不直连业务表）";
const NO_REALTIME = "无（Realtime 已移除；使用现有 polling fallback）";

function serverOnly(
  table: string,
  domain: string,
  sensitivity: string,
  serverDrizzleConsumer: string,
  reason: string,
): DatabaseAccessEntry {
  return {
    table,
    domain,
    sensitivity,
    serverDrizzleConsumer,
    browserDataApiConsumer: NO_BROWSER_DATA_API,
    realtimeConsumer: NO_REALTIME,
    anonPrivileges: [],
    authenticatedPrivileges: [],
    rlsEnabled: true,
    policyNames: [],
    publicationMembership: false,
    targetClass: "server_only",
    reason,
  };
}

/**
 * Canonical terminal access contract for every application-owned public base
 * table. The live checker below compares this list with PostgreSQL itself, so
 * adding a table without adding an explicit classification fails closed.
 */
export const DATABASE_ACCESS_MATRIX: readonly DatabaseAccessEntry[] = [
  serverOnly(
    "admin_invite_claims",
    "鉴权 / 管理员提权",
    "高敏感授权 ledger",
    "src/lib/auth/admin-invites.ts",
    "邀请码领取、计数和幂等事实只能在服务端事务内写入。",
  ),
  serverOnly(
    "admin_invites",
    "鉴权 / 管理员提权",
    "高敏感邀请码与授权范围",
    "src/lib/auth/admin-invites.ts; src/actions/admin.ts",
    "包含角色、赛季范围和使用限制，不是公开配置。",
  ),
  serverOnly(
    "audit_logs",
    "审计",
    "高敏感管理操作记录",
    "src/lib/audit/; src/actions/audit.ts",
    "审计 actor、目标和内部 metadata 由服务端审计 owner 维护。",
  ),
  serverOnly(
    "captain_votes",
    "Rivals 队长投票",
    "参赛者投票事实",
    "src/actions/captains.ts; src/lib/captains/data.ts",
    "投票 mutation 与结果读取通过 Server Action/Server Component；浏览器只轮询刷新。",
  ),
  serverOnly(
    "community_award_evidence",
    "赛后 / 社区奖项",
    "内部证据与提交人信息",
    "src/lib/community-awards/service.ts; src/lib/audit/targets.ts",
    "证据用于审核和审计，公开奖项只消费显式 read model。",
  ),
  serverOnly(
    "community_awards",
    "赛后 / 社区奖项",
    "审核、结果与奖项内部事实",
    "src/lib/community-awards/service.ts; src/actions/community-awards.ts",
    "public_note 等公开字段由服务端 projection 决定，原始审核记录仍为 server-only。",
  ),
  serverOnly(
    "competition_bracket_states",
    "赛事 bracket runtime",
    "高敏感运行时 JSON",
    "src/lib/bracket/index.ts",
    "2026-09-03 production inventory 确认该表曾是 anon/authenticated CRUD 暴露例外；0034 forward migration 收口为 server-only。",
  ),
  serverOnly(
    "competition_entries",
    "CompetitionEntry / 报名",
    "参赛身份、代表人与报名状态",
    "src/lib/competition-entries/; src/actions/competition-entries.ts",
    "CompetitionEntry 是报名与 runtime 的 canonical aggregate，不通过 Data API 旁路访问。",
  ),
  serverOnly(
    "competition_entry_active_claims",
    "CompetitionEntry integrity",
    "并发占用 ledger",
    "src/lib/competition-entries/commands.ts",
    "用于跨 Entry 用户占用约束和并发收敛。",
  ),
  serverOnly(
    "competition_entry_legacy_identities",
    "CompetitionEntry provenance",
    "历史身份追溯",
    "src/lib/competition-entries/commands.ts; migration provenance owner",
    "legacy provenance 只服务于服务端迁移和历史事实审计。",
  ),
  serverOnly(
    "competition_entry_participants",
    "CompetitionEntry / roster",
    "参赛成员身份与状态",
    "src/lib/competition-entries/commands.ts; src/actions/competition-entries.ts",
    "成员邀请、确认和退出是受鉴权保护的服务端领域操作。",
  ),
  serverOnly(
    "competition_entry_representative_changes",
    "CompetitionEntry provenance",
    "代表人变更审计",
    "src/lib/competition-entries/commands.ts",
    "代表人历史是 append-only 的服务端 owner 事实。",
  ),
  serverOnly(
    "competition_entry_roster_members",
    "CompetitionEntry / roster",
    "提交名单成员与起发标记",
    "src/lib/competition-entries/commands.ts; src/app/admin/[seasonSlug]/registrations/page.tsx",
    "名单包含个人身份和参赛资格上下文，仅由服务端 read model 投影。",
  ),
  serverOnly(
    "competition_entry_roster_revisions",
    "CompetitionEntry / roster",
    "提交名单版本与审核事实",
    "src/lib/competition-entries/roster-change.ts; src/lib/competition-entries/commands.ts",
    "revision、审批指针和 remediation 不能由客户端直接修改。",
  ),
  serverOnly(
    "competition_entry_submissions",
    "CompetitionEntry / review",
    "报名审核决策历史",
    "src/lib/competition-entries/commands.ts",
    "提交序列和审核决策用于 canonical lifecycle 与 audit。",
  ),
  serverOnly(
    "competition_entry_restriction_overrides",
    "CompetitionEntry / review",
    "资格限制解除与审计事实",
    "src/lib/competition-entries/restriction-overrides.ts; src/lib/competition-entries/commands.ts",
    "只记录管理员针对当前 roster revision 的显式、可解除政策限制；资料缺失仍由资格 owner 阻断。",
  ),
  serverOnly(
    "competitive_platform_ranks",
    "竞技资料目录",
    "内部等级目录配置",
    "src/lib/competitive/catalog.ts",
    "目录由服务端 bootstrap 和冻结快照 owner 管理。",
  ),
  serverOnly(
    "competitive_platform_seasons",
    "竞技资料目录",
    "内部赛季目录配置",
    "src/lib/competitive/catalog.ts; src/actions/competitive-platform.ts",
    "目录 season key 和 rank order 不能由 Data API 改写。",
  ),
  serverOnly(
    "competitive_platforms",
    "竞技资料目录",
    "内部平台目录配置",
    "src/lib/competitive/catalog.ts; src/actions/competitive-platform.ts",
    "平台定义是服务端产品配置，不是浏览器公开写入面。",
  ),
  serverOnly(
    "conversion_policies",
    "竞技资料目录",
    "跨平台换算策略",
    "src/lib/competitive/conversion-policy.ts; src/lib/seasons/lifecycle.ts",
    "版本化换算策略是服务端产品配置，冻结快照由注册开放 owner 管理。",
  ),
  serverOnly(
    "competitive_rank_facts",
    "个人竞技资料",
    "个人竞技事实",
    "src/actions/competitive-profile.ts; src/lib/qualification/service.ts",
    "竞技资料与资格判断需要服务端授权、冻结和 projection。",
  ),
  serverOnly(
    "disciplinary_case_idempotency",
    "纪律",
    "纪律 mutation ledger",
    "src/lib/discipline/service.ts",
    "幂等 key 只用于服务端纪律事务，不形成客户端数据面。",
  ),
  serverOnly(
    "disciplinary_cases",
    "纪律",
    "高敏感纪律事实",
    "src/lib/discipline/service.ts; src/actions/discipline.ts",
    "sanction、effect 和内部 reason 由授权管理员服务端维护。",
  ),
  serverOnly(
    "draft_picks",
    "Rivals 选秀",
    "选秀选择与幂等事实",
    "src/actions/draft/picks.ts; src/lib/draft/data.ts",
    "选秀写入由服务端事务保护；直播 UI 使用 polling，不直连 Data API。",
  ),
  serverOnly(
    "draft_state",
    "Rivals 选秀",
    "选秀运行时状态",
    "src/actions/draft/state.ts; src/actions/draft/picks.ts; src/lib/draft/data.ts",
    "当前队伍、deadline 和 active 状态是服务端 runtime owner 事实。",
  ),
  serverOnly(
    "education_verifications",
    "教育资格",
    "高敏感教育证据与审核结果",
    "src/actions/education-verifications.ts; src/lib/qualification/service.ts",
    "教育材料、evidence code 和 review note 绝不通过浏览器 Data API 暴露。",
  ),
  serverOnly(
    "event_roster_members",
    "Major event roster",
    "冻结参赛名单与身份映射",
    "src/actions/major-prestart.ts; src/lib/major/prestart-roster.ts",
    "event roster 是开赛前/运行时 canonical roster owner。",
  ),
  serverOnly(
    "event_rosters",
    "Major event roster",
    "名单状态与冻结边界",
    "src/actions/major-prestart.ts; src/lib/match-rosters/service.ts",
    "preparing/confirmed/frozen transition 只能经服务端领域操作。",
  ),
  serverOnly(
    "institution_email_domains",
    "教育目录",
    "内部高校邮箱规则",
    "src/lib/qualification/service.ts; src/actions/education-verifications.ts",
    "邮箱域名目录用于资格验证，不能作为公开可写配置。",
  ),
  serverOnly(
    "institutions",
    "教育目录",
    "高校目录与官方编码",
    "src/lib/qualification/service.ts; src/actions/education-verifications.ts",
    "机构目录可能被公开 projection 间接使用，但原始表仍由服务端控制。",
  ),
  serverOnly(
    "major_final_results",
    "Major post-event",
    "官方最终结果事实",
    "src/lib/postevent/service.ts; src/lib/major/placement.ts",
    "最终结果需 confirmation/adjudication 后归档，禁止客户端旁路写入。",
  ),
  serverOnly(
    "major_prestart_issues",
    "Major prestart",
    "开赛前内部 blocker 与审计",
    "src/actions/major-prestart.ts; src/lib/audit/targets.ts",
    "prestart issue 只供管理员修复和审计使用。",
  ),
  serverOnly(
    "major_prestart_states",
    "Major prestart",
    "开赛前状态与锁定事实",
    "src/actions/major-prestart.ts; src/lib/major/prestart-state.ts",
    "entrant/seed lock 是开赛门禁，不是客户端状态。",
  ),
  serverOnly(
    "major_stage_entrants",
    "Major stage runtime",
    "阶段参赛事实",
    "src/lib/major/run-entrants.ts; src/lib/major/stage-transition.ts",
    "stage entrant 与 StageRun 的一致性由 Major runtime owner 维护。",
  ),
  serverOnly(
    "major_stage_runs",
    "Major stage runtime",
    "阶段运行时与恢复状态",
    "src/lib/major/; src/actions/major-prestart.ts",
    "StageRun 是 Swiss/playoff/recovery 的 canonical runtime boundary。",
  ),
  serverOnly(
    "major_tournament_entrants",
    "Major prestart",
    "赛事参赛物化事实",
    "src/lib/major/run-entrants.ts; src/actions/major-prestart.ts",
    "正式参赛队及其冻结 roster 只由 server-side prestart 流程物化。",
  ),
  serverOnly(
    "major_tournament_seeds",
    "Major prestart",
    "正式 seed 与锁定事实",
    "src/actions/major-prestart.ts; src/lib/major/run-entrants.ts",
    "seed 是开赛时按冻结规则重验的内部事实。",
  ),
  serverOnly(
    "match_commentators",
    "赛后 / 解说",
    "管理员分配关系与内部 roster",
    "src/lib/postmatch/service.ts; src/actions/postmatch.ts",
    "解说分配和提交冻结由服务端 scope guard 维护。",
  ),
  serverOnly(
    "match_maps",
    "比赛 / BP",
    "地图选择与比分事实",
    "src/actions/matches/veto.ts; src/actions/player-stats.ts",
    "BP 与地图结果必须通过比赛 mutation owner 写入。",
  ),
  serverOnly(
    "match_mvp_votes",
    "比赛 / MVP",
    "MVP 投票事实",
    "src/actions/player-stats.ts",
    "MVP 投票仅由服务端 action 写入和聚合。",
  ),
  serverOnly(
    "match_player_stats",
    "比赛 / 统计",
    "选手比赛统计",
    "src/actions/player-stats.ts; src/lib/stats/",
    "统计写入与公开展示之间存在服务端 projection 边界。",
  ),
  serverOnly(
    "match_roster_players",
    "比赛 / roster",
    "比赛阵容成员事实",
    "src/lib/match-rosters/service.ts",
    "比赛 roster 必须引用已确认 event roster，禁止直接 Data API 写入。",
  ),
  serverOnly(
    "match_rosters",
    "比赛 / roster",
    "比赛阵容状态",
    "src/lib/match-rosters/service.ts; src/actions/matches/roster.ts",
    "阵容提交、确认和 starter preflight 是服务端操作。",
  ),
  serverOnly(
    "match_time_proposals",
    "比赛 / 排期",
    "时间协商与自动判定事实",
    "src/lib/matches/time-proposals.ts; src/actions/matches/scheduling.ts",
    "proposal lifecycle 和 auto-award 由服务端事务维护。",
  ),
  serverOnly(
    "match_veto_steps",
    "比赛 / BP",
    "BP 操作历史",
    "src/actions/matches/veto.ts; src/lib/teams/data.ts",
    "veto step 是比赛过程事实，不能被浏览器直接改写。",
  ),
  serverOnly(
    "matches",
    "比赛 runtime",
    "比赛、赛果与恢复事实",
    "src/actions/matches/; src/lib/major/; src/lib/match-corrections/",
    "manual/Major match、结果更正和 stage progression 均由服务端 owner 管理。",
  ),
  serverOnly(
    "post_event_adjudications",
    "赛后裁决",
    "高敏感裁决事实",
    "src/lib/postevent/service.ts; src/actions/postevent.ts",
    "裁决影响范围和撤销历史必须通过管理员服务端操作。",
  ),
  serverOnly(
    "post_match_reports",
    "赛后 / 解说",
    "赛后提交事实",
    "src/lib/postmatch/service.ts; src/actions/postmatch.ts",
    "视频和解说提交完成度由服务端 scope guard 与 postmatch owner 判定。",
  ),
  serverOnly(
    "recruitment_intents",
    "Team recruitment",
    "队伍/个人求职意图与联系方式",
    "src/lib/recruitment/commands.ts; src/lib/recruitment/data.ts",
    "公开招聘卡片由服务端 read model 过滤并投影，原始 intent 仍 server-only。",
  ),
  serverOnly(
    "recruitment_interests",
    "Team recruitment",
    "求职意向与用户关系",
    "src/lib/recruitment/commands.ts; src/lib/recruitment/data.ts",
    "兴趣记录包含用户关系和 mutation 状态，只能由鉴权命令访问。",
  ),
  serverOnly(
    "registration_drafts",
    "报名",
    "未提交报名草稿",
    "src/actions/register.ts; src/components/admin/DraftRegistrationTable.tsx",
    "草稿可能包含联系方式和未审核材料，不形成公开数据面。",
  ),
  serverOnly(
    "season_admin_grants",
    "鉴权 / 赛季授权",
    "高敏感管理员授权事实",
    "src/lib/auth/session.ts; src/actions/admin.ts",
    "管理员范围由当前数据库授权事实读取，客户端不能缓存或修改。",
  ),
  serverOnly(
    "season_registrations",
    "Rivals 报名",
    "报名、资格与个人竞技资料",
    "src/actions/register.ts; src/lib/qualification/service.ts",
    "报名状态和教育/竞技资料由服务端验证后投影。",
  ),
  serverOnly(
    "seasons",
    "赛事配置",
    "赛事生命周期与冻结配置",
    "src/actions/seasons.ts; src/lib/seasons/; src/db/schema/seasons.ts",
    "赛事 capability、注册窗口和冻结配置是业务控制面，不允许 Data API 旁路。",
  ),
  serverOnly(
    "swiss_standings",
    "Major Swiss",
    "排名 projection 与阶段事实",
    "src/lib/swiss/data.ts; src/lib/major/swiss-runtime.ts",
    "Swiss standings 不是独立真相，必须随 Major runtime 服务端更新。",
  ),
  serverOnly(
    "team_captain_changes",
    "长期 Team",
    "队长变更历史",
    "src/lib/teams/commands.ts; src/app/teams/[slug]/page.tsx",
    "队长 tenure/变更审计只由 Team command owner 写入。",
  ),
  serverOnly(
    "team_invitations",
    "长期 Team",
    "邀请 token 与成员关系",
    "src/lib/teams/invitations.ts; src/actions/teams.ts",
    "邀请状态和 token 是高敏感 mutation 事实。",
  ),
  serverOnly(
    "team_memberships",
    "长期 Team",
    "用户队伍归属",
    "src/lib/teams/invitations.ts; src/lib/teams/commands.ts",
    "成员状态和结束原因由 Team command owner 维护。",
  ),
  serverOnly(
    "team_name_changes",
    "长期 Team",
    "队伍名称历史",
    "src/lib/teams/commands.ts",
    "名称历史是不可旁路修改的 Team provenance。",
  ),
  serverOnly(
    "team_slug_aliases",
    "长期 Team",
    "队伍 URL 别名映射",
    "src/lib/teams/commands.ts; src/app/teams/[slug]/page.tsx",
    "slug alias 由 canonical Team mutation 创建并用于服务端解析。",
  ),
  serverOnly(
    "teams",
    "长期 Team",
    "队伍身份、状态与队长",
    "src/lib/teams/; src/actions/teams.ts",
    "公开队伍页消费显式 projection，原始队伍与 owner 事实仍 server-only。",
  ),
  serverOnly(
    "tournament_honors",
    "赛后 / 荣誉",
    "官方荣誉与撤销状态",
    "src/lib/postevent/service.ts; src/lib/community-awards/read-model.ts",
    "荣誉必须基于 final result/adjudication 的服务端事实形成。",
  ),
  serverOnly(
    "user_competitive_roles",
    "个人竞技资料",
    "个人位置偏好",
    "src/actions/competitive-profile.ts; src/lib/recruitment/data.ts",
    "位置资料用于资格和展示 projection，不能由客户端直接访问。",
  ),
  serverOnly(
    "user_map_preferences",
    "个人竞技资料",
    "个人地图熟练度",
    "src/actions/competitive-profile.ts; src/lib/recruitment/data.ts",
    "长期资料由服务端 action 更新，队伍/个人页面消费最小 projection。",
  ),
  serverOnly(
    "user_sessions",
    "鉴权 / 会话",
    "高敏感应用会话",
    "src/lib/auth/session.ts; src/db/schema/user-sessions.ts",
    "应用 session 与角色事实在服务端读取，绝不通过 Data API 暴露。",
  ),
  serverOnly(
    "users",
    "身份 / 账户",
    "高敏感 email、角色、教育与竞技身份",
    "src/lib/auth/; src/actions/account.ts; src/lib/identity/",
    "email、QQ、studentId、authId、审核材料和内部备注默认不是公开字段。",
  ),
] as const;

export const DATABASE_ACCESS_TABLES = DATABASE_ACCESS_MATRIX.map((entry) => entry.table);

export function validateDatabaseAccessMatrixConfig(
  entries: readonly DatabaseAccessEntry[] = DATABASE_ACCESS_MATRIX,
): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.table)) {
      throw new Error(`Database access matrix 存在重复 table：${entry.table}`);
    }
    seen.add(entry.table);
    if (!ACCESS_TARGET_CLASSES.includes(entry.targetClass)) {
      throw new Error(`Database access matrix 存在未知 target class：${entry.targetClass}`);
    }
    if (entry.targetClass === "server_only") {
      if (
        entry.anonPrivileges.length > 0 ||
        entry.authenticatedPrivileges.length > 0 ||
        !entry.rlsEnabled ||
        entry.policyNames.length > 0 ||
        entry.publicationMembership
      ) {
        throw new Error(`server_only table ${entry.table} 的 terminal contract 不安全。`);
      }
    } else if (!entry.rlsEnabled || entry.policyNames.length === 0) {
      throw new Error(`client/realtime table ${entry.table} 必须声明 RLS 和 policy。`);
    }
  }
}

export async function verifyDatabaseAccessMatrix(
  pool: Pick<Pool, "query">,
  context: string,
): Promise<readonly DatabaseAccessFacts[]> {
  validateDatabaseAccessMatrixConfig();

  const roleResult = await pool.query<{ rolname: string }>(
    "SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[]) ORDER BY rolname",
    [["anon", "authenticated"]],
  );
  const roles = roleResult.rows.map((row) => row.rolname);
  if (roles.join(",") !== "anon,authenticated") {
    throw new Error(`${context} 缺少 anon/authenticated database roles；access matrix 无法完成 effective privilege 检查。`);
  }

  const tableResult = await pool.query<{ table_name: string }>(`
    SELECT c.relname AS table_name
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  `);
  const factsResult = await pool.query<DatabaseAccessFacts>(
    `
      SELECT
        c.relname AS table_name,
        c.relrowsecurity AS rls_enabled,
        ARRAY(
          SELECT privilege.privilege_name
          FROM unnest($1::text[]) WITH ORDINALITY AS privilege(privilege_name, ordinal)
          WHERE has_table_privilege('anon', c.oid, privilege.privilege_name)
          ORDER BY privilege.ordinal
        ) AS anon_privileges,
        ARRAY(
          SELECT privilege.privilege_name
          FROM unnest($1::text[]) WITH ORDINALITY AS privilege(privilege_name, ordinal)
          WHERE has_table_privilege('authenticated', c.oid, privilege.privilege_name)
          ORDER BY privilege.ordinal
        ) AS authenticated_privileges,
        COALESCE(
          (
            SELECT array_agg(policyname::text ORDER BY policyname)::text[]
            FROM pg_policies
            WHERE schemaname = 'public' AND tablename = c.relname
          ),
          ARRAY[]::text[]
        )::text[] AS policy_names,
        EXISTS (
          SELECT 1
          FROM pg_publication AS publication
          LEFT JOIN pg_publication_rel AS publication_relation
            ON publication_relation.prpubid = publication.oid
           AND publication_relation.prrelid = c.oid
          WHERE publication.pubname = 'supabase_realtime'
            AND (publication.puballtables OR publication_relation.prrelid IS NOT NULL)
        ) AS publication_membership
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      ORDER BY c.relname
    `,
    [TABLE_PRIVILEGES],
  );
  const facts = factsResult.rows.map((row) => ({
    ...row,
    anon_privileges: normalizeTextArray(row.anon_privileges),
    authenticated_privileges: normalizeTextArray(row.authenticated_privileges),
    policy_names: normalizeTextArray(row.policy_names),
  }));
  assertDatabaseAccessMatrixFacts(
    tableResult.rows.map((row) => row.table_name),
    facts,
  );

  console.log(
    `${context} database access matrix passed: ${DATABASE_ACCESS_MATRIX.length} public base tables, deny-by-default, RLS/policy/publication contract aligned.`,
  );
  return facts;
}

export function assertDatabaseAccessMatrixFacts(
  actualTables: readonly string[],
  actualFacts: readonly DatabaseAccessFacts[],
): void {
  const tableDiff = diffNames([...DATABASE_ACCESS_TABLES].sort(), [...actualTables].sort());
  const actualByTable = new Map(actualFacts.map((row) => [row.table_name, row]));
  const failures = [...tableDiff.map((item) => `public table ${item}`)];

  for (const entry of DATABASE_ACCESS_MATRIX) {
    const actual = actualByTable.get(entry.table);
    if (!actual) {
      failures.push(`${entry.table}: table missing from PostgreSQL`);
      continue;
    }
    compare(
      failures,
      entry.table,
      "anon privileges",
      entry.anonPrivileges,
      actual.anon_privileges,
    );
    compare(
      failures,
      entry.table,
      "authenticated privileges",
      entry.authenticatedPrivileges,
      actual.authenticated_privileges,
    );
    compare(failures, entry.table, "RLS", entry.rlsEnabled, actual.rls_enabled);
    compare(failures, entry.table, "policies", entry.policyNames, actual.policy_names);
    compare(
      failures,
      entry.table,
      "Realtime publication",
      entry.publicationMembership,
      actual.publication_membership,
    );
  }

  if (failures.length > 0) {
    throw new Error(`database access matrix 校验失败：\n- ${failures.join("\n- ")}`);
  }
}

export function renderDatabaseAccessMatrixMarkdown(): string {
  const rows = DATABASE_ACCESS_MATRIX.map((entry) => {
    const policySummary = entry.policyNames.length > 0 ? entry.policyNames.join(", ") : "无（RLS deny）";
    const publication = entry.publicationMembership ? "supabase_realtime" : "无";
    return [
      entry.table,
      entry.sensitivity,
      entry.domain,
      entry.serverDrizzleConsumer,
      entry.browserDataApiConsumer,
      entry.realtimeConsumer,
      formatPrivileges(entry.anonPrivileges),
      formatPrivileges(entry.authenticatedPrivileges),
      entry.rlsEnabled ? "是" : "否",
      policySummary,
      publication,
      entry.targetClass,
      entry.reason,
    ].map(escapeMarkdownCell).join(" | ");
  });

  return [
    "# public 数据库访问矩阵",
    "",
    "> 本文由 [`scripts/db/access-matrix.ts`](../../scripts/db/access-matrix.ts) 的 canonical config 生成；表内 privilege、RLS、policy 和 publication 是 active migration 完成后的 terminal contract，并由 Local PostgreSQL 与 production read-only verifier 实际比对。",
    "",
    "## 结论",
    "",
    "- 当前 active chain 的 66 张 application-owned `public` base table 全部归类为 `server_only`。业务数据库只由 server-side Drizzle 访问，browser Data API consumer 为零。",
    "- `users`、`user_sessions`、`admin_invites`、`admin_invite_claims`、`season_admin_grants`、`audit_logs`、education evidence、Major prestart/runtime 和 bracket runtime 均按高敏感 server-only 处理。",
    "- 2026-09-03 production 只读 inventory 在 migration 前确认 `competition_bracket_states` 是明确的 anon/authenticated CRUD privilege 例外；Issue #395 的 forward migration 将其与其余表统一收口。",
    "- `DraftLiveRoom` 与 `CaptainVotingPanel` 的 Realtime subscription 已删除。两处继续使用既有 10 秒 polling fallback；`ResetPasswordForm` 保留 browser Supabase client，但仅调用 Supabase Auth，不调用 public table Data API。",
    "- `supabase_realtime` publication 不应包含本矩阵中的任何表；若新增 direct Data API 或 Realtime surface，必须先新增明确 classification、最小 privilege、RLS policy、publication 说明和正反例测试。",
    "",
    "## Terminal access matrix",
    "",
    "| Table | Sensitivity | Domain | Server Drizzle consumer | Browser Data API consumer | Realtime consumer | anon privileges | authenticated privileges | RLS enabled | policy summary | publication membership | Target class | Reason |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row} |`),
    "",
  ].join("\n");
}

function formatPrivileges(privileges: readonly string[]): string {
  return privileges.length > 0 ? privileges.join(", ") : "无";
}

function normalizeTextArray(value: readonly string[] | string): string[] {
  if (typeof value !== "string") return [...value];
  if (value === "{}") return [];
  return value
    .slice(1, -1)
    .split(",")
    .map((item) => item.replace(/^"|"$/g, "").replaceAll('\\"', '"').replaceAll('\\\\', '\\'))
    .filter(Boolean);
}

function escapeMarkdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

function diffNames(expected: readonly string[], actual: readonly string[]): string[] {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  return [
    ...expected.filter((name) => !actualSet.has(name)).map((name) => `missing ${name}`),
    ...actual.filter((name) => !expectedSet.has(name)).map((name) => `unclassified ${name}`),
  ];
}

function compare(
  failures: string[],
  table: string,
  label: string,
  expected: unknown,
  actual: unknown,
): void {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    failures.push(`${table}: ${label} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
