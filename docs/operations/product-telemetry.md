# 产品遥测：基线、排障与上线边界

Owner：`src/lib/telemetry/`；页面接入 `src/components/telemetry/`；独立接收端 `workers/telemetry/`。默认关闭，启用依赖对应环境的接收地址、凭据与绑定；是否运行以配置与实际入库证据为准。本文不授权部署、合并、持续访问或实际删除。

应用 release 成功只证明网站构建上线，不能代替接收端部署、环境配置及浏览器入库验收。部署准备工具不更改云资源；下面的云端写入、密钥配置与开流量步骤均须先获得对应授权。

## 与现有采集的关系

Vercel Analytics/Speed Insights 继续负责既有匿名流量与性能；`src/lib/observability/` 的 OTel/Better Stack 继续负责服务端运行日志、脱敏异常和 requestId。产品遥测补足页面耗时、筛选和显式业务操作基线，不把 runtime logs 复制到业务 PostgreSQL，也不增加点击级 Server Action、Vercel Function、Runtime Cache 写入或线上缓存策略。

浏览器在 Header 已有的 request/Suspense island 中获得限定 RivalHub 的签名接收票据；首次签发复用已读取的 Header 授权投影。可见的长开页面另通过 独立 `POST /api/product-telemetry` 每约 20 小时续签一次，重新读取当前授权（无 Runtime Cache 写入）；续签失败最多每小时一次有界重试。它不是用户动作，也不是每点击/每批发送一次的 Vercel 请求。每分钟把内存队列的最多 32 条事件直传独立 Worker。页面隐藏/退出触发一次 best-effort flush；请求使用 keepalive、omit credentials、no-referrer 和 text/plain，避免携带 Cookie、来源 URL 或逐批预检。空队列没有请求。

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

续签请求以 `PRODUCT_TELEMETRY_ORIGIN` 配置的公网 HTTPS origin 为准，与 Header 签发票据复用同一个 origin owner。配置必须是无凭据、路径、query 或 hash 的站点 origin；启用时配置无效则在授权读取前拒绝。自托管反向代理的内部 request URL、Host 和转发头不决定允许来源，跨域、缺少 Origin 和内部 loopback Origin 继续拒绝。

## 页面性能

单一 observer 通过 Next.js `useReportWebVitals` 的稳定 callback 记录 TTFB、FCP、LCP、INP，值统一为四舍五入的毫秒（0–3,600,000）；CLS 使用独立无单位 `score`（0–100、客户端四舍五入至四位小数），与 `durationMs` 互斥。只读取指标名称、数值和内存中的导航归属；不序列化 PerformanceEntry、DOM selector、原生 metric ID、URL、query 或 referrer。指标原生 ID 在最多 128 项的内存映射内换为随机事件 UUID，同一指标的后续报告沿用该 UUID 和首次报告的 session，不因超过 30 分钟闲置后再次上报而产生第二个样本主体；尚未发送的更新在队列内合并，已发送批次保持不可变。映射有界且只在当前身份内有效，不能据此保证无限长会话中的全局去重。

归属优先使用指标的 `navigationURL`，缺失时使用原始 document navigation entry；仅发送本站路由模板。延迟到达、所属路径与当前页面不同的报告归入 site，不附当前赛事 UUID。身份变更后清除映射，并丢弃开始于旧身份期间的导航指标。旧版本浏览器或不支持 Soft Navigation 的浏览器可能只报告初始文档指标；INP 需要实际交互，缺失不补零。

`src/instrumentation-client.ts` 使用 Next.js `onRouterTransitionStart` 捕获本站导航起点，现有 pathname/search observer 在目标路由提交后记录 NAV_COMMIT；新的起点替换被放弃的导航，身份变更丢弃在途测量。它覆盖可观察的 App Router 导航到提交的等待，包含同路径筛选导航；Suspense 内容可能尚未完成，不等于完整内容就绪或 LCP。无匹配提交、observer 未加载或超过一小时的测量不补造。

performance 事件的白名单 `metricName` 为 TTFB/FCP/LCP/INP/NAV_COMMIT/CLS。前五项的 `durationMs` 为毫秒；CLS 只使用 `score`。同批 summary 前九列兼容原布局，原 variant 维度在 performance kind 下保存 metricName，第九列始终为毫秒总和（CLS 为零）；可选第十列保存 CLS score 总和（其他指标为 null），第十一列保存固定 client 分类或 null；性能行追加第十二列随机样本 ID 与第十三列报告时间，并保留每个样本。旧行继续可读。分类不同的报告分组，日汇总仍跨分类合并；旧 `duration_ms` 日汇总暂不写 CLS，避免单位混用。面板对当前样本内同账号/会话、指标 ID 取最新报告时间的值后求均值；缺少样本 ID 的旧报告单列数量，不混入均值。日汇总的次数/耗时总和仍是接收报告口径，不用于最终 Web Vital/p75。保留、访问、DNT/GPC、队列/批次和免费预算沿用原规则，采集不逐次发送。

协议升级时先部署兼容新旧事件的独立 Worker，再按正式 release 流程发布网站采集端；旧 Worker 会拒绝含未识别字段或指标的整批。采集协议扩展不改 D1 表结构；面板另有添加索引的独立迁移，按下文执行，不重跑初始化 SQL。回滚网站可继续使用新 Worker；若回滚 Worker，先停用新版网站采集，避免整批被拒。

## 设备与入口分类

`client-context.ts` 在浏览器内把 User-Agent 和触摸能力投影为 device（mobile/tablet/desktop/unknown）、browser（chrome/safari/firefox/edge/other）、os（windows/macos/linux/android/ios/other）。这是浏览器报告的粗分类，不保证识别平板、伪装 UA 或所有浏览器衍生版；不保存原始 UA、版本、屏幕尺寸或硬件标识。

