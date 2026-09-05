# RivalHub 工作流

本文件描述当前 2.0 实现的生命周期与 owner boundary。政策规则由 [`rules/`](./rules/) 定义；精确 action 输入和错误码以 code 为准。

## 1. Account / Auth

用户通过 `/login` 进行 Supabase email/password 注册或登录。注册后邮件链接只会打开确认页；用户显式确认后才验证 token、建立 `rivalhub-session`。登录会同步应用账户并建立会话。密码恢复通过邮件跳转 `/reset-password`。

## 2. Long-lived participant profile

`users` 承载 display/profile、QQ、Steam 与 Perfect World identity 等跨赛事 participant profile。现有 Rivals 个人报名仍保留部分历史报名字段和赛事快照；2.x 的“我的”聚合与长期 Team/赛事参与边界见 [`decisions/2.x-product-domains.md`](./decisions/2.x-product-domains.md)。

## 3. Education verification

用户提交长期教育资格材料；系统按 institution、academic status 和证据类型审核。Major eligibility 引用已验证的教育事实；`studentId` 不参与 Major eligibility。

## 4. Competitive profile

数据 owner 是 `competitive_platforms`、`competitive_platform_ranks`、`competitive_platform_seasons` 与 `competitive_rank_facts`：平台拥有 rank ladder，平台赛季只表达时间目录，竞技事实引用其中的稳定身份。`/settings/competitive` 直接读取全局目录，不依赖已发布 RivalHub 赛事；当前赛季、上一赛季置顶，其他仍启用的已编目赛季也可维护，未来赛季可以留空，历史赛季资料可补录。赛事 qualification evaluator 只检查该赛事冻结上下文要求的 exact season keys，因此目录推进不会让冻结了旧赛季的赛事资格失效。

## 5. Rivals solo registration

Rivals 用户在报名窗口填写个人报名并可保存草稿。提交由 Server Action 再次校验人数、位置与赛季窗口；管理员审核为 pending、approved、rejected 或 waitlisted。

## 6. Captain voting

已审核用户在投票阶段为候选队长投票或撤票。投票资格、上限和状态由服务端校验；管理员确认队长后创建 Rivals 的 CompetitionEntry（`teamId = null`）与选秀顺位。

## 7. Rivals draft

队长/管理员操作选秀时，系统以行锁锁定 `draft_state`，先判定 `clientRequestId` 幂等，再验证轮次、身份、位置与可选性，在同一事务写 pick、Entry participant / roster member / event roster member 与下一轮状态。commit 后由直播页面通过服务端刷新/轮询读取最新事实。

## 8. Major entry registration

长期 Team 的队长为赛事创建 CompetitionEntry（`createCompetitionEntry`），维护可编辑的报名名单 revision（`saveCompetitionEntryRoster`）并可把代表职责转给当前已确认成员（`transferCompetitionEntryRepresentative`）。一个用户在同届赛事只能保有一个符合 `competition_entry_active_claims` 约束的 active commitment。提交前由服务端 qualification owner（batch facts + pure evaluators）汇集身份、教育、竞技和 Entry 事实执行资格判断。长期 Team 本身的成员邀请、队长交接与解散独立于赛事进行。

## 9. Participant confirmation

受邀成员以 Entry participant 身份确认或拒绝参赛（`confirmCompetitionEntryParticipation` / `declineCompetitionEntryParticipation`）。未确认成员不能被当作已完成的参赛成员；成员变更会重新影响 Entry readiness。

## 10. Entry review

管理员对 submitted entry 审核为 approved、waitlisted、rejected 或 changes_requested（`reviewCompetitionEntry`）。changes_requested/rejected entry 可由队长编辑并再次提交。approved entry 收敛到 approved roster revision；这一步不等同于进入 Major tournament（见 prestart）。

## 11. Major prestart

