# 生产可观测性运行手册

RivalHub 的 runtime observability 由 `src/lib/observability/` 统一拥有，记录结构化、可关联、默认安全的本地运行事件。`audit_logs` 仍只记录业务事实。

页面耗时、筛选和人工业务操作由独立 [产品遥测](product-telemetry.md) 经 Worker/D1 承接，复用错误 requestId，不将 runtime logs 写入业务数据库。

## 目标与边界

```text
Next request / Server Action / Cron route
        │ requestId + route（Node AsyncLocalStorage）
        ▼
canonical event ──► stdout / stderr ──► systemd journal
```

- 应用不注册 OTel provider，不创建或导出 span，不发送 Better Stack 日志，也不加载 Vercel Analytics / Speed Insights。Preview 保留正常 Next 功能，不支持 Vercel collector。
- 本地 JSON 日志保留异常分类、脱敏和 requestId；日志写入失败不改变请求结果。`onRequestError` 保留 Next 未处理异常捕获。
- Next server code 通过带 `server-only` 的 `@/lib/observability/server` facade 访问日志和运行诊断；`src/db/client-runtime.ts` 同时用于显式 Node CLI。
- 请求上下文通过进程共享的 AsyncLocalStorage 隔离并跨异步调用传播。周期健康采样与 LIVE 聚合退出请求上下文，避免关联到安装 timer 的请求。
- 外部日志 sink 无需环境变量；运行健康采样仍由 `RIVALHUB_RUNTIME_HEALTH_ENABLED` 控制，D1 配置见产品遥测文档。

## LIVE 投递结果聚合

`src/lib/observability/live-outcomes.ts` 通过 server facade 接收固定结果与数值耗时。窗口与 A 的采样器均以 `process` 的固定 Symbol 为 owner，跨 Next API/RSC/Instrumentation 模块图共享。模块使用唯一 `live_ingest` key 注册 `() => flushLiveIngestOutcomes()`，由共享进程 sampler 的 60 秒 tick 刷新到期非空窗口，不安装第二个 timer。启用常驻 Node 进程采样时，停止活动后的尾窗仍由后续 tick 输出；没有启用该采样器的环境保留同接口的活动兜底，空闲尾窗仍可能等待下次活动。

`mizar.live.outcome_window` 保留七类 ingest 结果的原分母；`mizar.live.stage_window` 单独记录 received/admitted/authorized/send_success/expired/capacity/contended/unknown_send 八个固定里程碑。阶段可重叠，不能相加作请求分母。两个聚合共享进程 singleton，只保存 15 类次数与耗时总和，不保存帧或身份；在空请求上下文输出，避免继承 requestId。重启、SIGKILL、日志链路故障仍可能丢失开放窗口；不承诺退出 flush 或持久审计。结果范围、窗口/平均值口径与 viewer 验收边界见 [LIVE 接收容量](live-capacity.md)。

可靠事件的受控拒绝在事务回滚后由 HTTP 边界记录 `mizar.reliable.reject`，不依赖成功审计。首条包含固定原因、阶段和服务端生成的 requestId（不采信请求头编号）；授权及范围核验成功后的事件可包含事件种类、比赛 UUID 的截断 SHA-256 和有关围栏的接收／存储数值，不记录正文、凭据、名单或 SQL。固定原因桶每 60 秒首条立即输出，其余合并为首末时间和包含首条在内的次数；只有首条成功交给本地日志流时其响应才附带同一 requestId，被聚合的请求不返回编号，也不关联到其他范围的首条日志；共享 sampler 刷新空闲尾窗，未启用采样器时由下次同原因请求刷新。进程退出或日志故障可丢失窗口，日志复用既有本地访问和留存策略，不能作为持久审计。

LIVE 与可靠事件分别在 canonical ingest 的解析/基本 scope 检查通过后，进入 `mizar.live` / `mizar.reliable` 资源计数；两者只包一层，均在 finally 结束计数。LIVE 耗时包含授权事务、发送与清理，reliable 包含事务和既有非关键心跳；重复、拒绝或依赖失败不残留 inFlight。该观测不创建准入 gate、不获取连接，也不改变锁、重试或业务结果。

## BP 超时与确认口径

`match.veto.timeout_resolved.durationMs` 保留从 deadline 到处理使用的数据库时间差；`safeContext.configuredGraceMs` 是既定 2000ms 宽限，`actualOverdueMs = max(0, durationMs - configuredGraceMs)` 是扣除宽限后的额外逾期。宽限、数据库时钟、锁序、revision 和命令幂等不因观测改变。authorize/transaction/invalidate/project 仍沿用现有 span，不能把包含关系的耗时相加。

浏览器指令 acknowledgement 与房间呈现是独立目标：HTTP 响应包含既有投影处理，DOM 应用该响应或恢复读之后才算呈现。VetoRoom 保存原 `beginTask()` 返回的 token，已知成功提交即确认任务，房间投影与呈现另行观察；未知提交只在读到相同恢复事实后闭合原 attempt；仅 revision 前进不足以宣称本次未知写入成功。stale 不算成功，也不重放未知提交。VetoRoom 在实际房间 React commit 后，使用原捕获 token 独立记录 result step；仅 revision 前进不记录本次未知写入的确认或呈现。任务 core 的身份、scope、取消与确认后 result 保护由产品遥测 owner 维护。

