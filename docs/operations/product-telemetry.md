# 产品遥测：基线、排障与上线边界

Owner：`src/lib/telemetry/`；页面接入 `src/components/telemetry/`；独立接收端 `workers/telemetry/`。默认关闭，未配置真实接收地址/凭据/绑定。本设计不授权部署、合并、持续访问或实际删除。

## 与现有采集的关系

Vercel Analytics/Speed Insights 继续负责既有匿名流量与性能；`src/lib/observability/` 的 OTel/Better Stack 继续负责服务端运行日志、脱敏异常和 requestId。产品遥测补足页面、筛选和显式业务操作基线，不把 runtime logs 复制到业务 PostgreSQL，也不增加点击级 Server Action、Vercel Function、Runtime Cache 写入或线上缓存策略。

浏览器在 Header 已有的 request/Suspense island 中获得限定 RivalHub 的签名接收票据；使用已读取的 Header 授权投影，不增加 auth/DB 查询。每分钟把内存队列的最多 32 条事件直传独立 Worker。页面隐藏/退出触发一次 best-effort flush；请求使用 keepalive、omit credentials、no-referrer 和 text/plain，避免携带 Cookie、来源 URL 或逐批预检。空队列没有请求。

Worker 仅使用独立 D1：一个批次一行、服务端校验后写入、按账号/会话索引。没有 R2、KV、Queue、Durable Object、付费分析平台、Vercel Drain 或 Mizar 资源依赖。示例配置关闭 Workers observability，避免额外持久化传输票据/诊断正文。Mizar #398 的分支、接收协议、账号绑定与未批准留存不属于本实现。

## 采集覆盖与真实结果

- Root Header 的单一 observer 覆盖所有页面，包括手机、登录、账号设置、公开赛事、统计、参赛工具与后台；动态 slug、用户/队伍 ID、邀请 token 只保留路由模板。新增页面要更新 `routes.ts`，未识别路径只记 `/unknown`。不抓 DOM、正文、鼠标移动、录屏、聊天、文件或网络请求内容。
- pathname/query 提交后记录 page；同一路径允许的筛选变化记录 filter。浏览器 popstate 记 `navigation=history`（包含返回和前进，不伪称能区分方向）；刷新记 reload。恢复到同一 URL 的 history 仍记录。只在内存用原 URL 去重，不写到事件、存储或日志。
- 统计 tab/stage/format/mapFilter/mapsView、名单/比赛 team/status、排序，以及共享 Tabs/MetricFamilyTabs 的选择有固定类别投影。查询词、具体队伍/人物、未知分类只记 selected，不记录值。恢复/刷新触发的 URL 变化是页面状态，不计业务动作。
- `operations.ts` 列出显式客户端动作：账号/认证/教育、队伍/招募/报名/阵容、队长投票/选秀、竞猜/免费预测/推演、比赛安排/BP/赛果/更正/截图识别、赛事管理/赛后/纪律/奖项/反馈，以及本站的 Mizar/DAK 授权。人工运行 scheduler 是人工操作；自动 scheduler、心跳、读取、轮询、边界 reconcile/recovery 不包装。
- 同一调用的 start/result 共用随机 operationId，结果取真正的 ActionResult。success 代表业务 owner 明确返回成功（包括幂等结果），不代表有新数据写入；预期业务拒绝记 rejected；抛错、传输失败、INTERNAL_ERROR 或凭据结果未知记 unknown，不能假称失败未写入。BP stale 明确为 rejected，applied/noop 单列。内部自动重试仍是一次调用；用户再次提交是新 operationId。
- bet join/stake、推演草稿/正式提交、免费 result/BP、BP ban/pick/side_pick 等只投影固定 discriminant，不复制其他输入。图片导出记录本地生成/触发下载是否完成，不能证明用户文件已写入磁盘。设备授权表单在业务 owner 返回成功后才导航，不拿 redirect 异常当成功证据。
- 失败增加固定错误码、当时的筛选类别、路由/赛事场景、耗时及已有 requestId；原始异常、SQL、邮箱、密码、token、输入/响应正文不进入事件。requestId 可交叉检索原 runtime observability，业务 audit 仍是事实 owner。

这是浏览器报告的产品基线，不是安全审计或账本。脚本未加载、DNT/GPC、广告拦截、离线、队列溢出、过期、限额、关闭标签页或授权 island 故障都会缺数；开始后无终态不等于业务失败。服务端实际执行但响应丢失时只记 unknown，再用 requestId/audit 查证。

## 数据字段与身份

