# 生产可观测性运行手册

RivalHub 的 runtime observability 由 `src/lib/observability/` 统一拥有。它记录结构化、可关联、默认安全的运行事件和关键 operation span；`audit_logs` 仍只记录业务事实，不是 runtime log 的替代品。

页面耗时/筛选/人工业务操作的产品基线由独立 [产品遥测](product-telemetry.md) 承接；它复用错误 requestId，不改变本页 runtime exporter、采样或线上缓存，不将事件发给 Better Stack。

## 目标与边界

```text
Next request / Server Action / Cron route
        │ requestId + route
        ▼
canonical event + critical span ──► Vercel Runtime Logs / OTEL traces
        │                                   │
        └──────────── OTLP logs/traces ─────┴──► Better Stack sink
```

- Linux 承载时，从 systemd 服务日志读取结构化标准输出；Vercel 承载时使用其 Runtime Logs、Runtime Error Groups、Analytics 和 Speed Insights 入口。实际承载身份以正式 release read-back 为准。
- Better Stack 只作为外部长历史、trace/error 查询和告警 sink；RivalHub 不建立自有 log database，也不使用 Vercel Drain。
- OTel 在服务端通过 `@vercel/otel` 初始化。Node runtime 将结构化 log 和 trace 以批处理 OTLP 发往 Better Stack；所有 runtime 在 auto/export processor 前先经过进程内 span sanitizer，删除异常 message/stack、状态 message、SQL/query/params、请求凭证与 body/header 属性；Route Handler 在响应后通过 Next `after()` 触发一次 bounded flush，避免 serverless 实例在 batch delay 前冻结；Edge runtime 仍只使用 Vercel 原生 OTel，不挂载 Better Stack exporter。
- Development 和 test 默认不向外部 Better Stack 发送 telemetry。exporter 或 sink 故障只影响观测，不改变核心请求结果。
- Client Component 不携带 Better Stack token，也不直接调用 Better Stack。
- Next server code 通过带 `server-only` 的 `@/lib/observability/server` facade 访问 logger/tracing；`src/db/client-runtime.ts` 是显式保留的 Node application/CLI runtime boundary。

## 环境变量

Preview 与 Production 使用相同变量名，在各自部署环境中独立配置：

```text
BETTER_STACK_SOURCE_TOKEN=<server-only Better Stack source token>
BETTER_STACK_INGESTING_HOST=<server-only Better Stack OTLP ingest host>
```

`BETTER_STACK_INGESTING_HOST` 只接受 HTTPS origin（可带或不带 `https://`，不能带 path、query、用户名或密码）。代码会自动分别发送到 `/v1/traces` 与 `/v1/logs`。不要把 token 写入 issue、PR、日志、fixture、Client props 或任何 `NEXT_PUBLIC_*` 变量。

如果 Preview/Production 只配置了一个变量，或 host/token 不合法，应用继续使用部署平台的标准输出观测并将配置状态记录为不含凭证的结构化事件。Development 未配置外部 telemetry 是正常状态。

## LIVE 投递结果聚合

`src/lib/observability/live-outcomes.ts` 通过 server facade 接收固定结果与数值耗时。窗口与 A 的采样器均以 `process` 的固定 Symbol 为 owner，跨 Next API/RSC/Instrumentation 模块图共享。模块使用唯一 `live_ingest` key 注册 `() => flushLiveIngestOutcomes()`，由共享进程 sampler 的 60 秒 tick 刷新到期非空窗口，不安装第二个 timer。启用常驻 Node 进程采样时，停止活动后的尾窗仍由后续 tick 输出；没有启用该采样器的环境保留同接口的活动兜底，空闲尾窗仍可能等待下次活动。

`mizar.live.outcome_window` 保留七类 ingest 结果的原分母；`mizar.live.stage_window` 单独记录 received/admitted/authorized/send_success/expired/capacity/contended/unknown_send 八个固定里程碑。阶段可重叠，不能相加作请求分母。两个聚合共享进程 singleton，只保存 15 类次数与耗时总和，不保存帧或身份；在 ROOT_CONTEXT 输出，避免继承 requestId/traceId。重启、SIGKILL、日志链路故障仍可能丢失开放窗口；不承诺退出 flush 或持久审计。结果范围、窗口/平均值口径与 viewer 验收边界见 [LIVE 接收容量](live-capacity.md)。

