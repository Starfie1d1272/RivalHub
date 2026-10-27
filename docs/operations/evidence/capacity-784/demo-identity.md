# #784 跨赛事 Demo 与身份撤销

[脱敏原始结果](demo-identity.json)使用冻结代码 `3c095680efb7e60f8d7e4c63b7374880113a8e12`。每轮新建 scratch database 并重放迁移，固定 17 场赛事、每场 10 位合成选手及一份 Demo；先确认第一场身份。各轮同时提交一次该身份撤销，以及 1、2、4、8 或 16 场其他赛事的 Demo 身份确认，因此实际事务数分别是 2、3、5、9、17。每赛事使用不同用户及 Steam64：本实验覆盖全局 identity advisory 锁跨赛事竞争，但不证明同一身份跨赛事失效传播。

池最大 6，连接获取 timeout 2s，每个事务读回 statement timeout 5s、lock timeout 2s；额外一个连接每 20ms 采样 PG advisory wait 和池队列。失败、采样失败或采样池队列达到 8 后停止升载；采样可能漏峰，无法提供单请求锁等待时间。结束后只读核对每个身份的状态、归属和 Demo 状态；未观察到的失败结果保留 unresolved，不重放。独立回归实际观察确认事务等待其他赛事撤销所持的 advisory 锁。试验没有 HTTP、provider、实际 egress 或生产测试。

在共享本地 PostgreSQL 17.11 上，确认数 1/2/4/8 各三轮，16 第一轮队列采样到 11，达到停止条件。74 个事务均观察到提交，身份归属和撤销后源 Demo 状态核对通过；最大 advisory wait 采样分别为 0/1/3/5/5。采样和共享实例均限制结论，不能推导生产预算或能力上限。保留的结果显示每个调用的端到端耗时、获取连接并开始事务耗时、事务回调开始到提交返回耗时，不是 HTTP 耗时。

复现仅限明确授权的隔离 loopback PostgreSQL 17：

```bash
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 \
RIVALHUB_LOCAL_DATABASE_URL=postgresql://postgres:local-review-only@127.0.0.1:55432/postgres \
RIVALHUB_INTEGRATION_WORKERS=1 RIVALHUB_DEMO_CAPACITY=1 \
RIVALHUB_CAPACITY_SHA=$(git rev-parse HEAD) RIVALHUB_DEMO_CAPACITY_REPORT=/tmp/demo-capacity.json \
pnpm test:integration:pg17 tests/integration/db/capacity/demo-identity.test.ts
```

未覆盖反向持锁顺序、共享身份跨赛事撤销、慢 SQL 或持锁故障下注入该业务、多实例和 HTTP。现有结果不完成 #784；预测、截止、结算及更正仍需独立实验。
