# #784 结算与已知回执重试

两份脱敏原始报告分别为 [reconcile-holder](settlement-reconcile-holder.json) 和 [stake-holder](settlement-stake-holder.json)，冻结测量代码均为 `0ecd6420cb25114a7904469f08205cfdd73599ad`。每轮独立 scratch database 包含一个 32 队 Major、两个账户对同一盘口已知成功的各 100 分投注。比赛完成且官方 Swiss 轮次已确认；测试先验证该盘口尚无 settled 批次，再运行一项持锁事务和并发任务。

`reconcile-holder` 的持锁者调用真实 reconciliation，其他任务调用 `stakeInTx` 重试已知提交的原 request ID；`stake-holder` 的持锁者调用相同已知回执重试，其他任务调用真实 reconciliation。**两种路径均在旧回执返回之前执行 reconciliation**；不存在由这两条 owner 路径证明“回执返回先于结算”的相反顺序。测试只重试事先确认已提交的请求，从不重放未知写入；发生错误时停止升载、等待任务结束并只读检查结算、下注和账本，不再自动执行幂等探针。

两种模式各完成任务数 1/2/4/8 各三轮；16 首轮采样到池队列 11 后停止。每个标签另有一个持锁者，实际事务数为标签加一。两种模式各 61 个并发任务成功并观察到锁等待；每轮仅一个 settled 批次、两条不同账户结算账本和两笔原下注，余额为 1100/900，再次 reconciliation 保持相同事实。已知成功后用全新 ID 尝试下注被拒绝且未增加下注。已完赛市场不允许新的成功下注；若下注先获得比赛 share lock，官方比赛状态写入需等待该事务完成。不能用人为设置的不可能状态宣称“新下注与已确认赛果同时成功”。

受控持锁用于确保观察竞争，池大小 6、获取 timeout 2s、每事务 statement timeout 5s、lock timeout 2s，队列阈值 8；5ms 池队列采样可能漏峰，holder 耗时包含测试屏障，不是服务自然耗时。共享本地 PG、小样本和测试事实更新不代表生产吞吐，也不测 HTTP 或 provider。

仅对明确授权的隔离 loopback PG17 复现，分别使用 `reconcile-holder` 和 `stake-holder`：

```bash
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 \
RIVALHUB_LOCAL_DATABASE_URL=postgresql://postgres:local-review-only@127.0.0.1:55432/postgres \
RIVALHUB_INTEGRATION_WORKERS=1 RIVALHUB_SETTLEMENT_CAPACITY=1 \
RIVALHUB_SETTLEMENT_ORDER=reconcile-holder RIVALHUB_CAPACITY_SHA=$(git rev-parse HEAD) \
RIVALHUB_SETTLEMENT_CAPACITY_REPORT=/tmp/settlement.json \
pnpm test:integration:pg17 tests/integration/db/capacity/prediction-settlement-capacity.test.ts
```
