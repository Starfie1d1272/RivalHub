# RivalHub 领域模型

本文件描述稳定领域关系，而不是字段百科。精确列、约束与 migration history 以 `src/db/schema/` 和 `drizzle/migrations/` 为准。

## 1. Accounts / Identity

`users` 将应用账户关联到 Supabase Auth，并保存角色、跨赛事展示资料、Steam 与 Perfect World identity。`users.role` 只允许 `user` 或 `super_admin`；`season_admin_grants` 保存用户对具体赛季的管理员授权，`admin_invites` 与 `admin_invite_claims` 支持正常账号的管理员授予和领取历史。

`users.studentId` 是 legacy compatibility field，不能作为 Major eligibility source。

## 2. Education

`institutions` 与 `institution_email_domains` 是机构目录；`education_verifications` 是用户的长期教育资格事实，含 institution、学籍状态、证据类型与审核状态。Major 在需要时引用已验证教育事实，而不从旧用户字段推断资格。

## 3. Competitive profile

`competitive_platforms` 是竞技平台的长期一级实体：平台持有稳定技术 key（创建后 immutable）、可修改的显示名称与 canonical performance Rating label（如完美世界的 Rating Pro、5E 的 Rating+；不是 Valve Premier CS Rating 这类 matchmaking / ladder score）。2.0 只内置 `perfect_world` 与 `fivee` 两个产品定义的平台目录，由 migration/bootstrap 建立，canonical owner 是 `src/lib/competitive/builtins.ts`（Perfect ladder 直接复用 `PERFECT_WORLD_RANK_ORDER`，5E below-S 共享同一基础）；后台不再提供“新增任意竞技平台”，只能维护既有内置目录的展示元数据。canonical performance Rating（Rating Pro / Rating+）由产品定义固定：migration 写入、runtime 读取、后台只读展示，不接受管理员修改，避免既有 rating 事实被重新解释。平台段位表 `competitive_platform_ranks` 由平台统一拥有：`rankKey` 是稳定身份、`label` 是可改的展示名，`sortOrder` 表达由低到高；S 段位携带 `starMin`/`starMax` 星数区间（无星段位两者皆 null，开放上限只有 `starMax` 为 null）。`BUILT_IN_COMPETITIVE_PLATFORMS` 是 bootstrap 与内置产品语义的 frozen definition，`isBuiltInStarRank()` 等派生判断从同一 rank definition 读取；数据库 catalog 仍是 runtime 的平台/段位展示与目录 owner。本次不扩展 `CompetitiveProfileConfig` 的 snapshot contract，StageRun 继续保存已解析的竞技事实，不能依赖未来 mutable catalog 重解释历史。平台赛季 `competitive_platform_seasons` 只表达时间目录（platform + seasonKey 不可变身份、显示名、时间顺序、active 与唯一 current），不再拥有段位顺序。previous 赛季由时间顺序推导，没有第二个 mutable 标记。

`competitive_rank_facts` 存储用户对任意已编目平台赛季或跨赛季 peak 的可审查竞技事实；`rank` 保存平台段位表的稳定 rankKey，不因管理员重命名 label 而失效；`rating` 保存该平台唯一 canonical performance Rating，不是 matchmaking score。`rank` ≠ `stars` ≠ `rating`：`stars` 是 S 段位内部精确星数（非负整数，必须落在该段位 starMin/starMax 区间内），已定级的星段位在保存和赛事资格 readiness 中都必须有准确星数；迁移前未记录星数的 legacy 事实在存储层保持 NULL（不猜默认值），但用户重新保存或进入需要该事实的报名流程时必须补填，不能作为资料完整或人工解除限制的替代状态。stars 目前只是竞技事实，不参与 Major qualification 的加权排序；Major 外校相对实力检查会直接使用完美世界历史最高总星数。requireCompetitiveProfile 赛事在实际报名开放时冻结平台目录的 literal current、previous、rank order 与该届 evidence policy；发布只公开赛事，之后的目录变化不回写已经开放的赛事。删除或重排已被长期事实或冻结赛事上下文引用的段位会 fail closed；真实的平台段位体系调整应建立版本化 ladder，而不是覆盖历史语义。

