# #784 预测截止与更正

[脱敏原始结果](prediction-drafts.json)来自冻结代码 `369d0b188547afa3440cf827f3381cc1895619ba`，共享本地 PostgreSQL 17.11，非独占主机。每轮独立 scratch database 重放迁移，固定一个 24 队 Major、两个已加入账户、一个 PickEm contest、零预测单；两个账户交替提交空草稿。每轮结束只读核对 request ID、账户归属、余额；未观察到的失败结果保留 unresolved，不重放。无失败时把测试窗口截止设为过去并检查新预测被拒绝。池最大 6、获取 timeout 2s；事务读回 statement timeout 5s 与 lock timeout 2s。失败或采样队列达到 8 停止升载；5ms 队列采样可能漏峰。

1/2/4/8 并发各三轮，16 第一轮队列采样 10 后停止；61 个预测均观察到提交且余额未变，截止后拒绝检查通过。结果包含逐调用总耗时、连接获取并开始事务耗时、事务回调开始到提交返回耗时；没有采样 PG 锁等待，也不代表 HTTP、provider 或生产预算。空草稿不是完整有效提交，也不代表更多独立观众。

另外两个真实 PG 回归观察到锁等待：一个在测试事务中提交过去的窗口截止，验证原先排队的另一账户草稿被拒绝，既有请求幂等；另一个在 32 队 Major 的第一轮完成及结算后，事务内更正比分并 reconciliation，验证排队的迟到下注拒绝、两账户余额反转及再次 reconciliation 幂等。这些测试通过直接更新测试比赛/窗口构造交错，不测真实开赛或赛果更正入口，也不是这些交错的容量梯度。

复现仅限明确授权的隔离 loopback PostgreSQL 17：

```bash
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 \
RIVALHUB_LOCAL_DATABASE_URL=postgresql://postgres:local-review-only@127.0.0.1:55432/postgres \
RIVALHUB_INTEGRATION_WORKERS=1 RIVALHUB_PREDICTION_CAPACITY=1 \
RIVALHUB_CAPACITY_SHA=$(git rev-parse HEAD) RIVALHUB_PREDICTION_CAPACITY_REPORT=/tmp/prediction-capacity.json \
pnpm test:integration:pg17 tests/integration/db/capacity/prediction-capacity.test.ts \
  tests/integration/db/capacity/prediction-boundary.test.ts tests/integration/db/capacity/prediction-correction.test.ts
```

未覆盖完整已提交预测、真实墙钟截止跨越、同一账户与不同账户分开对比、结算/更正并发梯度、慢 SQL 与持锁注入业务、HTTP、provider 或多实例。#784 继续开放。
