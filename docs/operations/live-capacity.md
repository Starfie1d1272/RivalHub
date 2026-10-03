# LIVE 接收容量与 authority 边界

本专题只拥有接收端准入与投递；`source.ts`、`installation.ts` 和 canonical result owner 继续拥有源接管、撤销和官方赛果。公开 `rivalhub.public-live.v1` / topic / viewer JWT 不变。模拟测量不是生产事故证据或 provider 容量证明。

## 实现前的不变量与并发时序

1. 每份尝试必须重新验证 installation → match → active source；比赛、session、authority revision、generation、epoch、reliable sequence floor、identity 和 lineup 继续 fail closed。准入信息不能替代数据库授权。
2. **发送仍在上述 share locks 内完成。** LIVE 先持锁，则 revoke/handover/manual command 等待发送返回；mutation 先持锁，则 LIVE 在短锁预算后丢弃，或在下一次请求重新验证新事实。不能用 Promise.race 放弃仍在运行的发送并提前解锁。
3. 比赛级 PostgreSQL try-advisory transaction lock 只排斥其它 LIVE 投递，不改变 mutation 的锁协议；争用立即丢弃，不保存等待帧。安装/比赛/源行锁仍是 authority fence，advisory lock 不是授权。
4. 进程级准入是资源保护，最多两个 LIVE 请求（包括凭据查询和 body read），不排队；不是跨实例 current-state authority。生产池为三连接，因此 LIVE 自身不吃完该池。其它业务和多实例仍须另外做容量预算。
5. 有界的进程内元数据只保留近期已验证投递的 cursor/timestamp/节流时间，不保存 snapshot。每源使用容量 2、每秒补充 2 个令牌的准入预算，吸收合法 2 Hz producer 的到达抖动；不强制接收间隔恰好大于 500ms。跨实例与进程重启不能承诺全局去重：公开 consumer 必须按现有 delivery cursor 与 producedAt 丢弃旧帧/重复帧，相同 gameplay sequence 的较新 heartbeat 合法。
6. 不重试当前帧，不持久化，不补发；过载返回 `accepted:false`，入口满载返回 429。恢复只靠下一份 eligible heartbeat；官方赛果从不消费 LIVE。
7. provider 的 202 只证明接受 HTTP 请求，不证明所有观众已收到。网络 timeout 的结果可能不明；不重试、不宣称取消已经到达 provider 的投递。provider 延迟投递与 viewer reset 仍需真实环境联调。

## 可复现环境与数据

2026-10-03，隔离 Linux x64 cloud workspace；cgroup 4 CPU / 16 GiB，Node 24.20.0、pnpm 12.3.4。PostgreSQL 17.11，镜像 `postgres:17@sha256:d74eeac9a635390a49bc21bd49fccd973de707e2a53a76ac49b552b8712ec46f`，只监听 `127.0.0.1:55432`。每次 canonical integration runner 从 active migration chain 建立独立临时数据库，结束后删除；不读取任何远程数据库/生产配置。

- 对照 main：`45219bf8deb94ec46dc30587a31d6d0ad8fcb82a`（包含 #787/#788/#789/#790/#791）。
- 修复运行：`99c3336f31e0dbb3fc89ed2519871b68cb767e15`。报告后续提交仅保存证据/说明；两个 JSON 同时记录测试与 runtime 文件 SHA-256，便于核对测量代码。
- 应用池明确设置为生产同样的 3 连接、10 秒 acquisition timeout；另用 1 连接观测池。只替换 DB factory 以注入真实 pg/Drizzle 测量池、stub Next cache hooks；SQL、事务、授权、route、SDK、HTTP 都真实执行。
- 每场有两支队伍、10 名首发、2 张地图、2 个 installation、1 个 active session；4/16 场分别独立 fixture，避免跨场 fixture 污染。payload 为 10 玩家、10 Radar markers、24 回合、2 utility / 1 flame，public JSON **10,111 bytes**（两位 sequence 时再增 1 byte）；不是最大复杂度或真实 CS2 录制数据。
- 4 源通常发 3 轮 × 500ms（共 12 帧）；16 源 48 帧。突发为 4 源 × 24 帧一次提交，共 96 帧，是明确的异常输入。错峰情景为 4 源各偏移 125ms、间隔 510ms，共 16 帧；低于 2 Hz 上限。另测相同 sequence 的 1Hz heartbeat、断连恢复、revoke/handover/manual result 并发和迟到可靠赛果。
- HTTP loopback 故障服务逐项注入：5ms/202、700ms/202、2600ms 响应头（触发 SDK 2 秒 abort）、主动断开 socket、429、立即 429 响应头但 2600ms 后才结束错误 JSON。错误体取消后不会解析或保存 provider 内容。不注入生产压测。