CS2 地图也分为相互独立的事实 owner：`CS2_MAP_CATALOG` 是保留历史条目的稳定地图目录，`CURRENT_CS2_ACTIVE_DUTY_MAP_POOL` 是可轮换的当前 Active Duty；当前 Active Duty 为 `de_mirage`、`de_inferno`、`de_nuke`、`de_ancient`、`de_dust2`、`de_anubis`、`de_cache`。`user_map_preferences` 只保存用户明确填写的稳定目录事实，缺失地图保持 unknown；`season_registrations.mapPreferences` 是该赛事报名时的历史快照，`seasons.registrationConfig.mapPool` 则是赛事自身冻结的图池。跨上下文展示与报名预填由 `src/lib/maps.ts` 投影，不能把缺失事实转成 `basic` 或显式 `none`，也不能以赛事快照回写长期资料。

## 4. Seasons

`seasons` 是赛事容器，包含状态、时间、人数、positions 与 capability configuration。Rivals、Major 与自定义赛事由 canonical template factory 建立初始定义；`competitionTemplate` 是持久化的模板身份 owner，编辑时服务端以其为准，draft 内置赛事每次保存都重新 canonicalize 固定语义；`kind` 只用于展示。报名方式、选秀、社区奖、阶段和资格规则由 capability fields 及关联配置决定。`hasCommunityAwards` 默认开启，是独立于赛事阶段的公开能力：草稿可关闭，发布后随公开规则冻结；关闭时公开/后台入口及社区奖 server mutation 均不可用。StagePlan 是可变的赛季定义，启动后不能代替冻结的 StageRun 事实。后台编辑能力由 `src/lib/seasons/edit.ts#getSeasonEditCapabilities` 这一纯 owner 根据 persisted status 与 `registrationOpenedAt` 派生，SeasonForm 与 server planner 共用该语义，不按 `kind` 分支。全局赛事目录的生命周期分组是 presentation-only projection，由 `src/lib/seasons/presentation.ts#getSeasonLifecycleGroup` 根据 `status` 与实际报名开放事实 `registrationOpenedAt` 派生；它不创建 `currentSeasonId` 或其它全局 singleton。

赛事设置编辑页的 presentation IA 固定为八个分区：基本信息、时间与生命周期、报名与名单、资格规则、赛制与地图、竞技参考、功能、危险操作。分区只负责组织现有 owner 的输入或只读事实：写入仍统一经过 `SeasonForm → actions/seasons → planSeasonUpdate → getSeasonEditCapabilities`，生命周期按钮仍调用既有 transition action；`registrationOpenedAt`、冻结的 competitive context 与 `ConversionPolicy` identity/version 只作明确的 lifecycle/策略事实展示，不由页面重算资格、生命周期或换算规则。

单届赛事 workspace 也是 presentation/read-model boundary，不新增领域事实：root `/admin/{seasonSlug}` 只编排 lifecycle、时间、摘要、当前赛前 readiness 与下一步；`/prestart`、`/matches`、`/post-event` 分别消费赛前、阶段运行/比赛、赛后 closure read-model。overview 按 `registrationMode` 从 `competition_entries` 或 `season_registrations` 投影报名事实；Major 额外读取 entrant、名单、seed 与最终结果事实，非 Major 只展示通用摘要。导航由 capability 和 server authorization 决定，旧 `/captains`、`/draft` URL 保留为 Rivals 赛前子入口。

## 5. Rivals registrations

`season_registrations` 是 Rivals 的本届个人报名，包含位置、报名期竞技快照、地图偏好和审核状态。`registration_drafts` 服务于可恢复的表单编辑。它们不是 Major Entry 报名的替代物。

## 6. Long-lived Teams and CompetitionEntry

`teams` 是独立于赛事的长期队伍；`team_memberships`、append-only `team_captain_changes`、append-only `team_name_changes` 和邀请表达其成员与治理事实。Team 不属于 Season。