## 管理员进程快照

`/admin/settings` 在现有 `requireSuperAdmin` 成功后，才从 server-only observability facade 读取当前 Node 进程的数值快照：采样时间、Node 版本、uptime、RSS、V8 堆已用/容量/上限、操作系统提供的内存约束、自启动累计事件循环利用率。环境内存约束为零时显示“未提供”，不能当作零容量或剩余可用内存；V8 堆上限也不等于整个进程的 RSS 上限。事件循环利用率不是 CPU 使用率或最近一分钟的指标。

常驻 production Node 服务由既有 instrumentation owner 启动进程共享的 `runtime-health` 采样器：每 60 秒输出一次 `runtime.health.sample`，timer 为 unref，`RIVALHUB_RUNTIME_HEALTH_ENABLED=0` 可在下次启动关闭；测试/HMR 可调用 `stopRuntimeHealthSampling()`，重复 start/stop 不叠加 timer。Vercel、development 与 production build 不自动启动。采样 RSS、heapUsed/heapTotal、external、arrayBuffers、V8 heap limit、Node constrainedMemory，以及窗口 ELU、20ms 分辨率的 event-loop delay P99/max；不是额外启动进程测量自身。arrayBuffers 包含于 external，heap/external/RSS 也不是可相加的独立预算；constrainedMemory 为 Node 已知限制，未知时不输出，不能直接当作 cgroup 峰值。事件只有固定数值诊断，沿用本地 logger，脱离请求上下文，不保存请求、URL、正文或环境变量值。SIGKILL/重启会丢失未采样峰值，60 秒采样不能证明不存在短时峰值或泄漏。

共享 sampler 支持 `registerRuntimeHealthFlush(name, callback: () => void): () => void`：仅接受 `live_ingest` 和 `mizar_reliable_reject` 两个固定 key，同 key 替换旧回调，返回幂等 unregister，旧 unregister 不会删掉新注册。回调必须同步；60 秒 tick 在 ROOT_CONTEXT 内各自隔离异常，读取回调副本以避免注册变更形成无界迭代。注册不创建 timer；停止采样即停止调度，显式 unregister 用于模块/测试清理，重载最多保留一个该 key 的回调。业务 owner 自行注册，不由 sampler 反向 import 业务模块。

同一 60 秒 sampler 还输出 `runtime.cgroup.sample`，只读当前进程所属 cgroup v2 的 `memory.current`、`memory.peak` 与 `memory.events` 的 oom/oom_kill。路径由当前进程 membership 和 mount root 解析，不能拿宿主根组代替服务子组。缺失、v1、不支持、拒读或无效数字均为 unknown（日志中省略字段），实际零保留为零；这些是 cgroup 总 charge/峰值/累计事件，与 RSS、V8 堆和 external 各有边界。观测不调整 pool、heap 或 cgroup 限额。

`runtime.read.sample` 按固定 `mizar.match` / `mizar.schedule` family 保存进程启动以来的 HTTP 请求、200、304、失败（含授权/校验失败）和其他状态计数。`fullBuilds` 在 canonical context builder 开始读取时递增，表示构建尝试（含失败与非 GET 的 claim/reliable 消费者），与 HTTP 分母分别核对；非法 schedule 窗口在进入构建前拒绝。授权账号/认领信息仍只在原 fresh snapshot 中读取，不成为指标维度。已编码 context 响应的 `encodedResponses/encodedBodyBytes` 复用原大小校验时的 JSON 字符串；304 正文记零，错误正文不在该字节分母中。它是未压缩 HTTP 正文 UTF-8 字节，不含 header/framing，也不是 SQL 返回量、文件/压缩制品字节或供应商 Shared Pooler Egress；304 不证明避免了数据库读取。`bet.aggregate_fallback` 每个采样周期输出（含已知零值），仅累计原 signature 不匹配回退分支，不改变原读取与控制流。计数只有固定维度与数字，不保存 viewer、姓名、用户/比赛 ID 或 token，进程重启归零。

统计缓存通过固定 `stats.cache.<family>.<metric>` operation 输出 `count`：family 为 `lineup.historical`、`lineup.realtime`、`lineup.style`、`platform`、`benchmark`，metric 为 `readCalls`、`fillStarted`、`fillSucceeded`、`fillFailed`。失效通过固定 `stats.invalidation.<reason>.<metric>` 输出 attempted/completed/failed；reason 为 `mizar.canonicalized_new`、`mizar.canonicalized_duplicate`、`dak.evidence`、`stats.projection_rebuild`、`scoreboard`、`identity`、`veto`、`season_or_other`。只在本周期计数变化时输出该项的进程累计值，重启归零；缺少样本不代表零。readCalls 是缓存入口调用而非 HTTP 请求，style 内部 benchmark 会分别计数；read 与 fill 不能直接当作命中率。completed 是失效调用成功返回，不是删除的缓存条数。当前可从进程 stdout/systemd journal 读取，尚未证明 Worker 或管理员面板接收这些样本。

