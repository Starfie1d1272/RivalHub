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

在 EventRoster 尚未冻结且名单调整窗口仍开放时，已确认的普通成员可以本人退出本届赛事；服务端会复用现有名单变更 transition，保留原 approved revision，创建或复用可编辑的 self roster change draft，从新 draft 移除该成员并释放本届 active commitment。Entry 随后需要重新完成成员确认、资格检查和管理员审核。退出长期 Team 不会被这个动作隐式改变；名单冻结或调整窗口关闭后继续由服务端 fail closed，并提示联系赛事管理员。

## Major prestart

赛前链路固定为：

```text
approved Entry candidate pool
→ admin selects final entrant set
→ approved roster revision materializes/reconciles EventRoster
→ readiness / exception handling
→ freeze final entrants + EventRosters
→ create immutable seed recommendation snapshot
→ admin confirms final seeds
→ start Major
```

正常名单 owner 始终是队长/成员的 Entry roster flow；管理员只处理审核、明确例外和最终冻结。名单变更必须形成新 revision 并重新进入审核/同步，不提供另一套管理员手工 roster pipeline。

系统种子建议与最终人工 seed 分离：freeze 时从同一批 frozen primary starters 和竞技上下文生成不可变 snapshot；管理员随后确认最终顺序。查看不同排序、人工调序或之后全局资料变化都不重写 snapshot。启动只消费并校验已存在的赛前事实，不在 `startMajor` 临时生成第一份建议。

在最终 entrant set 尚未冻结的候选阶段，管理员可以看到基于每支 approved roster revision 的 5 名预定主力和当前可用竞技事实生成的 live strength preview。它是只读、非权威的辅助 read model：不自动选择正式参赛队、不改变 qualification，也不创建或改写 `SeedRecommendationSnapshot`。正式参赛队与 EventRoster 统一冻结后，系统才生成并保留 immutable seed snapshot。

### Major Qualification

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

```text
scheduled → in_progress → finished
scheduled / in_progress → cancelled
```

forfeit 是 `finished` 的结果形态，不是额外比赛状态。

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

本场实际首发可以不同于赛事预定主力，但必须满足本届 frozen roster/eligibility 约束。正常结果由实际地图推导；弃赛不制造未进行地图。

赛后 Demo 闭环：DAK 提交的 `/3` Evidence 先以不可变 payload 保存，再由服务端基于当前目标、正式地图结果和 effective MatchRoster 重新校验。Steam64 既可以命中当前主身份，也可以命中 active gameplay alias；无法解析、已撤销或跨用户冲突都进入待处理。赛季管理员只能在单场工作台中从该份不可变 payload 选择本场当前首发，服务端再次核对观察 Steam64、队伍和候选身份后，只有同一 participant path 当前确实存在可确认的身份问题时，才经 gameplay identity owner 保存 alternate identity，并自动重跑同一 canonical validator；其它比分、QA、回合或 summary 问题仍保持待处理。工作台按当前 canonical validator 投影待确认身份、已关联其它选手的冲突与非身份阻塞，正常匹配者只显示人数摘要；候选只来自观察队伍的本场首发。冲突展示当前关联，只有来源属于当前赛事的 active `admin_confirmed_alternate` 提供填写原因、二次确认后的 scoped retire；主身份、`profile_change` 与跨赛事来源指向相应身份核对流程。撤销后刷新当前解析结果，再由同一确认 owner 决定下一步，不自动改绑或重写历史统计。无效 payload 保留在工作台并可拒绝，不能通过身份确认绕过完整校验。拒绝作为次级危险操作，比分、QA 等问题保留独立说明。确认、重检、拒绝和撤销都写入业务审计；不修改登录/报名资料中的当前 Steam64。

结果更正先检查所属运行时和下游依赖。Major StageRun 由 managed recovery owner 处理；Qualification 仅在正赛 entrants 尚未产生且后续资格赛比赛仍全部 scheduled 时允许胜者恢复，并原子作废后续资格赛轮。后续 Major stage、已开始/完成的下游比赛或既有正赛 entrants 都不能由结果更正静默重写，必须转入赛事事故裁决；不能直接改 standings 或把 finished match 任意退回进行中。

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

## Cross-workflow rules

- transport/page 不复制 domain transition；所有 mutation 回到 canonical owner。
- 高影响操作在服务端再次鉴权、校验，并在适用时与 audit 保持同一一致性边界。
- frozen facts 不从 mutable profile 重新计算；历史恢复只消费当时 snapshot。
- loading/empty/presentation 状态不能制造不存在的业务事实。
- 需要理解精确 transaction lock、幂等顺序或 recovery algorithm 时直接读对应 code + real PostgreSQL tests，不把实现步骤继续追加到本文件。