`recruitment_intents` 是平台级的当前组队意向：`team_recruiting` 属于一支 Team，`player_lft` 属于一个 Player；每个 owner 最多一条，`open` + `expiresAt` 才会公开。它只记录当次位置、可选目标赛事和说明，不复制 Team identity、成员关系、竞技档案或赛事报名事实。`recruitment_interests` 只表示 Player 希望 Team captain 查看公开资料；它既不是 TeamInvitation，也不是 TeamMembership。队伍招募只有当前 captain 可管理，正式入队仍只通过既有 TeamInvitation 流程。

`competition_entries` 是从报名草稿到赛事历史的唯一参赛身份。Major 通常由长期 Team 创建 Entry；Rivals 选秀队为 `teamId = null` 的赛事队伍。`competition_entry_participants` 表示本届参赛确认，报名名单 revision 表示审核材料，`event_rosters`/成员表示赛前确认名单，`match_rosters`/成员表示单场出场阵容。三层人员事实不得互相替代。

`competition_entry_restriction_overrides` 是 Entry 审核中的显式政策决定 ledger：每条记录绑定一个 Entry、当前 `rosterRevisionId`、typed qualification finding 的 `restrictionCode` 与完整 finding snapshot，另存具体理由、授予人/时间和可审计的撤销人/时间。snapshot 保留当时的 message 与 presentation/evidence metadata 供 audit/history 使用，但 finding identity 与 override matching 只使用 `code`、`waivable` 和规范化的 semantic metadata；对 `external_strength_gap` 而言，identity 仅包含双方最高星数与当前星差阈值，选中的 strongest player 的 user ID/label 不属于政策事实。文案或 evidence 选择变化本身不会使同一政策事实 stale。它只允许解除 `waivable=true` 的当前政策限制；身份、资料缺失和 roster/state 完整性 finding 不可被该表替代。新的 roster revision 不继承旧 revision 的有效解除。

旧 `team_applications`、season-bound `teams` 和 `team_members` 已由 active schema 退役；迁移 provenance 仅支持历史追溯，不参与运行时授权或比赛 identity。

## 7. Captain voting / draft

`captain_votes` 是 Rivals 投票记录。`draft_state` 维护单届选秀状态，`draft_picks` 用 `clientRequestId` 支持幂等。选秀与队员写入在同一事务内完成；直播页面通过服务端刷新/轮询读取已提交事实。

## 8. Matches

`matches` 表示赛程、比赛状态和官方系列赛结果；`scoreA/scoreB` 在 BO1、BO3、BO5 中始终是系列赛地图胜场比分。`match_maps` 持有所有实际进行地图的回合比分，正常 BO1 也必须有一行 scored map；弃赛不制造虚构地图。`match_veto_steps`、`match_time_proposals`、`match_mvp_votes` 与 `match_player_stats` 记录比赛细节。结果更正必须保留 audit 与适用的运行时边界。

管理端比赛总览与单场工作台是两个 presentation/read-model boundary：`src/lib/admin/matches/overview.ts` 只投影阶段、standings、赛程和轻量状态，并保留基于录像、赛后提交与解说分配事实的 season-level 有效场次聚合；`src/lib/admin/matches/workbench.ts` 才读取指定比赛的 roster、BP/地图、结果、赛后资料与 preflight。它们共享上述 canonical facts，不创建新的比赛、结果或 roster owner；概览中的比赛摘要只通过 workbench 链接进入单场操作。

## 9. Match rosters

`match_rosters` 与 `match_roster_players` 是具体比赛的提交/确认阵容；它们把某一场比赛的可操作名单与冻结赛事名单分开。Major match roster 校验基于对应的冻结阶段事实。

## 10. Major prestart

`major_prestart_states`、`major_tournament_entrants`、`event_rosters`/成员、`major_tournament_seeds` 与 `major_prestart_issues` 管理开赛前的 readiness、参赛队、最终名单、种子和 blocker。已批准的 `CompetitionEntry` 只是候选资格；最终 entrant 集合由管理员一次提交，选中的 Entry 的 `approvedRosterRevisionId` 是正常 EventRoster materialization / reconciliation 的唯一来源，自动保留主力和教育证据并进入 `confirmed`，全局锁定时才进入 `frozen`。只有完成相应确认的预启动事实才能被 Major start 消费。

## 11. Major stage runtime

