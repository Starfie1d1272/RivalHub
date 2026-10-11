# Partial Prefetching 会话过期时钟诊断

## 来源与版本

2026-10-11 线上 `/api/system/release` 真实 GET 200 返回 v2.15.12 / `c9b29ba0ab064dbd00b625daaa1ce600886a7c14`。Vercel deployment `dpl_5CkcNgQWSfwTYhaa6QTRcKZ79r73` metadata 一致，Next 16.4.0 / iron-session 9.0.1 / iron-webcrypto 2.0.0。main `b188b57f192b52dbf05c2193337aa8541e526d22` 的 session、teams directory/page、Header 与 Next config 在诊断前与该 Production commit 无差异。

用该 exact Production commit 的 detached worktree、冻结锁文件、canonical hermetic production build（不携带 DB/privileged credentials、不加载 .env）生成本地 server chunks/maps。此前工具只读 deployment tree 缺少 server map；本次是独立本地复建映射，**不是下载到了生产 source map**。同名 chunk/functions 及相同调用序列恢复；本地 minification 列有约 64–75 字符偏移，不能把线上 column 直接当作本地 map coordinate。按 function/call token 找到本地位置，再使用 TraceMap 映射源；此前“同位置”的简述以本段限定为准。

## 实际共享调用链

自然记录 `2026-10-11T17:02:44.879Z GET /teams`，requestId `jdk4n-1791738164735-14d9900c3e37`；同一 shared stack 也见 `/admin/settings`、`/admin/[seasonSlug]/settings`、`/my` 等。记录只有脱敏 framework cause，无 cookie/secret/session payload。

| 线上 stack | 本地 token column | 映射 owner |
| --- | --- | --- |
| I / `_0u4od0njr53si._.js:1:6154` | 6085 | iron-webcrypto `unseal`, index.js:192, `Date.now()` 检查 seal 到期 |
| M / :8486 | 8418 | iron-session `unsealData`, core.ts:354 |
| S / :11486 | 11418 | iron-session `createSession`, core.ts:645 |
| X / :14498 | 14429 | iron-session `getIronSession`, core.ts:896 |
| caller / :28871 | 28796 | `src/lib/auth/session.ts:48`, React cache getUserSession |
| teams s / `src_0hkhmzdj4w03y._.js:1:4861` | 4797 | `src/lib/teams/directory.ts:34`, 招募有效性所用 `new Date()` |

RivalHub 链：TeamDirectoryContent → getUserSession → getIronSession → createSession → unsealData → unseal → Date.now。后台 page 自己的 requireAdmin/requireSuperAdmin 和 /my 也进入该 canonical reader；React 可并行渲染 layout 与子页面，父 AdminLayout 的 connection 不替子页面建立阶段 barrier。HeaderViewer 已独立等待 connection，公共导航/全站反馈分别用 io + public cache；不能把这条堆栈笼统归因于 root layout、Header 或 OTel。

## 为什么 cookies 不够，为什么仍是 200

同时开启 cacheComponents 与 partialPrefetching。当前 Next 的 cookies 在 `prerender-runtime` 可返回 session cookies（RenderStage.ShellRuntime），不会等待 RenderStage.Dynamic。Date 扩展调用 io-utils，将该同步 wall clock 记为中断；Date 仍返回原值。finalRuntimeServerPrerender 的 onUnexpectedAbort 设置 resultIsPartial=true 并输出这条 framework error，留下 dynamic holes；实际 navigation 后的请求可动态完成。这不同于 domain exception、HTTP 500 或用户提交失败。

直接证据：一次无 cookie、无特殊 prefetch header 的只读 GET `/teams`，status=200、179235 bytes、x-vercel-cache=HIT；同一 requestId `8vzpt-1791738535443-3e80ba81ee9a` 在 `17:08:56.025Z` 对应上述 directory new Date prerender 日志。完整响应保留公开页面内容和目录加载 shell，不是 Application error 页面。`/seasons` 同次只读 GET 为 200，48248 bytes，requestId `4fnpd-1791738536503-e6caec3d5994` 的近期日志查询无命中。两个样本不代表全站 baseline，也不证明 Major 页面从不出现其它诊断。

## 频次与资源边界

用户提供的 24h 聚合为 /teams 3858、/admin 320、/admin/operations/announcements 298、season-info 290、operations 287、/my 170。当前 API 24h 原始/grouped 查询因 retention 返回 400，不能独立确认这组完整窗口。近 30m filtered log count 快照为 teams 39、admin 7、my 5、三条 operations 路由各4；这是日志数，不是独立用户/失败请求/500 数。pre-aggregated runtime error clusters 的 first/last 超出请求窗口，不能替代完整原始窗口。

证据证明了重复 runtime shell abort、日志输出、后续动态渲染/解密可能带来的额外工作；没有采集 CPU profile、执行时长、实例/重试归因、billing 或稳定请求分母，**不能量化 CPU 或费用影响**。缓存 HIT/单次 GET elapsed 也不能作为请求健康/资源总量指标。

## 修复与验证

唯一修改位置是 canonical getUserSession：在 cookies/解密前 await connection。会话有效性依赖实时过期与可撤销 registry，不能做 use cache 或复用旧 prefetch 的认证结论；connection 只延期 session-dependent islands，不改全站 dynamic、公共 cache、诊断设置或现有时间规则。teams 在 await session 后的真实招募时钟也因此进入 Dynamic。代价是 session-dependent 内容在 navigation/request 时才读取，公共壳与 fallback 保留。

新增6项 installed-Next runtime-store/real iron crypto 测试：重现旧 cookies→clock abort、修复后预渲染不触及 cookie/clock/registry、真实请求正常认证、匿名、实际 expired seal、撤销。运行原 main reader 时防 abort 回归失败；修复后通过。既有13项 auth guards + 8项 password mutation 共27项定向测试通过。类型、lint、architecture 与 hermetic build 按 PR evidence 核验。不接触生产 cookie、注册记录、余额、预测或 schema；不操作 Windows。

正式发布尚未授权；合并不等于线上诊断已经消失，发布后的同 deployment/window 自然运行验证与实际资源测量仍属 #571。

官方依据：[时钟诊断](https://nextjs.org/docs/messages/blocking-prerender-current-time)、[Partial Prefetching session shell](https://nextjs.org/docs/app/api-reference/config/next-config-js/partialPrefetching)、[connection](https://nextjs.org/docs/app/api-reference/functions/connection)。