Major prestart 将已批准的 CompetitionEntry 作为候选池。标准 Major 的最终 entrant 容量由 canonical stage plan 的 direct entrant cohorts 派生（阶段一、二、三为 16 / 8 / 8，当前合计 32）；管理员一次提交最终 Entry 集合，事务会从每个 Entry 的 `approvedRosterRevisionId` materialize / reconcile Entry-owned EventRoster，并保留主力与教育证据。名单调整必须由队长和成员在 Entry roster-change 流程中完成、重新审核后自动同步；管理员只处理明确 blocker/例外，再用一次统一动作冻结正式参赛队与 EventRoster。该统一 freeze command 随即读取每队恰好 5 名 frozen primary starters、event-owned competitive context 与 canonical `getPlayerStrengthBreakdown(...).weightedRank`，将简单平均后的 TeamSeedStrength、system rank/tie group、每人 breakdown/provenance 和 frozen-set identity 追加为 immutable `SeedRecommendationSnapshot`；snapshot 缺失、输入不一致或任何 strength evidence 不可计算时整个事务 fail closed。管理员随后在 `majorTournamentSeeds` 中编辑最终顺序，跨 recommendation group 必须提交持久化 override reason 并产生 audit；同一 snapshot 不因查看排序或人工拖动而变化。readiness 必须给出具体 blocker 与下一步操作。锁定后的预启动事实和已有 snapshot 被 `startMajor` 消费，创建 Stage 1 运行时；start 不负责首次生成建议，预览 opening plan 不能替代完整 readiness。
特殊的名单补正、重新开放或确认动作只用于处理明确例外，必须填写原因并产生审计记录；正常流程不提供逐队管理员名单选择器。

赛事工作区按生命周期组织这些能力：`/admin/{seasonSlug}` 只展示 lifecycle、时间、按报名模式投影的摘要、当前赛前 readiness 和下一步 CTA；完整 Major 赛前操作位于 `/prestart`。Rivals 的队长确认和选秀保留 `/captains`、`/draft` URL，并作为 `/prestart` 下的 capability 入口展示。工作区 shell 消费 `hasCaptainVoting`、`hasDraft`、`hasCommunityAwards` 与 StagePlan，不为不同赛事模板复制导航。

## 12. Stage runtime

Major 的 Swiss 阶段由 managed StageRun 运行。每次 pairing、回合结算、推进和恢复都绑定 StageRun；canonical truth 来自 entrants 与已完成比赛。阶段 1、2 的普通比赛为 BO1，晋级/淘汰局为 BO3；阶段 3 全部为 BO3。淘汰赛 QF BO3、SF BO3、Final BO5。

赛事级 `/admin/{seasonSlug}/matches` 是比赛总览 read-model：承载阶段、standings、赛程、筛选、批量截止时间和既有 Swiss/Playoff runtime 控件。总览只读取比赛摘要与阶段状态，不加载整届 event roster、match roster、BP/地图明细、赛后提交详情或 OCR 数据；其中解说有效场次统计只聚合已完成、有录像、已提交赛后资料且已登记解说的轻量比赛摘要。每场列表通过 `/admin/{seasonSlug}/matches/{matchId}` 进入单场比赛工作台。

单场比赛工作台按概览、首发、BP/地图、结果、赛后资料和危险操作/恢复组织内容。它只读取当前比赛及双方 frozen event roster、实际 match roster、地图/结果、解说/赛后资料和开赛前 preflight，并复用既有 `src/actions/matches/`、roster、veto、post-match 与 OCR 组件。比赛 actual lineup 是本场事实，可以不同于赛事 primary starter；workbench 不新增 match truth source，也不复制 Major runtime。Swiss/Playoff 阶段推进不再挂在赛事 root。

## 13. Match roster

Entry 为具体比赛提交或由管理员选定阵容；阵容成员必须是该 Entry frozen event roster 的成员。Major roster 检查阶段冻结的 affiliation 和参赛事实；缺少或不符合要求的阵容不能被伪造为可用，数据库 invariant 拒绝引用其他 Entry 名单成员的 lineup。

## 14. Match execution / result