`major_stage_runs` 冻结阶段规则与运行时 identity；`major_stage_entrants` 是阶段参与者的 canonical truth；`major_final_results` 记录待确认/已确认的最终结果。新的 StageRun 还冻结资格能力开关、外校星差阈值、批准名单的竞技事实和当前 revision 的有效政策解除；比赛只消费这些冻结事实。冻结 affiliation / rule snapshot 支持恢复、审计和历史复现，不应被当作可去重的重复数据。没有新资格能力字段的 legacy StageRun 不会被当前 3 星规则重新解释。

## 12. Discipline

`disciplinary_cases` 与 idempotency records 管理 sanction 的状态、范围与效果。纪律事实不自动重写 placement、honor 或比赛结果；关联影响通过明确的 adjudication 工作流处理。

## 13. Post-event

`post_event_adjudications` 保存赛后裁决，`tournament_honors` 保存冠军、亚军、名次或手动奖项及其有效/撤销/空缺状态。冠军被撤销不会自动把亚军提升为冠军；每项历史事实需要独立裁决。

`tournament_honors` 继续是最终官方荣誉事实。社区奖不写入此表，也不替代冠军、MVP、EVP 等官方荣誉。

## 14. Community awards

`community_awards` 与 `community_award_evidence` 是独立于 post-event 的社区奖流程事实。用户提交奖项名称、条件、奖品与说明，管理员可审核、要求补充或驳回；公开后由赛事相关人员提交候选、比赛或视频证据，管理员记录获奖、不颁、取消及必要的终态纠错。候选人与比赛必须属于当前赛事相关事实，public read model 只展示公开/终态以及提交者自己的待处理项。

社区奖生命周期可跨赛事发布前、进行中和结束后；它不由 `season.status` 推导是否可用。`seasons.hasCommunityAwards` 是唯一能力事实，`src/lib/community-awards/service.ts` 的事务边界统一校验该开关后再执行 submit、revise、review、supplement、withdraw、evidence 与 resolve；关闭时所有这些 mutation fail closed。该流程没有规则 DSL、自动评估、投票或支付语义。

## 15. Audit

`audit_logs` 是管理操作的持久审计轨迹。它与业务事实互补，不代替可查询的领域状态。管理员写操作必须同时考虑结果与审计记录。

## 16. Operational/support data

`user_sessions` 仅用于在线状态心跳，不是鉴权来源。应用 session 只保存 Supabase 用户身份，当前角色与赛季 grant 每次从数据库读取。Storage、Auth 与 Data API 的安全边界见 [`auth-and-permissions.md`](./auth-and-permissions.md)。

## Intentional snapshots

下列看似重复的数据是故意冻结的历史事实，支持 audit、historical truth、recovery 与 reproducibility：

| Live fact | Frozen or event-specific fact |
|---|---|
| long-lived Team / mutable Entry roster revision | approved formal EventRoster |
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
| CS2 稳定地图目录 / current Active Duty / 上下文投影 | `src/types/season.ts` + `src/lib/maps.ts` |
| 组队大厅 intent、有效期与 interest | `src/lib/recruitment/commands.ts` |
| 资格与 readiness | `src/lib/qualification/` |
| 资格限制解除 ledger | `src/lib/competition-entries/restriction-overrides.ts` + `src/lib/competition-entries/commands.ts` |
| CompetitionEntry 面向参赛者的状态文案 | `src/lib/competition-entries/presentation.ts` |
| Dialog / modal primitive | `src/components/ui/dialog.tsx` |
| bracket adapter | `src/lib/bracket/` |
| Major Swiss | `src/lib/major/swiss.ts` |
| 比赛 roster | `src/lib/match-rosters/` |
| migration scratch replay 基础设施 | `tests/integration/db/harness/migration-replay.ts` |

