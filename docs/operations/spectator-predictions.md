# 观赛预测运营

Prediction 自由推演不需要管理员启用或登录；浏览器只保存当前内存中的选择和撤销，每次进入/刷新从官方赛果开始，未结束比赛默认高种子获胜。Play-in 复用 Qualification Short Swiss，不提供 Pick’Em；Main Event 只消费正式确认的名单与种子。推演不保存到数据库、不提供快照分享，也不写回比赛事实。

Pick’Em 不设独立管理员页面。Main Event 名单与赛事种子正式确认后自动开放首阶段；上一 Swiss 阶段正式确认后，使用 canonical 晋级与种子规则自动开放下一阶段，不等待管理员生成比赛。未确定名单显示等待状态；未排期时允许提交，截止显示待公布。阶段窗口冻结参赛队和种子，StageRun 生成后仅绑定相同名单；官方名单更正或运行记录恢复使原预测失效，保留已提交记录供查看。挑战总数由阶段数量及类型决定，纪念币门槛由固定政策计算。

截止只消费该阶段最早的正式比赛计划开赛时间；提前实际开赛立即锁定。尚未截止时排期调整可更新截止；已有截止或实际开赛记录永久锁定，延期不重开。官方排期/开赛变化在同一事务更新截止和锁；公开读取也按相同规则投影。没有 Pick’Em 暂停、手动作废或单独 deadline 操作。截止/失效后，无提交者仅隐藏预测单入口，赛事推演保留；提交者保留只读单。Bet 的积分配置、盘口开放、投入和历史入口目前隐藏，后续独立设计；现有 market/stake/settlement/ledger correctness owner 保留。

`/api/cron/reconcile-predictions` 使用现有 Cron 鉴权与统一 scheduler registry/execution/health，Supabase primary、GitHub watchdog 和管理员恢复共享同一个 runner。数据库 `prediction_reconciliation_is_due` 是待处理判断的唯一 owner，调度器、批处理与 mutation reconciliation 共用它，只有官方事实变更或未锁定窗口到期时才需要结算。公开读取不推进结算、不获取项目锁；到期窗口即时显示为关闭，积分和成就显示最近一次已提交的结算结果。批处理只选择这些事件，避免空闲事件占据批次。失败返回非成功状态并记录可重试错误；官方操作无需等待结算完成，待处理条件保留供重试。排查时比对官方比赛、轮次确认、阶段最终确认与 prediction settlement/ledger 历史；禁止手动改余额或删除流水。修复原因后重新运行同一 owner，幂等重试不会重复发放。

改判后已使用的返还形成待抵扣差额，可用余额为零；合法补给、退款及新结算优先抵扣。未结算投入不进入净收益榜。纪念币重算不触发积分奖励。

本地验证使用 `pnpm test:integration tests/integration/db/predictions.test.ts` 和 `pnpm test:e2e tests/e2e/flows/predictions.spec.ts`；需要真实服务时显式设置 `RIVALHUB_ALLOW_LOCAL_CONTAINERS=1`，只能通过 active Drizzle migration chain 初始化隔离测试库。发布按通用 release runbook 执行，Pick’Em 跟随官方阶段自动开放，自由推演无需启用。

Sanitized preview mirror 不复制观众的草稿、提交和积分账本，也不复制依赖它们的预测项目与窗口。预览库按 active migration chain 建表后，需用独立测试数据确认官方名单并形成阶段事实；不能把生产观众数据作为界面演示素材。
