# 上线前审查

> 审查日期：2026-05-13。生产域名：`https://match.starfie1d.top`。

本文用于上线前最后一轮人工复核：先给出代码架构，再对照规则书中需要网站承载的功能，最后列出上线前剩余风险。

## 项目架构速览

RivalHub 是 Next.js 15 App Router 应用，部署在 Vercel，数据层使用 Supabase Postgres + Drizzle。所有业务写操作走 Server Actions；HTTP API Route 只保留定时任务入口。

核心分层：

| 层 | 路径 | 职责 |
|---|---|---|
| 页面层 | `src/app/` | Server Component 读库渲染公开页和后台页；少量 Client Component 负责表单、Realtime、倒计时 |
| 写操作 | `src/actions/` | 报名、审核、投票、选秀、赛程、录分、统计 OCR、赛季管理 |
| 数据模型 | `src/db/schema/` | Drizzle schema，所有赛事实体带 `season_id` 或通过赛季关联 |
| 赛制引擎 | `src/lib/formats/` | StageExecutor：round-robin / double-elim / single-elim / swiss / gsl-group |
| Bracket 适配 | `src/lib/bracket/` | 唯一允许直接调用 `brackets-manager` 的边界 |
| 鉴权 | `src/lib/auth/` | Supabase Auth email+password + iron-session；生产关闭邮件确认，不依赖 Magic Link |
| 设计系统 | `src/components/rivalhub/` | Tactical Grid 组件，供公开页和后台复用 |

关键公开路由：

| 路由 | 状态 |
|---|---|
| `/`、`/seasons`、`/[seasonSlug]` | 已实现 |
| `/rules` | 已实现，规则书 9 章已站内渲染 |
| `/[seasonSlug]/register` | 已实现，支持草稿、时间窗口、位置余量展示、NJUBox 链接 |
| `/[seasonSlug]/captains` | 已实现，投票 + Realtime/轮询刷新 |
| `/[seasonSlug]/draft`、`/[seasonSlug]/draft/captain` | 已实现，围观页 + 队长端 |
| `/[seasonSlug]/teams`、`/[seasonSlug]/teams/[teamId]` | 已实现 |
| `/[seasonSlug]/matches`、`/[seasonSlug]/matches/[matchId]` | 已实现，含 Bracket、赛前名单、时间协商、数据表、MVP 投票 |
| `/[seasonSlug]/stats`、`/players/[userId]` | 已实现 |

关键后台路由：

| 路由 | 状态 |
|---|---|
| `/admin/login`、`/login`、`/invite`、`/auth/callback` | 已实现 |
| `/admin/[seasonSlug]/registrations` | 已实现 |
| `/admin/[seasonSlug]/captains` | 已实现 |
| `/admin/[seasonSlug]/draft` | 已实现 |
| `/admin/[seasonSlug]/matches` | 已实现 |
| `/admin/[seasonSlug]/settings`、`/admin/seasons/new` | 已实现 |
| `/admin/invites`、`/admin/users`、`/admin/settings` | 已实现 |

## 规则书网站功能对照