## 指标与前后对比

`accepted` = HTTP Broadcast 返回成功；`dropped` = 200/accepted:false；`rejected` = 接收入口 429；`failed` = 其它非 2xx。四类互斥。`httpRequests/bytes` 是故障服务实际收到的 POST 数量/UTF-8 JSON 字节，不是 viewer 出站计费。

`poolWaitMs` 测 pg.Pool 实际 acquire（含外层 authenticateMizar）；`transactionMs` 从真实 BEGIN 后的 callback 到 COMMIT/ROLLBACK 完成。20ms 采样 `pg_stat_activity` / `pg_locks`；`sampledLockHoldingAgeMs` 是观测到 relation RowShareLock 时的最老 transaction age，**不是精确每一行的锁持有分位数**，也不把 relation lock 数冒充行锁数。短查询可能未被采到（0 不表示没有锁）。mutation 用真实 `wait_event_type=Lock` 证明等待，再测 command wall time。独立运行时的采样仍有约 20ms 的观测误差。

原始报告：[baseline](evidence/live-capacity-baseline.json)、[after](evidence/live-capacity-after.json)。下表 `A/D/R/F` 为接受/丢弃/拒绝/失败，时间为毫秒；小样本 p95 仅用于故障复现，不能当作生产 SLO。

| 场景 | 输入 | 基线 A/D/R/F → 修复 | 最大 pool queue 前→后 | pool wait p95 前→后 | transaction p95 前→后 |
| --- | ---: | --- | ---: | ---: | ---: |
| fast | 12 | 12/0/0/0 → 6/0/6/0 | 1 → 0 | 14.3 → 1.1 | 34.8 → 36.6 |
| slow | 12 | 12/0/0/0 → 4/0/8/0 | 6 → 0 | 706.7 → 0.3 | 729.1 → 718.2 |
| timeout | 12 | 0/12/0/0 → 0/2/10/0 | 9 → 0 | 4018.8 → 0.2 | 2016.2 → 2008.9 |
| disconnect | 12 | 0/12/0/0 → 0/6/6/0 | 1 → 0 | 11.3 → 0.2 | 37.7 → 11.8 |
| 429 | 12 | 0/12/0/0 → 0/6/6/0 | 1 → 0 | 14.6 → 0.3 | 19.6 → 12.7 |
| stalled-body | 12 | 0/12/0/0 → 0/6/6/0 | 9 → 0 | 5220.4 → 0.2 | 2616.3 → 24.7 |
| burst | 96 | 45/0/0/51 → 2/0/94/0 | 93 → 0 | 8535.4 → 0.7 | 720.3 → 706.5 |
| sixteen-fast | 48 | 48/0/0/0 → 6/0/42/0 | 13 → 0 | 47.4 → 0.3 | 12.2 → 13.6 |
| sixteen-slow | 48 | 48/0/0/0 → 4/0/44/0 | 42 → 0 | 6354.5 → 0.3 | 708.6 → 707.5 |

错峰 fast 在本次前后均为 16/16 接受；相同 gameplay sequence 的较新 heartbeat 在断连后恢复。同步 fast 会因进程并发预算拒绝部分帧，**不是吞吐提升**。该实现优先限制资源占用；16 场同步 2Hz 明显超出单实例“无丢帧”边界。不能根据某次错峰成功承诺正常赛事永不丢帧。

700ms 慢广播下，修复后的 revoke / handover / manual command 分别等待约 **658 / 669 / 664ms**，且观察到真实 Lock waiter；这项等待有意保留。旧 installation 在 revoke/handover 后仍 403；人工接管和 13:9 官方结果提交后，迟到 9:13 reliable candidate 不能覆盖。另一连接预先占用任一 installation/match/source 行时，本帧在 25ms 锁预算后丢弃；另一 LIVE 持有 advisory gate 时立即丢弃。被其它业务占满连接池超过一帧预算的请求恢复后也不再发送旧帧。

## 可解释的运行边界

