# RivalHub · 开发路线图

> 所有阶段均基于单赛事推进，但每个新增表/路由/组件都按多赛事抽象设计（带 `season_id`、走 `/[seasonSlug]/...`）。
> 每阶段结束 commit + push，在此文件更新 checkbox。

## 版本映射

| 版本 | 分支 | 覆盖阶段 | 目标 |
|---|---|---|---|
| **v1** | `main` / `dev` | Phase 1–12 | 2026 NJU Rivals（春季赛）正常运行 |
| **v2** | `v2` | Phase 11 Swiss 子 Phase | 2026 NJU Major（秋季赛）适配与准备 |
| **v3** | `v3` | 远期 | 泛用多游戏多赛制平台 |

---

## Phase 1 — 仓库搭建 ✅

- [x] Next.js 15 脚手架、依赖安装、shadcn 初始化
- [x] 目录骨架与桩文件（schema / actions / lib / types / components）
- [x] `.env.example`、`.nvmrc`、`components.json`
- [x] Vitest + RTL + Playwright 测试框架配置（hello-world 用例可跑通）
- [x] `CLAUDE.md` / `README.md` / `PHASES.md`
- [x] `docs/` 9 份架构文档
- [x] `pnpm tsc --noEmit` 通过
- [x] `pnpm build` 通过
- [x] `pnpm test` hello-world 通过
- [x] `pnpm db:generate` 离线生成迁移 SQL（不连接 DB）

---

## Phase 2 — 数据层

- [x] 创建 Supabase 项目（Postgres + Auth + Storage）
- [x] `pnpm db:push` / 直接 SQL 迁移推送所有表
- [ ] RLS：默认拒绝所有，按表逐条开放最小权限（暂缓，Phase 12 前完成）
- [ ] Storage bucket：`registration-screenshots`（暂缓；截图改用 NJUBox 分享链接）
- [x] 运行种子脚本：示例赛季占位行
- [x] 验证 Drizzle Studio 可查询

---

## Phase 3 — 全局 UI ✅

- [x] shadcn 基础组件安装（Button / Card / Badge / Input / Select / Toast / Dialog）
- [x] Header：多赛季导航（Active 赛季 + draft 状态赛季显示"敬请期待"）
- [x] Footer：品牌信息、Github 链接
- [x] 首页：活跃赛季检测 + 跳转
- [x] `/seasons`：历史赛季归档
- [x] 赛季 layout：注入 `theme_color` CSS variable
- [x] Tailwind tokens 落地（见 `docs/ui-tokens.md`）

---

## Phase 4 — 报名系统

- [x] `submitRegistration` Server Action（Zod 校验 + DB 写入）
- [x] 位置满员校验（COUNT GROUP BY）
- [ ] 截图上传 Storage（客户端直传 presigned URL）→ 当前为 URL 粘贴
- [x] `/[seasonSlug]/register` 表单页
- [x] 报名成功页 + Magic Link 邮件触发
- [x] 报名已截止 / 位置已满的错误态 UI
- [x] 报名配置化：`seasons.registration_config JSONB` 驱动段位门槛/身份类型/位置上限/截图数量（PR #38）

---

## Phase 5 — 管理审核 ✅

- [x] iron-session 接入（双 Cookie：`rivalhub-session` 全用户 + `rivalhub-admin` root 紧急）
- [x] `admin_users` + `admin_invites` 表（scrypt 密码哈希 + 邀请码追踪，含 `seasonId`）
- [x] 种子脚本写入根管理员 `RivalHub_root` + 自动生成 `ADMIN_SESSION_SECRET`
- [x] `/admin/login` 登录页（Root 用户名+密码紧急入口）
- [x] `/login` 选手/管理员 Magic Link 统一登录页
- [x] `/invite?code=xxx` 邀请码提权页（`claimInviteCode` → 更新 users.role + adminSeasonIds）
- [x] `/auth/callback` Supabase Auth 回调（upsert users + 建 rivalhub-session）
- [x] `users.role` 角色体系（user / season_admin / super_admin）+ `adminSeasonIds`
- [x] `/admin/[seasonSlug]/registrations` 审核列表 + 状态迁移校验
- [x] 通过 / 拒绝 / 等待名单 Server Action + audit log（含审核人邮箱）
- [x] 报名截图预览（NJUBox URL 跳转查看）
- [x] `/admin/invites` 邀请码管理（创建含 seasonId / 撤销 / 查看使用记录）
- [x] `/admin/users` 管理员列表（停用 / 重新启用）
- [x] `/admin/settings` 修改密码 + 环境变量状态面板
- [x] 管理后台统一导航栏 + 退出登录按钮

