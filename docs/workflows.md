# RivalHub 工作流

本文件只描述跨模块必须理解的生命周期与 owner boundary。领域实体见 [`domain-model.md`](./domain-model.md)；正式赛事规则见 [`rules/`](./rules/)；精确 action 输入、guard 和错误码以 code/tests 为准。

## Account and long-lived profile

```text
signup → confirmation email → explicit confirmation → application session
login  → password authentication → application session
forgot password → recovery email → reset password
```

Supabase Auth 负责登录身份；成功确认/登录后同步身份到对应的 `users.id` 并建立 `rivalhub-session`。用户可验证并绑定其他邮箱；其中任一已验证的学校邮箱都可完成学校邮箱教育认证，不要求替换当前登录邮箱。若该身份已属于另一个 user，系统建立短期双方控制授权，用户选择要保留的账号后查看归并影响；真实冲突会直接阻止执行。安全归并在单个事务内写入 alias ledger 与 audit，保留所选账号资料，归属不冲突的 person facts、登录身份和业务历史，关闭旧账号的临时状态，随后 session 解析到保留账号。长期资料、教育资格、竞技档案和 Team 独立于任何一届赛事维护；赛事只在需要时引用或冻结这些事实。

## Season lifecycle

核心状态由 code enum/action guard 精确定义；稳定流程为：

```text
Rivals: draft → registration → voting → drafting → playing → finished → archived
Major:  draft → registration → playing → finished → archived
```

关键边界：

- **publish ≠ registration open**：发布让赛事公开；实际开放报名才记录 `registrationOpenedAt` 并冻结需要的竞技/资格上下文。
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
→ admin review
→ approved roster revision
```

一个用户在同一赛事不能同时占有多个 active Entry commitment。成员确认、教育/竞技资料和 qualification 都由各自 canonical owner 提供；长期 Team 的成员变化不会自动改写已经提交或冻结的赛事名单。

管理员审核可以批准、候补、拒绝或要求补正。**approved Entry 只表示报名审核通过，不等于正式获得 Major 正赛席位。**

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

## Match

```text
scheduled → in_progress → finished
scheduled / in_progress → cancelled
```

forfeit 是 `finished` 的结果形态，不是额外比赛状态。

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

结果更正先检查 StageRun 和下游依赖。若会改变后续 pairing/stage，必须走受控 recovery；不能直接改 standings 或把 finished match 任意退回进行中。

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