LIVE 与可靠事件分别在 canonical ingest 的解析/基本 scope 检查通过后，进入 `mizar.live` / `mizar.reliable` 资源计数；两者只包一层，均在 finally 结束计数。LIVE 耗时包含授权事务、发送与清理，reliable 包含事务和既有非关键心跳；重复、拒绝或依赖失败不残留 inFlight。该观测不创建准入 gate、不获取连接，也不改变锁、重试或业务结果。

## BP 超时与确认口径

`match.veto.timeout_resolved.durationMs` 保留从 deadline 到处理使用的数据库时间差；`safeContext.configuredGraceMs` 是既定 2000ms 宽限，`actualOverdueMs = max(0, durationMs - configuredGraceMs)` 是扣除宽限后的额外逾期。宽限、数据库时钟、锁序、revision 和命令幂等不因观测改变。authorize/transaction/invalidate/project 仍沿用现有 span，不能把包含关系的耗时相加。

浏览器指令 acknowledgement 与房间呈现是独立目标：HTTP 响应包含既有投影处理，DOM 应用该响应或恢复读之后才算呈现。VetoRoom 保存原 `beginTask()` 返回的 token，已知成功提交即确认任务，房间投影与呈现另行观察；未知提交只在读到相同恢复事实后闭合原 attempt；仅 revision 前进不足以宣称本次未知写入成功。stale 不算成功，也不重放未知提交。VetoRoom 在实际房间 React commit 后，使用原捕获 token 独立记录 result step；仅 revision 前进不记录本次未知写入的确认或呈现。任务 core 的身份、scope、取消与确认后 result 保护由产品遥测 owner 维护。

## 管理员进程快照

`/admin/settings` 在现有 `requireSuperAdmin` 成功后，才从 server-only observability facade 读取当前 Node 进程的数值快照：采样时间、Node 版本、uptime、RSS、V8 堆已用/容量/上限、操作系统提供的内存约束、自启动累计事件循环利用率。环境内存约束为零时显示“未提供”，不能当作零容量或剩余可用内存；V8 堆上限也不等于整个进程的 RSS 上限。事件循环利用率不是 CPU 使用率或最近一分钟的指标。

常驻 production Node 服务由既有 instrumentation owner 启动进程共享的 `runtime-health` 采样器：每 60 秒输出一次 `runtime.health.sample`，timer 为 unref，`RIVALHUB_RUNTIME_HEALTH_ENABLED=0` 可在下次启动关闭；测试/HMR 可调用 `stopRuntimeHealthSampling()`，重复 start/stop 不叠加 timer。Vercel、development 与 production build 不自动启动。采样 RSS、heapUsed/heapTotal、external、arrayBuffers、V8 heap limit、Node constrainedMemory，以及窗口 ELU、20ms 分辨率的 event-loop delay P99/max；不是额外启动进程测量自身。arrayBuffers 包含于 external，heap/external/RSS 也不是可相加的独立预算；constrainedMemory 为 Node 已知限制，未知时不输出，不能直接当作 cgroup 峰值。事件只有固定数值诊断，沿用既有 logger/exporter，脱离请求 trace，不保存请求、URL、正文或环境变量值。SIGKILL/重启会丢失未采样峰值，60 秒采样不能证明不存在短时峰值或泄漏。

共享 sampler 支持 `registerRuntimeHealthFlush(name: "live_ingest", callback: () => void): () => void`：仅接受这个固定 key，同 key 替换旧回调，返回幂等 unregister，旧 unregister 不会删掉新注册。回调必须同步；60 秒 tick 在 ROOT_CONTEXT 内各自隔离异常，读取回调副本以避免注册变更形成无界迭代。注册不创建 timer；停止采样即停止调度，显式 unregister 用于模块/测试清理，重载最多保留一个该 key 的回调。业务 owner 自行注册，不由 sampler 反向 import 业务模块。

