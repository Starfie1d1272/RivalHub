# RivalHub 工作流

本文件只描述跨模块必须理解的生命周期与 owner boundary。领域实体见 [`domain-model.md`](./domain-model.md)；正式赛事规则见 [`rules/`](./rules/)；精确 action 输入、guard 和错误码以 code/tests 为准。

## Account and long-lived profile

```text
signup → confirmation email → explicit confirmation → application session
login  → password authentication → application session
forgot password → recovery email → reset password
```

Supabase Auth 负责登录身份；成功确认/登录后同步身份到对应的 `users.id` 并建立 `rivalhub-session`。用户可验证并绑定其他邮箱；其中任一已验证的学校邮箱都可完成学校邮箱教育认证，不要求替换当前登录邮箱。若该身份已属于另一个 user，系统建立短期双方控制授权，用户选择要保留的账号后查看归并影响；真实冲突会直接阻止执行。安全归并在单个事务内写入 alias ledger 与 audit，保留所选账号资料，归属不冲突的 person facts、登录身份和业务历史，关闭旧账号的临时状态，随后 session 解析到保留账号。长期资料、教育资格、竞技档案和 Team 独立于任何一届赛事维护；其中 `users` 拥有当前 player-declared profile，`season_registrations` 只保存报名当时的自述 snapshot；赛事只在需要时引用或冻结这些事实。

## Education verification

教育认证保持三条有明确优先级的路径：已验证且命中唯一学生邮箱 registry 的 identity 即时认证在读身份；CHSI 在线验证报告由 super admin 人工核验；暂时无法取得 CHSI 材料的新生可从 canonical 高校目录选择学校并提交一张录取通知书图片，由 super admin 人工核验。录取通知书路径固定写入 `enrolled + manual_other + pending`，不证明毕业身份，也不接受自由文本学校。

提交者必须是当前 canonical user、拥有 verified email ownership fact，并选择存在的 canonical institution。人工审核 claim 使用事务 advisory lock：pending/approved claim 返回既有结果，rejected 后再次提交会创建新的 immutable claim，旧审核历史不改写；CHSI 同一规范化验证码的并发重提也只会产生一条新的 pending claim。图片只供审核使用，审核完成七天后由既有 cleanup scheduler 删除；cleanup 失败时保留 object key 供下一次重试，不改变认证或审核历史。

## Season lifecycle

核心状态由 code enum/action guard 精确定义；稳定流程为：

```text
Rivals: draft → registration → voting → drafting → playing → finished → archived
Major:  draft → registration → playing → finished → archived
```

关键边界：

- **publish ≠ registration open**：发布让赛事公开；实际开放报名才记录 `registrationOpenedAt` 并冻结需要的竞技/资格上下文。
- `registrationOpensAt` 是计划开放时间，`registrationOpenedAt` 是实际 transition fact。scheduler 或参与者 recovery 的到期补开保留原计划时间；无计划赛事的明确立即开放同时写入当前时间；未来计划的提前开放必须由管理员明确确认，使用独立的 force-open 语义并将有效计划时间改为当前时间。
- 报名开放后，已经冻结的 policy/context 不随全局目录变化；运营 deadline 只在其允许的生命周期内调整。
- draft 撤回/删除必须通过无既有业务事实的 guard；不能靠 UI 隐藏按钮代替 server validation。
- 后台生命周期分组和首页 featured season 是 presentation projection，不创建全局 `currentSeason` 事实。
- 报名曾实际开放不代表当前仍可提交；首页报名提示、报名入口与报名页统一消费 `registration/window` 的计划、实际开放及截止时间。报名截止不会自行推进赛事到投票、选秀或比赛阶段。

## ConversionPolicy lifecycle

全局跨平台换算策略只由 super admin 管理，当前产品面向 `5E → Perfect World`：

```text
approved/current or historical policy
→ clone
→ draft mapping + provenance 编辑
→ server validator
→ approve（immutable）
→ optional set current
→ retire（仅非 current approved）
```

生命周期 mutation 与审计在同一服务端 transaction 内完成。赛事通过 `conversionPolicyId`、版本和冻结 mapping 引用策略；发布但未开放的赛事展示 locked reference，报名开放后的赛事展示 frozen reference。切换 current 或退役历史策略不会改写既有赛事配置。

## Rivals

Rivals 的主要链路：

```text
个人报名草稿
→ 提交并审核
→ 队长投票
→ 管理员确认队长
→ 创建赛事原生 CompetitionEntry
→ 蛇形选秀
→ roster / Entry facts 同事务收敛
→ playing runtime
→ final results / archive
```

选秀 pick 使用锁和 `clientRequestId` 保证并发与幂等：成功请求推进轮次后，同一请求重试仍返回原结果。直播视图只读取已提交状态，不以客户端乐观状态成为选秀真相。

## Major registration and review

长期 Team 的队长为赛事创建 CompetitionEntry，并维护本届报名名单 revision：

