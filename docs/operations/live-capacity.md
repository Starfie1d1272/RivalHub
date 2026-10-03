# LIVE 接收容量与 authority 边界

本专题只拥有接收端准入与投递；`source.ts`、`installation.ts` 和 canonical result owner 继续拥有源接管、撤销和官方赛果。公开协议、topic、viewer JWT 与 HTTP Broadcast transport 不变。隔离复现不代表生产事故，loopback 测量不代表 provider 容量。

## 准入、互斥与授权

接收分成两个资源阶段。读取/解析最多两个活跃请求，最多 256 个尚未解析的入口等待者，FIFO 等待最多 500ms；body 最多 256 KiB、读取最多 2 秒。入口满载或等待超时返回 429。这个短入口队列不查询数据库、不等待鉴权或广播、不保存解析后的 snapshot；没有重试或历史/快照仓库。释放入口后，最多两个请求进入鉴权查询与 LIVE 事务，因此 LIVE 自身最多使用生产三连接池中的两个连接，保留一个给其它业务。

广播准入按 **credential hash + match**（正常凭据与 installation 一一对应） 保存最多 256 个需求票据；同一安装下的不同比赛也独立轮转。调度 key 经过凭据语法和比赛 UUID 检查，但仍是不可信的输入，不代表合法比赛。票据只有 key 和最后到达的单调时间，不持有帧、请求或 promise。先前被拒绝的源保留顺序；后来的源不能越过已等待的源占用空闲名额。被拒绝的当前帧立即丢弃，下一份新 heartbeat 取得轮到的名额；同一个 key 不能同时占用两个名额。停止发送的票据最多保留 1.5 秒，避免静默源永久占位。

持续以 500ms cadence 到达、已登记的有限源，其票据顺序只会因前驱被服务或过期而前进；新到达者只能排在后面。因此有限的事务/发送完成时间下，每场都能持续取得发送机会。四源同相、每轮内完成的确定性回归从 **20/20/0/0** 变为 **10/10/10/10**，最长无接受间隔从后两源整段 10 秒变为每场 1 秒。700ms/2s permit 占用下，四场最长准入间隔分别为 2s/4s。每场 2Hz 仍是输入 cadence，不承诺所有输入帧投递成功；两并发是进程资源预算，不是“两场比赛”的产品限制。

公平性有明确适用范围：入口须能在 freshness 预算内完成读取/解析，随后鉴权仍受原 freshness 检查；需求集合与请求占用须有界。超过入口/元数据预算的持续流量、恶意凭据洪泛、事件循环暂停、DB 不可用或任意多实例路由，不能由本地调度器承诺每场送达。需要在目标并发、RTT 和实例路由下验证；这不是已批准的新产品上限。进程重启会丢失票据，不改变 authority。

每个获准请求仍在事务中重新验证 installation → match → active source，包括比赛状态、session、authority revision、generation、epoch、reliable sequence floor、identity/lineup、队伍映射及能力字段。入口票据不授予任何权限。**广播仍在原 installation/match/source share locks 内完成**：LIVE 先持锁则撤销/交接/人工结果等待广播返回；mutation 先持锁则本帧在锁预算后丢弃或重新验证新事实。不把发送移出事务，也不通过 Promise.race 提前放开锁。

跨实例同场互斥由 PostgreSQL `pg_try_advisory_xact_lock` 提供，争用立即丢弃。它不是跨比赛公平调度，也不是 project-wide provider 限流。SQL statement 预算 1 秒、单次锁等待 25ms；接收到完成授权的 freshness 预算仍为 500ms，连接池 acquisition timeout 仍为 10 秒。HTTP 发送仍使用 SDK 的 2 秒 abort，错误响应体取消逻辑不变。网络异常可能有未知投递结果；不重试、不宣称能撤回 provider 已接收的消息。

已授权投递的 cursor/timestamp/token bucket 元数据仍最多 256 条，10 秒过期；容量 2、补充 2/s 吸收到达抖动，不保存 snapshot。跨实例/重启后的旧帧与重复帧仍由现有 viewer cursor/producedAt 规则处理。相同 gameplay sequence 的较新 heartbeat 合法，官方赛果不消费 LIVE。

## 证据分层

审查基线为 `09fe43a`，已合入 main `7b75b671`。原先仅 aggregate accepted>0 与错峰成功不能证明同步公平；[确定性 unit 回归](evidence/live-fairness-baseline.json)先在原准入函数上失败，再在轮转实现上通过。