---

## Phase 6 — 队长投票

- [x] `castVote` / `retractVote` Server Action（每人最多 3 票，幂等约束）
- [x] `/[seasonSlug]/captains` 投票页（Realtime 实时票数 + 轮询兜底）
- [x] `/admin/[seasonSlug]/captains` 确认前 8 名队长、生成 teams + draft_order
- [x] 投票结果公示

---

## Phase 7 — 选秀直播间（围观）✅

- [x] `draftState` + `draftPicks` Realtime 订阅（`DraftLiveRoom` 订阅两张表，10 秒轮询兜底）
- [x] `/[seasonSlug]/draft` 围观页：8 队网格 + 倒计时 + 剩余选手池（`DraftLiveRoom` / `TeamDraftGrid` / `PlayerPool` / `DraftCountdown`）
- [x] 已选 / 当前轮次高亮
- [ ] 手机端响应式布局

---

## Phase 8 — 选秀队长端 + 超时 Cron ✅

- [x] `pickPlayer` Server Action（Postgres 事务 + SELECT FOR UPDATE + 幂等键）
- [x] 同位置 ≤ 2 人约束校验
- [x] `/[seasonSlug]/draft/captain` 队长选秀面板（仅当前轮队长可操作）
- [x] `/api/cron/draft-timeout` Cron route：超时按 peak_rating 降序自动 pick
- [x] `autoPick` Server Action

---

## Phase 9 — 队伍展示页 ✅

- [x] `/[seasonSlug]/teams` 列表页（8 队卡片，按 draftOrder 排序）
- [x] `/[seasonSlug]/teams/[teamId]` 详情页（首发/替补分区，队长 badge）

---

## Phase 10 — 比赛详情 ✅

- [x] `createMatch` / `recordMatchResult` / `cancelMatch` Server Action
- [x] `/[seasonSlug]/matches/[matchId]` 详情页（双方阵容、比分、地图结果、状态）
- [x] `/admin/[seasonSlug]/matches` 管理员赛程表（创建/录分/取消）
- [x] 比赛状态机：`scheduled → in_progress → finished`，`scheduled → cancelled`

---

## Phase 11 — Bracket 视图 + 自动生成赛程 + 平台配置化

**赛制支持**
- [x] 单循环排位赛（Round Robin）：按 `draftOrder` 为种子，生成所有两两对阵的 `matches` 行
- [x] 双败淘汰正赛（Double Elimination）：排位赛后按名次分配种子，`brackets-manager` 生成 bracket 结构
- [x] 单败淘汰（Single Elimination）：独立 executor，支持 bye（`entrySeeds` 种子轮空 + qualifiers 晋级合并）、季军赛占位、cross-group 交叉配对
- [x] 三败瑞士轮（Swiss）：Buchholz 评分 + slide 配对 + 交手回避，advanceRound 逐轮推进，decider 自动 BO3（`isWinAndIn`/`isLossAndOut`）
- [x] GSL 小组赛（GSL Group）：蛇形分配，确定性对阵（4/8 队组），4 轮推进，`getQualifiers` 按组内战绩产出 placement+group
- [x] StageExecutor v2 接口：`initialize(seasonId, config, teams, qualifiers?)` + `getQualifiers(seasonId, config)` 打通阶段间晋级数据流
- [x] `entrySeeds` 种子轮空机制：高位种子跳过前置阶段直入后续 Swiss（Major Stage 2/3）
- [x] `finalFormat` 决赛 BO5 覆写：淘汰赛决赛自动使用 BO5，其余场次用 `matchFormat`