| 字段 | 来源/约束 |
| --- | --- |
| id / at | 随机事件 UUID / 客户端 UTC 毫秒；接收只允许过去 15 分钟、未来 1 分钟 |
| session | 同标签页随机 UUID；30 分钟不活跃更新，sessionStorage 被禁用时内存降级；与鉴权 session/cookie 无关 |
| account | 服务端 HMAC(`rivalhub-product-account-v1:` + 内部 userId)，仅接收端批次字段；匿名为 null，不接收浏览器声称的 userId |
| role | Header 授权快照：anonymous/user/season_admin/super_admin；队长/代表不是全局授权角色，通过路由/操作区分，不猜测其权限 |
| release / environment | 签名票据中的构建 commit 与 preview/production；生产需检查 release 不是 unknown |
| route / scene / eventId | 路由模板、canonical 赛事模板 major/rivals/other（无赛事为 site）、公开赛事 UUID；未加载对应 layout 时可能是 site |
| kind / navigation / filters | page/filter/operation/error；navigate/history/reload；明确允许的类别/selected |
| operation / variant / phase | 注册表中的动作名、固定子类型、start/success/rejected/unknown |
| operationId / durationMs / outcome | 单次调用关联、最多一小时耗时、applied/stale/noop（存在时） |
| errorCode / requestId | 已知错误枚举或固定未知分类、既有 UUID；不保存 message/stack/cause |
| received / expires / bytes | 接收 UTC、批内最早事件 at + 七天、正文 UTF-8 字节数 |

票据是仅接收可用的签名 envelope，最长 24 小时；不授予业务或查询权限，不写入 D1/日志/sessionStorage。浏览器不持有签名密钥、账号 HMAC 密钥或查询凭据。常规 Header 重渲染可更新票据；静置超过 24 小时会停收，需正常页面刷新，不额外轮询续签。角色是签发时快照，不用遥测做权限判断。

登录、退出、账号归并成功时尽力送出原身份的末批，然后清空队列及会话，等待新的 Header 身份。身份切换后尚未完成的旧调用不会计入新账号。匿名会话不与登录账号拼接；不同产品、Preview、Production 必须使用不同的 account key、signing key、D1 和 operator key；不复用 Mizar、Auth 或 Better Stack secret。账号 HMAC 可关联同产品账号，属于假名化而非匿名数据。

## 交付、预算与免费边界

队列仅在内存保留最多 256 条；每批最多 32 条/24 KiB；没有本地事件文件、IndexedDB、录屏或离线长期补传。5 秒网络超时；同批 UUID 最多尝试三次，60/120 秒退避；超 15 分钟/溢出丢弃，不阻止业务。不额外 flush 每个点击。采集异常不更改返回结果，不重放业务调用。

接收逐字段拒绝未知数据；签名、来源和有效期都要匹配；管理员读取需独立 Bearer。全局每天至多 5,000 批、8 MiB 原始 JSON；每票据最多 120 批。D1 事务内 INSERT 与 usage counter 同步更新，重试不重复计数；到期清理积压时停收，维护失败不会把过期数据重新公开。恶意/无效请求仍可能消耗 Worker 请求额；必须使用 Workers Free 的硬停机额度，不升级 Paid 或开超额计费。