公开统计资源计数放在实际 cache body 内，覆盖平台统计、阵容生涯与赛前阵容比较，异常仍在 finally 释放。阵容生涯可嵌套触发独立 benchmark fill，二者是不同 operation 的工作次数，不能相加当唯一请求数；lookup 减 fill 也不能推算精确 cache hit。未直接观测的 handler hit/evict、缓存驻留字节和逐 SQL 网络归属保持 unknown。上述低频事件复用原 stdout/journal 与 best-effort exporter；外部 sink 不可用时本地日志仍是证据来源，不增加 sink、timer 或逐请求成功日志。

同一采样周期的 `runtime.pool.query` 复用既有 client wrapper 的完整 query/failure、returnedRows、queryMs 与 unsupported 累计计数，包含事务控制，不按请求归属、不估算网络字节。`returnedRows` 是驱动提供的 rowCount，不等于展开 JSON、压缩或供应商 Egress。其余输出 `runtime.pool.sample/acquire/hold/waiting`：只读现有 owner，不初始化 Pool 或执行 SQL；acquire/hold 为当前 pool generation 创建以来的累计计数和非累积桶（≤1/10/100/1000/>1000ms），pool 重建会归零。hold 在 release 时完成计数，inFlight/peak 包括仍持有的 lease；waitingPeak/waitingTotal 为每次 checkout 入队时观察到的等待人数（queued 含本次自己）的峰值/总和，不是时间加权等待人数，也不是等待时长。waiting 事件的固定人数桶为 0、1、2–4、5–10、>10；count 为 checkout 开始数，包含仍在等待的请求。当前 waiting 来自 pg 的瞬时队列。retiringTotal 单列旧池排空量，不把新旧 generation 累计值相加。原慢 acquire 日志与未知提交不重放、池配置均保留。

共享资源观测由 server-only `src/lib/observability/runtime-resources.ts` 的 `beginRuntimeResource(name): () => void` 拥有；调用者在 finally 调用幂等 completion。固定 name 为 `telemetry.dashboard.fill`、`stats.public.fill`、`profile.public.read`、`mizar.live`、`mizar.reliable`，不接受动态 route/user/cache key。`getRuntimeResourceSnapshot()` 返回副本，只有进程生命周期的 inFlight、peak、完成 count、totalMs/maxMs；周期输出 `runtime.resource.sample`，operation 为该固定 name。本接口不改变准入/并发或业务语义，只有接入的 owner 才有覆盖，未接入不能解释为零负载。缓存 owner 的 resident 字节与填充 in-flight 峰值分别测量，不相加或据计数推算字节。

现有隔离 production HTTP 资源驱动分别记录 DOM 到达、真实内容就绪与正文读取结束时间。统计需出现 fixture 的非空地图/选手/武器行，阵容需出现实际数值对比，队伍需出现非空打法图；标题或 Suspense 壳层不代表完成。规模种子复用 canonical Evidence、确认/promotion 与 projection reducer，不任意填充 JSON；报告保留 source hash、投影行/文本字节、重复使用的身份数与数据缺口。场景在任何页面预热前先运行两路 LIVE 与 BET/stats/telemetry 的冷混合，再分别记录其余页面冷旅程、暖混合、tag 失效、重启和停载恢复；并发冷启动的失败单独保留，不能用另一场景的成功消除。遥测页显式指定窗口，受控延迟仅施加于本地遥测 HTTPS provider，不代表东京数据库链路；HTTP 正文字节、SQL 行/JSON 文本字节与供应商 Egress 分开。

隔离资源复现可使用 `scripts/observability/resource-baseline.mjs`：输入 canonical local wrapper 生成的本地 env 文件、已存在且兼容锁定 Node 的 Docker image ID 和证据目录；只接受 loopback DB/Supabase。构建前为本地 fixture 设置合法的专用 releaseTag（如 `v0.0.0-local-resource`）与当前 checkout exact SHA 的 releaseCommit，并将同一身份放入本地 env 文件；不创建 Git tag。readiness 只接受 release endpoint 的 2xx 与相同身份，身份缺失、旧构建或 HTTP 错误均失败；每个 fixture 请求只接受 200，错误样本先保留再使该轮/脚本失败。它启动实际 production Next build，在 512MiB、1 CPU、128 tasks、无 swap 下按交替顺序进行 sampler 开/关各三轮 process-cold、warm、12 并发匿名读取及 65 秒空闲恢复；原始结果标明 artifact cache 保留、cgroup observer 自身微小开销及 HTTP 状态。该 fixture 不替代带身份的 BET/profile、两路 LIVE、后台长查询组合或浏览器验收；需要各 domain fixture 接入后再做整轮资源集成。不要以测试中未 OOM 宣称已修复生产 OOM。

数据库连接池数值由 `src/db/client-runtime.ts` 的 `getDatabasePoolSnapshot()` 拥有，经 `src/db/client.ts` 的 server-only facade 返回；读取 total/idle/waiting/max 不初始化 Pool、不连接数据库、不执行探测 SQL，也不返回连接地址或凭据。等待数只是当前连接请求队列长度，单次为零不能证明高峰期间没有等待。

此页面只在打开/刷新时读取当前实例，不代表整台主机、多实例汇总或历史告警；无新增轮询、常驻采样 timer、持久化记录、公开 health endpoint 或外部发送。进程 API 读取失败显示不可用，保留其它系统状态。访问和数据目的沿用超级管理员运行诊断边界。

## 事件 contract

