# LIVE 接收容量与 authority 边界

本专题只拥有接收端准入与投递；`source.ts`、`installation.ts` 和 canonical result owner 继续拥有源接管、撤销和官方赛果。公开协议、topic、viewer JWT 与 HTTP Broadcast transport 不变。隔离复现不代表生产事故，loopback 测量不代表 provider 容量。

## 准入、互斥与授权

接收分成两个资源阶段。读取/解析在 Vercel 最多两个、持久 Node 主机最多六个活跃请求，最多 256 个尚未解析的入口等待者，FIFO 等待最多 500ms；body 最多 256 KiB、读取最多 2 秒。入口满载或等待超时返回 429。这个短入口队列不查询数据库、不等待鉴权或广播、不保存解析后的 snapshot；没有重试或历史/快照仓库。释放入口后，LIVE 授权与广播事务采用相同上限：Vercel 的三连接池保留一个连接，持久 Node 主机的十连接池保留四个连接供其它业务。

广播准入按 **credential hash + match**（正常凭据与 installation 一一对应） 保存最多 256 个需求票据；同一安装下的不同比赛也独立轮转。调度 key 经过凭据语法和比赛 UUID 检查，但仍是不可信的输入，不代表合法比赛。票据只有 key 和最后到达的单调时间，不持有帧、请求或 promise。先前被拒绝的源保留顺序；后来的源不能越过已等待的源占用空闲名额。被拒绝的当前帧立即丢弃，下一份新 heartbeat 取得轮到的名额；同一个 key 不能同时占用两个名额。停止发送的票据最多保留 1.5 秒，避免静默源永久占位。

持续以 500ms cadence 到达、已登记的有限源，其票据顺序只会因前驱被服务或过期而前进；新到达者只能排在后面。因此有限的事务/发送完成时间下，每场都能持续取得发送机会。四源同相、每轮内完成的确定性回归从 **20/20/0/0** 变为 **10/10/10/10**，最长无接受间隔从后两源整段 10 秒变为每场 1 秒。700ms/2s permit 占用下，四场最长准入间隔分别为 2s/4s。每场 2Hz 仍是输入 cadence，不承诺所有输入帧投递成功；并发上限是进程资源预算，不是比赛场数限制。

公平性有明确适用范围：入口须能在 freshness 预算内完成读取/解析，随后鉴权仍受原 freshness 检查；需求集合与请求占用须有界。超过入口/元数据预算的持续流量、恶意凭据洪泛、事件循环暂停、DB 不可用或任意多实例路由，不能由本地调度器承诺每场送达。需要在目标并发、RTT 和实例路由下验证；这不是已批准的新产品上限。进程重启会丢失票据，不改变 authority。

每个获准请求仍在事务中重新验证 installation → match → active source，包括比赛状态、session、authority revision、generation、epoch、reliable sequence floor、identity/lineup、队伍映射及能力字段。入口票据不授予任何权限。**广播仍在原 installation/match/source share locks 内完成**：LIVE 先持锁则撤销/交接/人工结果等待广播返回；mutation 先持锁则本帧在锁预算后丢弃或重新验证新事实。不把发送移出事务，也不通过 Promise.race 提前放开锁。

生产接收链在跨区数据库下须控制 SQL 往返数。HTTP 外层只校验凭据格式并生成 hash；LIVE owner 在每帧的 installation 共享锁查询中按 hash 验证有效凭据，设备与赛事 scope 均从该受锁事实派生，payload 赛事必须匹配。两个事务超时设置与 advisory 准入合并为一条 SELECT；随后一个带 MATERIALIZED 依赖的语句按 installation → match → source 顺序获取共享锁，只投影授权所需字段。observed-lineup 的当前地图匹配与有效名单身份也在这条语句内读取，名单条件复用 effective roster owner。JSON 投影没有日期字段，保持 pg 对布尔值/整数/JSON 的原生解码。正常 HTTP 路径到完成锁内验证包含 BEGIN 与两条语句，共三轮 SQL 往返；COMMIT/发送在验证之后。不缓存授权，不放宽 500ms 过期预算；冷建连接、队列或单语句仍可使本帧过期，后续新帧重新检查。

