# #784 BET 服务层隔离探针

该探针只测真实 PostgreSQL 服务层的同账户 BET 提交，不代表完整 #784、HTTP、托管 provider 或生产容量，也不构成运行时预算。每轮在独立 scratch database 重放迁移并建立相同的小夹具：一个 Major、一场比赛、两个已加入账户、七个盘口、零下注；并发提交同一账户的 1 单位下注。`RIVALHUB_CAPACITY_SHA` 必须与 HEAD 相同，生产源码、迁移、夹具和探针必须无未提交差异。报告记录这些关键文件的 hash；每轮检查零下注和初始余额。

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

尚未覆盖跨截止并发、不同账户、预测、Demo/身份撤销、多赛事、结算/更正交错、BET 业务事务下的慢 SQL/持锁注入、锁等待采样、HTTP 和 provider 费用；issue 继续开放。不能从这些逻辑数据或响应字节推导 provider egress。后续预算由父任务根据完整证据判断。

## 本次测量

[原始脱敏结果](bet-service.json)记录代码提交 `e3d8bc7fef6b873ce95a557d5d9557c774867b33` 和文件哈希。2026-10-27 在本地 PostgreSQL 17.11（与本地其他服务共享实例，独立 scratch database）、Linux x86_64、5 个可见 CPU 上运行；这不是独占 DB 主机。1、2、4、8 并发各三轮，16 并发第一轮队列采样到 10，达到停止阈值 8 后未继续。61 个调用均观察到提交，余额、幂等和开赛拒绝通过。逐轮原始耗时及 timeout 读回见 JSON；这些小样本与共享环境不能用来确定退化点。

同一版本还以真实 PG 行锁和占满的六连接池分别触发锁等待及连接获取超时，释放后成功查询；两个 integration test 均通过并清理数据库。此故障测试不模拟提交响应丢失；未观察到失败请求的首次只读查询不能证明写入永远不会稍后提交，仍保留 unresolved，且不重放。