比赛可进行时间协商、BP、地图结果与赛果录入。正常比赛先由 BP 确定实际地图并建立 pending `match_maps`，再由 `recordMapResult` 写入实际地图回合比分，并从已完成地图推导 `matches` 的官方系列赛比分；弃赛只写官方系列赛结果，不制造未进行的地图。结果由对应 Server Action 验证、写审计并在适用时推进赛程。管理的 Major match 必须通过其 runtime owner 结算。

## 15. Result correction

管理员更正结果时，系统检查比赛、StageRun、后续阶段和恢复限制。更正不会以 UI projection 或 standings 覆盖 canonical facts；需要重新配对时走受控 recovery。

## 16. Discipline

管理员创建、执行、撤销或到期处理 disciplinary case。纪律与比赛、名次、荣誉通过明确的事实和审计连接，不做隐式递补。

## 17. Community awards

社区奖是独立的赛事 capability，不是 post-event 的子流程。新赛事默认启用；管理员只能在 draft 阶段显式关闭，发布后随赛事公开规则冻结。能力开启时，用户可提交社区奖，管理员可审核、要求补充、处理证据并记录或纠正结果；这些 transition 继续由 `src/lib/community-awards/service.ts` 的既有 owner 写入审计。

`hasCommunityAwards = false` 时，公共和后台页面以现有 unavailable / `notFound()` contract fail closed，导航不显示社区奖入口，且 service 事务边界拒绝提交、修改、审核、补充、撤回、证据和结奖 mutation。是否可用不由 `season.status` 或结束时间推导，因此社区奖可以跨发布前、赛事进行中和赛后生命周期运行。

## 18. Post-event / archive

Major 最终结果先处于 `pending_confirmation`，确认后生成可引用的 final result、placement 与 honor。赛后 adjudication 与 archive 遵守各自的状态和权限边界；归档后通常比赛变更受限，专门的赛后工作流仍保留明确入口。非 Major 赛事的 `/post-event` 只提供通用 closure 摘要，不推导 Major 专属的官方名次或荣誉事实。

赛事工作区的 `/admin/{seasonSlug}/post-event` 独立承载 capability 适用的 closure、官方结果、裁决、荣誉和归档；Major 使用完整 final-result editor，非 Major 只呈现通用 closure 摘要。root 只展示待处理摘要，不加载这些完整 editor。`/discipline` 与 `/logs` 属于跨生命周期的赛事治理 utility，继续复用原有 discipline/audit owner。

## Compact state contracts

状态枚举和 action guard 是精确 authority；下表保留跨模块修改时必须理解的稳定生命周期。

### Season

```text
Rivals: draft → registration → voting → drafting → playing → finished → archived
Major:  draft → registration → playing → finished → archived
```

Rivals 的 voting/drafting 由 capability 启用；Major start 在 readiness、entrants、final rosters 和 seeds 确认后创建 Stage 1。`archived` 是历史赛季终态，任何例外操作必须走明确的赛后 owner。

补充生命周期边界：