`mizar.live.outcome_window` 保留 accepted/frame_expired/contended/delivery_dropped/broadcast_unavailable/rejected/error 七类结果，范围仍是进入 ingest 的调用，平均完整 ingest 耗时包含事务结束/清理。单独的 `mizar.live.stage_window` 记录 HTTP LIVE received、获得两级准入且 revision 语法合法的 admitted、锁内全部授权通过的 authorized、SDK 返回成功的 send_success、过期 expired、入口或需求准入拒绝 capacity、数据库争用 contended，以及发送阶段 timeout/transport/未知失败的 unknown_send。阶段是可重叠的里程碑，不是互斥结果；例如 send_success 后事务结果仍可能未知。received 包含后续凭据语法或协议拒绝，不能与原 ingest 分母混用。

阶段均值为从接收到该阶段的单调耗时，received 为零；safeContext.durationMs 是窗口实际跨度。进程 singleton 保存至多 15 类次数与耗时，不保存帧、账号、凭据、玩家或 match/session/request/trace 标识。窗口以 process 固定 Symbol 跨模块图共享；G 使用唯一 `live_ingest` hook 注册 `flushLiveIngestOutcomes()`，由 A 的共享 sampler 到期 tick 调用，不安装第二套 timer。启用进程采样时，空闲尾窗由后续 tick 输出；未启用采样的环境仍依靠活动记录调用同一接口兜底。重启、SIGKILL 和日志链路故障仍可丢数。accepted/send_success 不证明 viewer 收到或渲染，窗口均值不能替代 p95。Linux 使用 journal 查询固定事件，沿用主机日志保留策略。

跨实例同场互斥由 PostgreSQL `pg_try_advisory_xact_lock` 提供，争用立即丢弃。它不是跨比赛公平调度，也不是 project-wide provider 限流。SQL statement 预算 1 秒、单次锁等待 25ms；接收到完成授权的 freshness 预算仍为 500ms，连接池 acquisition timeout 仍为 10 秒。HTTP 发送仍使用 SDK 的 2 秒 abort，错误响应体取消逻辑不变。网络异常可能有未知投递结果；不重试、不宣称能撤回 provider 已接收的消息。

已授权投递的 cursor/timestamp/token bucket 元数据仍最多 256 条，10 秒过期；容量 2、补充 2/s 吸收到达抖动，不保存 snapshot。跨实例/重启后的旧帧与重复帧仍由现有 viewer cursor/producedAt 规则处理。相同 gameplay sequence 的较新 heartbeat 合法，官方赛果不消费 LIVE。

## 完赛来源与恢复回执

地图结果与来源连接是不同生命周期。最终 `map_ended` 可以把比赛推进到 finished，同时保留数据库中的 `inter_map` 来源行和 producer sequence/receipt；它不表示 Node 仍持有该行对应的网络连接或帧缓存。finished 比赛不能继续通过 LIVE 授权或取得 viewer token。当前来源仍可走 `releaseMizarSource` 显式释放，精确重试 release 为幂等；handover/revoke 关闭的旧来源不能释放新 authority。关闭来源不删除既有可靠回执。

可靠事件在原事务中保存赛果、sequence、receipt 与审计。提交后响应丢失时，仍持有当前来源的同一 producer 可以重连后提交完全相同的事件，由 receipt 返回原结果；这不是重放一次业务写入。来源已经释放、交接或撤销后，旧来源仍按权限边界拒绝。没有发现可复现的资源释放缺口时，不因历史行 `closed_at=null` 批量关闭来源，也不把这类数据库行视为 OOM 根因。

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

`M` 场输入速率 `r≤2/s`、平均发送占用 `D` 秒，维持所有帧需约 `M*r*D` 个 slots。以两个 slots 的基线和 30% 余量计算，必要预算为 `M*r*D≤1.4`，还需考虑同相突发、入口鉴权耗时和其它业务。这不是支持场数或吞吐保证。

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

BP 指令与呈现的历史单次测量记录见 [归档](../archive/performance-w02-w03-2026-10-25/bp03-http-footprint.md)；原临时测量入口已移除。

上例密码只属于 disposable 本地容器；wrapper 隔离目标，不注入远程 URL/key。CI system lane 根据 Mizar changed surface 强制 Local Supabase evidence，并验证 pinned Mizar adapter/parser。

## 本地 HTTP resource fixture

