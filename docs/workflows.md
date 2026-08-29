# RivalHub 工作流

本文件描述当前 RC3 的生命周期与 owner boundary。政策规则由 [`rules/`](./rules/) 定义；精确 action 输入和错误码以 code 为准。

## 1. Account / Auth

用户通过 `/login` 进行 Supabase email/password 注册或登录。注册后需完成确认邮件并经 auth callback 建立 `rivalhub-session`；登录会同步应用账户并建立会话。密码恢复通过邮件跳转 `/reset-password`。

## 2. Long-lived participant profile

`users` 承载 display/profile、QQ、Steam 与 Perfect World identity 等跨赛事 participant profile。现有 Rivals 个人报名仍保留部分历史报名字段和赛事快照；长期资料与报名信息的进一步收敛见 [`decisions/2.0-convergence.md`](./decisions/2.0-convergence.md)。

## 3. Education verification

用户提交长期教育资格材料；系统按 institution、academic status 和证据类型审核。Major eligibility 引用已验证的教育事实；`studentId` 不参与 Major eligibility。

## 4. Competitive profile

数据 owner 是 `competitive_platform_seasons` 与 `competitive_rank_facts`。当前 `/settings/competitive` 的平台、当前赛季和上赛季上下文仍从已配置的赛事 `competitiveProfile` 取得；全局 catalog 接入是已接受的收敛工作。赛事 qualification evaluator 读取所需平台上下文和用户事实，并保留必要的 event-time snapshot。

## 5. Rivals solo registration

Rivals 用户在报名窗口填写个人报名并可保存草稿。提交由 Server Action 再次校验人数、位置与赛季窗口；管理员审核为 pending、approved、rejected 或 waitlisted。

## 6. Captain voting

已审核用户在投票阶段为候选队长投票或撤票。投票资格、上限和状态由服务端校验；管理员确认队长后创建 Rivals 的初始队伍与选秀顺位。

## 7. Rivals draft

队长/管理员操作选秀时，系统以行锁锁定 `draft_state`，先判定 `clientRequestId` 幂等，再验证轮次、身份、位置与可选性，在同一事务写 pick、成员和下一轮状态。commit 后才更新 Realtime。

## 8. Major team application

队长创建申请、填写赛事相关信息、邀请成员并维护可编辑申请。一个用户在同届赛事只能保有符合 active-claim 约束的参与关系。提交前由服务端汇集身份、教育、竞技和队伍事实执行资格判断。

## 9. Member invite / confirmation

受邀用户通过 application workflow 确认成员身份。未确认成员不能被当作已完成的申请成员；成员变更会重新影响申请 readiness。

## 10. Team review / materialization

管理员对 submitted application 审核为 approved、waitlisted 或 rejected。draft/rejected application 可由队长编辑并再次提交。approved application 原子物化为正式 `teams` / `team_members`，并保留 application provenance；这一步不等同于进入 Major tournament。

## 11. Major prestart

管理员维护预启动 entrants、最终名单、种子和 blockers。readiness 必须给出具体 blocker 与下一步操作。锁定/确认后的预启动事实被 `startMajor` 消费，创建 Stage 1 运行时；预览 opening plan 不能替代完整 readiness。

## 12. Stage runtime

Major 的 Swiss 阶段由 managed StageRun 运行。每次 pairing、回合结算、推进和恢复都绑定 StageRun；canonical truth 来自 entrants 与已完成比赛。阶段 1、2 的普通比赛为 BO1，晋级/淘汰局为 BO3；阶段 3 全部为 BO3。淘汰赛 QF BO3、SF BO3、Final BO5。

## 13. Match roster

正式队伍为具体比赛提交或由管理员选定阵容。Major roster 检查阶段冻结的 affiliation 和参赛事实；缺少或不符合要求的阵容不能被伪造为可用。

## 14. Match execution / result

比赛可进行时间协商、BP、地图结果与赛果录入。结果由对应 Server Action 验证、写审计并在适用时推进赛程。管理的 Major match 必须通过其 runtime owner 结算。

## 15. Result correction

管理员更正结果时，系统检查比赛、StageRun、后续阶段和恢复限制。更正不会以 UI projection 或 standings 覆盖 canonical facts；需要重新配对时走受控 recovery。

## 16. Discipline

管理员创建、执行、撤销或到期处理 disciplinary case。纪律与比赛、名次、荣誉通过明确的事实和审计连接，不做隐式递补。

## 17. Post-event / archive

Major 最终结果先处于 `pending_confirmation`，确认后生成可引用的 final result、placement 与 honor。赛后 adjudication 与 archive 遵守各自的状态和权限边界；归档后通常比赛变更受限，专门的赛后工作流仍保留明确入口。

## Compact state contracts

状态枚举和 action guard 是精确 authority；下表保留跨模块修改时必须理解的稳定生命周期。

### Season

```text
Rivals: draft → registration → voting → drafting → playing → finished → archived
Major:  draft → registration → playing → finished → archived
```

Rivals 的 voting/drafting 由 capability 启用；Major start 在 readiness、entrants、final rosters 和 seeds 确认后创建 Stage 1。`archived` 是历史赛季终态，任何例外操作必须走明确的赛后 owner。

### Team application

```text
draft / rejected → submitted
submitted → approved | waitlisted | rejected
waitlisted → approved | rejected
```

成员状态独立为 `invited → confirmed`。只有 draft/rejected application 可由队长编辑；submitted/waitlisted application 的审核与正式队伍物化由服务端控制。`approved` 已物化为正式队伍，不通过普通 review workflow 回退。

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
4. 写入 `draft_picks`、`team_members` 与 audit log；
5. 推进 `draft_state`，最后一 pick 将赛季推进为 `playing`；
6. commit 后 revalidate；Realtime client 只消费已提交的 `draft_state` 与 `draft_picks` 更新。

幂等检查必须早于 turn/state 校验：第一次请求成功推进轮次后，安全重试仍需得到同一成功结果。