| 规则书条目 | 网站承载内容 | 实现状态 | 证据 |
|---|---|---|---|
| 3.1 资格要求 | 段位门槛、身份类型、Steam/QQ/学号信息 | 已实现 | `src/lib/validators/registration.ts`、`src/types/season.ts` |
| 3.2 报名信息 | 基础信息、段位与 WE、位置、风格、经历、高光链接、反作弊承诺 | 已实现 | `src/components/register/RegistrationForm.tsx` |
| 3.2 地图熟练度 | 赛季配置图池；每图 5 档熟练度，至少 3 张能打，强图最多 3 张 | 已实现 | `src/types/season.ts`、`src/lib/validators/registration.ts` |
| 3.2 近两周 5 场截图 | 可选提交 1 个 NJUBox 分享链接，链接内建议包含近两周 5 场截图 | 已实现 | `RIVALS_REGISTRATION_CONFIG.screenshotCount = 1` |
| 3.3 报名审核 | pending / approved / rejected / waitlisted + audit log | 已实现 | `src/actions/admin.ts` |
| 3.3 位置主选上限 15 | 页面展示位置余量，提交和审核时服务端二次校验 | 已实现 | `src/actions/register.ts`、`src/actions/admin.ts` |
| 3.3 队长录取 | 候选人投票、前 8 生成队伍，票数决定顺位 | 已实现 | `src/actions/captains.ts` |
| 4.1 队伍构成 | 队长 + 4 首发 + 2 替补，队伍页展示 | 已实现 | `src/actions/captains.ts`、`src/components/teams/` |
| 4.2 蛇形选秀 | 6 轮蛇形、3 分钟倒计时、超时自动 pick | 已实现 | `src/actions/draft/picks.ts`、`.github/workflows/cron.yml` |
| 4.3 队内同位置约束 | 选秀时同主选位置最多 2 人 | 已实现 | `src/lib/draft/rules.ts`、`src/actions/draft/picks.ts` |
| 5.1 排位赛 | 8 队单循环 28 场 BO1，积分榜按规则排序 | 已实现 | `src/lib/formats/round-robin.ts`、`src/lib/standings.ts` |
| 5.2 正赛 | 8 队双败，常规 BO3，总决赛 BO5 | 已实现 | `RIVALS_STAGE_PLAN`、`src/lib/formats/double-elim.ts` |
| 5.3 BP 规则 | 网站记录地图、pick 方、起始边、比分；BP 本身线下手动执行 | 已实现到 v1 范围 | `src/actions/matches/results.ts`、`src/components/matches/MapByMapInput.tsx` |
| 6.1 比赛时间确认 | 队长提议时间、对方接受/拒绝、管理员强制指定 | 部分实现 | `src/actions/matches/scheduling.ts` |
| 6.1 赛前名单 | 队长提交 5 首发 + 最多 2 替补，开赛前 2 小时锁定 | 已实现 | `src/actions/matches/roster.ts`、`src/components/matches/MatchRosterForm.tsx` |
| 6.2-6.6 比赛执行 | 规则书展示流程；网站负责赛程、详情、录分、统计 | 已实现到 v1 范围 | `/rules`、`src/app/[seasonSlug]/matches/**` |
| 7 反作弊条款 | 报名反作弊承诺；规则书公示处罚 | 已实现 | `RegistrationForm`、`/rules` |
| 8-9 赛委会与联系方式 | 规则书公示 | 已实现 | `src/app/rules/page.tsx` |

## 上线前剩余风险

| 风险 | 影响 | 建议 |
|---|---|---|
| 时间协商是轻量版 | 已支持管理员设置最晚完成时间，并自动用 `最晚完成时间 - 24h` 作为队长协商截止；仍不支持多候选时间和截止后自动采用首个合法时间 | v1 可上线但需在运营流程中保留“管理员最终指定兜底”；后续补完整状态机 |
| RLS 未在迁移中落地 | Server Actions 直连 DB 不受影响；Realtime 直接读依赖 Supabase 侧策略 | 上线前在 Supabase Dashboard 核对 Realtime 三表读策略，避免公开订阅失败 |
| E2E 覆盖不足 | `tests/e2e` 目前只有首页 smoke，不覆盖报名→审核→投票→选秀→录分 | 上线前至少手动跑一遍生产或 staging 冒烟流程，并补 Playwright 关键路径 |
| 定时任务不在 `vercel.json` | 当前 `vercel.json` 为空，超时选秀由 GitHub Actions 每分钟调用生产 Cron endpoint | 保持 `.github/workflows/cron.yml` 的 `CRON_SECRET` 与生产一致；若迁回 Vercel Cron，需确认计划支持分钟级频率 |
| 文档曾混用 Magic Link 与 email+password | 生产实际使用 email+password，Supabase 邮件确认关闭 | 已统一为“生产不依赖 Magic Link”口径 |

## 上线检查清单

- [ ] 生产 Supabase 已应用 `drizzle/migrations/0000` 至 `0011`
- [ ] Vercel 环境变量与 `.env.example` 清单一致
- [ ] GitHub Actions secret `CRON_SECRET` 与 Vercel `CRON_SECRET` 一致
- [ ] Supabase Auth 邮件确认关闭，`/login` 注册后可直接登录
- [ ] Realtime 对 `draft_state`、`draft_picks`、`captain_votes` 可读
- [ ] Root 紧急账号可登录，至少一个 season_admin 邀请码可用
- [ ] `/rules`、报名页、后台审核、队长投票、选秀、赛程录分完成生产冒烟
- [ ] `pnpm type-check`、`pnpm test`、`pnpm build` 通过