```text
Team captain creates Entry
→ maintain roster revision / primary starters
→ members confirm participation
→ canonical qualification
→ submit
→ optional withdraw from review into a new draft revision
→ admin review
→ approved roster revision
```

一个用户在同一赛事不能同时占有多个 active Entry commitment。成员确认、教育/竞技资料和 qualification 都由各自 canonical owner 提供；长期 Team 的成员变化不会自动改写已经提交或冻结的赛事名单。

草稿只表示尚未提交审核，不提供终止报名动作。报名提交窗口仍开放时，负责人可以把 `submitted` 撤回为同一个 Entry 的新 draft revision 后继续编辑和再次提交；既有 submission、roster revision 与 audit 历史保留，成员 active claim 不释放。报名截止后保持 `submitted` 等待审核，不再撤成无法重新提交的草稿。`changes_requested` 继续只表示管理员要求补正，`withdrawn` 不用于普通主动撤回审核。

管理员审核可以批准、候补、拒绝或要求补正。**approved Entry 只表示报名审核通过，不等于正式获得 Major 正赛席位。**

在 EventRoster 尚未冻结、名单调整截止时间未到且 Major 当前阶段允许自助修改时，已确认的普通成员可以本人退出本届赛事；服务端会复用现有名单变更 transition，保留原 approved revision，创建或复用可编辑的 self roster change draft，从新 draft 移除该成员并释放本届 active commitment。Entry 随后需要重新完成成员确认、资格检查和管理员审核。退出长期 Team 不会被这个动作隐式改变；名单冻结或调整窗口关闭后继续由服务端 fail closed，并提示联系赛事管理员。

## Major prestart

赛前工作区按运营阶段推进：

```text
报名收口 → 资格方案 → 资格赛 → 正赛名单 → 正赛种子 → 开赛确认
```

报名截止停止新的正常提交，并冻结 Qualification candidate basis；Qualification 配置及比赛期间参赛队自助名单调整关闭。资格赛完成并确定正赛参赛队后，仅最终 entrant 可在最终调整截止前重新申请名单变更；名单变更形成新 revision 并重新进入资格、审核与同步。Final Roster Lock 与报名截止是两个不同事实，锁定前须完成最终名单确认；锁定时 EventRoster 冻结并生成不可变系统种子建议。正常名单 owner 始终是队长/成员的 Entry roster flow；管理员只处理审核、明确例外和最终冻结。

系统种子建议与最终人工 seed 分离：freeze 时从同一批 frozen primary starters 和竞技上下文生成不可变 snapshot；管理员随后确认最终顺序。查看不同排序、人工调序或之后全局资料变化都不重写 snapshot。启动只消费并校验已存在的赛前事实，不在 `startMajor` 临时生成第一份建议。

候选期管理员通过只读排序矩阵查看完整已批准名单及各成员的竞技证据；系统参考仍仅由 5 名预定主力计算，不自动选择正式参赛队、不改变 qualification，也不创建或改写 `SeedRecommendationSnapshot`。资格方案和最终种子复用同一矩阵交互；预排名与赛制先保存为共享的版本化草稿，确认 Qualification 后锁定，最终种子另行保存和确认。正式参赛队与 EventRoster 统一冻结后，系统才生成并保留 immutable seed snapshot。Qualification 的单场操作继续由统一比赛管理拥有，赛前工作区只展示比赛进度和入口。

报名截止和最终名单截止仍由 `seasons` 保存，但 Major 的正常运营编辑入口位于赛前工作区；`mainEventPlannedStartAt` 仅是计划时间，到时未 ready 时显示待处理事项，不触发 `startMajor()`。实际开始只由管理员确认后创建 StageRun。

预排名调整先保存共享服务器草稿，再预览并确认最新版本。未保存修改、旧版本、候选集合或容量变化均阻止最终确认；保存不创建 QualificationRun。确认后排序与赛制锁定，首轮生成前显式 reset 可返回草稿继续修改。Play-in 首轮同步已批准名单并采用冻结资格规则；名单补正重新批准后同步当前 revision 的竞技事实和有效特批，首发 gate 同时执行校籍人数及外校实力规则。

## Major Qualification

Qualification 是 `registration` 到 Major 正赛 entrant set 之间的独立 run，不加入 StagePlan，也不创建 Major StageRun。Major 正赛规模只可在报名阶段、未配置 Qualification、未创建正赛 entrants/seeds/StageRun 且赛前事实未锁定时，通过 profile owner 更新；已发布设置展示调整边界并链接到赛前准备。

报名截止、所有报名审核/补正/候补处理完毕后，所有已批准且名单有效的 Entry 组成冻结候选集合。初始预排名消费当前 strength `displayOrder`；无法排名的候选按队名与 Entry ID 稳定排序。配置确认前，管理员先预览正赛容量、候选数、赛制、切线及完整排名路径。系统由候选数和正赛容量推导直通、Play-in 与晋级数量；超出单层资格赛可收敛的数量时停止配置，不提供人工覆盖人数或替换正赛队伍的入口。

