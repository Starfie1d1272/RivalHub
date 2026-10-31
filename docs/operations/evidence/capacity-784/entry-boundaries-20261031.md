# #784 正式入口与边界补充实验

2026-10-31 使用独立本地 PostgreSQL 17.11 容器；每轮在新 scratch database 重放迁移。无 HTTP、真实用户或生产数据。下表是本次实验预算和观察，不是生产支持人数或性能承诺。每档 1/2/4/8 均三轮；16 首轮采样连接池队列达到止损阈值 8 后停止。6 连接池、2s 获取 timeout、每事务 5s statement timeout，BET/更正/Demo 锁 timeout 2s，墙钟实验锁 timeout 3s；原始 JSON 包含测量源码精确 SHA、文件哈希、逐请求耗时和分类、每轮耗时、采样队列与清理标记。每轮吞吐可由请求数除以该轮 elapsedMs 计算；受控持锁场景的耗时包含人为屏障和 sleep，不能当作正常服务延迟或吞吐。队列采样可能漏峰。

| 操作及夹具 | 实验结果 | 止损与限制 |
| --- | --- | --- |
| [BET 同账户 ALL IN](bet-all-same-20261031.json)：1 个比赛、2 个已加入账户，每轮使用同一账户 | 13 次提交、48 次预期余额不足；每轮首笔扣尽余额，已知成功请求重试不重复扣款。 | 16 首轮队列采样 10；一账户不是独立用户容量。 |
| [BET 两账户 ALL IN](bet-all-two-20261031.json)：同一比赛，两个账户交替 | 23 次提交、38 次预期余额不足；余额由账本求和核对，已知成功请求重试不重复扣款。 | 16 首轮队列采样 10；仍共享赛事锁。 |
| [正式地图开赛](bet-start-20261031.json)：已完成 BO3 BP，开赛 owner 持锁后排队下注 | 61 次预期锁定拒绝，余额和单条开赛审计通过；持锁后人为 `pg_sleep(0.2)`。另有确定性回归验证下注先持锁与开赛先持锁及幂等。 | 16 首轮队列采样 11；sleep 仅是故障模型。 |
| [完整预测跨墙钟截止](prediction-wall-20261031.json)：24 队、两账户、完整 2/6/2 提交 | 每轮截止前对照提交成功，61 次负载请求截止后拒绝；数据库时钟证明已连接的请求截止前等待及持锁方截止后释放。 | 16 首轮队列采样 11；池满时其余请求先排连接池，不能称所有请求在截止前已进入 PG。持锁方有约 1.1s 人为 sleep。 |
| [正式结果更正](prediction-correction-entry-20261031.json)：32 队、已结算预测市场和两个相反选项 | `planResultCorrectionInTx` 后调用 `applyResultCorrectionInTx`；61 次迟到请求预期关闭拒绝。更正后先为待结算，重验收瑞士轮后余额反转；重复对账保持不变。 | 16 首轮队列采样 11；`pg_sleep(0.2)` 是持锁故障模型。已完赛盘口的拒绝不可归因于更正本身。 |
| [共享身份重校验先行](demo-reverse-20261031.json)：两个赛事共享身份，重校验持锁后多个撤销调用 | 13 次有效撤销、48 次已撤销；两赛事导入失效，身份归属一致。确定性回归另验证撤销先行与合法人工再次确认。 | 16 首轮队列采样 11；多请求针对同一身份，不代表多个独立身份。 |

正式更正回归首次将旧直接 SQL 实验的最终余额当成立即结果，测试观察到第二账户为 900 而非 1100。源码及后续真实 PG 复验表明正式恢复回滚瑞士轮验收游标，重新验收并对账后才为 1100；测试现明确验证中间态和最终态，没有更改业务代码。初始失败不是容量梯度结果。

隔离复现：以表中 JSON 的 `sha` 检出对应提交；设置本地 PG17 地址、`RIVALHUB_ALLOW_LOCAL_CONTAINERS=1`、`RIVALHUB_INTEGRATION_WORKERS=1` 与 `RIVALHUB_CAPACITY_SHA=$(git rev-parse HEAD)`，分别运行：

```bash
RIVALHUB_BET_CAPACITY=1 RIVALHUB_BET_AMOUNT=all RIVALHUB_CAPACITY_REPORT=/tmp/all.json pnpm test:integration:pg17 tests/integration/db/capacity/bet-capacity.test.ts
# 两账户另加 RIVALHUB_BET_ACCOUNTS=different
RIVALHUB_BET_START_CAPACITY=1 RIVALHUB_BET_START_REPORT=/tmp/start.json pnpm test:integration:pg17 tests/integration/db/capacity/bet-boundary.test.ts
RIVALHUB_PREDICTION_WALL_CAPACITY=1 RIVALHUB_PREDICTION_CAPACITY_REPORT=/tmp/wall.json pnpm test:integration:pg17 tests/integration/db/capacity/prediction-capacity.test.ts
RIVALHUB_CORRECTION_CAPACITY=1 RIVALHUB_CORRECTION_CAPACITY_REPORT=/tmp/correction.json pnpm test:integration:pg17 tests/integration/db/capacity/prediction-correction-capacity.test.ts
RIVALHUB_DEMO_REVERSE_CAPACITY=1 RIVALHUB_DEMO_REVERSE_REPORT=/tmp/demo.json pnpm test:integration:pg17 tests/integration/db/capacity/demo-shared-identity.test.ts
```

定向 PG 回归还在实际 BET 提交等待正式开赛事务时触发 `55P03` 行锁超时，回滚持锁方后用新请求恢复；在正式开赛事务中触发 `57014` statement timeout，核对审计回滚并以新事务恢复。既有回归另验证连接池获取超时和释放后的恢复；实验中不重放未知结果。未覆盖网络提交结果未知、HTTP/provider、多实例或生产负载及费用。并发测试的已完成请求与采样并不保证真实部署的容量或排队上限。
