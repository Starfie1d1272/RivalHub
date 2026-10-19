# 生产可观测性运行手册

RivalHub 的 runtime observability 由 `src/lib/observability/` 统一拥有。它记录结构化、可关联、默认安全的运行事件和关键 operation span；`audit_logs` 仍只记录业务事实，不是 runtime log 的替代品。

页面/筛选/人工业务操作的产品基线由独立 [产品遥测](product-telemetry.md) 承接；它复用错误 requestId，不改变本页 runtime exporter、采样或线上缓存，不将事件发给 Better Stack。

## 目标与边界

```text
Next request / Server Action / Cron route
        │ requestId + route
        ▼
canonical event + critical span ──► Vercel Runtime Logs / OTEL traces
        │                                   │
        └──────────── OTLP logs/traces ─────┴──► Better Stack sink
```

- Vercel 保留为部署、Runtime Logs、Runtime Error Groups、Analytics 和 Speed Insights 的平台入口。
- Better Stack 只作为外部长历史、trace/error 查询和告警 sink；RivalHub 不建立自有 log database，也不使用 Vercel Drain。
- OTel 在服务端通过 `@vercel/otel` 初始化。Node runtime 将结构化 log 和 trace 以批处理 OTLP 发往 Better Stack；所有 runtime 在 auto/export processor 前先经过进程内 span sanitizer，删除异常 message/stack、状态 message、SQL/query/params、请求凭证与 body/header 属性；Route Handler 在响应后通过 Next `after()` 触发一次 bounded flush，避免 serverless 实例在 batch delay 前冻结；Edge runtime 仍只使用 Vercel 原生 OTel，不挂载 Better Stack exporter。
- Development 和 test 默认不向外部 Better Stack 发送 telemetry。exporter 或 sink 故障只影响观测，不改变核心请求结果。
- Client Component 不携带 Better Stack token，也不直接调用 Better Stack。
- Next server code 通过带 `server-only` 的 `@/lib/observability/server` facade 访问 logger/tracing；`src/db/client-runtime.ts` 是显式保留的 Node application/CLI runtime boundary。

## 环境变量

Preview 与 Production 使用相同变量名、不同的 Vercel Environment 值：

```text
BETTER_STACK_SOURCE_TOKEN=<server-only Better Stack source token>
BETTER_STACK_INGESTING_HOST=<server-only Better Stack OTLP ingest host>
```

`BETTER_STACK_INGESTING_HOST` 只接受 HTTPS origin（可带或不带 `https://`，不能带 path、query、用户名或密码）。代码会自动分别发送到 `/v1/traces` 与 `/v1/logs`。不要把 token 写入 issue、PR、日志、fixture、Client props 或任何 `NEXT_PUBLIC_*` 变量。

如果 Preview/Production 只配置了一个变量，或 host/token 不合法，应用继续使用 Vercel/stdout 观测并将配置状态记录为不含凭证的结构化事件。Development 未配置外部 telemetry 是正常状态。

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

不为每个 helper 创建 span，只为可运营的边界创建：

- request → route / Server Action；
- DB query、连接池创建、重建和仅限建立连接前失败的一次 retry；
- Supabase Auth/session、Turnstile、Steam、SiliconFlow/OCR；
- Rivals registration submit；CompetitionEntry submit/review；
- Major prestart final entrant selection/reconciliation and lock, Major start、Swiss round finalize、stage transition、playoff start；
- match result record、result correction plan/apply/adjudication。
- scheduler endpoint failure、watchdog fallback、人工 break-glass run；正常 primary success 与 fresh watchdog no-op 不逐条写 runtime log。

Span name、`rivalhub.*`、`db.*`、HTTP method/status 和 provider 等属性必须是低基数值。默认不加 user/team/entry ID、email、昵称或业务 payload。跨 provider 的 trace propagation 只对自有 deployment URL 开启；Supabase、Steam、SiliconFlow、Cloudflare Turnstile 和 Better Stack 均不接收 RivalHub trace headers。

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

OCR 失败由 `src/lib/ocr/` 分类为配置、上游鉴权、限流/额度、网络、超时、上游结果或图片错误。Action 的 `provider.siliconflow.ocr_failure` 事件保留 HTTP 状态、失败阶段与固定提示分类；HTTP 错误体最多检查 8 KiB，仅投影结构化 `code/message`，传输异常只投影 `name/code/message/cause`。未知结构化原因不会丢成固定分类：每条原因经过 canonical redaction，并移除 URL 凭据/路径/query、令牌模式及确切请求凭据/图片回显；每段最多 160 字符、cause 最多六层，降级前后最多八条。服务端通过既有 allowlist 的 `errorCodes/errorName/errorMessage` 同索引数组保存脱敏错误链，不保存原始 body、header、stack、截图或模型输出，也不将诊断自由文本返回浏览器。UI 的排查编号与事件 `requestId` 一致；正常请求和响应格式降级使用同一编号。鉴权/配置失败指向 `/admin/settings#ocr-configuration`，由超级管理员在 Vercel 环境绑定及 SiliconFlow 控制台检查；“已配置”只证明存在，不能证明凭据、权限或余额有效。

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

不要为正常成功路径逐条记录日志，不要复制领域 transition/错误分类，不要在 component 中配置外部 sink。Client Component 只有在存在明确 fallback 时才可输出固定、非敏感的浏览器诊断，不能输出 raw exception/payload 或用空 catch 静默吞错。新增 safeContext key 时必须同时补 redaction 单测，并检查它不会成为 ID、body、query 或 secret 的旁路。

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