- 发布（draft → registration）只让赛事公开；报名可处于待定或已排期状态，尚不冻结竞技上下文。
- 实际报名开放由 `openSeasonRegistrationInTx` 在同一事务内记录 `registrationOpenedAt`、冻结 requireCompetitiveProfile 赛事的 current/previous/rank order 及证据策略，并写入审计。
- 全局管理后台按 presentation-only 生命周期目录展示赛事：`playing`、`voting`、`drafting` 与已实际开放报名的 `registration` 归入“进行中”；`registration` 但 `registrationOpenedAt IS NULL` 归入“即将开始”；`draft`、`finished`、`archived` 分别归入草稿、最近结束和已归档。公共首页通过 `selectFeaturedSeason` 按 `playing` > `voting`/`drafting` > 已开放 `registration` > 未开放 `registration` > 最近 `finished` 的固定优先级选择主赛事，同一优先级按 `createdAt` 新到旧并以 `id` 稳定打破平局，`archived` 不进入选择，不产生全局 current-season 事实。
- 撤回（registration → draft）与删除共用“无报名/队伍/赛程事实”guard；通过后撤回会解除 built-in 赛事的竞技冻结，下一次实际开放报名重新解析目录。
- 删除（draft → deleted）拒绝已有 invite claim 的赛季；未领取的邀请码与其 claim ledger 随赛季删除，`season_admin_grants` 通过 season FK cascade 清理，`audit_logs.season_id` 为 SET NULL，并写入全局 `season.deleted` 审计。
- 赛季设置的编辑能力由 `src/lib/seasons/edit.ts` 的纯 capability contract 统一派生：发布（`draft → registration`）即锁定 slug、模板、报名模式、投票/选秀能力、队伍规模、positions、stage plan、map pool、`registrationConfig`、归属/资格规则及其它公开赛事规则，不因报名尚未开放而继续改赛制。
- `hasCommunityAwards` 同样属于公开赛事规则：新赛事默认启用，draft 可关闭；发布后锁定，关闭时 public/admin route、导航和全部社区奖 mutation 均不可用。
- 已发布但尚未实际开放报名时（`status = registration` 且 `registrationOpenedAt IS NULL`），仍可调整报名开放/截止/名单调整时间、`endAt`、名称和主题色；当前过渡期的 Major event-owned 5E `fallbackConversion` 也仅在此阶段允许调整。实际开放由 `openSeasonRegistrationInTx` 记录不可变的 `registrationOpenedAt`，并冻结本届 competitive context 与 fallback。
- 实际开放后到比赛开始前，`registrationOpensAt` 与 competitive context/fallback 永久冻结，但 `registrationClosesAt`、`rosterChangeClosesAt` 仍可运营调整；进入 `playing`、`finished` 或 `archived` 后，这两个报名运营 deadline 也锁定。名称、主题色与 `endAt` 仍属于允许的 metadata。
- `revertSeasonToDraft` 成功后会清除实际开放事实并解除 built-in 竞技冻结，赛季重新获得 draft 的完整编辑能力；#365 的 versioned canonical 5E policy 不在本流程内。

管理端赛事设置页按“基本信息 / 时间与生命周期 / 报名与名单 / 资格规则 / 赛制与地图 / 竞技参考 / 功能 / 危险操作”组织现有设置。它复用上述 capability、lifecycle、qualification、StagePlan 与 ConversionPolicy owner；当规则或竞技上下文已冻结时，页面在对应分区同时展示状态、冻结原因与 canonical identity/version，而不是在客户端复制业务判断。

### Match

```text
scheduled → in_progress → finished
scheduled / in_progress → cancelled
```

forfeit 是 `finished` 的结果形态，不是额外比赛状态。结果更正、Major recovery 与赛后裁决使用各自受控 workflow，不能直接把已完成比赛改回进行中。

### Major StageRun and final result

`major_stage_runs` 不使用单独 status enum：创建 StageRun 即冻结规则与 entrant membership，`finalizedRound` 记录已被运营者接受的 Swiss 回合。来源阶段完整结算后才可创建下一阶段 StageRun。`major_final_results` 采用 `pending_confirmation → confirmed`；确认后的 placement、honor 与 archive 仍由明确的赛后流程拥有。

## Rivals draft transaction invariants

一个 pick 在同一 transaction 内完成：

1. 对 `draft_state` 执行 `SELECT … FOR UPDATE`；
2. 在当前轮次、队长和 deadline 校验之前查询 `clientRequestId`；同一请求的重试返回原 pick，跨 season/team/player 复用同一 id 则拒绝；
3. 校验 draft active、当前队伍、deadline、队长、目标报名状态、未被选择和位置上限；
4. 写入 `draft_picks`、Entry participant / roster member / event roster member 事实与 audit log；
5. 推进 `draft_state`，最后一 pick 将赛季推进为 `playing`；
6. commit 后 revalidate；直播页面只通过服务端刷新/轮询消费已提交的 `draft_state` 与 `draft_picks`。

幂等检查必须早于 turn/state 校验：第一次请求成功推进轮次后，安全重试仍需得到同一成功结果。