同一采样周期输出 `runtime.pool.sample/acquire/hold/waiting`：只读现有 owner，不初始化 Pool 或执行 SQL；acquire/hold 为当前 pool generation 创建以来的累计计数和非累积桶（≤1/10/100/1000/>1000ms），pool 重建会归零。hold 在 release 时完成计数，inFlight/peak 包括仍持有的 lease；waitingPeak/waitingTotal 为每次 checkout 入队时观察到的等待人数（queued 含本次自己）的峰值/总和，不是时间加权等待人数，也不是等待时长。waiting 事件的固定人数桶为 0、1、2–4、5–10、>10；count 为 checkout 开始数，包含仍在等待的请求。当前 waiting 来自 pg 的瞬时队列。retiringTotal 单列旧池排空量，不把新旧 generation 累计值相加。原慢 acquire 日志与未知提交不重放、池配置均保留。

共享资源观测由 server-only `src/lib/observability/runtime-resources.ts` 的 `beginRuntimeResource(name): () => void` 拥有；调用者在 finally 调用幂等 completion。固定 name 为 `telemetry.dashboard.fill`、`stats.public.fill`、`profile.public.read`、`mizar.live`、`mizar.reliable`，不接受动态 route/user/cache key。`getRuntimeResourceSnapshot()` 返回副本，只有进程生命周期的 inFlight、peak、完成 count、totalMs/maxMs；周期输出 `runtime.resource.sample`，operation 为该固定 name。本接口不改变准入/并发或业务语义，只有接入的 owner 才有覆盖，未接入不能解释为零负载。缓存 owner 的 resident 字节与填充 in-flight 峰值分别测量，不相加或据计数推算字节。

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
| `traceId` / `spanId` | 当前 OTel span 的关联信息 |
| `release` / `deployment` / `environment` | commit（CLI deployment 无 commit metadata 时回退为 deployment）、Vercel deployment 与运行环境 |
| `durationMs` | 有边界的 operation duration |
| `safeContext` | 仅 allowlist 中的低敏诊断字段 |

预期业务结果必须继续通过 `ActionResult` 返回。例如权限不足、重复报名、验证码拒绝、重复邀请和 rate limit 都不是 exception capture 告警；可以按需记录为 `expected` 事件，但不应制造 5xx 噪音。

非预期 Server Action 失败返回统一安全提示及可检索的 `requestId`；写入可能已完成，默认提示先刷新核对结果，避免盲目重试。密码更新由 `PasswordMutationError` 提供固定恢复指引：明确拒绝提示重新登录，结果未知保留 deny fence，返回 `PASSWORD_UPDATE_OUTCOME_UNKNOWN`，提示停止提交并联系平台管理员核查；密码表单持续展示指引与编号，不跳转成功页。`auth.password_update.failure` 与 UI 使用同一个 requestId，unknown 的 retryable=false。原始 cause 只留在服务端异常对象；该凭据边界的日志仅投影有界、允许的异常名称/错误代码/cause 链及整数 HTTP 状态，永不读取或输出 provider message、stack、body、邮箱、密码或 token。登录 429 是 expected 限流，0/未知失败是 dependency；只有官方 `invalid_credentials` 才归为无效凭据。管理员核查步骤见 [`auth-password-reconciliation.md`](auth-password-reconciliation.md)。Mizar HTTP 边界通过 `mizar.request.failure` 记录 auth/read/validate/domain/revalidation 阶段和同一关联编号；预期 4xx 不作为异常告警，非预期失败返回 500，并在安全响应与 `X-Request-Id` 中提供编号。

DAK HTTP 五入口通过 `withIntegrationRequest()` 复用请求 trace、固定路由与 `after()` flush；handled 500 只由 `dak.request.failure` capture 一次，保留原始异常的脱敏 cause/SQLSTATE 与 auth/read/validate/domain/revalidation 阶段。既有 `error.code/message` 协议不增添字段，安全提示及 `X-Request-Id` 使用同一编号；导入后失效失败明确提示已收到提交，先查看保存结果并核对导入状态、不要重新上传；该已知状态不附加通用“稍后重试”前缀。预期 401/403/404/422 不产生 exception 告警，成功响应不变。

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

第三方 URL 可能包含 key 或 token。provider request 使用 `providerFetch()` 标记 `opentelemetry.ignore` 并关闭 context propagation；fetch instrumentation 只对内部 deployment allowlist 传播 trace，避免把凭证 query 或 provider 请求作为可传播链路。