**平台配置化（PR #38）**
- [x] `seasons` 表：`qualifierFormat`/`playoffFormat` 枚举列 → `stagePlan`/`registrationConfig` JSONB（migration 0005 + backfill）
- [x] `season_registrations` 表：新增 `player_type` 列（enrolled/graduated/external）
- [x] `matches` 表：`stage` 改为 text（存 `StagePlan[n].key`），新增 `round` 列
- [x] StageExecutor 框架：`src/lib/formats/`（types/round-robin/double-elim/single-elim/index）
- [x] `generateSchedule` 重构为遍历 `stagePlan`，调用 executor
- [x] `initializeStage` Server Action（基于上一阶段名次种子初始化后续阶段）
- [x] Admin UI：`/admin/seasons/new`（创建赛季）、`/admin/[seasonSlug]/settings`（编辑赛季配置）
- [x] `src/actions/seasons.ts`：createSeason / updateSeason / deleteSeason / publishSeason
- [x] 报名配置化：段位门槛/身份类型/位置上限/截图数从 `registrationConfig` 读取
- [x] `playerType` 加入报名表单 + Server Action 校验
- [x] SeasonForm 组件：Rivals 预设 + 自定义 JSON 模式

**自动生成流程**
- [x] admin 页面「生成赛程」按钮：赛季状态为 `playing` 且尚无 matches 时可用
- [x] Server Action `generateSchedule(seasonId)`：按赛制 insert 所有 `matches`（`status: scheduled`，`scheduledAt: null`）
- [x] 管理员在赛程列表逐场填入 `scheduledAt`（`ScheduledAtInput` 组件 + `updateMatchScheduledAt` Server Action）

**Bracket 视图**
- [x] `brackets-manager` 双败淘汰赛数据结构初始化
- [x] `brackets-viewer` 渲染集成（注入 season theme_color）
- [x] `/[seasonSlug]/matches` 总览页（bracket 图 + 赛程列表联动）
- [x] 比赛详情页与 bracket 节点双向跳转（BracketView 点击跳转 + 详情页"查看对阵图"回链）

---

## Phase 11.5 — 玩家数据展示 ✅

- [x] **比赛详情页数据表**：`PlayerStatsTable` Server Component，每图 Team A / Team B 双栏 K/D/A/ADR/Rating
- [x] **单场 MVP 投票**：`match_mvp_votes` 表 + `castMatchMvpVote` / `getMatchMvpResults` actions + `MatchMvpVote` Client Component
- [x] **选手跨赛季数据聚合**：`/players/[userId]` 页新增「个人数据」section（加权平均 Rating/ADR/K-D/WE + 按赛季分组）
- [x] **赛季排行榜**：`/[seasonSlug]/stats`，URL searchParams 驱动排序（Rating/ADR/K-D/WE/KPR/场次）+ 位置筛选（IGL/AWPer/Opener/Closer/Anchor）
- [x] **队伍统计卡片**：`/[seasonSlug]/teams/[teamId]` 页新增「队伍数据」（场均 Rating/ADR/K-D/WE + 各位置最佳选手）
- [x] `showStats` capability + SeasonNav 入口 + QuickLinks
- [x] 组件单元测试（2 test files, 7 tests）

---

## Phase 12 — 部署上线

- [x] vercel.json 创建（Cron Job 配置）
- [x] `/api/cron/draft-timeout` 接入 `runDraftTimeoutCron` + CRON_SECRET 鉴权
- [x] Sub-project 1 完成：代码整理 + 配置修正（config 合并、action-utils/revalidation、standings 解耦、draft/matches 拆分、测试覆盖、文档对齐）
- [ ] Vercel Dashboard 环境变量配置
- [ ] Vercel 首次部署
- [ ] 自定义域名绑定
- [ ] Sub-project 2：比赛时间协商 + 赛前名单提交（see docs/superpowers/specs/2026-05-12-match-time-roster-design.md）
- [ ] Playwright E2E 跑关键路径（注册 → 投票 → 选秀 → 比赛）
- [ ] 性能基准（LCP / FCP）验收

---

## v2 计划（dev 已预实现赛制引擎，待 v2 分支 UI/集成）

- **赛制引擎**（dev 已落地）：Swiss / GSL Group / Single Elim 独立 executor + entrySeeds 种子轮空 + finalFormat 决赛 BO5 + `getQualifiers()` 阶段间数据流
- **MAJOR_STAGE_PLAN 预设**（dev 已落地）：32 队 3 轮 Swiss（stage1/2/3 BO1，decider BO3）+ Single Elim 淘汰赛（BO3，决赛 BO5）
- 多游戏/多赛制位置系统 UI 适配
- 自由组队模式赛事完整实现
- 历史赛季归档多届展示
- 用户账号设置页
- i18n 多语言支持
- 赛后玩家数据自动化（待调研）