Qualification run 保存格式、冻结候选与预排名。管理员生成每轮前先预览完整对阵；确认时服务端重新计算并比对所预览的队伍，变化后要求重新预览。Direct BO3 使用镜像种子：P1 对 Pn、P2 对 P(n−1)，依此类推。Short Swiss 仅在当前 Play-in 人数满足规则门槛时可选，最多三轮；R1 按同战绩组高低种子配对，之后只在相同战绩组内生成无重赛配对。比赛结果只写入官方 Match，完成一个结果不会自动创建下一轮；管理员显式生成下一轮。重试仅接受已完整且规则一致的对阵集合，缺场、重复、跳轮、跨战绩或不匹配的历史事实 fail closed。

Qualification 的胜者更正走通用结果更正与审计入口，但只允许在正赛 entrants 尚未产生、且后续 Qualification 比赛仍全部 scheduled 时执行。确认后在同一事务中作废并审计后续轮，再由冻结候选与更正后的 canonical Match 结果重新投影晋级事实；若后续比赛已开始/结束或正赛 entrants 已产生，则拒绝自动恢复并转赛事事故裁决。

首轮生成时，Play-in 队伍的已批准 Entry roster 由共享 EventRoster owner 同步并确认；资格赛阵容消费 confirmed/frozen EventRoster。Entry 重新批准只在比赛间隙同步当前 EventRoster。已被 MatchRoster 引用的旧 EventRosterMember 保留为非当前历史行，新比赛使用新当前行；已有 MatchRoster 不改写。Major 正赛仍要求 frozen EventRoster。Qualification 完成后，正赛集合只由直通 Entry 与系统推导的晋级 Entry 构成，并且必须达到冻结 profile 的准确容量。

公开首页在 Main Event 首阶段开始前，将 PLAY-IN 作为独立信息面板放在阶段 tracker 下方；此时 REGISTER 显示完成，Main Event 阶段待开始，且没有 Main Event 阶段显示为当前阶段。公开和后台赛程以 PLAY-IN 独立 tab 展示 Qualification-owned matches，并以分隔线与 Main Event tabs 区分；它不会因为不属于 StagePlan 而触发未配置阶段告警。合法的 `stage=<StageConfig.key>` 请求优先显示对应 Main Event 阶段，然后回退到当前 Main Event 阶段、Play-in、Stage 1；`stage=play-in` 显式选择 Play-in。Short Swiss public/admin standings 从通用 Swiss projection 与 Qualification run facts 投影，使用 P 前缀种子并只展示 R1–R3。Direct BO3 赛程在比赛卡片前显示 Play-in 晋级数量与剩余名额摘要。

## Stage runtime

Major 每个阶段由 managed StageRun 拥有：

```text
create StageRun with frozen rules/entrants
→ schedule/pair matches
→ record official results
→ finalize round/stage
→ derive qualifiers
→ create next StageRun
```

推进依据是 StageRun entrants 与已完成比赛。standings/bracket/page summary 是 projection，不可直接覆盖 runtime truth。具体阶段人数、BO 规则和配对政策属于赛事规则与 runtime owner，不在本文件复制。

通用阶段初始化由 canonical transition boundary 解析 previous/current/next stage、上一阶段完成状态和本阶段 entrant input；管理员页面不自行推断邻接阶段或执行“生成正赛”旁路。generic provider 每次只初始化当前 `StageConfig.key` 的 state；Major Swiss/Playoff 由各自 managed runtime owner 管理。

## Match

个人赛务从本人有权参与的实际官方比赛派生，不要求 Season 已进入 playing；报名期 Qualification 已生成的 PLAY-IN 与正赛复用同一任务投影。当届负责人使用 CompetitionEntry 身份，普通成员使用当前合法名单及确认事实。时间提议在事务中记录提议方 CompetitionEntry；历史提议仅从创建时的不可变负责人交接历史解析，无法确认归属时拒绝回应并要求重新提议；交接后的本队负责人仍不能回应本队提议，实际提议用户保留为审计事实。个人工作区和赛事首页链接到同一比赛详情协商入口。

计划开赛须为未来时间且不超过 completionDeadline，不按阶段提前关闭双方协商。首次 pending 提议完整 24 小时未回应，取得比赛与资源锁后重新读取时间、仍距开赛至少两小时，才自动采纳；已有排期的改期必须对方明确接受，原定时间继续有效。双方主动同意的短通知排期不受自动采纳门槛限制。建议在 T−2h 前提交首发和 BP 负责人；临时约赛优先先交名单再确认时间，这只是建议，不是协商前置条件。生产调度器独立识别已确认排期进入 T−2h 且缺少本场首发的正式比赛，不依赖 pending 提议或旧 cutoff 唤醒。到 T−2h 或未排期直接准备 BP 时仍使用既有合法预定主力兜底，失败显示真实阻塞；确认短时排期后更换阵容走既有管理员晚改名单流程。


```text
scheduled → in_progress → finished
scheduled / in_progress → cancelled
```