## 当前关键 span

Node trace sampling 由 `src/lib/observability/sampling.ts` 在唯一的 `registerOTel()` provider 上决定：Production `/api/cron/*` 请求按 trace ID 采样 5%，其他 Production 请求与 Preview 请求保留 100%。Development/test 不接外部 sink。结构化日志（包括错误事件）不参与 trace sampling，仍完整输出。

Sampler 在 SERVER span 创建时读取 Next 提供的 `http.target`，兼容 `url.path`、`http.route`、`next.route`，忽略 query/hash；不依赖请求结束才更新的 span name。远端 parent 的采样标志不覆盖本服务请求策略，本地 child span 跟随本地 parent，避免零散丢弃 child span。未知路由或属性读取失败保留 trace，不影响请求。未采样日志仍可携带 trace ID，但不保证存在可打开的完整 trace。

此策略不改变 scheduler 触发频率、due gating 或 health projection。发布后必须回读实际请求树，确认平台没有在 Next 请求之前创建无法识别路径的本地 parent；若有，先修正入口识别，不用 child span 过滤掩盖问题。5% 是采样概率，不是小窗口内的精确计数或已测得的 ingest 降幅。

`traceOperation` 的可选 stage 只接受 authorize/read/transaction/compute/project/invalidate/provider/serialize，沿用当前 trace 和错误 owner；不加业务 ID 或输入。领域 owner 在实际阶段边界标记，不重复包装同一 SQL。

不为每个 helper 创建 span，只为可运营的边界创建：

- request → route / Server Action；
- DB query、连接池创建、重建和仅限建立连接前失败的一次 retry；连接获取失败或超过一秒时，`db.pool.acquire` 日志记录 durationMs、入队前 poolTotal/poolIdle/poolWaiting/poolMax、connectionState（reuse/connect/queued）及 outcome。queued 表示获取开始时无空闲连接且已达应用池上限；connect 包括新连接的网络/TLS/provider 握手，不能据此认定数据库执行慢。该事件不重放查询，也不把失败后的恢复解释为原操作未提交；
- Supabase Auth/session、Turnstile、Steam、SiliconFlow/OCR；
- Rivals registration submit；CompetitionEntry submit/review；
- Major prestart final entrant selection/reconciliation and lock, Major start、Swiss round finalize、stage transition、playoff start；
- match result record、result correction plan/apply/adjudication。
- scheduler endpoint failure、watchdog fallback、人工 break-glass run；正常 primary success 与 fresh watchdog no-op 不逐条写 runtime log。

Span name、`rivalhub.*`、`db.*`、HTTP method/status 和 provider 等属性必须是低基数值。默认不加 user/team/entry ID、email、昵称或业务 payload。跨 provider 的 trace propagation 只对自有 deployment URL 开启；Supabase、Steam、SiliconFlow、Cloudflare Turnstile 和 Better Stack 均不接收 RivalHub trace headers。

`db.pool.query` 的 pooled query envelope span 在调用前记录 `rivalhub.db.pool.total/idle/waiting` 数量快照，返回后记录 `rivalhub.db.result.rows`；仅保存数值，不包含 SQL 或行内容。duration 包含连接获取与执行，调用前快照不能精确拆分等待时间；逐语句 `db.query` span 由 checkout 后的 client 统一拥有，覆盖普通配置的 Promise/callback 与 Drizzle 事务，和 pool envelope 是包含关系，不能相加当 SQL 次数。自定义 Submittable/自带 callback 的 Query 对象保留原语义并计入 unsupported，不宣称全覆盖。`getDatabasePoolSnapshot().client` 返回 query count/failures/rows/queryMs、checkout hold 与 transaction hold 的进程内完整计数；BEGIN 到 COMMIT/ROLLBACK 为事务时间，ROLLBACK TO SAVEPOINT 不结束事务，已失败事务 COMMIT 返回 ROLLBACK 计回滚，release 时仍未结束的事务和提交错误计 unfinished，不推断其提交结果，也不自动回滚或重试。方法在归还连接前恢复，避免复用时叠加包装；这些时间互相包含且不能与 pool acquire/请求 duration 简单相加。`getDatabasePoolSnapshot().acquire` 提供当前 pool 自创建以来所有成功/失败 checkout 的 count、failures、totalMs、maxMs、开始时 reuse/connect/queued 次数与非累积耗时桶（≤1/10/100/1000/>1000 ms）；每次读取返回副本，不初始化连接，也不保存单次样本。它是进程内完整分母，pool 重建后归零，不能作为持久历史或 TLS 新建比例。慢日志保持原有阈值；不从慢日志计算全部请求分位数。常驻 production Next.js Node 服务在空闲时保留至多两条已建立连接，不主动预建；超过该下限的空闲连接在 30 秒后回收，Vercel 与 CLI 保留 5 秒的回收行为；连接上限与故障重建、重试边界维持由数据库 runtime owner 管理。