`脚本 scripts/db/mizar-http-resource-fixture.ts` 复用既有完整 Mizar fixture 与纯 snapshot 工厂，创建两个独立 synthetic test match / producer。只接受明确的 local target 与 loopback `DATABASE_URL`；manifest 绑定该数据库指纹，使用 0600，stdout 只输出路径和状态。运行时使用同一提交的完整 worktree，避免只复制 CLI 而遗漏 fixture 工厂。

在调用方已提供本地环境的情况下：

```bash
pnpm exec tsx scripts/db/run-server-cli.ts scripts/db/mizar-http-resource-fixture.ts create .agent-tmp/mizar-http-resource.json
pnpm exec tsx scripts/db/run-server-cli.ts scripts/db/mizar-http-resource-fixture.ts verify .agent-tmp/mizar-http-resource.json --require-receipts
pnpm exec tsx scripts/db/run-server-cli.ts scripts/db/mizar-http-resource-fixture.ts cleanup .agent-tmp/mizar-http-resource.json
```

播出统计联通可用同一 fixture：每场附带两张已完成的合成历史地图和已审核记分板，首发中最高 Rating 为 1.5、缺 ADR 且有两图，另一名为 1.25、ADR 80 且有一图；没有 Demo 明细，不代表手枪、经济、道具或七维已有样本。以下命令从本地 Supabase 状态取得 loopback 连接，不打印连接或 manifest 中的凭据；将 `create` 改为 `cleanup` 可清理：

```bash
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm db:local:bootstrap
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm dev:local # 在独立终端运行
node --input-type=module - <<'JS'
import { execFileSync } from "node:child_process";
const status = JSON.parse(execFileSync("node_modules/.bin/supabase", ["status", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
const env = { ...process.env, DATABASE_URL: status.DB_URL, RIVALHUB_LOCAL_DATABASE_URL: status.DB_URL, RIVALHUB_DB_TARGET: "local" };
execFileSync("node_modules/.bin/tsx", ["scripts/db/run-server-cli.ts", "scripts/db/mizar-http-resource-fixture.ts", "create", ".agent-tmp/mizar-http-resource.json"], { env, stdio: "inherit" });
JS
```

调用方从私有 manifest 的 `producers[]` 读取 `fixture.matchId` 和 `credential`，向 loopback `GET /api/mizar/stats?matchId=...` 发送 Bearer；不要打印凭据。此 fixture 只用于隔离环境，完成后关闭调用并执行 cleanup。

HTTP driver 在内存读取 `producers[]`：`fixture.matchId`、`fixture.authorityRevision`、`credential`、`liveTemplate`、`reliableEnvelope`。只对 loopback SUT POST `/api/mizar/live` / `/api/mizar/reliable`，构造 Bearer 与 x-rivalhub-authority，不打印 manifest 或请求 headers。每份新 LIVE 更新 producedAt 并递增 cursor.runtimeSeq；可靠 envelope 预留 sequence=1,000,000，须在 LIVE 阶段停止后发送，之后低于该 floor 的 LIVE 不能继续发送。遇未知提交先只读 verify，不能重放旧 LIVE 或重新生成同一 idempotency key 的 envelope。

15 分钟是 fixture 使用 deadline，并非现有 credential 的服务器 TTL；不改变线上 auth。driver 必须 finally 停止发送并 cleanup，删除 tagged local authority、合成事实和 manifest。verify 使用 repeatable-read/read-only transaction，`--require-receipts` 要求两个唯一 canonicalized receipt 及合成比分；没有 receipt 时不代发、不补写。cleanup 不接受无 fixture namespace、错误数据库或不匹配的本地用户集合。

## 尚未证明的事实

没有生产锁事故、生产压测、远程 Supabase 迁移、部署或权限变更。loopback 故障模型不等于 Supabase 故障实现。真实 provider 仍需验证：目标 project 的 quotas/modern-key Broadcast 支持、跨区 RTT/p99、429/timeout 后晚到包、撤销/接管与 viewer reducer 的 end-to-end reset、多实例热点/公平性、token renew/rejoin 高峰、最大复杂度 Radar payload、实际出站和账单。超时后 provider 已接受的消息无法靠数据库回滚撤回；这是现有 transport 的边界，不能用本次 mock/本地通过签署生产能力。

本专项不替代 #784 身份/竞猜容量、#610 后台工作流或 #615 公开 consumer 的完整验收。DB retry、公共缓存、投影 backfill/coverage 和 release checks 继续沿用 main，未改写其 owner。
