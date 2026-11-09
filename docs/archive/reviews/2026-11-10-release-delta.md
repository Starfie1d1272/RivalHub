# v2.25.42 后的发布差异审查

审查日期：2026-11-10。原始范围为 `cc5566ba44a0684e25f22a7b0738bbbe3c1d78c6`（`v2.25.42`）至 `7dd0768a76d87081e87aa6f2b5750d8669a6f262`（审查开始时的远端 main），共 33 个提交、318 个变化文件。canonical Production `/api/system/release` 当时返回同一 `v2.25.42` tag/SHA。

本文件记录该次审查结论。当前规则继续由 canonical docs 与实现拥有；后续 CI、发布结果以对应 PR 和 Release run 为准。

## 判断依据

审查沿用户任务追踪输入、授权、领域决定、事务提交、反馈与恢复。共享业务事实应由一个 owner 解释；确认界面需要在提交时重新核对服务端事实；已提交结果应与后续清理或刷新故障分开。测试只在独立风险缺少证据时补充。

## 变更目的与归属

| 范围 | 实际变化与解决的问题 | 结构与证据判断 |
| --- | --- | --- |
| 身份与访问控制 | 私有赛事读取先核对本届授权；备用邮箱在消耗 OTP 前检查申请主体；密码恢复绑定本次恢复意图与 provider 身份；资格补全保留返回路径 | Auth、identity 与 session registry 继续拥有身份绑定和撤销语义；页面确认不替代 server authorization。检查了恢复、备用邮箱、归并、撤权及 DAK/Mizar connect 调用链 |
| 报名与队长 | 保留报名草稿和赛事上下文；队长确认绑定排名与名单快照，拒绝过期确认 | 报名资格与投票规则继续归原领域；浏览器只拥有未提交草稿。队长确认在锁内核对当前候选与顺位 |
| 选秀 | 恢复队长选人和超时停滞轮次；手动与自动选人统一推进 | `src/lib/draft/operations.ts` 统一拥有选人后推进，action 负责输入和权限，避免 transport 各自维护轮次事实 |
| 赛季发布 | 发布、提前开放报名需确认已保存配置 | `src/lib/seasons/confirmation.ts` 产生事实版本；事务内重新核对，防止确认旧配置后发布新配置 |
| 比赛工作台 | 保留任务与返回上下文；取消待赛核对状态；排期与截止操作检查当前比赛事实 | 比赛生命周期继续拥有状态转换，日期解析集中在 `src/lib/utils/date.ts`；首发审核队列使用独立 read model |
| 管理员高影响操作 | 处罚、教育审核、撤权、删除、回退等展示对象和影响并要求确认 | 复用 `InlineConfirm`、Dialog 和领域 action；教育审核的持久化并发问题见下文 |
| 统计与导航 | 统计指标、选中项、阅读视图写入 URL；返回链接、窄屏位置和赛务任务保留上下文 | `reading-state.ts` / `view-state.ts` 处理阅读状态；服务端范围、指标计算与样本门槛继续由统计领域拥有 |
| 主题与通用 UI | 统一字段标签、帮助、焦点、主地标、窄屏布局及赛事色浮层 | 复用共享 UI、语义 token、`seasonAccentStyle` 与 Portal theme context；无第二份主题或业务状态系统 |
| CI 与发布 | 按变化选择验证、合并环境、减少重复安装和无消费者输出；区分 CI 预算与发布 deadline | 子任务失败继续阻断；exact-SHA CI、冻结生产身份、capability、migration、checkpoint、promotion 与 rollback 边界保留。Release 文档与当前 main 实现一致 |
| 测试与依赖 | 精简重复浏览器/数据库场景、取消默认重试及覆盖率工具，更新锁定依赖 | Major 赛后不变量仍由 postevent PostgreSQL suite 保护；BET 结算与锁定、OCR 回执仍保留各自领域/数据库证据。依赖由 frozen lockfile 安装 |
| 预览快照 | 保留 Demo `validated_revision` 并声明引入版本 | 使用既有 preview policy/lifecycle owner，保持预览 schema 兼容判断 |

## 已修复发现

### P1：同一教育材料的并发审核可提交冲突结论

`src/actions/education-verifications.ts` 原流程在事务内读取 pending 后无锁更新。两个审核请求可以先后读取 pending，再分别提交批准和驳回，造成结论覆盖及两条有效审核审计。本问题存在于本次确认交互对应的完整调用链，早于本轮 UI 修改。

修复为先锁定目标认证行，再核对 pending、写入结论和审计。第二个请求等待后会读取已处理状态并拒绝。已有 PostgreSQL suite 增加一项真实锁竞争场景，验证仅一次成功、唯一审计与最终状态一致；不以 mock 数据库证明并发。

### P2：密码恢复完成后，会话 Cookie 清理失败导致误报

`resetUserPassword` 在 `mutatePassword` 已完成密码更新和全会话撤销后，仍可能因 `destroyUserSession` 失败返回通用错误。用户会看到更新结果未确认。

修复复用既有 `after_commit` 诊断，保持已确认的成功结果。已有 action suite 补一项故障注入，检查对调用者返回的成功事实。该用例不替代 provider 与真实 session 撤销的现有系统证据。

### P2：非法日期可被 JavaScript Date 自动进位并持久化

统一日期解析原先只检查 `Invalid Date`，如 `2026-02-31T20:30` 会变成 3 月 3 日。比赛完赛时间 action 的非空检查无法拒绝这种输入。

在 canonical `parseCSTInput` 中校验 datetime-local 形状及 CST 回读一致性。保留有效分钟、秒、毫秒和清除语义；全部调用者复用同一解析。复审调用者时发现赛季日期转换会将解析失败当成清空，因此在 season edit/create owner 拒绝可编辑字段的非法非空值；生命周期锁定字段仍消费已保存事实。纪律签发、Major 筹备与其他比赛时间调用者已有非空非法值拒绝。既有比赛时间及赛季 PostgreSQL 场景补非法日期拒绝与原值保持断言。

## 查询与触发成本

以下为源码结构核对，未作为生产费用改善验收：

- 首发审核摘要以聚合查询返回一行，队列在同一只读快照中读取计数与最多 25 条结果；未为计数拉取完整名单。
- 统计阅读状态变化由 URL owner 管理；未新增统计聚合 owner 或持久化写入。
- BP 静止房间停止独立时钟；选秀与比赛界面仍通过原领域读取与命令入口更新。
- 本次教育审核修复将同一事务中的普通读取改为加锁读取，未增加查询轮次；密码与日期修复未新增查询。

## 验证边界

审查使用完整 changed-file inventory、分领域 diff 和实际调用链，并独立复核 CI/Release 与测试精简。普通 UI 未新增常驻测试，未执行全站截图或真实设备验收。源码审查不能证明所有 viewport 的视觉与焦点表现，也不能证明真实邮件投递或真实赛事运营。

原始 main 的只读 Release Plan 结果为无 schema migration、无数据回填、无 checkpoint，因 scheduler verification owner 变化而要求 scheduler provision/verify。正式发布应由受保护 Release workflow 重新冻结生产身份并计算最终计划。

新增回归仅保护提交结果、并发数据完整性和日期写入。实际检查及部署结果记录在本次修复 PR、release PR 与 Release run，避免把尚未完成的 CI 或部署写成成功。