## 查询与排障

先在 Vercel 确定 deployment、region、Runtime Error Group 和时间窗口，再用下列字段在 Vercel Runtime Logs 或 Better Stack 查询：

1. `event` + `environment=production`：判断是 `application`、`database`、`dependency`、`security` 还是 `invariant`。
2. `requestId`：串起一次 route/action、DB retry 与 provider 失败。
3. `safeContext.errorDigest`：Next server render 错误的安全十进制 hash（1–20 位），与客户端显示的「排查编号」一致；同一事件保留服务端 `requestId`，先按 digest + 时间/route 查找事件，再按 requestId/traceId 关联请求。digest 不是唯一请求 ID，不截断、转换或自造编号，缺失或不合法时不显示。原始原因只进入既有服务端脱敏 exception，不返回错误页面。
4. `traceId`：打开请求树，查看 route → critical operation → provider/DB child span；`spanId` 用于精确定位单个 operation。
5. `deployment` / `release`：确认错误是否只出现在新 deployment；必要时与上一 release 对比。
6. `route` + `status`：确认 5xx 是否集中在某个 route，而不是把 validation/duplicate 结果计入错误率。

排障顺序：

- `security` / `invariant` / `fatal`：先保留证据并检查对应 audit fact、权限边界和数据不变量；不要通过补写 runtime log 修复业务事实。
- `database`：看 SQLSTATE、safe constraint、`db.pool.*` 和 retry 次数；禁止从日志猜测或复制 SQL 参数。
- `dependency`：看 provider、HTTP status、retryable 和 trace；确认 provider 是否超时、限流或配置缺失。
- `application`：看 release/deployment、route 和 bounded exception；修复 canonical owner 后再重试。
- 只有在 `ActionResult` 已返回但用户仍报告异常时，才将 expected event 与业务 audit fact 一起核对。

教育 evidence 的 Storage provider 失败只记录不含 object key、原始文件名、signed URL、图片、CHSI code 或 provider raw response 的 dependency 事件；上传后的数据库/audit 失败由既有 Server Action observability 记录安全分类，并 best-effort 删除刚上传对象。retention 删除失败直接交给既有 scheduler execution owner 重试，不在教育 retention 内重复 capture 或建立第二个日志 owner。

OCR 失败由 `src/lib/ocr/` 分类为配置、上游鉴权、限流/额度、网络、超时、上游结果或图片错误。Action 的 `provider.siliconflow.ocr_failure` 事件保留 HTTP 状态、失败阶段与固定提示分类，以及输出字符数、空白字符百分比、有效生成 token 数和固定枚举结束原因；HTTP 错误体最多检查 8 KiB，仅投影结构化 `code/message`，传输异常只投影 `name/code/message/cause`。长度上限结束会在解析前归为 `output_truncated`，即使 JSON 恰好完整也拒绝接受可能缺行的结果；不自动重放这类识别请求。行校验失败区分数组列数错误与其他行结构错误，仅记录有界列数。收到成功 HTTP 响应后，响应体读取中断仍归网络错误，读取超时保留 `response` 阶段与脱敏原因；只有实际 JSON 语法错误归 `invalid_response_json`，不记录其原始解析消息。未知结构化原因不会丢成固定分类：每条原因经过 canonical redaction，并移除 URL 凭据/路径/query、令牌模式及确切请求凭据/图片回显；每段最多 160 字符、cause 最多六层，降级前后最多八条。服务端通过既有 allowlist 的 `errorCodes/errorName/errorMessage` 同索引数组保存脱敏错误链，不保存原始 body、header、stack、截图或模型输出，也不将诊断自由文本返回浏览器。UI 的排查编号与事件 `requestId` 一致；正常请求和响应格式降级使用同一编号。鉴权/配置失败指向 `/admin/settings#ocr-configuration`，由超级管理员在当前承载环境的 runtime 配置及 SiliconFlow 控制台检查；“已配置”只证明存在，不能证明凭据、权限或余额有效。

