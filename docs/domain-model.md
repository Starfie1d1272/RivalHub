# RivalHub 领域模型

本文件描述稳定领域关系，而不是字段百科。精确列、约束与 migration history 以 `src/db/schema/` 和 `drizzle/migrations/` 为准。

## 1. Accounts / Identity

`users` 将应用账户关联到 Supabase Auth，并保存角色、跨赛事展示资料、Steam 与 Perfect World identity。`users.role` 为 `user`、`season_admin` 或 `super_admin`；`admin_users` 仅保存 legacy emergency Root 兼容身份，`admin_invites` 支持正常账号的管理员授予。

`users.studentId` 是 legacy compatibility field，不能作为 Major eligibility source。

## 2. Education

`institutions` 与 `institution_email_domains` 是机构目录；`education_verifications` 是用户的长期教育资格事实，含 institution、学籍状态、证据类型与审核状态。Major 在需要时引用已验证教育事实，而不从旧用户字段推断资格。

## 3. Competitive profile

`competitive_platforms` 是竞技平台的长期一级实体：平台持有稳定技术 key（创建后 immutable）、可修改的显示名称与 canonical performance Rating label（如完美世界的 Rating Pro、5E 的 Rating+；不是 Valve Premier CS Rating 这类 matchmaking / ladder score）。平台段位表 `competitive_platform_ranks` 由平台统一拥有：`rankKey` 是稳定身份、`label` 是可改的展示名，`sortOrder` 表达由低到高。平台赛季 `competitive_platform_seasons` 只表达时间目录（platform + seasonKey 不可变身份、显示名、时间顺序、active 与唯一 current），不再拥有段位顺序。previous 赛季由时间顺序推导，没有第二个 mutable 标记。

`competitive_rank_facts` 存储用户对任意已编目平台赛季或跨赛季 peak 的可审查竞技事实；`rank` 保存平台段位表的稳定 rankKey，不因管理员重命名 label 而失效；`rating` 保存该平台唯一 canonical performance Rating，不是 matchmaking score。发布 requireCompetitiveProfile 的赛事时，平台目录的 current、previous 与当时生效的平台段位表（rankKey 序列）被冻结进该赛事的 `teamRegistrationConfig`，之后的目录变化不回写已发布赛事。删除或重排已被长期事实或冻结赛事上下文引用的段位会 fail closed；真实的平台段位体系调整应建立版本化 ladder，而不是覆盖历史语义。

## 4. Seasons

`seasons` 是赛事容器，包含状态、时间、人数、positions 与 capability configuration。Rivals、Major 与自定义赛事由 canonical template factory 建立初始定义；`competitionTemplate` 是持久化的模板身份 owner，编辑时服务端以其为准，draft 内置赛事每次保存都重新 canonicalize 固定语义；`kind` 只用于展示。报名方式、选秀、阶段和资格规则由 capability fields 及关联配置决定。StagePlan 是可变的赛季定义，启动后不能代替冻结的 StageRun 事实。

## 5. Rivals registrations

`season_registrations` 是 Rivals 的本届个人报名，包含位置、报名期竞技快照、地图偏好和审核状态。`registration_drafts` 服务于可恢复的表单编辑。它们不是 Major Entry 报名的替代物。

## 6. Long-lived Teams and CompetitionEntry

`teams` 是独立于赛事的长期队伍；`team_memberships`、队长任期、名称历史和邀请表达其成员与治理事实。Team 不属于 Season。

`competition_entries` 是从报名草稿到赛事历史的唯一参赛身份。Major 通常由长期 Team 创建 Entry；Rivals 选秀队为 `teamId = null` 的赛事队伍。`competition_entry_participants` 表示本届参赛确认，报名名单 revision 表示审核材料，`event_rosters`/成员表示赛前确认名单，`match_rosters`/成员表示单场出场阵容。三层人员事实不得互相替代。

旧 `team_applications`、season-bound `teams` 和 `team_members` 已由 active schema 退役；迁移 provenance 仅支持历史追溯，不参与运行时授权或比赛 identity。

## 7. Captain voting / draft

`captain_votes` 是 Rivals 投票记录。`draft_state` 维护单届实时选秀状态，`draft_picks` 用 `clientRequestId` 支持幂等。选秀与队员写入在同一事务内完成，事务完成后才可发送 Realtime。

## 8. Matches

`matches` 表示赛程和比赛状态，并区分 `manual` 与 `major_stage` ownership。`match_maps`、`match_veto_steps`、`match_time_proposals`、`match_mvp_votes` 与 `match_player_stats` 记录比赛细节。结果更正必须保留 audit 与适用的运行时边界。

## 9. Match rosters

`match_rosters` 与 `match_roster_players` 是具体比赛的提交/确认阵容；它们把某一场比赛的可操作名单与冻结赛事名单分开。Major match roster 校验基于对应的冻结阶段事实。