forfeit 是赛事比赛 `finished` 的结果形态，不是额外比赛状态。比赛执行核心由 `matches/lifecycle` 和 `matches/execution` 拥有；赛事开赛政策由 `matches/competition-policy` 接入。无赛事比赛可以在没有预报选手、BP 和数据源时启动，结束时选择已记录、待补或不提交结果；赛事比赛继续走下述完整赛事流程，不得通过无结果结束绕过晋级约束。

无赛事创建、首次结束、结果补录和显式更正是分开的事务领域入口，调用方负责授权；结束后的补图不重开执行，原结束时间保持不变；不提供约战产品入口。RivalHub 可生成无赛事比赛的 v2 转播文档，Mizar 可以导入、保存和投影；现有 installation、赛程窗口和实时回传仍以赛事授权为边界。

队长 BP 操作区使用明确的中文阶段、行动队伍及本轮次数；禁用按钮使用危险色与「禁用 地图名」，选取按钮使用成功色与「选取 地图名」。选择后在当前操作区确认相同动作，取消恢复地图按钮焦点；未确认选择只存在于 UI，并以 revision / turn key 为界随轮次变化清除。等待对方、选边、暂停、到时及完成状态沿用当前权限和计时事实，不改变 BP 规则或命令协议。

赛事比赛的在线 Veto Session 在 Match 通过共享 status transition 从 `scheduled` 进入 `in_progress` 时开始；计划开赛时间只用于开放协调窗口，不单独启动比赛。BP 步骤完成仅表示地图计划完成，不推进或结束 Match。进入 Veto 前，本场首发取队伍已提交的合法阵容；若未提交，则在计划开赛前两小时从 EventRoster 的五名当前主力生成默认阵容，提前开始 Veto 时同事务生成。实际开赛时再次核对并定格双方首发，不要求管理员单独确认。Qualification run 的 BP privileged entry 从该 run 的冻结 `competition_qualification_entrants.preliminary_seed` 推导，数字较小者为 higher seed；Major StageRun 使用冻结阶段种子。只有 `majorStageRunId` 与 `qualificationRunId` 都为空的 manual Match 才由赛季管理员显式指定 privileged entry。 BP 公开 projection 按观众、首发、负责人和管理员权限呈现，管理员可返回工作台，由工作台按当前阶段展示建房等赛务任务。完成页消费正式 match_maps 汇总地图顺序与起始阵营，内部 participant/system 来源保持审计事实，页面只说明超时自动选择及管理员调整。取消后停止操作倒计时和自动边界推进，保留历史记录和既有技术申诉权限，申诉表单按需展开；恢复先手选择后为实际操作方重新生成完整操作时限。

Qualification-owned Play-in 比赛不允许进入 `cancelled`，以免冻结资格赛轮次；需要裁决时使用正式弃赛判负，写入可投影的胜者结果。资格赛比赛也不能通过通用 delete 路径单独删除。

正常比赛：

```text
EventRoster
→ MatchRoster / starting lineup
→ BP / actual maps
→ map-level results
→ official series result
→ runtime settlement
```

本场实际首发可以不同于赛事预定主力，但必须满足本届 frozen roster/eligibility 约束。地图结果由单一 canonical result owner 在事务内写入并推进 runtime；人工录入与后续经过校验的可靠数据源复用同一入口，不能另起一套结果写入路径。正常结果由实际地图推导；弃赛不制造未进行地图。单图正式结束后，管理员可用 OCR 或手填补齐实际首发十人的全部基础记分板字段；身份覆盖、唯一性、字段范围和正式回合上下文核验通过才表示齐备。DAK 已确认的 gameplay facts 不被 OCR 覆盖，清除计分板输入只清空仅由 OCR 持有的行与 DAK 行的 Rating / RWS / WE。
Mizar 数据源闭环：Mizar 在本机发起短期 pairing intent 并保留 poll secret，本站授权页要求当前登录的赛事管理员选择一个有权限的赛事，Mizar 轮询后取得该赛事独立的 installation credential。管理员在赛事管理页查看或撤销连接；Mizar 从赛程窗口选择比赛，并在本机显式认领单场活跃数据源，换机时以递增 authority revision 接管。可靠事件只在当前 installation、authority revision、session、generation、map epoch、序列、身份与首发证据一致时进入结果 owner；`map_ended` 的 `scoreA`/`scoreB` 是 entrant-relative 候选，`scoreCT`/`scoreT` 只作为证据，`series_ended` 不会绕过缺失的地图结果推进系列赛。公开 LIVE 只消费接收方限定到单场的短期投递，断流或不健康时降级到正式赛程与赛果。公开页和后台使用同一 `projectMatchPresentationPhase` 契约解释 canonical 状态、BP、地图完成及当前执行事实；BP 后的等待、对局、图间共用地图结果 → 直播 → 比赛数据布局。客户端 freshness 独立于 phase，私有 viewer 在到期、重连、前后台恢复和比赛切换时重新订阅，等待下一份合法 heartbeat，不读取 replay baseline。