事件由 `logEvent()` 产生，`captureException()` 只用于非预期、依赖、数据库、安全或 invariant 失败。所有事件至少包含：

| 字段 | 说明 |
| --- | --- |
| `level` | `debug`、`info`、`warn`、`error`、`fatal` |
| `event` | 稳定的 machine event key，例如 `db.query.failure` |
| `scope` / `operation` | owner 和具体 operation，不放用户输入 |
| `errorClass` | `expected`、`application`、`dependency`、`database`、`security`、`invariant` |
| `errorCode` / `retryable` | 稳定错误分类与是否可重试 |
| `route` / `requestId` | 路由模板和请求关联 ID；不放 query string |
| `release` / `deployment` / `environment` | commit（CLI deployment 无 commit metadata 时回退为 deployment）、Vercel deployment 与运行环境 |
| `durationMs` | 有边界的 operation duration |
| `safeContext` | 仅 allowlist 中的低敏诊断字段 |

预期业务结果必须继续通过 `ActionResult` 返回。例如权限不足、重复报名、验证码拒绝、重复邀请和 rate limit 都不是 exception capture 告警；可以按需记录为 `expected` 事件，但不应制造 5xx 噪音。

非预期 Server Action 失败返回统一安全提示及可检索的 `requestId`；写入可能已完成，默认提示先刷新核对结果，避免盲目重试。密码更新由 `PasswordMutationError` 提供固定恢复指引：明确拒绝提示重新登录，结果未知保留 deny fence，返回 `PASSWORD_UPDATE_OUTCOME_UNKNOWN`，提示停止提交并联系平台管理员核查；密码表单持续展示指引与编号，不跳转成功页。`auth.password_update.failure` 与 UI 使用同一个 requestId，unknown 的 retryable=false。原始 cause 只留在服务端异常对象；该凭据边界的日志仅投影有界、允许的异常名称/错误代码/cause 链及整数 HTTP 状态，永不读取或输出 provider message、stack、body、邮箱、密码或 token。登录 429 是 expected 限流，0/未知失败是 dependency；只有官方 `invalid_credentials` 才归为无效凭据。管理员核查步骤见 [`auth-password-reconciliation.md`](auth-password-reconciliation.md)。Mizar HTTP 边界通过 `mizar.request.failure` 记录 auth/read/validate/domain/revalidation 阶段和同一关联编号；预期 4xx 不作为异常告警，非预期失败返回 500，并在安全响应与 `X-Request-Id` 中提供编号。

DAK HTTP 五入口通过 `withIntegrationRequest()` 复用请求上下文与固定路由；handled 500 只由 `dak.request.failure` capture 一次，保留原始异常的脱敏 cause/SQLSTATE 与 auth/read/validate/domain/revalidation 阶段。既有 `error.code/message` 协议不增添字段，安全提示及 `X-Request-Id` 使用同一编号；导入后失效失败明确提示已收到提交，先查看保存结果并核对导入状态、不要重新上传；该已知状态不附加通用“稍后重试”前缀。预期 401/403/404/422 不产生 exception 告警，成功响应不变。

Demo Evidence 的格式和关系校验分别由 ZodError 与 DemoEvidenceValidationError 标识。提交、存量重查及身份确认只把这两类已知校验失败映射为无效数据；解析程序异常交回既有 request/cause 边界，事务回滚，不写入 STORED_PAYLOAD_INVALID，也不将异常原文作为预期校验提示返回。

PostgreSQL 分类必须复用 `src/db/errors.ts` 的 `extractPgError()`。日志只允许 SQLSTATE、constraint/schema/table/column 等分类 metadata，不能读取或输出 raw query、params、detail 或完整 Drizzle error。

Steam 与教育材料/赛事公开图片 Storage 的失败事件保留有界 HTTP 状态、允许的异常名称及网络/服务错误代码；`provider-failure.ts` 只读取这些 metadata 和有界 cause/originalError 链，不读取 provider message、stack、正文、凭据 URL 或对象路径。事件沿用请求上下文关联，Storage 4xx（408/429 除外）不标记为可直接重试。

## 脱敏 contract

默认拒绝以下字段或内容：

- password、old/new password、Authorization、Cookie、Set-Cookie、session、JWT、Bearer token；
- signup/reset/invite/token_hash、Turnstile token、教育材料、education verification code；
- secret、apiKey、`CRON_SECRET`、原始 `FormData`/request body；
- SQL 文本、参数数组、raw provider response、完整 Drizzle error；
- 无界 `JSON.stringify()`、循环对象和会触发 getter 的任意异常对象。

`extractSafeException()` 沿最多八层、cycle-safe、getter-safe 的 `cause` 链保存脱敏 name/message/code；普通异常只保留一个根 stack，PostgreSQL 异常始终只保留分类 metadata，不能借内层 cause 泄露 SQL。`sanitizeSafeContext()` 先执行 allowlist，再执行字符串、数组和长度边界。这个边界在 Development、test、Preview 和 Production 相同，不能依赖环境隐藏泄漏。

第三方 URL 可能包含 key 或 token。provider 请求使用标准 fetch；应用不配置 fetch tracing 或传播 trace headers，日志仍必须通过既有脱敏边界。

## 本地数据库诊断

