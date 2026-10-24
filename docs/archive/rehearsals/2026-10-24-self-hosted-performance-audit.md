# 自托管性能审查（2026-10-24）

审查基线：v2.21.11 / df3541f839285a75c9a80c56763b6c7952f8a74e。覆盖 79 个 page 与 6 个 layout 的源码入口；跟进数据库连接、主要公共 read model、权限读取、统计 Client 入口与 Cloudflare 产品遥测通道。此记录区分源码发现、单次运行测量和待发布验证；未执行所有身份、tab、赛事状态组合的浏览器验收。

## 运行证据

生产主机的单次快照：应用 RSS 约 242 MiB，systemd MemoryMax 512 MiB、CPUQuota 100%；主机 load 约 0.01，服务 NRestarts=0。该快照未显示资源饱和，不能代替高峰期观测。现有 Caddy 已启用 zstd/gzip，Next cache 写路径已有修正，未重复配置。

在生产主机上使用相同 TLS 验证的 PostgreSQL SELECT 1，对比连接闲置回收：

| idle timeout | 首次连接 | 立即复用 | 闲置 6 秒后 |
| --- | ---: | ---: | ---: |
| 5 秒 | 662 ms | 90 ms | 706 ms |
| 30 秒 | 665 ms | 94 ms | 95 ms |

这是有界单次对照；证明当前跨区重连有明显成本，不能推导全站 p95 收益。候选仅延长常驻 Next.js Node 进程的闲置复用，保留 Vercel 与 CLI 的短回收。

生产主机经过实际 Caddy、TLS 与压缩的匿名 GET 单次样本（回环解析，排除公网客户端链路）：

| 页面 | 完整响应时间 | 压缩下载字节 |
| --- | ---: | ---: |
| `/` | 1.329 s | 21,832 |
| `/stats` | 0.692 s | 103,400 |
| `/stats?tab=players` | 0.893 s | 318,233 |
| `/2026-nju-major/matches` | 2.121 s | 37,967 |
| `/2026-nju-major/bet` 排行榜视图 | 5.607 s | 50,507 |

这些请求的首字节约 45–58 ms。App Router 流式 shell 的早期首字节不能代表页面数据已完成；也不能直接用 curl 完整时间替代浏览器 LCP。

## Cloudflare 现有样本

以 D1 中仍未到期的 batches 为依据，按签名 release 和 summary 白名单维度读取；未导出账号、会话轨迹或 raw 正文。2026-10-23 UTC 的两次自托管版本样本：30eb5e3a 有 80 批 / 53,939 原始 JSON 字节；df3541f8 有 28 批 / 22,956 字节。

| 操作 | 30eb5e3a | df3541f8 |
| --- | --- | --- |
| 登录成功 | 4 次，平均 3,652 ms | 2 次，平均 4,644 ms |
| OCR 成功 | 3 次，平均 79,059 ms | 2 次，平均 20,255 ms |

保存选手统计合计 3 次成功，平均 585 ms；阵容提交 1 次成功，3,385 ms。样本很小且版本窗口不等长，不能据此声称回归或统计显著提升。OCR 已有优化，不重复覆盖现有工作。

页面记录较多的模板包括比赛详情（39）、比赛列表（31）、选手资料（27）、赛事队伍（27）、赛事首页（21）、统计（17）、推演（14）、首页（14）、BET（13）。这些是 page 事件量，现有 page/filter 没有加载耗时，无法计算按页面的性能分位数。缺少事件也不能证明页面正常或无人使用。

D1 当次控制台快照为约 1.57 MB，查询 p50 约 0.34 ms；账户 Free 使用约 8.3k/5M rows read 和 1.34k/100k rows written。共享额度随时间变化；未提高预算、启用长期汇总或变更计划。

## 交付与验证