## 10. Major prestart

`major_prestart_states`、`major_prestart_entrants`、`event_rosters`/成员、`major_tournament_seeds` 与 `major_prestart_issues` 管理开赛前的 readiness、参赛队、最终名单、种子和 blocker。只有完成相应确认的预启动事实才能被 Major start 消费。

## 11. Major stage runtime

`major_stage_runs` 冻结阶段规则与运行时 identity；`major_stage_entrants` 是阶段参与者的 canonical truth；`major_final_results` 记录待确认/已确认的最终结果。冻结 affiliation / rule snapshot 支持恢复、审计和历史复现，不应被当作可去重的重复数据。

## 12. Discipline

`disciplinary_cases` 与 idempotency records 管理 sanction 的状态、范围与效果。纪律事实不自动重写 placement、honor 或比赛结果；关联影响通过明确的 adjudication 工作流处理。

## 13. Post-event

`post_event_adjudications` 保存赛后裁决，`tournament_honors` 保存冠军、亚军、名次或手动奖项及其有效/撤销/空缺状态。冠军被撤销不会自动把亚军提升为冠军；每项历史事实需要独立裁决。

`tournament_honors` 继续是最终官方荣誉事实。未来奖项定义、候选或资格、申请或提名、材料、审核与补充、最终授予和领取确认属于独立产品流程；其模板、自动资格、申领范围、材料要求和状态仍待产品决策，不能从当前 honor 表反推答案。

## 14. Audit

`audit_logs` 是管理操作的持久审计轨迹。它与业务事实互补，不代替可查询的领域状态。管理员写操作必须同时考虑结果与审计记录。

## 15. Operational/support data

`user_sessions` 仅用于在线状态心跳，不是鉴权来源。Storage、Auth 与 Data API 的安全边界见 [`auth-and-permissions.md`](./auth-and-permissions.md)。

## Intentional snapshots

下列看似重复的数据是故意冻结的历史事实，支持 audit、historical truth、recovery 与 reproducibility：

| Live fact | Frozen or event-specific fact |
|---|---|
| Team application | approved formal team |
| live team membership | frozen tournament entrant / roster |
| mutable season policy | StageRun rule snapshot |
| current match result | correction / adjudication history |
| current education verification | historical eligibility reference |

清理重复时必须先确认没有破坏这些边界。

## Key invariants and ownership

### Canonical Owner Map

| 事实或能力 | Canonical owner |
|---|---|
| 人类可读用户身份（公开） | `src/lib/identity/display-name.ts` → `getPublicDisplayName()` |
| 人类可读用户身份（内部） | `src/lib/identity/display-name.ts` → `getDisplayName()` |
| 竞技平台目录 / current / previous chronology | `src/lib/competitive/catalog.ts` |
| 资格与 readiness | `src/lib/qualification/` |
| Dialog / modal primitive | `src/components/ui/dialog.tsx` |
| bracket adapter | `src/lib/bracket/` |
| Major Swiss | `src/lib/major/swiss.ts` |
| 比赛 roster | `src/lib/match-rosters/` |
| migration scratch replay 基础设施 | `scripts/db/migration-replay.ts` |

| 不变量 | 主要 owner |
|---|---|
| email 与 Auth identity 的唯一性 | DB unique constraints + Auth 同步 |
| 一用户同赛事仅有一个 active Entry commitment claim | `competition_entry_active_claims` unique constraint + transaction |
| Entry 报名 revision 的可编辑性与状态迁移 | competition-entry domain action / state rules |
| affiliation 与竞技资格 | `src/lib/qualification/` 单一 owner：batch fact loaders + pure evaluators |
| 内置赛事模板身份与固定语义 | `seasons.competitionTemplate` + canonical template factory（draft 保存时重新 canonicalize） |
| 发布时的竞技上下文冻结 | `publishSeason` 事务：platform catalog current/previous/ladder → season frozen competitiveProfile（单一 owner：`src/lib/competitive/catalog.ts`） |
| 队长交接的并发安全 | application/team 行锁 + season 行锁 + 目标成员 `FOR UPDATE`，全部判断基于锁定行 |
| Major prestart readiness | prestart domain service 与明确 blocker |
| StageRun 规则与参赛成员冻结 | rule snapshot + managed runtime |
| 一场 Major 比赛恰好 5 名首发 | match-roster service 与 lineup evaluator |
| 管理 mutation 的审计 | Server Action transaction + `audit_logs` |
| team logo 类型与大小 | server upload validation + Storage bucket |
| public Data API 默认拒绝 | active migration 的 grants / RLS |

DB constraint、transaction、domain evaluator 与 frozen snapshot 各自覆盖不同的风险。不能以任一层替代另一层，也不应把需要业务语义的约束伪装为单纯字段检查。