逐语句计数覆盖普通配置的 Promise/callback 与 Drizzle 事务。自定义 Submittable/自带 callback 的 Query 对象保留原语义并计入 unsupported，不宣称全覆盖。连接获取失败或超过一秒时，`db.pool.acquire` 日志保留耗时、池快照、connectionState 与 outcome；queued 表示开始时无空闲连接且已达应用池上限，connect 包括网络/TLS/provider 握手，不能据此认定数据库执行慢。

`getDatabasePoolSnapshot().client` 返回 query count/failures/rows/queryMs、checkout hold 与 transaction hold 的进程内完整计数；BEGIN 到 COMMIT/ROLLBACK 为事务时间，ROLLBACK TO SAVEPOINT 不结束事务，已失败事务 COMMIT 返回 ROLLBACK 计回滚，release 时仍未结束的事务和提交错误计 unfinished，不推断其提交结果，也不自动回滚或重试。方法在归还连接前恢复，避免复用时叠加包装；这些时间互相包含且不能与 pool acquire/请求 duration 简单相加。`getDatabasePoolSnapshot().acquire` 提供当前 pool 自创建以来所有成功/失败 checkout 的 count、failures、totalMs、maxMs、开始时 reuse/connect/queued 次数与非累积耗时桶（≤1/10/100/1000/>1000 ms）；每次读取返回副本，不初始化连接，也不保存单次样本。它是进程内完整分母，pool 重建后归零，不能作为持久历史或 TLS 新建比例。慢日志保持原有阈值；不从慢日志计算全部请求分位数。常驻 production Next.js Node 服务在空闲时保留至多两条已建立连接，不主动预建；超过该下限的空闲连接在 30 秒后回收，Vercel 与 CLI 保留 5 秒的回收行为；连接上限与故障重建、重试边界维持由数据库 runtime owner 管理。

## 查询与排障

先确认正式发布身份与时间窗口，再从 systemd journal 的结构化日志按下列字段查询：

1. `event` + `environment=production`：判断是 `application`、`database`、`dependency`、`security` 还是 `invariant`。
2. `requestId`：串起一次 route/action、DB retry 与 provider 失败。
3. `safeContext.errorDigest`：Next server render 错误的安全十进制 hash（1–20 位），与客户端显示的「排查编号」一致；同一事件保留服务端 `requestId`，先按 digest + 时间/route 查找事件，再按 requestId 关联请求。digest 不是唯一请求 ID，不截断、转换或自造编号，缺失或不合法时不显示。原始原因只进入既有服务端脱敏 exception，不返回错误页面。
4. `deployment` / `release`：确认错误是否只出现在新 deployment；必要时与上一 release 对比。
5. `route` + `status`：确认 5xx 是否集中在某个 route，而不是把 validation/duplicate 结果计入错误率。

排障顺序：

- `security` / `invariant` / `fatal`：先保留证据并检查对应 audit fact、权限边界和数据不变量；不要通过补写 runtime log 修复业务事实。
- `database`：看 SQLSTATE、safe constraint、`db.pool.*` 和 retry 次数；禁止从日志猜测或复制 SQL 参数。
- `dependency`：看 provider、HTTP status、retryable 和 requestId；确认 provider 是否超时、限流或配置缺失。
- `application`：看 release/deployment、route 和 bounded exception；修复 canonical owner 后再重试。
- 只有在 `ActionResult` 已返回但用户仍报告异常时，才将 expected event 与业务 audit fact 一起核对。

教育 evidence 的 Storage provider 失败只记录不含 object key、原始文件名、signed URL、图片、CHSI code 或 provider raw response 的 dependency 事件；上传后的数据库/audit 失败由既有 Server Action observability 记录安全分类，并 best-effort 删除刚上传对象。retention 删除失败直接交给既有 scheduler execution owner 重试，不在教育 retention 内重复 capture 或建立第二个日志 owner。

OCR 失败由 `src/lib/ocr/` 分类为配置、上游鉴权、限流/额度、网络、超时、上游结果或图片错误。Action 的 `provider.siliconflow.ocr_failure` 事件保留 HTTP 状态、失败阶段与固定提示分类，以及输入/输出 token 数、输出字符数、空白比例、固定枚举结束原因及经过格式限制的 SiliconFlow trace ID（收到响应头后即保留）。请求开始事件保存固定模型标签（覆盖配置的其他模型归为 custom）、实际提示词/采样/输出格式配置的 SHA-256 摘要与解码后图片的 SHA-256 摘要，用于关联同图同配置；这些摘要仅用于运行排障，沿用 runtime logs 的访问、保留和删除策略，见 `docs/security/data-lifecycle.md`。结果事件与结构校验失败保留原始行数、空昵称行数和有效行数；零有效行标记 rejected。输出末尾最多 8192 个字符按 32 字符分块计算重复块比例，仅作重复生成线索，不据此认定或拒绝结果；HTTP 错误体最多检查 8 KiB，仅投影结构化 `code/message`，传输异常只投影 `name/code/message/cause`。长度上限结束会在解析前归为 `output_truncated`，即使 JSON 恰好完整也拒绝接受可能缺行的结果；不自动重放这类识别请求。行校验失败区分数组列数错误、昵称缺失与其他行结构错误，仅记录有界列数。收到成功 HTTP 响应后，响应体读取中断仍归网络错误，读取超时保留 `response` 阶段与脱敏原因；只有实际 JSON 语法错误归 `invalid_response_json`，不记录其原始解析消息。未知结构化原因不会丢成固定分类：每条原因经过 canonical redaction，并移除 URL 凭据/路径/query、令牌模式及确切请求凭据/图片回显；每段最多 160 字符、cause 最多六层，降级前后最多八条。服务端通过既有 allowlist 的 `errorCodes/errorName/errorMessage` 同索引数组保存脱敏错误链，不保存原始 body、header、stack、截图或模型输出，也不将诊断自由文本返回浏览器。UI 的排查编号与事件 `requestId` 一致；正常请求和响应格式降级使用同一编号。鉴权/配置失败指向 `/admin/settings#ocr-configuration`，由超级管理员在当前承载环境的 runtime 配置及 SiliconFlow 控制台检查；“已配置”只证明存在，不能证明凭据、权限或余额有效。

