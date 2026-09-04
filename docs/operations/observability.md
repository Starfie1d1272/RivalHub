# 生产可观测性运行手册

RivalHub 的 runtime observability 由 `src/lib/observability/` 统一拥有。它记录结构化、可关联、默认安全的运行事件和关键 operation span；`audit_logs` 仍只记录业务事实，不是 runtime log 的替代品。

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
- OTel 在服务端通过 `@vercel/otel` 初始化。Node runtime 将结构化 log 和 trace 以批处理 OTLP 发往 Better Stack；Route Handler 在响应后通过 Next `after()` 触发一次 bounded flush，避免 serverless 实例在 batch delay 前冻结；Edge runtime 只使用 Vercel 原生 OTel，不挂载 Better Stack exporter。
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

PostgreSQL 分类必须复用 `src/db/errors.ts` 的 `extractPgError()`。日志只允许 SQLSTATE、constraint/schema/table/column 等分类 metadata，不能读取或输出 raw query、params、detail 或完整 Drizzle error。

## 脱敏 contract

默认拒绝以下字段或内容：

- password、old/new password、Authorization、Cookie、Set-Cookie、session、JWT、Bearer token；
- signup/reset/invite/token_hash、Turnstile token、教育材料、education verification code；
- secret、apiKey、`CRON_SECRET`、原始 `FormData`/request body；
- SQL 文本、参数数组、raw provider response、完整 Drizzle error；
- 无界 `JSON.stringify()`、循环对象和会触发 getter 的任意异常对象。

`extractSafeException()` 只沿 bounded、cycle-safe、getter-safe 的 `cause` 链读取 name/message/code/stack 及 PostgreSQL 分类字段。`sanitizeSafeContext()` 先执行 allowlist，再执行字符串、数组和长度边界。这个边界在 Development、test、Preview 和 Production 相同，不能依赖环境隐藏泄漏。

第三方 URL 可能包含 key 或 token。provider request 使用 `providerFetch()` 标记 `opentelemetry.ignore` 并关闭 context propagation；fetch instrumentation 只对内部 deployment allowlist 传播 trace，避免把凭证 query 或 provider 请求作为可传播链路。

## 当前关键 span

不为每个 helper 创建 span，只为可运营的边界创建：

- request → route / Server Action；
- DB query、连接池创建、重建和一次 retry；
- Supabase Auth/session、Turnstile、Steam、SiliconFlow/OCR；
- Rivals registration submit；CompetitionEntry submit/review；
- Major start、Swiss round finalize、stage transition、playoff start；
- match result record、result correction plan/apply/adjudication。

Span name、`rivalhub.*`、`db.*`、HTTP method/status 和 provider 等属性必须是低基数值。默认不加 user/team/entry ID、email、昵称或业务 payload。跨 provider 的 trace propagation 只对自有 deployment URL 开启；Supabase、Steam、SiliconFlow、Cloudflare Turnstile 和 Better Stack 均不接收 RivalHub trace headers。

## 查询与排障

先在 Vercel 确定 deployment、region、Runtime Error Group 和时间窗口，再用下列字段在 Vercel Runtime Logs 或 Better Stack 查询：

1. `event` + `environment=production`：判断是 `application`、`database`、`dependency`、`security` 还是 `invariant`。
2. `requestId`：串起一次 route/action、DB retry 与 provider 失败。
3. `traceId`：打开请求树，查看 route → critical operation → provider/DB child span；`spanId` 用于精确定位单个 operation。
4. `deployment` / `release`：确认错误是否只出现在新 deployment；必要时与上一 release 对比。
5. `route` + `status`：确认 5xx 是否集中在某个 route，而不是把 validation/duplicate 结果计入错误率。

排障顺序：

- `security` / `invariant` / `fatal`：先保留证据并检查对应 audit fact、权限边界和数据不变量；不要通过补写 runtime log 修复业务事实。
- `database`：看 SQLSTATE、safe constraint、`db.pool.*` 和 retry 次数；禁止从日志猜测或复制 SQL 参数。
- `dependency`：看 provider、HTTP status、retryable 和 trace；确认 provider 是否超时、限流或配置缺失。
- `application`：看 release/deployment、route 和 bounded exception；修复 canonical owner 后再重试。
- 只有在 `ActionResult` 已返回但用户仍报告异常时，才将 expected event 与业务 audit fact 一起核对。

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

## 告警原则

告警要面向可行动的变化：

- Production `fatal`、`invariant`、`security` 或 integrity 事件；
- Production unexpected 5xx spike；
- DB pool/query failure 增长、持续 retry 或连接重建；
- 关键 Auth、Turnstile、mail、OCR/provider 的连续失败或不可重试失败；
- 新 release/deployment 首次出现的新错误。

不要为 validation、权限拒绝、重复邀请、重复投票、正常邮件 rate limit 或单个可恢复 OCR 行过滤创建 paging 告警。阈值应在 Better Stack/Vercel 中以 production 流量基线设定，并按 `event`、`environment`、`deployment` 分组，避免同一故障重复通知。

## 验收清单

代码与 Preview-ready 检查：

- `pnpm type-check`、`pnpm lint`、observability unit tests；
- server/runtime-owned `src/**` 无裸 `console.*`；client-only fallback 的例外由 ESLint 文件边界明确声明；
- 结构化事件不包含 secret、token、邮箱、教育证据、request body、SQL params 或 provider raw response；
- `BETTER_STACK_SOURCE_TOKEN` 与 `BETTER_STACK_INGESTING_HOST` 仅在 Preview/Production 配置，且两套环境使用不同 source 值；
- Preview/Production deployment 页面能按 requestId/traceId/release 查询，并能区分 Vercel 与 Better Stack 的同一事件；
- 手工制造一次受控 application/provider/DB failure，确认核心请求返回语义不因 sink 不可用而改变，且事件可在两端关联；
- 受控触发一次告警并确认恢复/去重策略。

没有真实 Better Stack source token 或 Vercel Preview/Production 环境时，只能声明代码、测试和配置 contract 已准备；不能把外部查询、trace、告警或 source isolation 写成已验收。Issue 的最终 production acceptance 需要在真实环境完成后再更新。