来源只按 document.referrer 分类为 none/internal/search/social/external/unknown，none 表示没有可用 referrer，不能据此断言直接输入网址。原始来源域名、路径、query、凭据和 UTM 值均不发送。分类沿用当前文档入口，SPA 内部导航不会改写入口来源；它不代表逐页上一个页面。固定分类可随事件保存，继续受同批七天 TTL、DNT/GPC、operator 权限及原恢复副本约束；不建立独立映射或延长留存。

## 有界内容就绪合同

接收端兼容旧事件及 measurement v1。先部署 Worker，再在网站服务端设置 `PRODUCT_TELEMETRY_MEASUREMENT_V1=1`；未设置时 bootstrap 不宣告能力，客户端继续旧协议。回滚 Worker 前先关闭该开关并停止仍持有 v1 bootstrap 的旧标签页采集；仅关闭开关不能撤回已签发配置。

`ContentReady` 只挂载于真实可用内容旁，不放在 fallback。module 白名单为 match/schedule/statistics/player/team/bet/prediction/admin/account/public；phase 为 primary/advanced/form。同一导航、模块、阶段只记首次就绪。异步工作用 `captureTelemetryNavigation()` 在开始时捕获 token，结束时调用 `recordContentReady(token, module, phase)`；导航或身份改变后旧 token 被丢弃。此计时采用单调 performance 时钟，初次 document 从零开始，已观察的软导航从 router start 开始；没有 router start 时从首次观察开始，不解释为完整导航耗时。

v1 的 page/operation/error/ready/NAV_COMMIT 携带随机 navigationId、构建冻结的 clientRelease 和上报时 visibility。签名票据 release 仍表示签发服务器版本，两者不得混用。Web Vitals 保留原生来源路由与 navigationType/startTime 的有限投影，使用每个指标样本自己的随机 correlation ID（随样本更新保持），不附当前 SPA 导航 ID；该 ID 不表示不同指标已被归并成同一次导航，避免将晚到样本串到当前页面。v1 的导航上下文另带 lifecycle：hard/soft/bfcache/prerender/unknown、采集时的 startedHidden、隐藏后恢复标志、单调时钟起点和 activation 相对毫秒。BFCache pageshow(persisted) 创建新导航并拒绝旧 ready token，普通 visibility 恢复保持导航；这些生命周期字段来自当前 collector，不能推断 observer 挂载前未观察到的隐藏转换。Web Vital 原始异常值仍保留；完整浏览器 cohort 与旧客户端对照尚需集成实验。ready 作为独立 kind 保存于既有七天 raw 数据，以独立内容就绪指标进入面板，不混入 LCP/NAV_COMMIT。

局部 error boundary 通过 `recordClientBoundaryError(error)` 复用同一投影；无需自行读取或上传异常内容。客户端错误 v1 附固定 source（window_error/unhandled_rejection/boundary）、异常类别及可选 s1 fingerprint。fingerprint 只取自身 data property stack 的前 8192 字符中至多五个 Next 静态 chunk basename/数字行列；无此 data property 时可用 ErrorEvent 的文件/行列元数据。仅对归一化 frame 计算有界 64-bit hash，原文、URL、函数名、message 和 stack 均不上传、不持久化，也不调用任意 stack getter。没有受控 frame 时缺省 fingerprint；它是排查线索而非唯一根因证明。四个历史错误路由仍由页面 owner 复现关闭。新增字段不扩大接收端访问权限、保留时长、批次或队列预算。

## 数据字段与身份

| 字段 | 来源/约束 |
| --- | --- |
| id / at | 随机事件 UUID / 客户端 UTC 毫秒；接收只允许过去 15 分钟、未来 1 分钟 |
| session | 同标签页随机 UUID；30 分钟不活跃更新，sessionStorage 被禁用时内存降级；与鉴权 session/cookie 无关 |
| account | 服务端 HMAC(`rivalhub-product-account-v1:` + 内部 userId)，仅接收端批次字段；匿名为 null，不接收浏览器声称的 userId |
| role | Header 授权快照：anonymous/user/season_admin/super_admin；队长/代表不是全局授权角色，通过路由/操作区分，不猜测其权限 |
| release / environment | 签名票据中的构建 commit 与 preview/production；生产需检查 release 不是 unknown |
| route / scene / eventId | 路由模板、canonical 赛事模板 major/rivals/other（无赛事为 site）、公开赛事 UUID；未加载对应 layout 时可能是 site |
| kind / navigation / filters | page/filter/operation/error/performance/ready；navigate/history/reload；明确允许的类别/selected |
| operation / variant / phase | 注册表中的动作名、固定子类型、start/success/rejected/unknown |
| operationId / durationMs / outcome | 单次调用关联；操作或性能指标最多一小时的整数毫秒耗时；applied/stale/noop（存在时） |
| metricName / score | 仅 performance 事件；固定指标名；CLS 使用无单位 score，其他指标使用 durationMs |
| client | 可选设备/浏览器/系统/文档来源固定分类；无原始 UA、版本、URL 或推广参数 |
| errorCode / requestId | 已知错误枚举或固定未知分类、既有 UUID；不保存 message/stack/cause |
| received / expires / bytes | 接收 UTC、批内最早事件 at + 七天、未压缩事件 JSON UTF-8 字节数（预算口径） |
| events_gzip / summary | 原始事件 gzip BLOB；同批七天到期的无身份计数投影，后者不是已批准的长期汇总 |