本地真实 PostgreSQL 17 使用独立 loopback 容器，每次 canonical runner 重放 active migration chain、建立临时 worker DB 并清理。应用 pg pool 为 3，另用 1 连接观测；SQL、事务、授权、route、SDK 和 HTTP 均真实执行，只替换 DB factory 与 Next cache hooks。HTTP 故障服务分别注入 5ms/202、700ms/202、2600ms 响应头、断连、429、错误 JSON、错误体挂起。它的 viewer 数为 0。

[逐场报告](evidence/live-fairness-after.json)记录 source/match、接受次数、最长无成功时间、provider 尝试次数/最长间隔和恢复。成功接受与获准发送分开：provider 故障时可以每场都获得尝试但接受数均为 0；恢复断言要求每场的新帧成功，不能只看总量。4 场通常运行 20 轮 × 500ms；16 场慢广播运行 32 轮。另覆盖同一安装四场、四场错峰、单源突发、恶意/超大/挂起 body、入口超时、handover/revoke、人工赛果与迟到可靠事件。

`maxPoolQueue` 来自 pg.Pool；事务/锁采样间隔 20ms，relation RowShareLock 的数量不是精确行锁数量。请求/事务分位数是小样本故障证据，不是生产 SLO。JSON 保存运行 SHA 及关键源码 SHA-256；后续只保存证据的提交不改变测量实现。历史 [baseline](evidence/live-capacity-baseline.json) / [after](evidence/live-capacity-after.json) 属于轮转修复前的资源保护实验，不能用于证明当前公平性。

本次固定实现 `b475a030` 的 PostgreSQL 专项共 36 项通过，相关 unit 共 47 项通过；下列顺序对应报告中逐场的 UUID，时间取整到毫秒。场景转换时旧源的票据最多还保留 1.5 秒，表中包含这段恢复等待。

| 场景 | 每场成功接受数 | 每场最长无成功间隔（ms） | 恢复 |
| --- | --- | --- | --- |
| 四场同步 fast，20 轮 | 10 / 10 / 10 / 10 | 1005 / 1003 / 1018 / 1018 | 四场全部恢复 |
| 四场同步 700ms，20 轮 | 5 / 5 / 4 / 4 | 2226 / 2226 / 3226 / 3225 | 四场全部恢复 |
| 四场 timeout | 0 / 0 / 0 / 0（尝试各 2 次） | 故障期间均 11024 | 四场全部恢复 |
| 同一安装四场，20 轮 | 9 / 9 / 8 / 8 | 1519 / 1520 / 2015 / 2018 | 持续取得新帧 |
| 单源突发 + 三场正常源 | 3 / 3 / 2 / 2 | 1555 / 1555 / 2078 / 2078 | 四场持续取得新帧 |
| 四场错峰 | 4 / 4 / 4 / 4 | 断连后的较新 heartbeat 另有断言 | 无首次帧丢失 |

16 场 fast 的逐场接受数为 `3,3,2,2,2,2,2,2,2,2,2,2,2,2,2,2`，700ms 慢广播为 `2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,1`；各场最长间隔与恢复标记完整保存在 JSON。所有故障矩阵场景观测到广播并发不超过 2、pool queue 峰值 0；429/断连/错误体期间每场都有发送尝试，恢复后每场均接受新帧。恶意同步 burst 可全部拒绝，不能把其后恢复计入故障阶段的接受数。

本工作区启动 Local Supabase 时镜像解包磁盘不足，未得到本地 provider 通过结果；该层以最终 HEAD 的 CI system job 为证据入口，不能把这里的 PostgreSQL 通过当作替代。

Local Supabase 单独验证真实 Realtime/WebSocket、JWT/RLS 与 fan-out；不把 loopback 故障服务说成真实 Supabase。托管项目的 quota、跨区 RTT、project-wide 限流和线上账单属于第三层，未进行生产压测。

## 容量估计与公平性的区别

`M` 场输入速率 `r≤2/s`、平均发送占用 `D` 秒，维持所有帧需约 `M*r*D` 个 slots。按本进程两个 slots 和 30% 余量，必要预算为 `M*r*D≤1.4`，还需考虑同相突发、入口鉴权耗时和其它业务。这不是支持场数或吞吐保证。

四场 2Hz、700ms provider 延迟约需 5.6 slots；十六场约需 22.4。当前选择降低各场投递频率并保持轮转，不让前两场永久占用。多实例会增加 DB/provider 总需求；同场 PG 互斥不能自动解决跨实例公平和 provider 配额。上线前需用实际赛程、实例路由与 provider RTT 验证每场间隔。