赛后 Demo 闭环：DAK 提交的 `/3` Evidence 先以不可变 payload 保存，再由服务端基于当前目标、正式地图结果和 effective MatchRoster 重新校验；单图具备正式比分与完成时间后即可接收该图 Evidence，不必等待整场系列赛结束。Steam64 既可以命中当前主身份，也可以命中 active gameplay alias；无法解析、已撤销或跨用户冲突都进入待处理。赛季管理员只能在单场工作台中从该份不可变 payload 选择本场当前首发，服务端再次核对观察 Steam64、队伍和候选身份后，只有同一 participant path 当前确实存在可确认的身份问题时，才经 gameplay identity owner 保存 alternate identity，并自动重跑同一 canonical validator；其它比分、QA、回合或 summary 问题仍保持待处理。工作台按当前 canonical validator 投影待确认身份、已关联其它选手的冲突与非身份阻塞，正常匹配者只显示人数摘要；候选只来自观察队伍的本场首发。冲突展示当前关联，只有来源属于当前赛事的 active `admin_confirmed_alternate` 提供填写原因、二次确认后的 scoped retire；主身份、`profile_change` 与跨赛事来源指向相应身份核对流程。撤销在同一事务中把所有依赖该观察身份的已确认 Demo 标为待处理，并在提交后立即失效公开统计缓存；后续由同一确认 owner 重检并重建投影，不自动改绑。无效 payload 保留在工作台并可拒绝，不能通过身份确认绕过完整校验。拒绝作为次级危险操作，比分、QA 等问题保留独立说明。确认及重检晋级同时保存带来源、身份绑定和计算版本的每图统计投影；原文保持不可变。确认、重检、拒绝和撤销都写入业务审计，并刷新公开统计、生涯和基准；不修改登录/报名资料中的当前 Steam64。

赛后 MVP 投票在比赛完成 24 小时后关闭；公开页面只读取票数和已提交胜者。统一调度器在到期后锁定比赛、聚合候选票数并原子保存胜者和审计，重复执行不会改写已锁定结果；投票写入与结算共享比赛锁边界。票数相同按最早获得投票的时间、再按稳定选手 ID 排序；选手改名不拆分同一人的票数。没有有效选手票的比赛不产生胜者。

结果更正先检查所属运行时和下游依赖。Major StageRun 由 managed recovery owner 处理；Qualification 仅在正赛 entrants 尚未产生且后续资格赛比赛仍全部 scheduled 时允许胜者恢复，并原子作废后续资格赛轮。后续 Major stage、已开始/完成的下游比赛或既有正赛 entrants 都不能由结果更正静默重写，必须转入赛事事故裁决；不能直接改 standings 或把 finished match 任意退回进行中。

管理员比赛总览的「赛务待办」由 `src/lib/admin/matches/operations.ts` 聚合轻量事实，读取前校验本届管理员授权。正式赛统计只包含待进行/进行中的非测试赛；全赛季数量和当前阶段/队伍范围分别标明，不受生命周期筛选影响。排期状态复用 `projectMatchScheduling`，`scheduled` 仅表示待进行，不表示时间已确认。待提议催双方，有效提议按创建时队伍归属催对手的当前负责人，改期保留原定时间且不自动采纳。联系人来自当前 `competition_entries.representativeUserId`，QQ 仅进入管理员投影，按需查看/复制；催办文字不包含联系方式。解说覆盖复用已授权解说读取，撞档只提示同一解说认领的同一开赛时刻，实际测试赛资源也参与核对；不推测比赛时长。Bet 摘要保留原后台快捷入口，盘口判断仍归原 owner。

单人赛务沿用本届管理员和 `match_commentators`，不新增角色或任务完成表。赛事比赛总览中的「我的当前比赛」「我的下一场」独立于阶段/状态筛选：当前取本人已登记且进行中的比赛；下一场只取本人已登记的待进行比赛，已排期按时间优先，未排期后置。「可认领的比赛」按服务端 `canClaim` 展示当前用户能认领的比赛，包含解说 0/2 与 1/2 的比赛；已满员、本人已认领或无本届解说资格的比赛不进入该队列。单场与总览认领按钮均遵循同一授权事实，可由具有本届管理员授权或全局超级管理员身份的当前用户自助认领；身份仅来自会话，资格读取当前数据库角色和授权，不要求超级管理员额外领取本届授权。队列、认领/取消命令、管理员补登记候选与数据库触发器遵循同一资格规则。认领复用原有解说 owner、每场最多两人和审计，在比赛行锁内复核状态与授权；本人重复认领幂等。本人可在尚未排期或已排期但 BP 未开始时，经简单确认取消自己的认领，立即释放一个名额，不影响另一位解说；取消入口只接受比赛 ID，身份来自会话。比赛已结束、已取消、BP/比赛已开始或存在未关闭的 Mizar 制作会话时禁止自行取消；进行中及制作准备阶段提示联系管理员。取消在同一比赛行锁内复核状态、BP 与制作会话，仅删除本人的记录并写入审计；重复取消不重复记账，不增加理由、审批或时间限制。既有管理员补登记入口继续支持赛后整理。