票据是仅接收可用的签名 envelope，最长 24 小时；不授予业务或查询权限，不写入 D1/日志/sessionStorage。浏览器不持有签名密钥、账号 HMAC 密钥或查询凭据。常规 Header 重渲染或约 20 小时的低频自动续签可更新票据。隐藏页面不续签，重新可见时检查；续签网络等待最多五秒，超时/暂时故障保留状态并最多每小时重试。真正过期且无法续签时才暂停入队，恢复后继续；过期期间和隐藏页离线丢失不补造。身份切换会忽略旧续签响应，旧账号待完成动作不会进入新账号；同身份续签保持诊断会话和队列，未 ACK 批次仍使用原票据/批次 ID。角色是签发时快照，不用遥测做权限判断。

登录、退出、账号归并成功时尽力送出原身份的末批，然后清空队列及会话，等待新的 Header 身份。身份切换后尚未完成的旧调用不会计入新账号。匿名会话不与登录账号拼接；不同产品、Preview、Production 必须使用不同的 account key、signing key、D1 和 operator key；不复用 Mizar、Auth 或 Better Stack secret。账号 HMAC 可关联同产品账号，属于假名化而非匿名数据。

## 交付、预算与免费边界

队列仅在内存保留最多 256 条；每批最多 32 条/24 KiB；没有本地事件文件、IndexedDB、录屏或离线长期补传。5 秒网络超时；同批 UUID 最多尝试三次，60/120 秒退避；超 15 分钟/溢出丢弃，不阻止业务。不额外 flush 每个点击。采集异常不更改返回结果，不重放业务调用。

接收逐字段拒绝未知数据；签名、来源和有效期都要匹配；管理员读取需独立 Bearer。全局每天至多 5,000 批、8 MiB 原始 JSON；每票据滚动一小时最多 120 批，使用 `(ticket, received)` 索引；正常每分钟一批不因累计活跃两小时停收。D1 事务内 INSERT 与 usage counter 同步更新，重试不重复计数；正常到期或清理积压不阻断新批次接收；查询持续排除到期数据，维护异常由独立任务失败暴露。实际 D1 读写/存储额度耗尽仍可能导致接收 503，不能声称维护失败永远不影响可用性。恶意/无效请求仍可能消耗 Worker 请求额；必须使用 Workers Free 的硬停机额度，不升级 Paid 或开超额计费。

