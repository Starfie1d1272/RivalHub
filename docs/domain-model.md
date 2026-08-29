# RivalHub 领域模型

本文件描述稳定领域关系，而不是字段百科。精确列、约束与 migration history 以 `src/db/schema/` 和 `drizzle/migrations/` 为准。

## 1. Accounts / Identity

`users` 将应用账户关联到 Supabase Auth，并保存角色、跨赛事展示资料、Steam 与 Perfect World identity。`users.role` 为 `user`、`season_admin` 或 `super_admin`；`admin_users` 仅保存 legacy emergency Root 兼容身份，`admin_invites` 支持正常账号的管理员授予。

`users.studentId` 是 legacy compatibility field，不能作为 Major eligibility source。

## 2. Education

`institutions` 与 `institution_email_domains` 是机构目录；`education_verifications` 是用户的长期教育资格事实，含 institution、学籍状态、证据类型与审核状态。Major 在需要时引用已验证教育事实，而不从旧用户字段推断资格。

## 3. Competitive profile

`competitive_platform_seasons` 管理竞技平台赛季目录及其时间顺序和当前赛季；platform + seasonKey 是目录项的不可变身份。`competitive_rank_facts` 存储用户对任意已编目平台赛季或跨赛季 peak 的可审查竞技事实。它们是独立于某届 RivalHub 赛事的长期资料。发布 requireCompetitiveProfile 的赛事时，目录的 current、previous 与 rank order 被冻结进该赛事的 `teamRegistrationConfig`，之后的目录变化不回写已发布赛事。

## 4. Seasons

`seasons` 是赛事容器，包含状态、时间、人数、positions 与 capability configuration。Rivals、Major 与自定义赛事由 canonical template factory 建立初始定义；`competitionTemplate` 是持久化的模板身份 owner，编辑时服务端以其为准，draft 内置赛事每次保存都重新 canonicalize 固定语义；`kind` 只用于展示。报名方式、选秀、阶段和资格规则由 capability fields 及关联配置决定。StagePlan 是可变的赛季定义，启动后不能代替冻结的 StageRun 事实。

## 5. Rivals registrations

`season_registrations` 是 Rivals 的本届个人报名，包含位置、报名期竞技快照、地图偏好和审核状态。`registration_drafts` 服务于可恢复的表单编辑。它们不是 Major team application 的替代物。

## 6. Team applications

`team_applications` 表示 Major 报名阶段的队伍申请；`team_application_members` 记录邀请、确认和申请期成员关系；`team_application_active_claims` 防止同一用户在同一赛季出现冲突的 active claim。审核通过后申请物化为正式 `teams` 与 `team_members`，并保留 provenance。

这是 RC4 的 season-bound 实现，不是未来长期 Team 的最终模型。2.x 已接受以 CompetitionEntry 表达长期 Team 与某届赛事的参与关系，但现有 application 如何迁移、兼容或退役仍需单独设计。

## 7. Teams

`teams` 是 RC4 比赛运行时的 season-bound 正式队伍，包含 `captainUserId` 与来源；`team_members` 是正式的赛季队伍成员。Rivals 通过个人报名/选秀产生来源，Major 通过 approved application 产生来源。普通 `teams`、`match_rosters` 和 `draftOrder` 不能替代 Major entrants、最终名单或赛事种子。

2.x 的目标模型把 Team 提升为独立于赛事的长期一级实体，并以带时间历史的 TeamMembership 表达成员加入、离队与队长交接。Team 不属于 Season；CompetitionEntry 保存某届赛事的 roster、队长、资格、审核、种子、快照和最终成绩。长期 Team 后续变更不得改写冻结的赛事 roster。Rivals 选秀队可以是 `teamId = null` 的赛事临时参赛者，不为历史 Rivals 队伍补造长期 Team。这里只记录领域边界，不提前确定迁移和最终 schema；完整决策见 [`decisions/2.x-product-domains.md`](./decisions/2.x-product-domains.md)。

## 8. Captain voting / draft