单场工作台从正式地图计划、正式单图完成事实与已有 Mizar 开始记录投影当前任务。BP 后提供 Perfect 建房指引及 `https://match.wmpvp.com/` 后台入口；可复制字段与核对项按后台表单顺序统一呈现，使用已完成的网站 BP 结果，不引导重复 BP。整个系列赛保持 RivalHub A/B 对应 Perfect Team 1/2；起始边未知时要求核对，不猜边。轮次和短描述分开，Swiss 短描述来自相应 StageRun / Qualification 的 canonical Swiss read model，未知值不能复制。仅轮次、短描述、两队名、GOTV 线路 2 延迟和密码提供复制；其余为核对项，不保存或推断外部房间是否已创建。

单图同时具备正式比分与完成时间即可打开 OCR。DAK 前的基础计分板齐备要求十名 effective starters 完整身份覆盖、无重复或越界，Match/Map/队伍归属一致，且 kills、deaths、assists、hsPercent、firstKills、multiKills、clutches、adr、ratingPro、rws、we 十一项字段齐全，通过既有 schema / stat-ranges 与正式回合上下文核验。缺值保持 incomplete，零值按各字段既有合法范围处理。DAK 后 identity/gameplay/verification lineage 仍归 DAK，OCR 只补 Rating Pro / RWS / WE；缺值不抹掉已有 enrichment，基础板从已核验的 DAK gameplay 与平台 enrichment 合并判定，DAK evidence 同步状态单独检查。

图间 OCR 与下一图准备可并行，不构成建房或赛后资料的门槛。上一图人工完成后，即使旧采集冲突仍待核对，也显示已记录状态与下一图建房指引，保留 REVIEW 证据，不再要求重复提交上一图比分。图间计时仅在派生阶段为 inter_map 时从上一图正式 completed_at 正计时，10 分钟软提醒；下一图已经 gameplay 或系列结束后不再显示图间提醒、催促准备已开打的地图，即使随后失鲜或人工接管也如此。保存/清除后刷新投影，页面可见时定期刷新，仍可手动刷新。正式系列赛结束立即进入赛后整理，BO3 的 2:0 不准备 Map 3，仍进行中的 1:1 才继续；无实际地图的弃赛不要求 OCR 或 Demo。公开赛后页面将有效比赛回放置于顶部 BP 记录右侧，窄屏自然换行；没有有效回放时不显示入口，直播间仍独立标注。赛后工作台提供 Demo Uploader 稳定下载入口及逐图同步状态，needs_attention 面板保留独立恢复入口，即使当前地图缺少正式结果也不隐藏。

可靠事件的错图拒绝持久化为 execution_conflict，工作台优先 REVIEW，保留既有可信 currentMapId 与 gameplay 事实；后续单独的结束事件保留冲突；同 epoch 更新的 map_started 在 BP 完成、正式第一张待进行地图、十人名单、identity/freshness、session/authority/context/generation 校验均通过后可重新 armed，并记录 revalidated 审计。显式人工接管的本 epoch 保持手动选择。Mizar 当前每个 epoch 只发送一次开始事件；同 epoch 重选采集来源不保证重发，只有新的有效开始证据被接收后才会重新核验，页面刷新只读取处理状态。管理员仍可显式接管本图，人工命令经同一正式赛果 owner。若 invalid map_started 后没有可信地图绑定，工作台展示正式计划中第一张未完成地图；管理员明确确认恢复并接管，服务端在 match→source 锁内重验 session、map epoch、空绑定、冲突与未完成地图顺序，记录恢复前后地图及操作者审计。已人工接管的同 epoch 若因 source generation 切换丢失绑定，后续可靠事件确认 execution_conflict 后仍提供此显式恢复入口；unknown 本身不授权恢复；管理员可通过下述明确登记采集故障的入口接管，已绑定且已接管时不重复提示。恢复审计包含 generation 与原人工接管 epoch。此恢复不切换 installation，不允许任选地图或覆盖正式赛果；下一图新 epoch 仍须通过健康检查才恢复 AUTO。

## Discipline and post-event

纪律、比赛裁决、最终名次和荣誉是独立 workflow：

```text
sanction ───────────────┐
match correction ───────┼─ explicit adjudication when effects interact
final result confirmation│
honor grant/revoke ─────┘
```

任何处罚或撤销都不隐式递补、改比分或改荣誉。Major final result 先进入待确认状态，确认后才成为长期可引用事实；归档不会把历史 snapshot 重新解释为当前 profile。

## Community awards

社区奖是独立赛事 capability，可以跨赛前、比赛中和赛后运行：

```text
submit → review/revise → evidence → resolve/correct
```

是否可用只由 capability 决定，不从 season status 推导。capability 关闭时入口和 server mutation 都 fail closed。社区奖不替代官方 `tournament_honors`。

