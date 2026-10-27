# #784 BET 服务层隔离探针

该探针只测真实 PostgreSQL 服务层的同账户和两个账户交替 BET 提交，不代表完整 #784、HTTP、托管 provider 或生产容量，也不构成运行时预算。每轮在独立 scratch database 重放迁移并建立相同的小夹具：一个 Major、一场比赛、两个已加入账户、七个盘口、零下注；并发提交 1 单位下注，默认同账户；设置 `RIVALHUB_BET_ACCOUNTS=different` 时两个账户交替提交。`RIVALHUB_CAPACITY_SHA` 必须与 HEAD 相同，生产源码、迁移、夹具和探针必须无未提交差异。报告记录这些关键文件的 hash；每轮检查零下注和初始余额。

池大小 6，连接获取 timeout 2s；每个事务用 `set_config` 设置并读回 statement timeout 5s 和 lock timeout 2s。测试设定不代表生产配置。梯度 1、2、4、8、16 各三轮；任何失败或 5ms 采样的池等待队列达到 8 时，在当前轮结束并核对后停止升载。采样可漏掉队列峰值；停止条件不是生产资源上限。每个请求记录总耗时、获取连接并开始事务的耗时、事务回调开始到提交返回的耗时；它们不是 HTTP 耗时，也不分离 SQL 和锁等待。

负载结束后仅通过 request ID 读取已提交投注，核对余额；失败且未观察到的结果保留为 unresolved，不重放。仅当该轮没有失败时发送新的不同 ID 的恢复请求。单独验证幂等重试与开赛后拒绝。scratch 数据库和连接由现有 fixture 的 finally 清理；实验不修改生产数据。报告不保存用户、比赛或 request ID。

在明确授权的隔离 loopback PostgreSQL 17 上运行，不可指向生产：

```bash
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 \
RIVALHUB_LOCAL_DATABASE_URL=postgresql://postgres:local-review-only@127.0.0.1:55432/postgres \
RIVALHUB_INTEGRATION_WORKERS=1 RIVALHUB_BET_CAPACITY=1 \
RIVALHUB_CAPACITY_SHA=$(git rev-parse HEAD) RIVALHUB_CAPACITY_REPORT=/tmp/bet-capacity.json \
pnpm test:integration:pg17 tests/integration/db/capacity/bet-capacity.test.ts
```

尚未覆盖跨截止并发、更多独立账户、预测、Demo/身份撤销、多赛事、结算/更正交错、BET 业务事务下的慢 SQL/持锁注入、锁等待采样、HTTP 和 provider 费用；issue 继续开放。不能从这些逻辑数据或响应字节推导 provider egress。后续预算由父任务根据完整证据判断。

## 本次测量

[原始脱敏结果](bet-service.json)记录代码提交 `e3d8bc7fef6b873ce95a557d5d9557c774867b33` 和文件哈希。2026-10-27 在本地 PostgreSQL 17.11（与本地其他服务共享实例，独立 scratch database）、Linux x86_64、5 个可见 CPU 上运行；这不是独占 DB 主机。1、2、4、8 并发各三轮，16 并发第一轮队列采样到 10，达到停止阈值 8 后未继续。61 个调用均观察到提交，余额、幂等和开赛拒绝通过。逐轮原始耗时及 timeout 读回见 JSON；这些小样本与共享环境不能用来确定退化点。

PG 故障测试还以行锁、占满的六连接池和慢 SQL 分别触发锁、连接获取及 statement 超时，释放或回滚后成功查询；两个 integration test 均通过并清理数据库。此故障测试不模拟提交响应丢失；未观察到失败请求的首次只读查询不能证明写入永远不会稍后提交，仍保留 unresolved，且不重放。

## 两账户扩展

冻结代码 `c9fbc19929ed017a9a781d57b603898f8c0c5955` 的 [两账户结果](bet-service-two-accounts.json) 和 [同账户复跑](bet-service-same-accounts.json) 均完成 1/2/4/8 各三轮，在 16 并发第一轮采样队列达到 10 后停止；两账户模式 61 个请求均观察到提交，逐请求归属与两账户余额通过。两个账户仍属于同一赛事，提交共享 BET program 行锁；此实验不能隔离账户争用，也不是 16 个不同账户的实验。两次运行都在共享的本地 PostgreSQL 上，不能用于生产预算。

[开赛边界并发回归](../../../../tests/integration/db/capacity/bet-boundary.test.ts)在真实 PostgreSQL 中观察到行锁等待，验证先提交的 gameplay 状态使排队下注被拒绝，以及下注先持锁并提交后开赛状态才能写入。它直接更新测试比赛的 gameplay 状态来构造交错，不覆盖真实开赛 workflow，也不是跨截止容量梯度。