Audit 查询回答“谁在什么时候改变了什么业务事实”；runtime observability 回答“请求如何执行、在哪里失败、是否可关联”。两者可以用 request 时间窗口对照，但不得合并成一个存储或 serializer。

## 新增事件

新事件必须在 canonical owner 中定义稳定 key，并只传低基数、安全字段：

```ts
logEvent({
  level: "warn",
  event: "provider.example.rate_limited",
  scope: "provider",
  operation: "example.request",
  errorClass: "dependency",
  retryable: true,
  safeContext: { provider: "example", httpStatus: 429 },
});
```

不要为正常成功路径逐条记录日志，不要复制领域 transition/错误分类，不要在 component 中配置外部 sink。Client Component 只有在存在明确 fallback 时才可输出固定、非敏感的浏览器诊断，不能输出 raw exception/payload 或用空 catch 静默吞错。新增 safeContext key 时必须同时补 redaction 单测，并检查它不会成为 ID、body、query 或 secret 的旁路。 safeContext 仅读取有界 allowlist 中的自有数据字段，跳过 accessor；单字段或代理读取失败时保留其他安全字段与原始 exception，不让附加诊断丢弃整条错误事件。

后台统计修复的候选查询与单图重建失败由 `stats.projection_repair.failure` 保留脱敏原始 cause，并以 `phase=candidate_selection/rebuild` 区分阶段。Demo 关联重检的单项失败与候选载入失败由 `demo.recheck.failure` 保存原因，以 `phase=recheck/candidate_selection` 区分；保留既有 failed 数量和 partial success，已提交身份确认不因后续 fanout 故障被伪装为失败。事件不附加账号、赛事、地图或 artifact 标识，复用存在的请求 context；scheduler 最终摘要仍报告整批健康失败。不同层级的 DB/item/summary 事件不是唯一 incident 数，按 request 关联，不重复相加成失败次数。

默认首发后台补齐仅将名单资格 owner 的 `VALIDATION_FAILED` 视为正常等待；数据库、冻结事实缺失与其他系统异常由 `match.default_lineup.failure` 保留脱敏 cause/SQLSTATE 和排查编号。批次继续处理其他比赛及时间提议，先刷新已提交比赛，再将补齐系统失败交给 scheduler 健康 owner；后续提议读取失败也必须携带已提交比赛列表，由 runner 在报告原始故障前刷新；人工提示明确首发已保存，先核对首发与排期，不能指望重复运行修补丢失的页面失效。异常对象及内部目标列表不进入公开摘要。管理员先在比赛工作台核对已保存首发，超级管理员按编号排查服务，恢复后从 `/admin/settings` 定时任务健康的既有人工入口运行一次。仍未满足名单资格时按工作台提示处理；补齐复用原事务、资格 owner 和已有名单跳过规则，不能据故障自行造名单或绕过资格。

Scheduler 的 `scheduled_job_health` 只保存有界 current projection，不是 runtime log 或 execution ledger。primary trigger、primary endpoint start/success、watchdog fallback/manual success、最近业务推进和最近失败分别由 shared scheduler owner 更新；fresh watchdog no-op 不写 projection。失败只保存稳定 source/code/classification，不保存 raw error、URL、Authorization 或 Vault secret。`jobKey`、`source` 等 safeContext 仍必须经过 allowlist。

## 服务健康与证据覆盖

超级管理员在 `/admin/settings` 查看六组当前证据。认证、个人及团队报名提交、赛果更正使用产品遥测过去 24 小时的客户端 operation 聚合。来源不可用、未配置或窗口不完整、截断、过期时显示未核验；完整窗口没有调用显示暂无样本。未知结果显示需要关注，先核对业务事实与回执日志，不直接重放；只有待定结果时显示待确认，无法据此判断超时。成功或预期拒绝闭合的客户端样本显示正常，仅说明当前窗口的样本结果覆盖，不代表整体生产健康；拒绝不等于故障。进一步按版本和操作查看 `/admin/telemetry` 与 runtime logs，不以这些计数推算失败率或告警阈值。

定时任务使用现有 scheduler 投影和各任务的 freshness 判定；缺记录或读取失败显示未核验，有主调度记录但判定 degraded 或派发未确认成功显示需要关注。检查主调度、派发和业务状态。完整性与依赖及备份保障不由本页自动读取，显示未核验；按运维记录核对 production 结构化日志与审计事实、公共资源真实 GET、可信 full backup 验证和 provider 控制台。外部告警未配置，应用不提供外部告警投递。