Audit 查询回答“谁在什么时候改变了什么业务事实”；runtime observability 回答“请求如何执行、在哪里失败、是否可关联”。两者可以用 request/trace 时间窗口对照，但不得合并成一个存储或 serializer。

## 新增事件或 span

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

关键 operation 使用 `traceOperation()`，让异常继续交给外层 action/route owner 处理：

```ts
return traceOperation("competition_entry.submit", {
  scope: "competition_entry",
  operation: "submit",
  attributes: { "rivalhub.workflow": "competition_entry" },
}, () => canonicalSubmitInTx(...));
```

不要为正常成功路径逐条记录日志，不要复制领域 transition/错误分类，不要在 component 中配置外部 sink。Client Component 只有在存在明确 fallback 时才可输出固定、非敏感的浏览器诊断，不能输出 raw exception/payload 或用空 catch 静默吞错。新增 safeContext key 时必须同时补 redaction 单测，并检查它不会成为 ID、body、query 或 secret 的旁路。 safeContext 仅读取有界 allowlist 中的自有数据字段，跳过 accessor；单字段或代理读取失败时保留其他安全字段与原始 exception，不让附加诊断丢弃整条错误事件。

后台统计修复的候选查询与单图重建失败由 `stats.projection_repair.failure` 保留脱敏原始 cause，并以 `phase=candidate_selection/rebuild` 区分阶段。Demo 关联重检的单项失败与候选载入失败由 `demo.recheck.failure` 保存原因，以 `phase=recheck/candidate_selection` 区分；保留既有 failed 数量和 partial success，已提交身份确认不因后续 fanout 故障被伪装为失败。事件不附加账号、赛事、地图或 artifact 标识，复用活动 trace 与存在的请求 context；scheduler 最终摘要仍报告整批健康失败。不同层级的 DB/item/summary 事件不是唯一 incident 数，按 trace/request 关联，不重复相加成失败次数。

默认首发后台补齐仅将名单资格 owner 的 `VALIDATION_FAILED` 视为正常等待；数据库、冻结事实缺失与其他系统异常由 `match.default_lineup.failure` 保留脱敏 cause/SQLSTATE 和排查编号。批次继续处理其他比赛及时间提议，先刷新已提交比赛，再将补齐系统失败交给 scheduler 健康 owner；后续提议读取失败也必须携带已提交比赛列表，由 runner 在报告原始故障前刷新；人工提示明确首发已保存，先核对首发与排期，不能指望重复运行修补丢失的页面失效。异常对象及内部目标列表不进入公开摘要。管理员先在比赛工作台核对已保存首发，超级管理员按编号排查服务，恢复后从 `/admin/settings` 定时任务健康的既有人工入口运行一次。仍未满足名单资格时按工作台提示处理；补齐复用原事务、资格 owner 和已有名单跳过规则，不能据故障自行造名单或绕过资格。

Scheduler 的 `scheduled_job_health` 只保存有界 current projection，不是 runtime log 或 execution ledger。primary trigger、primary endpoint start/success、watchdog fallback/manual success、最近业务推进和最近失败分别由 shared scheduler owner 更新；fresh watchdog no-op 不写 projection。失败只保存稳定 source/code/classification，不保存 raw error、URL、Authorization 或 Vault secret。`jobKey`、`source` 等 safeContext 仍必须经过 allowlist。

## 告警原则

告警统计 canonical **结构化日志事件**，不能把通用 `label('error')='1'` 的 framework、child 或 DB span 数量当成应用故障数。所有规则先限制 `environment=production`，再应用下列条件：

| 告警 / 图表名称 | 事件条件 | confirmation period |
| --- | --- | --- |
| 意外应用故障信号 | `errorClass=application` | 60 秒 |
| 严重 / 安全 / 不变量信号 | `errorClass` 为 `security` 或 `invariant` | 0 秒 |
| 数据库连接性降级信号 | `errorClass=database`，且 `event` 为 `db.pool.error`、`db.pool.rebuild_failure`、`db.query.outcome_unknown`，或 `event=db.query.failure AND retryable=true` | 60 秒 |

