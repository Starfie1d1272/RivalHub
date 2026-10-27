# #784 预测截止与更正

[脱敏原始结果](prediction-drafts.json)来自冻结代码 `369d0b188547afa3440cf827f3381cc1895619ba`，共享本地 PostgreSQL 17.11，非独占主机。每轮独立 scratch database 重放迁移，固定一个 24 队 Major、两个已加入账户、一个 PickEm contest、零预测单；两个账户交替提交空草稿。每轮结束只读核对 request ID、账户归属、余额；未观察到的失败结果保留 unresolved，不重放。无失败时把测试窗口截止设为过去并检查新预测被拒绝。池最大 6、获取 timeout 2s；事务读回 statement timeout 5s 与 lock timeout 2s。失败或采样队列达到 8 停止升载；5ms 队列采样可能漏峰。

1/2/4/8 并发各三轮，16 第一轮队列采样 10 后停止；61 个预测均观察到提交且余额未变，截止后拒绝检查通过。结果包含逐调用总耗时、连接获取并开始事务耗时、事务回调开始到提交返回耗时；没有采样 PG 锁等待，也不代表 HTTP、provider 或生产预算。空草稿不是完整有效提交，也不代表更多独立观众。

另外两个真实 PG 回归观察到锁等待：一个在测试事务中提交过去的窗口截止，验证原先排队的另一账户草稿被拒绝，既有请求幂等；另一个在 32 队 Major 的第一轮完成及结算后，事务内更正比分并 reconciliation，验证排队的迟到下注拒绝、两账户余额反转及再次 reconciliation 幂等；比赛在更正前已完赛，下注本就应被关闭，因此拒绝不能归因于更正。这些测试通过直接更新测试比赛/窗口构造交错，不测真实开赛或赛果更正入口，也不是这些交错的容量梯度。

复现仅限明确授权的隔离 loopback PostgreSQL 17：

```bash
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 \
RIVALHUB_LOCAL_DATABASE_URL=postgresql://postgres:local-review-only@127.0.0.1:55432/postgres \
RIVALHUB_INTEGRATION_WORKERS=1 RIVALHUB_PREDICTION_CAPACITY=1 \
RIVALHUB_CAPACITY_SHA=$(git rev-parse HEAD) RIVALHUB_PREDICTION_CAPACITY_REPORT=/tmp/prediction-capacity.json \
pnpm test:integration:pg17 tests/integration/db/capacity/prediction-capacity.test.ts \
  tests/integration/db/capacity/prediction-boundary.test.ts tests/integration/db/capacity/prediction-correction.test.ts
```

未覆盖同一账户与不同账户分开对比、真实开赛/更正入口、其他业务的慢 SQL 与持锁、HTTP、provider 或多实例；完整提交、墙钟交错及更正持锁梯度见下文。#784 继续开放。

## 完整预测提交

[完整预测原始结果](prediction-complete.json)使用冻结代码 `bf6f469acd6edf640197d997cc3b686c49f6ed59`：每轮相同独立夹具，两账户交替提交符合官方 2/6/2 槽位规则的完整 Swiss 预测。1/2/4/8 并发各三轮，16 首轮队列采样到 10 后停止；61 次提交观察到对应账户与 submitted 标记，余额不变，后续截止拒绝通过。可在复现命令中增加 `RIVALHUB_PREDICTION_COMPLETE=1`；此结果仍是两账户共享单一赛事的服务层实验。

## 墙钟截止及更正持锁梯度

完整预测的真实墙钟回归使用 PostgreSQL `clock_timestamp()`：先成功提交并幂等重试；事务持有 program 锁、设定未来一秒的截止，观察另一账户的完整提交在截止前等待，事务内 `pg_sleep(1.2)` 后确认数据库时间已过截止，释放锁后排队请求被拒绝。该用例是一次有界交错，而非跨截止的并发梯度。

[更正持锁梯度原始结果](prediction-correction-capacity.json)使用冻结代码 `0100db43dbbd5aee77fd9e5a2136c7687051b910`：每轮独立 32 队 Major，两个账户对一场已结算盘口分别投入 100 分。真实 reconciliation 事务中以测试更新更正比分，在持有比赛及 program 锁时执行 `pg_sleep(0.2)`，观察 1/2/4/8/16 个迟到下注等待；前四档各三轮，16 首轮队列采样 11 后停止。61 个下注均按已关闭市场拒绝且未观察到新下注；两账户余额从 1100/900 更正为 900/1100，重复 reconciliation 后保持不变。比赛在更正前已完赛，拒绝不能归因于更正；直接比分更新及 SQL sleep 均为可控故障模型，不代表真实更正入口或生产延迟。报告含逐请求耗时、池队列和至少一个事务锁等待的观察，但不提供逐请求锁等待或 HTTP/provider 时间。出现未知结果时只读核对，不重放。

复现更正持锁梯度时，以上述命令的相同隔离 PG 配置改设 `RIVALHUB_CORRECTION_CAPACITY=1` 和 `RIVALHUB_CORRECTION_CAPACITY_REPORT=/tmp/correction-capacity.json`，测试文件改为 `tests/integration/db/capacity/prediction-correction-capacity.test.ts`。`tests/integration/db/capacity/prediction-wallclock.test.ts` 为普通 PG 回归。两者不替代真实开赛/更正 workflow、provider 或多实例验证。