| PR | 改动 | 证据与剩余边界 |
| --- | --- | --- |
| [#1053](https://github.com/Starfie1d1272/RivalHub/pull/1053) | 常驻 Node 数据库连接保温；db.query 数值型 pool/行数诊断 | 上述生产只读连接对照；尚未发布候选，生产费用和用户延迟待复查 |
| [#1054](https://github.com/Starfie1d1272/RivalHub/pull/1054) | 同一 RSC 请求内复用阶段事实；并行独立页面读取 | Major layout/page 从各自三次相同读取改为共用一次，6→3 为源码推导；未测候选缓存命中率 |
| [#1055](https://github.com/Starfie1d1272/RivalHub/pull/1055) | 三种免费预测榜单共用一次人群读取 | 生产只读 repeatable-read 对照 39→13 SQL，三种排序各 108 人，DTO 完全相同；没有数据写入 |
| [#1056](https://github.com/Starfie1d1272/RivalHub/pull/1056) | 按选中视图拆分统计中心 Client 组件 | 保留 SSR；本机 Google Fonts TLS 失败阻塞生产构建，实际下载量与耗时收益待验证 |
| [#1057](https://github.com/Starfie1d1272/RivalHub/pull/1057) | Cloudflare TTFB/FCP/LCP/INP 与 NAV_COMMIT | 25 项定向测试及最终完整 CI 通过；Worker 先于网站发布，实际浏览器入库待验收 |
| [#1058](https://github.com/Starfie1d1272/RivalHub/pull/1058) | 超级管理员按需读取进程和连接池快照 | 无探测 SQL、后台采样或新增持久化；候选尚未部署 |

## 页面覆盖

每个入口都经过源码第一轮读取。下表记录相关导入线索与本轮处理；“保留”仅表示本轮未发现足以实施的局部性能改动，不代表所有运行状态已排除问题。数据库入口共同受 #1053 影响，赛事 layout 的共享阶段读取受 #1054 影响。

| 源码入口 | 相关导入线索（非完整依赖图） | 本轮处理 |
| --- | --- | --- |
| `src/app/[seasonSlug]/announcements/page.tsx` | `@/lib/announcements/read-model, @/lib/data/public-seasons` | 检查公共目录/资料 read model、缓存与显式 DTO；本轮保留 |
| `src/app/[seasonSlug]/bet/page.tsx` | `@/lib/data/public-seasons, @/lib/auth/session` | #1055 三种排名一次读取；金融与个人读取保持原事务 |
| `src/app/[seasonSlug]/captains/page.tsx` | `@/lib/captains/data, @/lib/auth/session` | 检查当前阶段、投票/推演/选秀与本人状态；本轮保留 |
| `src/app/[seasonSlug]/community-awards/page.tsx` | `@/lib/auth/session, @/lib/community-awards/data` | 检查当前阶段、投票/推演/选秀与本人状态；本轮保留 |
| `src/app/[seasonSlug]/draft/captain/page.tsx` | `@/lib/auth/session, @/lib/draft/data` | 检查当前阶段、投票/推演/选秀与本人状态；本轮保留 |
| `src/app/[seasonSlug]/draft/page.tsx` | `@/lib/draft/data, @/lib/auth/session` | 检查当前阶段、投票/推演/选秀与本人状态；本轮保留 |
| `src/app/[seasonSlug]/info/page.tsx` | `@/lib/data/public-seasons, @/lib/season-public-info/read-model` | 检查公共目录/资料 read model、缓存与显式 DTO；本轮保留 |
| `src/app/[seasonSlug]/layout.tsx` | `@/lib/seasons/public-next-step, @/lib/registration/window` | #1054 复用阶段事实 |
| `src/app/[seasonSlug]/matches/[matchId]/page.tsx` | `@/lib/discipline/public-query, @/lib/matches/display-score` | 检查阶段、比分、阵容与统计读取；保留 fresh 权限/比赛状态，发布后需量测完整内容就绪 |
| `src/app/[seasonSlug]/matches/[matchId]/veto/page.tsx` | `@/lib/data/public-seasons, @/lib/matches/veto-room/read-model` | 检查阶段、比分、阵容与统计读取；保留 fresh 权限/比赛状态，发布后需量测完整内容就绪 |
| `src/app/[seasonSlug]/matches/page.tsx` | `@/lib/bracket/display-scores, @/lib/matches/display-score-data` | #1054 共享阶段事实；保留分阶段赛程 read model 与实时刷新边界 |
| `src/app/[seasonSlug]/page.tsx` | `@/lib/seasons/overview-read-model, @/lib/matches/read-official` | #1054 并行独立介绍、公告、结果与阶段读取 |
| `src/app/[seasonSlug]/players/page.tsx` | `@/lib/discipline/public-query, @/lib/players/directory-query` | 检查公共目录/资料 read model、缓存与显式 DTO；本轮保留 |
| `src/app/[seasonSlug]/predictions/page.tsx` | `@/lib/data/public-seasons, @/lib/auth/session` | 检查当前阶段、投票/推演/选秀与本人状态；本轮保留 |
| `src/app/[seasonSlug]/register/page.tsx` | `@/actions/register, @/lib/seasons/compatibility` | 检查资格、报名窗口与参赛上下文；保留实时校验 |
| `src/app/[seasonSlug]/stats/page.tsx` | `@/lib/data/public-seasons, @/lib/seasons/public-stage` | #1056 按视图加载；保留公开统计缓存与当前 tab DTO |
| `src/app/[seasonSlug]/teams/[entryId]/page.tsx` | `@/lib/stats/return-context, @/lib/stats/view-state` | 检查公共目录/资料 read model、缓存与显式 DTO；本轮保留 |
| `src/app/[seasonSlug]/teams/page.tsx` | `@/lib/competition-entries/public-directory, @/lib/seasons/public-results` | 检查公共目录/资料 read model、缓存与显式 DTO；本轮保留 |
| `src/app/admin/[seasonSlug]/announcements/[announcementId]/page.tsx` | `@/lib/admin/season-content, @/lib/announcements/read-model` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/admin/[seasonSlug]/announcements/new/page.tsx` | `@/lib/admin/season-content` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/admin/[seasonSlug]/announcements/page.tsx` | `@/lib/admin/season-content, @/lib/announcements/read-model` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/admin/[seasonSlug]/bet/page.tsx` | `@/lib/auth/session, @/lib/bet/data` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/admin/[seasonSlug]/captains/page.tsx` | `@/lib/captains/data` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/admin/[seasonSlug]/community-awards/page.tsx` | `@/lib/auth/session, @/lib/community-awards/data` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/admin/[seasonSlug]/discipline/page.tsx` | `@/lib/auth/session, @/lib/auth/admin-access` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/admin/[seasonSlug]/draft/page.tsx` | `@/lib/competition-entries/counts, @/lib/draft/data` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/admin/[seasonSlug]/information/page.tsx` | `@/lib/admin/season-content, @/lib/season-public-info/read-model` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/admin/[seasonSlug]/layout.tsx` | `@/lib/auth/session, @/lib/auth/admin-access` | 保留现有布局与权限边界 |
| `src/app/admin/[seasonSlug]/logs/page.tsx` | `@/lib/auth/session, @/lib/auth/admin-access` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/admin/[seasonSlug]/matches/[matchId]/page.tsx` | `@/lib/admin/matches/return-context, @/lib/admin/matches/workbench` | 检查阶段、比分、阵容与统计读取；保留 fresh 权限/比赛状态，发布后需量测完整内容就绪 |
| `src/app/admin/[seasonSlug]/matches/page.tsx` | `@/lib/admin/matches/postmatch-tasks, @/lib/admin/matches/operations` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/admin/[seasonSlug]/page.tsx` | `@/lib/admin/season-workspace/overview` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/admin/[seasonSlug]/post-event/page.tsx` | `@/lib/admin/season-workspace/post-event` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/admin/[seasonSlug]/prestart/page.tsx` | `@/lib/admin/season-workspace/major-prestart, @/lib/seasons/compatibility` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/admin/[seasonSlug]/registrations/page.tsx` | `@/lib/utils/season, @/lib/registrations/admin-review` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/admin/[seasonSlug]/settings/page.tsx` | `@/lib/auth/session, @/lib/auth/admin-access` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/admin/[seasonSlug]/test-matches/page.tsx` | `@/lib/auth/admin-access, @/lib/auth/session` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/admin/competitive-seasons/conversion-policies/page.tsx` | `@/lib/auth/admin-access, @/lib/auth/session` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/admin/competitive-seasons/page.tsx` | `@/lib/auth/session, @/lib/auth/admin-access` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/admin/education-verifications/page.tsx` | `@/lib/auth/session, @/lib/auth/admin-access` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/admin/invites/page.tsx` | `@/lib/auth/session, @/lib/auth/admin-access` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/admin/layout.tsx` | `@/lib/auth/session, @/lib/auth/admin-access` | 保留现有布局与权限边界 |
| `src/app/admin/logs/page.tsx` | `@/lib/auth/session, @/lib/auth/admin-access` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/admin/operations/announcements/[announcementId]/page.tsx` | `@/lib/auth/session, @/lib/auth/admin-access` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/admin/operations/announcements/new/page.tsx` | `@/lib/auth/session, @/lib/auth/admin-access` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/admin/operations/announcements/page.tsx` | `@/lib/auth/session, @/lib/auth/admin-access` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/admin/operations/feedback/page.tsx` | `@/lib/auth/session, @/lib/auth/admin-access` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/admin/operations/page.tsx` | `@/lib/auth/session, @/lib/auth/admin-access` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/admin/operations/season-info/[seasonSlug]/page.tsx` | `@/lib/auth/session, @/lib/auth/admin-access` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/admin/operations/season-info/page.tsx` | `@/lib/auth/session, @/lib/auth/admin-access` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/admin/page.tsx` | `@/lib/auth/session, @/lib/auth/admin-access` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/admin/seasons/new/page.tsx` | `@/lib/auth/session, @/lib/auth/admin-access` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/admin/settings/page.tsx` | `@/lib/auth/session, @/lib/auth/admin-access` | #1054 并行姓名与 scheduler health；补充进程快照 |
| `src/app/admin/users/page.tsx` | `@/lib/auth/session, @/lib/auth/admin-access` | 检查权限与对应管理 read model；本轮保留其 fresh 读取 |
| `src/app/announcements/page.tsx` | `@/lib/announcements/read-model` | 检查公共目录/资料 read model、缓存与显式 DTO；本轮保留 |
| `src/app/auth/confirmation/page.tsx` | `@/lib/auth/secondary-email-otp` | 检查认证/邀请/配对入口；保留 token 与权限实时校验 |
| `src/app/forgot-password/page.tsx` | `本地页面/组件` | 检查认证/邀请/配对入口；保留 token 与权限实时校验 |
| `src/app/integrations/dak/connect/page.tsx` | `@/lib/auth/session` | 检查认证/邀请/配对入口；保留 token 与权限实时校验 |
| `src/app/integrations/mizar/connect/page.tsx` | `@/lib/auth/session` | 检查认证/邀请/配对入口；保留 token 与权限实时校验 |
| `src/app/invite/page.tsx` | `@/lib/auth/session` | 检查认证/邀请/配对入口；保留 token 与权限实时校验 |
| `src/app/layout.tsx` | `@/lib/branding, @/lib/runtime/preview` | 公共导航与授权 island 隔离；#1057 扩展原有遥测 observer |
| `src/app/login/page.tsx` | `@/lib/auth/session, @/lib/auth/redirect` | 检查认证/邀请/配对入口；保留 token 与权限实时校验 |
| `src/app/my/competitions/page.tsx` | `@/lib/my/competitions, @/lib/auth/session` | #1054 并行参赛上下文与测试赛读取 |
| `src/app/my/layout.tsx` | `本地页面/组件` | 保留现有布局与权限边界 |
| `src/app/my/page.tsx` | `@/lib/auth/session, @/lib/my/workspace` | 检查私有任务/队伍组合与既有请求内上下文缓存；本轮保留 |
| `src/app/my/teams/page.tsx` | `@/lib/my/competitions, @/lib/auth/session` | 检查私有任务/队伍组合与既有请求内上下文缓存；本轮保留 |
| `src/app/page.tsx` | `@/lib/draft/data, @/lib/seasons/public-stage` | 检查公共目录/资料 read model、缓存与显式 DTO；本轮保留 |
| `src/app/players/[userId]/page.tsx` | `@/lib/postevent/presentation, @/lib/stats/return-context` | 检查公共目录/资料 read model、缓存与显式 DTO；本轮保留 |
| `src/app/privacy/page.tsx` | `本地页面/组件` | 静态文档/本地规则；本轮保留 |
| `src/app/reset-password/page.tsx` | `本地页面/组件` | 检查认证/邀请/配对入口；保留 token 与权限实时校验 |
| `src/app/rules/page.tsx` | `本地页面/组件` | 静态文档/本地规则；本轮保留 |
| `src/app/rules/spring/page.tsx` | `本地页面/组件` | 静态文档/本地规则；本轮保留 |
| `src/app/seasons/page.tsx` | `@/lib/matches/scope, @/lib/matches/competition-context` | 检查公共目录/资料 read model、缓存与显式 DTO；本轮保留 |
| `src/app/settings/competitive/page.tsx` | `@/lib/auth/session, @/lib/competitive/catalog` | 检查当前用户授权与个人数据读取；保留私有边界 |
| `src/app/settings/education/page.tsx` | `@/lib/auth/session, @/lib/education/validation` | 检查当前用户授权与个人数据读取；保留私有边界 |
| `src/app/settings/layout.tsx` | `本地页面/组件` | 保留现有布局与权限边界 |
| `src/app/settings/page.tsx` | `@/lib/auth/session, @/lib/my/readiness` | 检查当前用户授权与个人数据读取；保留私有边界 |
| `src/app/settings/password/page.tsx` | `本地页面/组件` | 检查当前用户授权与个人数据读取；保留私有边界 |
| `src/app/settings/security/merge/page.tsx` | `@/lib/auth/session, @/lib/identity/merge` | 检查当前用户授权与个人数据读取；保留私有边界 |
| `src/app/settings/security/page.tsx` | `@/lib/auth/session, @/lib/identity/linking` | 检查当前用户授权与个人数据读取；保留私有边界 |
| `src/app/stats/page.tsx` | `@/lib/stats/platform-query, @/lib/errors` | #1056 按视图加载；保留公开统计缓存与当前 tab DTO |
| `src/app/team-invites/[token]/page.tsx` | `@/lib/utils/date, @/lib/auth/session` | 检查认证/邀请/配对入口；保留 token 与权限实时校验 |
| `src/app/teams/[slug]/page.tsx` | `@/lib/auth/session, @/lib/teams/public-profile` | 检查公共目录/资料 read model、缓存与显式 DTO；本轮保留 |
| `src/app/teams/page.tsx` | `@/lib/auth/session, @/lib/teams/directory` | 检查公共目录/资料 read model、缓存与显式 DTO；本轮保留 |
| `src/app/teams/recruitment/page.tsx` | `@/lib/recruitment/contract, @/lib/config/cs2-positions` | 检查公共目录/资料 read model、缓存与显式 DTO；本轮保留 |

## 自托管实践与选择

- [Next.js 自托管指南](https://nextjs.org/docs/app/guides/self-hosting)建议由反向代理处理请求边界，保持流式响应和缓存语义。当前 Caddy 压缩与单实例可写缓存已具备；本轮不增加第二个缓存服务。若将来扩为多实例，再验证共享 cache、部署标识与失效一致性。
- [node-postgres pooling](https://node-postgres.com/features/pooling)说明请求应复用有限连接池；本轮保留 pool 上限并延长常驻 Node 的闲置复用。数据库仍在外部区域，预热连接不能消除每条 SQL 的跨区往返；优先减少重复查询和依赖外的串行等待。
- [React cache](https://react.dev/reference/react/cache)提供单次服务端请求内的去重。阶段事实用稳定 primitive key，当前会话与权限继续独立保持 fresh，不引入跨请求授权缓存。
- [Cloudflare SPA Analytics](https://developers.cloudflare.com/web-analytics/get-started/web-analytics-spa/)与 [Core Web Vitals](https://developers.cloudflare.com/web-analytics/data-metrics/core-web-vitals/)是核对导航与浏览器指标语义的参考。项目继续使用自有的路由模板协议；每个毫秒指标只代表其自身阶段，不能把流式 TTFB、NAV_COMMIT 和 LCP 混为一项。
- [Node.js process](https://nodejs.org/docs/latest-v24.x/api/process.html)提供进程内存和环境限制，[eventLoopUtilization](https://nodejs.org/docs/latest-v24.x/api/perf_hooks.html#performanceeventlooputilizationutilization1-utilization2)提供自启动累计事件循环忙碌比例。管理员快照按需读取，不增加常驻采样 timer 或持久化历史；ELU 不等于 CPU 使用率。

## 仍需发布后的证据

候选全部停在 PR，不包含 merge/release/deploy。Cloudflare 新协议需先更新兼容 Worker 再发布网站。发布后在相同版本窗口、相同路由/身份/设备组比较页面指标、连接等待与失败率，并核对现有免费预算。首次请求、预取、暖缓存与完整内容就绪分开记录；小样本只作排障线索。

本机 Google Fonts TLS 连接失败使 production build 与前后 bundle 量测未完成；PR #1057 的最终 CI 已通过 production build、静态、PostgreSQL、浏览器与 required gate。首轮预算超限和第二轮报名用例 flaky 的失败证据留在 PR 执行记录，最终第三轮完整运行成功；未放宽超时或检查门禁。CI 构建通过不能补出本机前后 bundle 差值。统计 Players 页单次压缩响应约 318 KB，仍值得用新增浏览器指标评估解析与交互成本；本轮保留现有 DTO 和完整统计语义。公开比赛详情仍包含多个有依赖的读取阶段，部署共享连接/去重后再判定剩余热点。公告编辑当前会先读管理列表再按 ID 选择，本轮未将低频路径作为独立优化 PR；若规模增大，应在原 owner 增加 scoped ID predicate。

没有通过压测证明容量上限，也没有遍历所有赛事生命周期和角色的浏览器业务写入；不以源码审查或 required CI 替代上线性能验收。外部 Auth/OCR 延迟需继续按其操作样本观察，当前数据不足以支持更换 provider。