`captain_votes` 是 Rivals 投票记录。`draft_state` 维护单届实时选秀状态，`draft_picks` 用 `clientRequestId` 支持幂等。选秀与队员写入在同一事务内完成，事务完成后才可发送 Realtime。

## 9. Matches

`matches` 表示赛程和比赛状态，并区分 `manual` 与 `major_stage` ownership。`match_maps`、`match_veto_steps`、`match_time_proposals`、`match_mvp_votes` 与 `match_player_stats` 记录比赛细节。结果更正必须保留 audit 与适用的运行时边界。

## 10. Match rosters

`match_rosters` 与 `match_roster_players` 是具体比赛的提交/确认阵容；它们把某一场比赛的可操作名单与 live team membership 分开。Major match roster 校验基于对应的冻结阶段事实。

## 11. Major prestart

`major_prestart_states`、`major_prestart_entrants`、`major_prestart_roster_members`、`major_tournament_seeds` 与 `major_prestart_issues` 管理开赛前的 readiness、参赛队、最终名单、种子和 blocker。只有完成相应确认的预启动事实才能被 Major start 消费。

## 12. Major stage runtime

`major_stage_runs` 冻结阶段规则与运行时 identity；`major_stage_entrants` 是阶段参与者的 canonical truth；`major_final_results` 记录待确认/已确认的最终结果。冻结 affiliation / rule snapshot 支持恢复、审计和历史复现，不应被当作可去重的重复数据。

## 13. Discipline

`disciplinary_cases` 与 idempotency records 管理 sanction 的状态、范围与效果。纪律事实不自动重写 placement、honor 或比赛结果；关联影响通过明确的 adjudication 工作流处理。

## 14. Post-event

`post_event_adjudications` 保存赛后裁决，`tournament_honors` 保存冠军、亚军、名次或手动奖项及其有效/撤销/空缺状态。冠军被撤销不会自动把亚军提升为冠军；每项历史事实需要独立裁决。

`tournament_honors` 继续是最终官方荣誉事实。未来奖项定义、候选或资格、申请或提名、材料、审核与补充、最终授予和领取确认属于独立产品流程；其模板、自动资格、申领范围、材料要求和状态仍待产品决策，不能从当前 honor 表反推答案。

## 15. Audit

`audit_logs` 是管理操作的持久审计轨迹。它与业务事实互补，不代替可查询的领域状态。管理员写操作必须同时考虑结果与审计记录。

## 16. Operational/support data

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

| 不变量 | 主要 owner |
|---|---|
| email 与 Auth identity 的唯一性 | DB unique constraints + Auth 同步 |
| 一用户同赛事仅有一个 active team application claim | `team_application_active_claims` unique constraint + transaction |
| application 的可编辑性与状态迁移 | team-application domain action / state rules |
| affiliation 与竞技资格 | `src/lib/qualification/` 单一 owner：batch fact loaders + pure evaluators |
| 内置赛事模板身份与固定语义 | `seasons.competitionTemplate` + canonical template factory（draft 保存时重新 canonicalize） |
| 发布时的竞技上下文冻结 | `publishSeason` 事务：catalog current/previous/rank order → season frozen competitiveProfile |
| 队长交接的并发安全 | application/team 行锁 + season 行锁 + 目标成员 `FOR UPDATE`，全部判断基于锁定行 |
| Major prestart readiness | prestart domain service 与明确 blocker |
| StageRun 规则与参赛成员冻结 | rule snapshot + managed runtime |
| 一场 Major 比赛恰好 5 名首发 | match-roster service 与 lineup evaluator |
| 管理 mutation 的审计 | Server Action transaction + `audit_logs` |
| team logo 类型与大小 | server upload validation + Storage bucket |
| public Data API 默认拒绝 | active migration 的 grants / RLS |

DB constraint、transaction、domain evaluator 与 frozen snapshot 各自覆盖不同的风险。不能以任一层替代另一层，也不应把需要业务语义的约束伪装为单纯字段检查。