## 故障信号与验收

应用不再提供外部告警投递。运维检查本地 `environment=production` 事件：application 代表意外应用故障，security/invariant 应先核对安全边界与审计事实；expected 拒绝不是系统故障。同一次请求可能经过多个错误边界，按 requestId 关联，不重复相加为唯一 incident 数。

数据库故障继续使用 runtime owner 的稳定分类。`db.query.outcome_unknown` 表示结果无法确定，禁止自动重放；只有明确建立连接前的 ECONNREFUSED / ENOTFOUND 才可重试一次。已恢复 retry 与普通 SQL/schema 错误不能一概解释为连接性故障。

代码验证使用现有类型检查、定向测试与构建。发布后回读实际服务 journal，确认 requestId、脱敏异常、runtime health、DB 计数和 LIVE 窗口输出；同时独立确认 D1 产品遥测。没有运行环境证据时，不将本地验证称为 production 验收。

## 数据库流量短期分析

常驻 Node 服务复用 60 秒 sampler 和 pg wrapper：Mizar manifest/schedule/live/reliable 等、DAK 入口、scheduler job、公开统计和 BET 的实际 cache fill 使用固定来源标签，其他为 unknown。请求排队时恢复提交者异步上下文，事务中的查询按发起上下文归属。采集 query 数、失败、pg rowCount 和耗时；自定义 Submittable 单列 unsupported。rowCount 包含写入影响行数，不等同返回行数。既有 `runtime.pool.query` 仍是 pool generation 分开的总分母。

查询形态 ID 由本机规范化 SQL 结构计算：保留标识符，移除注释并规范化字面量和参数，仅摘要进入 D1，不传 SQL 或标识符文本。超过 token 预算归为 unknown，不把截断前缀当成完整形态。结构可能碰撞或合并，不能当作精确 SQL 标识，也不是 pg_stat_statements 的 queryid；每窗口最多保留 40 个形态/来源候选，按观察到的协议字节近似竞争；淘汰片段归入原来源的 overflow，封存期间暂停替换。重新入选只代表后续保留片段，形态值是下界而非精确排名；页面仅展示前 20。源码定位时 checkout 同一 release，在隔离测试中将候选的参数化 SQL 字符串传给 `src/lib/observability/db-traffic.ts` 的 `queryShape()`，只比较输出 hash；不要输出 SQL 或参数，也不能反推 SQL 或据指纹推断单个用户行为。

比赛详情页面、预测与竞猜页面及其 API / Server Action 读取、平台统计页面读取分别使用固定来源；公开赛事目录和统计等缓存填充保留独立来源。没有请求上下文记为 `context.absent`，有上下文但未映射记为 `context.unmapped`；其他未覆盖的操作仍可能归入这些类别，不能视为完整归因。新批次格式及新增来源必须先部署兼容新旧数据的遥测 Worker，再上线应用；旧 Worker 会拒绝新批次。

`pg` 建连完成后在接收 stream 统计 PostgreSQL 下行协议字节：TLS 时为解密后的协议流，不包含握手及 TLS 开销。已解析消息按发起查询时的来源和形态归属，错误后的消息保留归属至 ReadyForQuery；通知等异步消息、无归属、不支持的驱动模式、未完成帧及计量异常分别列入剩余。跨采样或小时边界未完成的前缀永久记作 partial，之后只归属尚未结算的字节。连接观察器与查询 owner 使用进程共享的弱引用登记，使不同服务端模块图的采样器能结算同一连接。每批满足接收字节等于来源字节与剩余字节之和；查询次数按完成时间、协议字节按接收时间计入，因此查询数可为零而字节大于零。逻辑 JSON 字节受遍历预算限制，跳过原因分别记录预算、值不支持和查询错误。旧批次未提供的字段不视作零。连接覆盖比例仅说明采样时连接数量覆盖，不是字节覆盖率；连接观察器安装失败即记录未知覆盖，连接在采样前断开也不会将未知字节显示为完整。供应商账单范围更广且实际用量尚未接入，不能把协议字节、逻辑字节或 rowCount 当作账单。

投递使用独立 `DB_TRAFFIC_KEY` 和 `PRODUCT_TELEMETRY_ENDPOINT`；设置 `PRODUCT_TELEMETRY_QUERY_PROXY_URL` 时通过 HTTPS CONNECT 并校验证书。生产 systemd 服务将队列存于 release 目录之外的 `/var/lib/rivalhub-production/db-traffic`，权限为 0700；安装、回滚和 release 清理不删除此目录。受保护的 Linux Release 在既有部署通道回读实际生效的 unit、目录权限、进程、配置状态及锁所有者，输出不含凭据的布尔和版本回执；采集未配置、回读不可用或任一必要状态未通过时，不得将这些字段视为生产验收通过。文件提交使用同目录临时文件、文件 fsync、原子改名与目录 fsync，磁盘不可写或状态损坏时保留未封存计量并输出固定诊断，不降级到易失队列。常驻服务的 Next 注册钩子在接收请求前等待本地队列恢复及开放窗口标记提交，最多等待 5 秒，不等待网络；失败或超时发出固定降级诊断并继续提供业务，恢复后先持久记录未知覆盖。硬杀发生在首次标记提交前时，本机可能尚无持久证据。启用状态由现有 60 秒 sampler 推进；封存期间新增的计量留待下一次采样或显式刷新，避免流量持续到达时反复封存挤占队列。禁采不删除已存队列。队列上限 256 个数据批及 10 MiB，最长保留 23 小时；容量淘汰和过期批生成单独的 gap。尝试过但未确认的批可能已被接收，不能当作确定丢失；正常退出时同步保存安全的待封存快照与残余，并在下次持锁启动时幂等恢复后再投递；损坏的退出快照先持久标记覆盖未知并隔离保留，再继续已验证队列；隔离发生 I/O 错误或待恢复快照超过有界上限时停止投递，直至恢复完成。写入失败仍留下未知覆盖。强杀不执行退出快照，未封存尾窗数量未知。队列、质量事件与 gap 不是 DR 备份的一部分，主机恢复时应注明缺口。