| 不变量 | 主要 owner |
|---|---|
| email 与 Auth identity 的唯一性 | DB unique constraints + Auth 同步 |
| 一用户同赛事仅有一个 active Entry commitment claim | `competition_entry_active_claims` unique constraint + transaction |
| Entry 报名 revision 的可编辑性与状态迁移 | competition-entry domain action / state rules |
| affiliation 与竞技资格 | `src/lib/qualification/` 单一 owner：batch fact loaders + pure evaluators |
| “我的”长期资料与赛事任务聚合 | `src/lib/my/readiness.ts` 只编排 Team、CompetitionEntry、qualification、discipline 与 catalog read model，不重算 eligibility 规则 |
| 内置赛事模板身份与固定语义 | `seasons.competitionTemplate` + canonical template factory（draft 保存时重新 canonicalize） |
| 全局赛事生命周期目录分组 | `src/lib/seasons/presentation.ts#getSeasonLifecycleGroup` + `groupSeasonsByLifecycle` |
| 公共首页主赛事选择 | `src/lib/home/navigation.ts#selectFeaturedSeason`（presentation-only，不持久化） |
| 单届赛事 workspace read-model 编排 | `src/lib/admin/season-workspace/{overview,major-prestart,post-event,selectors,types}.ts` + `/admin/[seasonSlug]` route pages（不拥有 mutation） |
| 管理端比赛总览与单场工作台 read-model | `src/lib/admin/matches/{overview,workbench,shared,types}.ts` + `/admin/[seasonSlug]/matches` routes（不拥有 mutation） |
| 赛事设置生命周期编辑能力 | `src/lib/seasons/edit.ts#getSeasonEditCapabilities` + `planSeasonUpdate`（UI 与 server 共用 capability contract） |
| 赛事公开能力（含社区奖） | `seasons.hasCommunityAwards` + `src/lib/seasons/edit.ts#planSeasonUpdate`（草稿可改，发布后冻结） |
| 社区奖 transition 与 capability guard | `src/lib/community-awards/service.ts`（事务内统一复用） |
| 报名开放时的竞技上下文冻结 | `openSeasonRegistrationInTx` 事务：platform catalog current/previous/ladder + evidence policy → season frozen competitiveProfile |
| 队长交接的并发安全 | application/team 行锁 + season 行锁 + 目标成员 `FOR UPDATE`，全部判断基于锁定行 |
| 一队/一人只有一条当前组队意向 | `recruitment_intents` owner shape + unique indexes + owner row lock |
| 组队意向写入锁序 | `User`（如需）→ `Team` → target `Season`（如需）→ `RecruitmentIntent` → `RecruitmentInterest`；只持有 intent ID 的命令先非锁定查询 Team，再取得 Team 锁并重校验 intent |
| 赛前名单与已批准报名名单的一致性 | `src/lib/major/prestart-entry.ts`：确认、锁定与正式开赛前校验 Entry 仍 approved、approved revision 存在且 event roster 已同步到该版本 |
| Major 标准定义、最终 entrant 选择与 EventRoster 同步 | `src/lib/major/standard.ts` + `src/lib/competition/definition.ts` + `src/lib/major/prestart-entrants.ts` + `src/lib/major/prestart-roster.ts`：canonical stage-plan capacity、Entry qualification re-check、最终集合 materialize、approved revision mirror、统一冻结与同事务 audit |
| Major 赛前事务锁顺序 | `season / majorPrestartState → CompetitionEntry → eventRoster → majorTournamentEntrant`；名单显式重同步只放宽 source revision guard，完成写入后再由同一 coherence owner 严格复核 |
| Major prestart readiness | prestart domain service 与明确 blocker |
| StageRun 规则与参赛成员冻结 | rule snapshot + managed runtime；开赛时按冻结 competitiveProfile 重验参赛事实后，以同一批读取结果序列化 `frozenCompetitiveFacts` |
| typed qualification finding 与政策解除 | `src/lib/qualification/` 产生 finding；`competition_entry_restriction_overrides` 只持久化当前 revision 的可解除 finding，并由 `src/lib/major/start.ts` 冻结到 StageRun |
| 一场 Major 比赛恰好 5 名首发 | match-roster service 与 lineup evaluator |
| 管理 mutation 的审计 | Server Action transaction + `audit_logs` |
| team logo 类型与大小 | server upload validation + Storage bucket |
| public Data API 默认拒绝 | `security/database-access-matrix.md` + active migration 的 grants / RLS |

DB constraint、transaction、domain evaluator 与 frozen snapshot 各自覆盖不同的风险。不能以任一层替代另一层，也不应把需要业务语义的约束伪装为单纯字段检查。