三条规则均使用事件数 `> 0`、check period 60 秒、query period 300 秒、recovery period 300 秒、`on_missing_data=dont_fire`。这是故障信号计数，不是唯一 incident 数；一个请求可能经过多个错误边界，排障时按 requestId/traceId 关联，不应因此恢复为通用 span 计数。

应用故障包括 `next.request.unhandled_error`、`action.internal_error`、`action.unexpected_error`、`http.response.server_error` 等 canonical application 事件，不维护会遗漏新 owner 的固定 event 白名单。普通权限拒绝、validation、重复邀请/投票属于 `expected`，不进入安全或应用告警。

数据库规则排除成功 DB span、已恢复的 `db.query.retry`、`db.pool.rebuilt`，以及 `retryable=false` 的 SQL/schema query failure。`db.query.outcome_unknown` 表示连接中断后无法确定执行结果，`retryable=false`，禁止自动重放（包括有副作用的 SELECT）；连接池仅为后续请求重建。只有明确建立连接前的 ECONNREFUSED / ENOTFOUND 可以自动重试一次。连接池重建失败由共享 rebuild owner 记录一次，覆盖 pool guard 与 query retry 两个入口。连接性分类复用数据库 runtime 的稳定字段，不在外部 SQL 中解析异常 message。

### Better Stack 规则迁移与验证

1. 导出既有 alert/chart 配置和时间窗口基线；暂停噪音 application 告警，保留 incident history。旧的泛化 “Error rate high” 规则保持暂停。
2. 查询实际 source schema 和日志样本。OTLP log attributes 由应用发出为 `rivalhub.environment`、`rivalhub.event`、`rivalhub.errorClass`、`rivalhub.retryable`；JSON log body 对应无前缀字段。**以 source 实际解析字段和类型为准映射 SQL**，尤其不能混用 span 的 `rivalhub.error_class`，也不能把 boolean 当作字符串盲猜。确认查询只统计一份 canonical log，不将 stdout 与 OTLP 重复相加。
3. 按上表替换 query、时序参数和图表名称，回读保存后的配置。alert ID、source ID、实际 SQL 与回读证据记录在执行 Issue，避免在运行手册复制账户状态。
4. 在 Preview 或受控非生产环境，用同一 predicate（仅替换环境筛选）验证 application、security/invariant、final DB failure 正例，以及 expected 拒绝、成功 span、retry 后成功、非连接性 SQL error 反例。验证恢复/去重和通知路由后再启用新规则；禁止为验收故意制造 Production 500。
5. 统一发布后，对比等长、代表性的前后窗口：cron 请求数与 sampled request trace 数、非 cron trace 覆盖、canonical 错误日志、scheduler health 和真实 ingest 使用量/账户配额。采样命中率与成本是不同指标，不用估算 bytes 冒充账户测量。

## 验收清单

代码与 Preview-ready 检查：

- `pnpm type-check`、`pnpm lint`、observability unit tests；
- server/runtime-owned `src/**` 无裸 `console.*`；client-only fallback 的例外由 ESLint 文件边界明确声明；
- 结构化事件不包含 secret、token、邮箱、教育证据、request body、SQL params 或 provider raw response；
- `BETTER_STACK_SOURCE_TOKEN` 与 `BETTER_STACK_INGESTING_HOST` 仅在 Preview/Production 配置，且两套环境使用不同 source 值；
- Preview/Production deployment 页面能按 requestId/traceId/release 查询，并能区分 Vercel 与 Better Stack 的同一事件；
- 在 Preview 或受控非生产环境制造 application/provider/DB failure，确认核心请求返回语义不因 sink 不可用而改变，且事件可在两端关联；
- 受控触发一次告警并确认恢复/去重策略。

没有真实 Better Stack source token 或 Vercel Preview/Production 环境时，只能声明代码、测试和配置 contract 已准备；不能把外部查询、trace、告警或 source isolation 写成已验收。Issue 的最终 production acceptance 需要在真实环境完成后再更新。