Worker 在严格鉴权、字段和大小验证后，将跨字段不一致的安全批隔离，保留原值和固定原因，不计入可信流量。旧客户端仍收到 204；新发送端仅在版本、ID、规范摘要和状态匹配时确认。鉴权失败全局退避；永久错误停止该批并保留 gap；网络和服务错误保留原 ID 重试。D1 接收与离线摘要共用每日 5000 批额度；其中隔离批最多 400、gap 最多 100，正常批与离线摘要没有额外的 4500 限额。子类满时只暂停相应类别，总额满时全部退避；没有为正常批预留最后额度。重复请求不重复计费，原始证据与小时汇总保留七天；有界清理积压时过期数据不再读取。既有 D1 应依次应用尚未执行的迁移，先升级兼容 Worker 再发布应用；回滚应用时保留新 Worker 和主机状态目录。备份和 Preview 正常导出完成时投递已有安全摘要，仅包含 run、时间、release 和数值，不保存 project ref、表、行或文件路径，也不增加读取；skipped Preview 保留原 workflow 摘要，未接入 D1。受保护 workflow 未配置凭据时不投递，不影响产物。

Worker 在接收时尽力处理 1 个最多 32 批的分块，每小时维护最多处理 4 个分块：先读取小时版本，再选择待处理批次；同一 D1 事务比较版本并确认所有选中 ID 仍待处理后，原子更新小时汇总和原批次 processed 标记。并发处理或过期清理使快照失效时不提交，避免重复或幽灵累计。积压按原采样小时处理，页面显示待处理数量（超过 512 时仅显示下限）；聚合失败不阻断产品遥测的维护。每小时按 release 和 deployment 分窗，管理页只在选中的小时和版本内比较来源与形态；已有跨版本汇总无法事后拆分，标记为未提供。每个分窗最多保留 120 个形态，分别保留次数、耗时、行数、逻辑字节和协议字节的候选项，超过上限或 producer 原窗口 overflow 时显式标记截断；形态数值仅是保留片段的下界，不能保证前 20。来源汇总保留所有已汇总字节。进程和 release 维度也有上限，超限明确标记。每日最多接收 5000 批；接收时的滚动汇总与小时维护共同推进，失败、竞争和突发可能产生积压和过期损失。Workers Free 的 CPU 限额与账户共享余量须在隔离 Preview 实测；本地 wall time 和 D1 行数不能替代 provider CPU 验收。

`/admin/telemetry?view=database` 仅超级管理员可读，每次读取最多 72 个可信小时汇总和 72 个质量小时汇总，各自最多 513 个未处理记录的索引项，以及 101 条离线摘要；仅对选中小时和版本读取最多 11 条隔离或缺口详情，不展开整个范围的原始批次。质量分窗、详情或积压超过界限时标记截断或待处理。默认按逻辑结果字节排序，也可按查询次数、累计耗时和 rowCount 排序后取前 20；来源汇总包含四种数值。逻辑字节是每个已返回行单独 JSON 序列化后的 UTF-8 字节之和，不含外层数组和字段描述，不等于协议或账单字节。覆盖率是成功测量的查询数 / 已观测查询数；旧版本、失败和超预算结果未测，不能解释为零。时间按北京时间显示，窗口从小时起点对齐，当前小时可能未完整；未处理和被淘汰的形态不能当作零。查询排除未来批次。没有数据、网络错误与未配置分别显示。采样窗口以完成时刻归属，起止边缘的跨窗口查询和关闭前尾窗存在不确定性。生产启用后需核对 D1 和供应商实际用量、覆盖缺口及来源分类，以实际启用时间起算 24/72 小时分析；本地 fixture 不是生产验收。

既有受保护 `release-host-diagnostic.mjs` 的主机只读回执中，`statsJournal` 读取最近固定 60 分钟的 journal，按固定 operation 和 UTC 十分钟桶输出 `[bucket, operation, count]`。每项是该桶内**最后观察到的一条进程累计值**，不会相加；journal 的 cat 输出不能可靠区分进程或重启，因此 `processBoundary` 为 `unavailable`、`delta` 为 null，不可跨桶相减。无样本不代表零；`status` 不可用或不完整时不得解释为完整观测。该读取与原 incident journal 查询共用 30 秒、16 MiB 上限，不接数据库，不输出请求标识或原文；尚无 Worker 或管理员面板接入保证。