## Spectator predictions

Prediction is available without administrator activation or login. Each visit/refresh starts from current official tournament facts; unfinished matches use a deterministic high-seed winner preview. Choices and undo live only in browser memory, with no scenario persistence or sharing. An upstream edit clears affected downstream choices and recomputes the preview. Completed official matches may be overridden for an if line without changing official results or inventing scores. Updated official facts reset the local worldline.

Play-in Short Swiss uses the separate canonical Qualification run, entrants and 2W2L / at most three-round policy. Its result stops at Qualified / Eliminated; hypothetical qualifiers never become Main Event entrants. The default context switches to Main Event after official entrants/seeds are confirmed; the official Play-in history remains available for local simulation.

Main Event Pick’Em opens automatically after official entrants/seeds are confirmed. A confirmed Swiss stage automatically opens the next eligible phase using canonical advancement and seeding rules, even before its matches are generated. Coin thresholds follow fixed policy and challenge capacity follows the frozen stage plan. No independent administrator configuration, deadline, pause or void controls are exposed. Missing entrants render a waiting state; an unknown schedule allows submission and displays an unpublished deadline. Before closing, the deadline follows the first official match's schedule; an elapsed deadline or actual start permanently locks the phase, including after postponement. Official recovery invalidates stale picks automatically. Prediction and Pick’Em stay on the same page. Importing a simulation edits only a draft; explicit submission records the pick. After closing or invalidation, only the prediction dock is hidden for viewers without a submission; simulation remains available and submitters retain their read-only record. Official judging and Coin remain independent from simulation choices and Bet.

BET has independent public/admin entrypoints and a fixed points policy. Its markets open in sequence from official event, match, BP and map facts; actual gameplay/map starts permanently lock admission. Official results settle pools, corrections reverse and resettle, and forfeits refund. Prediction/Pick’Em pages do not expose Bet configuration, balances or history. Operational reconciliation is described in [`operations/spectator-predictions.md`](operations/spectator-predictions.md).

## Cross-workflow rules

- transport/page 不复制 domain transition；所有 mutation 回到 canonical owner。
- 高影响操作在服务端再次鉴权、校验，并在适用时与 audit 保持同一一致性边界。
- frozen facts 不从 mutable profile 重新计算；历史恢复只消费当时 snapshot。
- loading/empty/presentation 状态不能制造不存在的业务事实。
- 需要理解精确 transaction lock、幂等顺序或 recovery algorithm 时直接读对应 code + real PostgreSQL tests，不把实现步骤继续追加到本文件。

### Admin Match operations projection

单场工作台复用 canonical phase facts，将当前任务、source mode、health 和 review reasons 分开投影。真实身份/阵容/连续性/赛果冲突优先处理，无 Mizar 是正常人工路径；AUTO 已核验时展示「Map N · 地图名进行中」，解说认领另行展示；认领不等于已经开播或正在解说。准备房间时先展示 Perfect 指引，手动录分收在「比赛结束后录入本图比分」，显式接管后展开。服务端人工命令与可靠事件共用比赛锁及结果 owner；人工接管校验预期 source session、地图与 epoch，已有正式赛果只能走更正流程，下一图健康开始后重新自动 armed。持久化 health 表示已完成的核验，不表示当前仍在传输；工作台使用同场、同 authority / generation / epoch / map 的 receive-only LIVE 订阅显示正在接收、暂未更新或尚未收到数据，不以低频 reliable-event 时间冒充心跳。客户端失鲜只改变提示，不授权写入。管理员已确认采集故障时，可填写原因并二次确认备用录分；服务端在 match→source 锁内重验 session、epoch、generation、lastReliableSeq、原地图绑定、BP 完成及正式第一张未完成地图，将原因和核对序列写入接管审计。并发重复确认幂等，状态变化要求刷新重核。

官方完赛不等待 OCR/DAK 或制作资料。实际完成地图分别检查完整计分板与 Demo 同步，未打 decider 和无实际地图弃赛不生成任务；解说与录像按实际认领单独检查；暂无解说认领时显示认领状态，收起解说资料项；比赛统计和 Demo 仍逐图检查。Bilibili 状态采用低频服务端缓存查询，失败显示「无法确认」。设备与赛后下载区并列提供 Mizar 现场制播与 DAK Uploader 赛后分析入口。Mizar 使用官方公开下载目录与发布页；Uploader 消费 DAK 的稳定 manifest，有有效安装包条目时优先推荐 Windows 安装包，同时保留完整 ZIP 备用，旧清单继续使用 ZIP，macOS 保持原入口。ZIP 应完整解压并保留目录结构。清单失败时保留官方 Release fallback。