## Viewer fan-out 与费用假设

`RIVALHUB_LIVE_EVIDENCE=1` 的现有 Local Supabase verifier 增加 **8 个真实 WebSocket viewer、3 帧**，要求 24 次实际接收，输出 `LIVE_FANOUT` 的接收 JSON bytes、p95/max publication-to-receive latency；同时保留单场 JWT、跨场拒绝、HTTP/WebSocket INSERT 拒绝、业务 Data API 拒绝。这里的 8 是小规模回归样本，不是最大观众数；最终 CI run 的 system evidence 是结果来源。局部 loopback HTTP capacity test 的 viewer 数为 0，不伪称它测到了实际 fan-out。

按 2026-10-03 查阅的 [消息计费](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages) / [Realtime pricing](https://supabase.com/docs/guides/realtime/pricing)：一次 Broadcast 按 1 次发送 + 每个 viewer 1 次接收计量；付费档超配额以每百万消息 $2.50、向上取整包计费。实际计划、quota 和限流仍要在目标项目核实。

设第 i 场 `r_i` 帧/s、`V_i` 个接收连接、payload `B_i` bytes、持续 `T` 秒：

- 消息预算：`T * Σ[r_i * (1 + V_i)]`；
- viewer payload 出站：`T * Σ[r_i * V_i * B_i]`，另加 WebSocket/TLS/IP、重连和其它产品开销；
- 峰值连接：所有同时连接的 tab/device 总数，不能只数独立用户；短 JWT renew/rejoin 也产生额外授权/连接压力。

沿用 #615 Free 规划边界 100 events/s、200 connections，并预留 30% events 余量，保守条件 `Σ[r_i*(1+V_i)] ≤ 70`。4 场 ×2Hz、每场10连接为88 messages/s：低于名义100，但已不满足该余量；16场同条件为352，明显超预算。这些算式**不等于支持人数**，还未考虑其他流量、payload 上限和 provider 实际计量/节流。

仅作费用例子：若 4 场、每场100连接、2Hz、每次2小时、月内10次，则约58,176,000消息；假设 Pro 5,000,000月配额全部可用于此流量，超额按54包估算 **$135/月消息费用**，峰值400连接低于假定的500配额。本地代表性 B=10,111 bytes 时，viewer JSON 出站约 **542.4 GiB/月**；不含 framing、重连、token、SSR、数据库/HTTP流量、基础计划、compute 与出站单价，不能把 $135 当总账单。若每帧接近192 KiB，字节预算会再增约19.4倍。

## 重复执行

使用 Node 24 与仓库固定的 pnpm；只在隔离的 loopback 目标执行：

```bash
pnpm install --frozen-lockfile
pnpm exec vitest run tests/unit/lib/mizar-live-admission.test.ts
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 \
RIVALHUB_LOCAL_DATABASE_URL=postgresql://postgres:local-review-only@127.0.0.1:55432/postgres \
RIVALHUB_INTEGRATION_WORKERS=1 LIVE_CAPACITY_REPORT=/tmp/live-fairness.json \
pnpm test:integration:pg17 tests/integration/db/mizar-live-capacity.test.ts \
  tests/integration/db/mizar-live-ingest.test.ts
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 RIVALHUB_LIVE_EVIDENCE=1 \
pnpm db:local:bootstrap-services
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 RIVALHUB_LIVE_EVIDENCE=1 \
pnpm db:local:verify-supabase
```

上例密码只属于 disposable 本地容器；wrapper 隔离目标，不注入远程 URL/key。CI system lane 根据 Mizar changed surface 强制 Local Supabase evidence，并验证 pinned Mizar adapter/parser。

## 尚未证明的事实

没有生产锁事故、生产压测、远程 Supabase 迁移、部署或权限变更。loopback 故障模型不等于 Supabase 故障实现。真实 provider 仍需验证：目标 project 的 quotas/modern-key Broadcast 支持、跨区 RTT/p99、429/timeout 后晚到包、撤销/接管与 viewer reducer 的 end-to-end reset、多实例热点/公平性、token renew/rejoin 高峰、最大复杂度 Radar payload、实际出站和账单。超时后 provider 已接受的消息无法靠数据库回滚撤回；这是现有 transport 的边界，不能用本次 mock/本地通过签署生产能力。

本专项不替代 #784 身份/竞猜容量、#610 后台工作流或 #615 公开 consumer 的完整验收。DB retry、公共缓存、投影 backfill/coverage 和 release checks 继续沿用 main，未改写其 owner。