截至 2026-10-17，官方 [Workers Free](https://developers.cloudflare.com/workers/platform/pricing/) 为每日 100,000 请求、每次 10ms CPU；[D1 Free](https://developers.cloudflare.com/d1/platform/pricing/) 为每日 5M rows read、100k rows written；[D1 限制](https://developers.cloudflare.com/d1/platform/limits/) 为单库 500MB、账户 5GB。索引、删除、事务计数器和汇总同样耗写额度；一个批次不等于一行计费。以上是计划上限，不是当前共享账户余量。上线前必须确认团队已有占用，保留免费安全余量；额度不足则保持关闭/停收，不自动扩容或改 Vercel 缓存。

复现本地请求/体积/客户端耗时：`pnpm telemetry:measure`（需 Playwright Chromium）。它执行真实 browser client bundle，再把实际事件形状写入本地 SQLite（含索引）；不是 D1 计费报告，也不是全部 Next chunks 的增量。真实 workerd/D1 入口和并发 ACK 的自动证据见 `tests/unit/telemetry/worker.test.ts`。量测结果随代码和机器变化，以 PR 的精确提交证据为准。

## 原始数据压缩

Worker 验证 JSON 白名单后，用原生 `CompressionStream("gzip")` 压缩每批原始事件，仅存 `events_gzip BLOB`，不再另存未压缩 events TEXT。客户端仍发送有界 text/plain JSON；没有引入压缩 SDK、额外点击请求或 Vercel 缓存写入。客户端 core gzip 只是脚本体积，不能证明原始数据已压缩。

`summary` 是同批次内的无身份维度/计数/耗时投影，与原始压缩数据同删，供明确获批后的日汇总读取，避免每天解压全部 raw。账号/会话索引保持可检索；受控查询每页最多二十批，逐批解压且每批解码上限 24 KiB，仍返回原 events JSON 供现有 CLI 使用。解压失败只使该次查询失败，不触发明文存储回退。压缩不是加密，也不改变访问权限、TTL 或恢复副本限制。

新旧事件字节、gzip 字节、附加计数投影、含全部索引的 SQLite 空间、压缩 wall time 分开量测，见 [终审修正证据](../archive/product-telemetry-review-2026-10-17/README.md)。初始化 schema 使用 gzip 格式；已有数据库只应用对应的独立编号迁移，不重跑建表文件。性能事件扩展不修改该 schema。

## 保留、清理、恢复

原始事件和所有账号/会话索引在同一 batches 表，按批内最早事件时间加七天到期。所有查询立即排除到期批次；小时任务分块独立提交，每块最多 500 批、每轮最多 5,000 批（等于每日接收上限），正常集中到期可在一次任务内清完。更多故障积压在后续轮次继续处理，清理失败不会让接收端因“有过期行”而停收；成功提交的块不随之后失败回滚。`/admin/usage.cleanup` 提供积压批数和最早到期时间，维护者应核对超过一轮的积压及 scheduled invocation 失败。行删除可能延迟到维护成功；停收不会关闭维护。清理时间不刷新 event time，也不通过重发延长已有批次寿命。

**长期汇总默认关闭，保留天数尚未批准。** 仅设置 `RETENTION_APPROVED=1` 仍不会写日汇总；必须另外批准并配置 `SUMMARY_RETENTION_DAYS`（技术范围 1–90，缺省/0/非法值关闭新汇总）。90 天仅为讨论候选和技术上限，不是默认值或已批准政策。明确启用后，对关闭的 UTC 接收日汇总一次，维度仅日期、版本、环境、角色、场景、路由、动作/子类型/阶段/outcome，值仅次数、耗时总和。没有 account/session/operationId/eventId/requestId、自由文本或可回放路径。每行 expires 固定为该接收日结束时刻加批准天数，查询与删除都按 expires；修改配置或重跑不能延长已有行。关闭新汇总仍删除已到期汇总。rollup marker 保证重跑不双算；已汇总接收日拒绝迟到的在途写入，后续重试按新的接收日处理（仍受 15 分钟事件年龄限制）；usage/marker 最长八天，仅用于预算/进度。汇总没有独立用户数、留存曲线或个人轨迹，不能用于跨产品追踪。七天内未成功汇总可能损失基线，不能延长原始留存来补算。

**恢复副本必须另行确认**：[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) 始终开启，Free 恢复窗口为七天，不能将其描述为已关闭的可选备份。应用七天删除不能证明恢复历史立即物理擦除；被删行可能在随后恢复窗口中存在：正常清理约为事件后十四天再加调度延迟；清理故障还可能更久，十四天不是绝对上限。七天读端 cutoff、SQL DELETE 和 provider 存储介质/备份的物理擦除是不同边界；本实现不能证明所有副本在七天内物理消失。若要求“包括 provider 恢复副本在内绝对七天”，这个候选不能直接获批上线，需要先确认可关闭/缩短恢复历史的能力或更换存储方案。恢复时保持 ACCEPTING=0，先执行过期清理并核验所有查询 cutoff、预算进度，再经确认开流量；旧备份不应重新成为可读原始事件。遥测不进入 RivalHub PostgreSQL DR 备份，不额外导出 raw 或建长期账号映射表。

`RETENTION_APPROVED=0` 时既不接收也不运行持久清理；线上一旦启用后紧急停收只改 ACCEPTING，必须保留清理。不得在已存数据时取消维护而声称仍执行七天保留。

## 管理后台分析

`/admin/telemetry` 仅向超级管理员开放。RSC 首次读取与后续 Server Action 都经 server-only adapter 核对当前超级管理员授权，再读取缓存或查询独立 Worker 的 `GET /admin/analysis`。`PRODUCT_TELEMETRY_ENDPOINT` 与 `PRODUCT_TELEMETRY_ADMIN_KEY` 仍只存在服务端；网站查询密钥可使用 Worker 专用 `DASHBOARD_KEY`，它只允许 GET `/admin/dashboard`、`/admin/analysis` 和 `/admin/history`，不能调用原始事件、日汇总或用量 operator 端点。原 `ADMIN_KEY` 保留运维权限。旧 `/admin/dashboard` 保留原聚合协议，供网站与接收端分步更新；新面板要求先更新接收端，缺少配置或版本不支持时显示不可用，不回退到公开查询。

面板以产品概况、用户任务、页面体验、问题排查和数据质量组织短期观测；业务流程与长期趋势各自独立筛选。默认最近七天，支持 6/24 小时及最多七天的自定义日期。全局白名单包括范围、具体赛事、任务/操作、角色、页面、设备/浏览器/来源、导航类型、可见性与版本口径，聚合条件进入 URL，会话凭据不进入 URL。赛事名仅经超管页面读取受控目录；目录缺失保留匿名赛事标签。

短期窗口按接收时间选择，详情按客户端时间排序；北京时间自然日/小时分桶。读取最多最新 2,000 批、2 MiB 未压缩正文，额外独立版本目录保持未筛选的版本可选；命中预算明确截断。本次最早观测不证明之前数据已过期。客户端构建与票据签发版本分别查询，客户端版本缺失不回退成票据版本；已采集的构建标签与当前构建映射提供易读名称，未知提交保留短 SHA。没有可信发布时刻时不绘制发布时间标记。

Web Vitals 按同身份/会话、指标和样本标识取最新报告；ready 按同导航/模块/阶段去重，指标间不强行关联。旧性能样本缺标识单列。P50/P75/P90/P95 使用 nearest-rank；少于 20 个样本时隐藏趋势尾部分位数并标注少量样本。缺失不补零，窗口截断、覆盖、新鲜度、孤立报告和迟到结果各自显示。比较从两侧原始样本独立计算，展示双边样本量与设备构成，不平均分位数或自动作因果判断。

操作按窗口内 start 关联同身份/会话/operation/operationId 的最新终态，成功与其他结果耗时分开。任务以 start cohort 与注册表观察窗口计算成熟分母、窗口内完成、仍观察、明确取消和未观测完成；完成耗时只含成熟且窗口内完成的尝试。历史窗口允许读取窗口后至最长任务窗口加迟到余量的结果，用于同 cohort 跟随；全部读取仍受七天 TTL 与预算约束。七天内的重复使用仅按任务和北京时间不同日计数登录账号，不返回账号，不称长期留存率；匿名使用单列。

错误按页面、操作、分类与受控指纹归并；最多 100 个问题组、每组最近 30 条、100 个会话和选定会话最多 100 条事件。原账号、票据、operationId、session UUID、gzip 不离开 Worker，排查使用用途隔离的 SHA-256 短标识；requestId 按需展开。网站传输 owner 缓存最多 12 个结果、最多 60 秒且在原始样本过期前失效；每次读取缓存前重新授权，五秒超时、拒绝重定向、响应 1 MiB、结构校验。无常驻轮询；用量与到期积压为不随筛选变化的 UTC 全站事实。返回预算不是 D1 扫描或费用上限。

### 测量合同兼容与接入顺序

共享任务 wire type 读取 definitionVersion 1 和 2；当前定义常量为 2，计时 cap 仍为一小时。v2 的 elapsedCensored/activeCensored 只在对应计时**超过** cap 时传 true；等于 cap 不标记。报名观察窗口仍为 24 小时，不能从截断值推断真实时长。旧 v1 无标记样本独立归类，不追溯生成标记或混为 v2。业务确认回执使用 complete/confirm；真正呈现另记 result step 或 ready，不延迟 complete 等待 React 挂载。

ready 的目标兼容合同是可选 basis=navigation|demand，缺省为旧 navigation。navigation 保留导航到首次可用及异常原始样本；demand 从本次用户请求模块开始，需求 token 的真实导航 ID、模块和单调时刻只留内存。两种 basis 分组，不混算分位数。Web Vital 仅在确证源导航时关联，否则保持未知，不用当前 SPA 导航或 metric ID 拼接。

登录只在原 attempt/原 identity 记录已确认终态并进行既有 flush，随后 reset；不跨账号 carry。logout、换账号、DNT/GPC 或停收清除内存状态。任何交接不保存密码、表单内容或持久身份映射。

类型 provider 本身不改变客户端 emit 或 receiver 校验。必须先同步 receiver 的逐字段校验、短期/长期分析按定义版本及 ready basis 分组，之后客户端后继变更才发送 v2/censored/basis；部署顺序为 receiver 先、app 后，不能凭共享类型已合并认定接收端已支持。

### 任务采集

`task-contract.ts` 是任务定义/步骤/观察窗口 owner，`task-client.ts` 是内存状态 owner；`TaskBoundary` 仅在首次输入或明确提交时开始。登录/注册、资料、教育、个人/团队报名、阵容、BP、预测和成绩录入接入有限步骤。个人报名仅具备提交资格时发独立 exposure，不把普通访问视为可参与曝光。固定 validationReason 不读取字段值。内容呈现继续复用 navigation/ready，不能解释为读懂或找到答案。

任务报告携带随机 attemptId、定义版本、固定步骤与 phase；操作继续保留独立 operationId。OCR 重试共享当前地图尝试，成绩保存完成要求相应 UI 投影确认；非 OCR 回执与结果呈现遵循上述兼容合同。60 秒无交互暂停活跃计时，隐藏即暂停；异步结果切换步骤不重置交互时间，隐藏期间不恢复活跃计时；沿用分钟批量队列，无逐输入请求。attempt 仅内存，不跨刷新或身份变化恢复；非 OCR 已确认事实不能依赖组件继续挂载，登录请求在原身份结束。上报 durationMs/activeMs 保持协议一小时上限；短期个人经过时间按已关联起止时间差计算，活跃时间及长期聚合的 duration 达到上限时是截断观测。报名的观察窗口可更长，不能将 capped duration 当准确长周期。缺少完成只表示未观测；多人等待从业务记录读取。

### 业务流程读模型

超管 Server Action 经独立 PostgreSQL read model 输出聚合，使用自身 7/28/90 天与赛事条件，不附设备/客户端版本。报名审核按正式提交记录，教育认证按提交/审核记录，约赛按 proposal 起止，BP 按当前房间周期。缺少可靠结束时间计入缺失时长；仍等待对象保持等待，不反推完成时间。测试比赛排除。赛后资料复用既有工作台待办与撤回记录，按窗口内完赛比赛输出当前齐备/待办/待更正；缺少完赛时间单列，不推算首次齐备或全部历史返工周期。持久记录当前状态无法重建任意历史时点，浏览器 task 与业务对象不未经定义联接。

### 可修订长期聚合

`history-contract.ts` 与独立 `history.ts` 拥有新日聚合；`HISTORY_RETENTION_DAYS` 默认 0，与旧 `SUMMARY_RETENTION_DAYS` 分开，合法范围 1–90。启用后从实际处理开始累积，无 raw 回填承诺。短期关联表保存用途隔离的 SHA-256 样本键与有限维度，不保存原账号/session；最早原批次到期即失效，重复报告不得续期。任务、操作、性能更新按单一样本合并；日聚合保留计数、分母与分布桶，按采集版本/任务定义/导航类型区分。

北京时间日桶在六天修正窗口内重算，封存后保持；未启用完整日、暂停、超预算或原始数据已丢失标记不完整。未处理批次与处理游标可查询，每轮最多处理 16 批/384 KiB，合并事务后公平刷新两个仍在保留范围内的日快照；七个修正日可能跨四轮维护才更新，受影响但未刷新的快照标为不完整。含原始清理与旧汇总的最坏 SQL 路径受 50 次预算测试保护，实际 provider CPU/扫描仍需部署验收。原始 TTL 清理独立于聚合成败。日分布可合并后取近似分位数，显示所在桶上界并以观测最大值裁剪；不能平均日分位数。长期只展示可加次数与分布，不相加日去重人数。关闭后停止新增但继续过期删除；恢复前先停收、执行过期清理，D1 恢复副本边界与原始数据一致。

`GET /admin/history` 仅返回有界聚合与处理状态，默认关闭时明确返回 disabled。未封存日从现存去重样本读取，并以最多 16 批/384 KiB 的未处理 raw 叠加，查询不移动维护游标、不写库；尾部超预算单独标记，pending 不自动等于故障。日快照最多 8,192 个分布桶组、1.5 MiB，超出标记不完整；查询在 D1 内先应用白名单条件，再返回最多 90 个每日计数及 512 个期间分布组。版本、采集/任务定义和导航类型保持独立，分布组达到预算时明确截断；指定条件后仍可读取较早的匹配分组。网站不接收完整的多维日快照，90 天趋势不受未筛选明细传输预算截断。两种长期聚合均须在部署时批准保留天数并检查 provider 预算；本实现不自动启用。

### 独立滚动长窗口投影

`getLongWindowSummary(input)`（`src/lib/telemetry/dashboard.ts`）与 `GET /admin/long-window` 使用原 analysis 筛选和 rolling 请求时间含义，独立输出 `LongWindowSummary`，不把 raw Analysis 的截断 totals 伪装为完整。`requestedRange` 保留请求，`effectiveRange` 表示留存限制后的窗口，`coveredRanges` 仅列可确认完整的范围。完整北京时间日读取日聚合与有界未封存尾部；首尾不足日读取有界 raw，半开边界不重复午夜事件。raw 边缘先读本段，再仅为存在 start 的任务/操作补读后续；同一查询的 raw/tail 共用最多 2 MiB/2,000 批预算。性能更新以用途隔离样本键排除聚合/边缘重叠，再跨两个 raw 边缘取最新值。样本键不投影到应用。

`counts` 是实际读到的可加次数，覆盖不完整时只是 observed counts；`distinctSessions` / `distinctAccounts` 为 null，不累加日去重数。`metrics` 为可合并分布桶，不能平均日分位数。`coverage.segments` 分别说明 history+tail 与 raw_edge 的完整、partial、unknown 范围与原因；raw 留存最早边缘受批内最早事件 TTL 影响，缺口不补造。`pendingTailBatches`、`tailBudgetTruncated`、`metricGroupsTruncated`、`rawBudgetTruncated`、`retentionUnknown` 与 `seriesOmitted` 分开表达；该 summary 不提供 series，原 raw 的前 12 series 省略状态仍保留。

历史不具备的 browser/source/visibility、scope、navigationType 条件，以及 ticket release、missing eventId 或单 session 条件，返回 unsupportedDimensions 与 unsupported 状态，counts 为 null；不把未过滤历史冒充匹配结果。原始账号/session 诊断保留既有 `/admin/events` 的有界 cursor；raw Analysis 仍受原预算保护。F 的 UI 消费应展示实际范围和覆盖分类，不能用这些独立 summary 替换所有 raw 诊断。

后台常驻缓存只保存已校验结果的编码 Buffer，payload 与 key 的 UTF-8 字节合计最多 2 MiB / 12 项；过期和超预算立即逐出。返回调用者的解析对象不保存在缓存，缓存命中重新解析，避免调用方修改缓存。另有 4 MiB 在途响应预约、单响应 1 MiB 上限，保留按 key 的 singleflight；并发满时不新发查询。字节预算约束编码表示和响应读取，不是 V8 对象或进程 RSS 的上界。缓存有效期还受源数据最早 expiry 约束。

## 基本查询与版本比较

运维 CLI 凭据在受控终端注入 `PRODUCT_TELEMETRY_ENDPOINT`、`PRODUCT_TELEMETRY_ADMIN_KEY`；按账号定位额外需要同环境 `PRODUCT_TELEMETRY_ACCOUNT_KEY`。工具不创建/打印凭据，不跟随重定向。

```sh
pnpm telemetry:query session <diagnostic-session-uuid>
pnpm telemetry:query account <internal-user-uuid>
pnpm telemetry:query summary 2026-10-01 2026-10-17
pnpm telemetry:query usage
```

`/admin/events` 必须指定 session 或 account，每页最多 20 批；按 received/id/ticket 三元 cursor 翻页，直接使用返回 nextCursor 的 before/id/ticket 参数，包含相同毫秒也不漏数。CLI 只展示第一页并保留 truncated/cursor，不暗示结果完整。`/admin/summary` 一次最多 31 天、5,000 组，truncated 时按更短时间窗口查询；`/admin/usage` 返回最近八个接收日的成功批数/未压缩字节量及到期清理积压。仅已关闭日期有汇总，接收时间是分桶依据。

旧 summary CLI 的 UTC 接收日仅用于报告次数与总和；任务与版本体验比较使用上述分析端点的明确定义、开始 cohort 和缺失标识，不从旧 summary 恢复任务完成率或分位数。

## 上线前交回确认的清单

1. 确认独立 Worker/D1 所属账户、**Free 计划**和共享额度余量；核对 ALLOWED_ORIGIN 与 separate preview/production 资源；不绑定 Mizar #398。
2. 确认账号假名化目的、管理员查询权限及隐私说明；确认七天 active raw、物理清理时限、D1 恢复副本取舍、独立汇总的目的和具体保留天数；未获单独批准保持 SUMMARY_RETENTION_DAYS=0，不因 raw 获批而开启。未确认部署与 raw 保留时其余开关也保持 0。
3. 由维护者批准并注入四类最小凭据：app/Worker 共用的 signing key、app/受控账号查询用 account key、独立 operator key、部署所需 provider 权限。本 PR 不创建持续凭据或授权。
4. 复制 review-only `wrangler.example.jsonc` 到受控部署配置，填批准的 D1 ID；在新空的独立 D1 应用 schema.sql，检查 schema/索引和权限。此 SQL 不是 RivalHub PostgreSQL migration，不在应用 release 自动执行；后续演进需独立编号迁移，不重跑初始化文件。
5. 经批准先在隔离 Preview 验收：身份切换、Major/Rivals、返回/筛选、业务拒绝/响应丢失、Worker 停机、重试去重、按账号/会话查询、跨 origin/无授权拒绝、七天读端边界、5,000 批集中到期、清理失败下继续接收与恢复前清理、26 小时同页采集及续签身份变化。
6. 对比新旧构建的实际 Next 路由资源 gzip/加载与 hydration，结合现有 Speed Insights 复核（core 独立 bundle 量测不等于全站增量）。测量真实 Worker CPU/请求数、D1 rows_read/rows_written、数据库 size（含索引/实际获批天数的汇总）、各共享免费额度。核对每批最多 50 个 D1 查询限制，本实现通常 7 个以内；保留失效/拒绝请求开销。超过预算保持停收，绝不加付费能力。
7. 单独批准生产部署后才能启用 PRODUCT_TELEMETRY_ENABLED、ACCEPTING、RETENTION_APPROVED；汇总天数需另行批准；核查 build release 标签与实际签名版本。小范围比较代表性等长窗口，不拿本地量测承诺线上成本。
8. 回滚先停 app 采集/Worker ACCEPTING；不更改业务 cache，不撤掉既有原始清理。密钥轮换会使旧票据失效；账号 key 轮换会改变 lookup，需要明确旧七天窗口处理，不能建立永久映射补连。

## 可执行的独立接收端准备

`pnpm exec tsx scripts/telemetry/prepare.ts inventory --account <approved-account-id>` 使用已有 `CLOUDFLARE_API_TOKEN` 只读列出 D1/Worker 的名称、ID 和 D1 大小；无 token 时明确失败，不登录、不创建资源、不把未查询到当作不存在。结果标记分页不完整，不能拿第一页证明目标不存在。另从 Cloudflare account dashboard 核实 Workers **Free**、当前 UTC 日请求量、D1 reads/writes 与总存储；记录核验时间和余量。若账户已是 Paid，则不得把其“免费包含量”当作免费硬停机方案直接部署，需另行选择 Free 账户或批准的免费隔离方案。

建议资源名是 `rivalhub-product-telemetry-preview` 和 `rivalhub-product-telemetry-production`，每个名称对应各自一个 Worker 和一个空 D1。它们是待批准的新资源名，不能据此断言已存在。无需 R2、KV、Queue、Durable Object、域名购买、Zone 写权限或 Mizar 绑定。使用账户现有 workers.dev 子域提供 HTTPS；若账户尚无子域，建立该公开端点也是应批准的配置动作。

获得目标资源创建许可及已有受控 provider 访问后，按以下顺序执行；不要在未批准环境运行写入命令。Wrangler 是固定版本的一次性 CLI，不改应用依赖或锁文件。

```sh
# 本节云端命令依赖已批准的 CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN。
# 先 inventory；目标同名资源存在时检查绑定、schema 和数据，不覆盖或重跑建表。
pnpm exec tsx scripts/telemetry/prepare.ts inventory --account "$CLOUDFLARE_ACCOUNT_ID"
pnpm dlx wrangler@4.151.1 d1 create rivalhub-product-telemetry-preview
pnpm dlx wrangler@4.151.1 d1 create rivalhub-product-telemetry-production
```

记录各新库返回的实际 UUID，再分别生成配置（以下为 Production；Preview 要用自己的 UUID 和固定 Preview origin）：

```sh
pnpm exec tsx scripts/telemetry/prepare.ts config \
  --account "$CLOUDFLARE_ACCOUNT_ID" --database "$RIVALHUB_TELEMETRY_D1_ID" \
  --origin https://match.starfie1d.top --environment production \
  --output .agent-tmp/telemetry/production.json
pnpm dlx wrangler@4.151.1 d1 info rivalhub-product-telemetry-production \
  --config .agent-tmp/telemetry/production.json
pnpm dlx wrangler@4.151.1 d1 execute rivalhub-product-telemetry-production \
  --config .agent-tmp/telemetry/production.json --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"
```

确认 `version: production`、账户/UUID 匹配，并且上面的用户表列表为空；否则停止初始化，先检查已有 schema，不能使用 DROP/清库绕过。只对已批准的新空库应用以下文件，并核对当前 schema 中的表和显式索引均存在。Preview 同样独立执行。

```sh
pnpm dlx wrangler@4.151.1 d1 execute rivalhub-product-telemetry-production \
  --config .agent-tmp/telemetry/production.json --remote --file workers/telemetry/schema.sql
pnpm dlx wrangler@4.151.1 d1 execute rivalhub-product-telemetry-production \
  --config .agent-tmp/telemetry/production.json --remote \
  --command "SELECT type,name FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name"
pnpm dlx wrangler@4.151.1 deploy --dry-run \
  --config .agent-tmp/telemetry/production.json --outdir .agent-tmp/telemetry/bundle
```

生成器只在忽略目录写新文件，不覆盖已有配置；main 使用绝对本地路径，避免 `.agent-tmp` 下相对路径错误。它明确启用 workers.dev、关闭 Preview URL/Workers 日志、设置小时 cron，并保持 `ACCEPTING=0`、`RETENTION_APPROVED=0`、`SUMMARY_RETENTION_DAYS=0`。`--dry-run` 只构建，不证明数据库存在、资源额度、cron 实际执行或线上 CPU 达标。

### 凭据与网站配置的最小清单

所有值经批准后在受控终端生成/注入，不出现在参数、PR、构建日志或聊天中；每个环境各自生成三份至少 32 字节随机密钥。Worker secret 文件使用忽略目录和 0600 权限，注入后安全删除；不能复用 Mizar、应用会话或其他服务的密钥。

| 用途 | Worker | Vercel 项目对应环境 | 受控运维终端 |
| --- | --- | --- | --- |
| 接收票据验签 | secret `SIGNING_KEY` | Secret `PRODUCT_TELEMETRY_SIGNING_KEY`，与该 Worker 相同 | 不需要 |
| RivalHub 账号 HMAC | 不需要 | Secret `PRODUCT_TELEMETRY_ACCOUNT_KEY` | 仅账号定位时使用同值 |
| 运维查询授权 | secret `ADMIN_KEY` | 不配置到浏览器 | 运维使用 `PRODUCT_TELEMETRY_ADMIN_KEY` |
| 网站面板查询 | 独立 secret `DASHBOARD_KEY` | 服务端 `PRODUCT_TELEMETRY_ADMIN_KEY`，与 DASHBOARD_KEY 相同 | 不需要 |
| 接收 URL | 路径 `/v1/batches` | Config `PRODUCT_TELEMETRY_ENDPOINT=https://<worker>.<subdomain>.workers.dev/v1/batches` | 同 URL |
| 允许的网站 | `ALLOWED_ORIGIN` | Config `PRODUCT_TELEMETRY_ORIGIN`，必须与 Worker 相同 | 同 origin |
| 开关 | `ACCEPTING`、`RETENTION_APPROVED`、`SUMMARY_RETENTION_DAYS` | Config `PRODUCT_TELEMETRY_ENABLED=0`，经开流量许可后才为 `1` | 不需要 |

Provider 权限与上表运行时密钥不同。先复用已有获批的访问；若需要新建 token，先明确到期时间、账户范围和用途并获批。读取资源需要 D1 Read / Workers Scripts Read；创建独立库、应用 schema 和部署所需的 D1 Edit / Workers Scripts Edit 可能覆盖账户内多项资源，不能声称按名称便自动隔离。若平台权限不能限到两个目标，由 owner 执行相应命令或明确批准账户范围；不因此索要 Global API Key、Zone、R2 或业务数据库权限。Vercel 只需目标 `rival-hub` 项目的指定 Production/固定 Preview 分支环境变量管理权限，不扩展到团队其他项目。

经批准可将只含 `SIGNING_KEY` / `ADMIN_KEY` 的受控 JSON 文件通过 `wrangler deploy --secrets-file <private-file>` 与全关配置一起部署，先检查未授权读取为 401、跨 origin 为 403、合法 origin 停收为 503。这个部署仍不接收事件。获得 raw 留存及 Preview 测试流量许可后，把 Preview 配置中的 `RETENTION_APPROVED`、`ACCEPTING` 改为 `1` 再部署；汇总仍为 `0`，Production 继续关闭。不能用默认全关文件覆盖已启用且有数据的接收端，否则会同时关闭清理。

环境变量修改不会改变已经构建的 Vercel deployment。开流量需要为对应网站环境构建并部署新的候选，遵循 [发布规范](release.md) 的 smoke/routing 门槛；不可把已上线的 v2.18.0 当作 fresh retry 来绕过配置发布，same-tag resume 本就跳过构建。实际 Production 配置发布方式、exact commit/tag 和开流量时间须纳入同次确认。停收时先令 Worker `ACCEPTING=0`；已批准的 `RETENTION_APPROVED=1` 与小时清理应继续。

### 如何证明浏览器、接收、存储和读取一致

在经批准的隔离 Preview 配置发布后，向受控进程注入上表 URL/operator key，并设置 `TELEMETRY_EXPECTED_COMMIT`（40 位构建 commit）、`TELEMETRY_EXPECTED_ENVIRONMENT=preview` 及已批准测试的 `TELEMETRY_ALLOW_LIVE_SMOKE=1`，运行：

```sh
pnpm exec tsx scripts/telemetry/verify-live.ts
```

脚本使用新建匿名 Chromium 会话访问实际网站首页，不 mock fetch、不注入客户端或票据、不执行业务写入。它检查真实网站 bootstrap 指向指定接收端，等待页面 observer 正常的一分钟批量请求，确认 CORS、无 Cookie/referrer、204 ACK，再凭独立 operator key 按该浏览器 session 读取 `/admin/events`。只有同 batch ID、精确版本/环境、anonymous 身份及 gzip 解压后事件完全一致才通过；再验证无凭据读取 401、错误 origin 接收 403。输出只有布尔值、计数和版本，不输出 ticket、session、账号或原始事件。异常只报固定阶段，不保存 trace/HAR。该测试会产生少量**真实匿名遥测数据**并按同一七天策略过期，显式许可变量不能代替用户授权。测试超时/失败不应触发业务重放。

这证明正常匿名页面链路，不替代登录账号、Major/Rivals、返回筛选和真实操作终态验收。后者在固定 Preview 上用获批测试账号按既有功能交互，确认同 operationId 的 start/result、账号和会话查询一致；不得用生产业务写入制造测试。到期、续签、配额、重试及维护故障使用已有 receiver/client/workerd 测试和隔离 Preview fixture 验证，不修改生产时钟、持久数据或保留开关。Production 开启后只运行匿名 smoke，并观察首个正常到期小时任务与 cleanup backlog。

真实用量证据需记录同一测试窗口前后 Workers 请求与 CPU 分位、D1 reads/writes/size（含索引）、网站新增请求/字节及 hydrate 影响。`/admin/usage` 的批数/未压缩 bytes 不是 provider 账单；5000 批是接收上限，不是承诺共享账户能承受的正常流量。缺少共享余量或实际 CPU/查询开销证据时保持停收，不能升级付费来补证据。汇总 `0` 时只可比较七天内仍可读的同长窗口；跨版本更长期比较必须另行批准具体汇总天数后启用，不能回补已经过期的原始事件。

性能批次摘要还保留浏览器生成的随机指标样本 ID 与报告时间（不是原始 web-vitals ID），只随原批次保留七天。查询端按该 ID 选时间最新的值，避免 CLS/INP 在隐藏、恢复后重复更新而被当成多次访问；INP 允许下降，不能使用最大值代替最新值。旧摘要没有样本 ID 时仅能作为历史报告计数，不能混入去重指标样本均值。

面板部署前，对既有 D1 按顺序应用尚未执行的 `workers/telemetry/migrations/0001_dashboard_index.sql` 与 `0002_product_history.sql`，再更新 Worker，最后按正式 release 流程发布网站。第二项新增独立历史聚合表，新库 schema 已包含；不重放初始化 SQL，不更改留存开关。面板按同一账号/会话内随机样本 ID 和报告时间选择最新性能值，乱序送达不回退；旧摘要缺少样本 ID 时单独显示数量，不混入均值。2,000 批是最近批次截断而非随机抽样，页面须明确显示不完整；查询索引优化接收顺序，但版本筛选仍可能扫描更多批次，不能把 LIMIT 当扫描成本上限。