截至 2026-10-17，官方 [Workers Free](https://developers.cloudflare.com/workers/platform/pricing/) 为每日 100,000 请求、每次 10ms CPU；[D1 Free](https://developers.cloudflare.com/d1/platform/pricing/) 为每日 5M rows read、100k rows written；[D1 限制](https://developers.cloudflare.com/d1/platform/limits/) 为单库 500MB、账户 5GB。索引、删除、事务计数器和汇总同样耗写额度；一个批次不等于一行计费。以上是计划上限，不是当前共享账户余量。上线前必须确认团队已有占用，保留免费安全余量；额度不足则保持关闭/停收，不自动扩容或改 Vercel 缓存。

复现本地请求/体积/客户端耗时：`pnpm telemetry:measure`（需 Playwright Chromium）。它执行真实 browser client bundle，再把实际事件形状写入本地 SQLite（含索引）；不是 D1 计费报告，也不是全部 Next chunks 的增量。真实 workerd/D1 入口和并发 ACK 的自动证据见 `tests/unit/telemetry/worker.test.ts`。量测结果随代码和机器变化，以 PR 的精确提交证据为准。

## 保留、清理、恢复

原始事件和所有账号/会话索引在同一 batches 表，按批内最早事件时间加七天到期。所有查询立即排除到期批次；小时任务每轮最多删 500 批，失败下次继续；raw 删除先独立提交，后续汇总写入/删除失败不会回滚 raw 清理。物理删除可能延迟到维护成功；停收不会关闭维护。清理时间不刷新 event time，也不通过重发延长已有批次寿命。

独立的候选汇总保留 **90 天，待确认**：关闭的 UTC 接收日汇总一次，维度仅日期、版本、环境、角色、场景、路由、动作/子类型/阶段/outcome，值仅次数、耗时总和。没有 account/session/operationId/eventId/requestId、自由文本或可回放路径。rollup marker 保证重跑不双算；已汇总接收日拒绝迟到的在途写入，后续重试按新的接收日处理（仍受 15 分钟事件年龄限制）；usage/marker 最长八天，仅用于预算/进度。汇总没有独立用户数、留存曲线或个人轨迹，不能用于跨产品追踪。七天内未成功汇总可能损失基线，不能延长原始留存来补算。

**恢复副本必须另行确认**：D1 Free 的 Time Travel 恢复窗口为七天。应用七天删除不能证明恢复历史立即物理擦除；被删除原始数据可能在随后恢复窗口中存在（从事件创建算保守约十四天）。若要求“包括 provider 恢复副本在内绝对七天”，这个候选不能直接获批上线，需要先确认可关闭/缩短恢复历史的能力或更换存储方案。恢复时保持 ACCEPTING=0，先执行过期清理并核验所有查询 cutoff、预算进度，再经确认开流量；旧备份不应重新成为可读原始事件。遥测不进入 RivalHub PostgreSQL DR 备份，不额外导出 raw 或建长期账号映射表。

`RETENTION_APPROVED=0` 时既不接收也不运行持久清理；线上一旦启用后紧急停收只改 ACCEPTING，必须保留清理。不得在已存数据时取消维护而声称仍执行七天保留。

## 基本查询与版本比较

运维凭据仅在受控终端注入 `PRODUCT_TELEMETRY_ENDPOINT`、`PRODUCT_TELEMETRY_ADMIN_KEY`；按账号定位额外需要同环境 `PRODUCT_TELEMETRY_ACCOUNT_KEY`。工具不创建/打印凭据，不跟随重定向。

```sh
pnpm telemetry:query session <diagnostic-session-uuid>
pnpm telemetry:query account <internal-user-uuid>
pnpm telemetry:query summary 2026-10-01 2026-10-17
pnpm telemetry:query usage
```

`/admin/events` 必须指定 session 或 account，每页最多 100 批；按 received/id/ticket 三元 cursor 翻页，直接使用返回 nextCursor 的 before/id/ticket 参数，包含相同毫秒也不漏数。CLI 只展示第一页并保留 truncated/cursor，不暗示结果完整。`/admin/summary` 一次最多 31 天、5,000 组，truncated 时按更短时间窗口查询；`/admin/usage` 返回最近八个接收日的成功批数/字节量。仅已关闭日期有汇总，接收时间是分桶依据。

比较新旧版本时使用相同长度的完整 UTC 日、相同 environment/scene/role/route，分别计算 page/filter 次数、operation start 次数、success/rejected/unknown 次数、终态平均 duration_ms；BP stale/noop 和操作 variant 独立比较。不要将 start 和终态相加为操作量；成功率按终态分母并同时报告没有终态的 start 与每日停收/额度/采集覆盖情况。不能把客户端开始/结果之间的数量差完全解释为业务失败，也不能将不同规模用户群的总量变化直接当作转化率。

## 上线前交回确认的清单

1. 确认独立 Worker/D1 所属账户、**Free 计划**和共享额度余量；核对 ALLOWED_ORIGIN 与 separate preview/production 资源；不绑定 Mizar #398。
2. 确认账号假名化目的、管理员查询权限及隐私说明；确认七天 active raw、物理清理时限、D1 恢复副本取舍、90 天无身份汇总。未确认保持全部开关为 0。
3. 由维护者批准并注入四类最小凭据：app/Worker 共用的 signing key、app/受控账号查询用 account key、独立 operator key、部署所需 provider 权限。本 PR 不创建持续凭据或授权。
4. 复制 review-only `wrangler.example.jsonc` 到受控部署配置，填批准的 D1 ID；在新空的独立 D1 应用 schema.sql，检查 schema/索引和权限。此 SQL 不是 RivalHub PostgreSQL migration，不在应用 release 自动执行；后续演进需独立编号迁移，不重跑初始化文件。
5. 经批准先在隔离 Preview 验收：身份切换、Major/Rivals、返回/筛选、业务拒绝/响应丢失、Worker 停机、重试去重、按账号/会话查询、跨 origin/无授权拒绝、七天边界、500 批清理分页与恢复前清理。
6. 对比新旧构建的实际 Next 路由资源 gzip/加载与 hydration，结合现有 Speed Insights 复核（core 独立 bundle 量测不等于全站增量）。测量真实 Worker CPU/请求数、D1 rows_read/rows_written、数据库 size（含索引/90 天汇总）、各共享免费额度。核对每批最多 50 个 D1 查询限制，本实现通常 7 个以内；保留失效/拒绝请求开销。超过预算保持停收，绝不加付费能力。
7. 单独批准生产部署后才能启用 PRODUCT_TELEMETRY_ENABLED、ACCEPTING、RETENTION_APPROVED；核查 build release 标签与实际签名版本。小范围比较代表性等长窗口，不拿本地量测承诺线上成本。
8. 回滚先停 app 采集/Worker ACCEPTING；不更改业务 cache，不撤掉既有原始清理。密钥轮换会使旧票据失效；账号 key 轮换会改变 lookup，需要明确旧七天窗口处理，不能建立永久映射补连。