异常面板优先展示差异、修复位置与完成条件。管理员先检查 Perfect 房间和 Mizar 当前比赛/采集来源，正确的本图开始证据重新核验后恢复自动记录；备用手动录分收起，确认时说明本图范围和采集仍需处理。当前 source session / map epoch 的最近未采纳上报按有界查询读取；地图冲突优先选择实际错图报告，阵容报告保存当时首发与采集玩家的缺少、额外、重复差异。页面通过既有 Steam profile 缓存与批量缺失查询显示 Steam 昵称及主页链接，昵称暂缺时显示待识别玩家；Steam64 继续承担内部匹配。比赛 identity 协议目前只有总体状态和 reason，具体队伍对应差异依赖生产端扩展；admin 私有证据与公开 projection 分离。

进行中与已结束系列赛的已完成地图共用 `map-score-correction.ts`。更正要求原因和预期旧比分，在 match→source 锁内再次核验，重复目标幂等、旧页面冲突拒绝，保留原 completed_at；进行中地图胜数继续从 maps 派生，整场正式比分仅在完赛时保存。更正造成已完赛系列胜者变化时，使用已有整场结果更正并核对后续赛程；普通更正继续拒绝使进行中系列提前结束的请求。此时工作台提供专用系列恢复：服务端预览旧/新地图和系列比分、实际地图状态、下游与赛后资料；管理员填写原因并确认后续地图尚未开打后，`correctSeriesAfterMapScoreChangeInTx` 在比赛、赛季及来源/下游锁内重验完整预览指纹。更正地图后复用 canonical series completion owner 更新胜者、正式比分、状态与实际决胜地图的完成时间，推进 Qualification/通用 bracket；Major Swiss/淘汰赛仍经已有本轮确认 gate 推进下一轮。已有后续赛程、后续阶段/正赛参赛队或最终结果阻止本操作，交由现有恢复/裁定流程处理。后续地图已有开始观察、人工接管、比分、OCR 或 Demo 时拒绝；开始历史在 source 重启/接管后仍有效。未打地图的 BP 计划保留，但完赛后的工作台待进行任务与 DAK 地图列表只消费实际正式地图，不伪造结果。重复确认以既有审计指纹核对并返回，不重放完成时间、晋级或审计。DAK payload/gameplay/lineage 保留，原 evidence revision 按新比分显示待重新核验。当前图来源暂停自动写入，下一图仍按完整核验恢复。

设备授权管理展示授权人、活动连接和受影响比赛。普通赛事管理员管理自己授权的设备，跨用户撤销由超级管理员填写原因；服务端事务执行相同校验并审计。设备凭据验证后的自行断开仍支持幂等重试。

Perfect 六项复制复用 canonical 赛事事实：轮次来自阶段（含 Direct BO3 Play-in），短描述来自对阵轮次／淘汰赛轮次／Swiss 当前轮战绩；Direct BO3 不读取不存在的 Swiss 战绩。队伍 1/2 来自本场 A/B，起始边来自 BP；缺失事实时禁用复制并指向赛程或 BP 核对，不生成猜测值。


## 测试赛验收

赛事管理员在本届后台「测试赛」选择两支已批准名单的队伍、赛制、选择 BP 顺序的一方及双方操作人。默认使用各队队长；指定账号可独立于出场名单。页面列出本届全部已批准队伍，包括直通正赛队伍，无需等待 Play-in 完成。创建时复用正式名单 owner 校验并准备双方当前已批准的比赛用名单，同时冻结图池及 Major 本场资格事实；管理员无需额外同步或确认名单。准备名单不创建 Qualification/Main Event 参赛节点，测试赛不产生正式赛程节点；无需先生成 Play-in。双方队长从本届名单提交首发，正常资格校验与开赛冻结仍执行，双方操作人在 BP 房间确认并完成禁选和选边。

管理员/解说从测试赛列表或比赛工作台进入；双方队长及指定操作人在「我的赛事」看到入口。比赛详情和 BP 观看可匿名凭链接访问，写操作仍检查身份及本场权限。正在进行的测试赛在报名、投票、选人阶段也可取得仅本场可读的短期 LIVE 凭据；正式比赛仍要求赛事已开赛。解说认领、覆盖安排和 B站嵌入复用已有流程；测试会占用实际选择的转播容量，避免同一解说资源重复承诺。

Mizar 通过原赛事授权选择标记为测试的比赛，消费真实名单及 BP 地图并向该 matchId 上传 LIVE / reliable events。DAK Updater 通过原授权事件目录的「测试赛」阶段选取已记录比分的实际地图并上传证据，沿用身份、比分和语义校验。比赛可以正常按图结束，也可明确待补或不提交结果；待补地图与总比分使用结果补录入口，不重开比赛或改变首次结束时间。已确认结果修改需要原因和版本校验，已完成地图比分与总比分通过同一更正表单原子提交，并审计前后变化。测试不会推进赛事或进入正式累计统计。

自动化证明创建、权限、BP、结果与投影边界；现场验收仍需 Windows + CS2 + Mizar + OBS 的真实出场、LIVE、地图切换与赛后 DAK 上传，并打开 B站直播检查网页嵌入。没有实际演练证据时，不以代码通过替代这些验收结论。