- 每进程 LIVE 入口最多 2 个请求，包括 auth query/body read；拒绝不查 DB、不读 body。body 最大 256 KiB、读入预算 2 秒；单帧从入口到 DB 授权完成预算 500ms（一个 producer cadence interval），超出即丢弃。已进入共享连接池的最多两个请求仍受既有 10 秒 acquisition timeout 约束，不改 #787 的安全 retry owner。
- LIVE SQL statement 预算 1 秒、单次锁等待 25ms。HTTP 发送仍为 SDK 2 秒 abort；不 `Promise.race` 提前放开 authority fence。数据库链路故障、事件循环暂停、provider 已接受但响应丢失不等同硬实时取消保证。
- `M` 场每源 `r≤2/s`，平均投递占用 `D` 秒，平均需要约 `M*r*D` 个 LIVE slots。若预留 30% 余量，评估条件是 `M*r*D ≤ 1.4`（本进程 2 slots），同时考虑同相突发、鉴权/DB 延迟和其它业务。此条件只是必要预算，不是吞吐证明或公平调度保证。
- 以 4 场、2Hz 为规划情景，700ms provider 延迟需要约 5.6 slots，单实例必须丢帧；16 场 2Hz 则需约 22.4 slots。增加实例会乘大总 DB/provider 开销，不能把进程保护误称为 project-wide rate limit。跨实例仅比赛 try-lock 共用，节流/去重元数据不共用。
- 同相突发可能偏向较早到达的源；无跨实例公平性保证。需要用真实目标赛程、实例路由、连接预算和 provider 延迟复测，再选择赛事同时 LIVE 的范围/运营 cadence/plan。本 PR 不改基础设施或扩大生产权限。

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

只在隔离工作区执行；下例密码仅用于 disposable loopback PG，不是生产凭据。

```bash
corepack pnpm install --frozen-lockfile
docker run -d --name rivalhub-live-pg -e POSTGRES_PASSWORD=local-live-test \
  -p 127.0.0.1:55432:5432 \
  postgres:17@sha256:d74eeac9a635390a49bc21bd49fccd973de707e2a53a76ac49b552b8712ec46f
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 \
RIVALHUB_LOCAL_DATABASE_URL=postgresql://postgres:local-live-test@127.0.0.1:55432/postgres \
RIVALHUB_INTEGRATION_WORKERS=1 LIVE_CAPACITY_REPORT=/tmp/live-after.json \
corepack pnpm test:integration:pg17 tests/integration/db/mizar-live-capacity.test.ts \
  tests/integration/db/mizar-live-ingest.test.ts
```

基线：checkout 上述 exact main SHA，将本 PR 的 `mizar-live-capacity.test.ts` 和 `harness/mizar.ts` 两个测试文件复制到该 worktree，安装相同 lockfile；同命令加 `LIVE_CAPACITY_BASELINE=1`，只运行 capacity spec。该开关只关闭新增背压断言，**不替换 runtime 实现**。前后顺序执行，避免两个负载互相干扰；报告的 source hashes 必须匹配。若共享已安装 node_modules，pnpm workspace 校验会拒绝跨 worktree 复用；可各自安装，或像本次基线一样通过已安装的 `node_modules/.bin/tsx scripts/db/pg17-integration.ts ...` 运行同一个 canonical runner（报告确认 Node 24.20.0）。

本地真实 provider 回归使用 canonical wrapper：

```bash
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 corepack pnpm db:local:bootstrap-services
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 RIVALHUB_LIVE_EVIDENCE=1 \
corepack pnpm db:local:verify-supabase
```

wrapper 隔离本地目标；不要自行注入远程 URL/key。CI 的 system lane 已根据 Mizar changed surface 强制该 evidence，并验证 pinned Mizar adapter/parser。

## 尚未证明的事实

没有生产锁事故、生产压测、远程 Supabase 迁移、部署或权限变更。loopback 故障模型不等于 Supabase 故障实现。真实 provider 仍需验证：目标 project 的 quotas/modern-key Broadcast 支持、跨区 RTT/p99、429/timeout 后晚到包、撤销/接管与 viewer reducer 的 end-to-end reset、多实例热点/公平性、token renew/rejoin 高峰、最大复杂度 Radar payload、实际出站和账单。超时后 provider 已接受的消息无法靠数据库回滚撤回；这是现有 transport 的边界，不能用本次 mock/本地通过签署生产能力。

本专项不替代 #784 身份/竞猜容量、#610 后台工作流或 #615 公开 consumer 的完整验收。DB retry、公共缓存、投影 backfill/coverage 和 release checks 继续沿用 main，未改写其 owner。
