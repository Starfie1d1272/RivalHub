# RivalHub · v1 开发路线图

> 所有阶段均基于单赛事推进，但每个新增表/路由/组件都按多赛事抽象设计（带 `season_id`、走 `/[seasonSlug]/...`）。
> 每阶段结束 commit + push，在此文件更新 checkbox。

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
- [ ] **TODO**: 将 `src/lib/config/registration-defaults.ts` 迁移到 `seasons.registration_config JSONB`，实现赛事级可配置（Phase 7-8 后台管理）

---

## Phase 5 — 管理审核 ✅

- [x] iron-session 接入（`getAdminSession` / `requireAdmin` + session 含 adminId/username/role）
- [x] `admin_users` + `admin_invites` 表（scrypt 密码哈希 + 邀请码追踪）
- [x] 种子脚本写入根管理员 `RivalHub_root` + 自动生成 `ADMIN_SESSION_SECRET`
- [x] `/admin/login` 登录页（用户名 + 密码，DB 查询 + scrypt 验证）
- [x] `/admin/register` 邀请码注册页（新管理员自设用户名密码）
- [x] `/admin/[seasonSlug]/registrations` 审核列表 + 状态迁移校验
- [x] 通过 / 拒绝 / 等待名单 Server Action + audit log（含审核人用户名）
- [x] 报名截图预览（NJUBox URL 跳转查看）
- [x] `/admin/invites` 邀请码管理（创建 / 撤销 / 查看使用记录）
- [x] `/admin/users` 管理员列表（停用 / 重新启用）
- [x] `/admin/settings` 修改密码
- [x] 管理后台统一导航栏 + 仪表盘

---

## Phase 6 — 队长投票

- [ ] `castVote` / `retractVote` Server Action（每人最多 3 票，幂等约束）
- [ ] `/[seasonSlug]/captains` 投票页（Realtime 实时票数）
- [ ] `/admin/[seasonSlug]/captains` 确认前 8 名队长、生成 teams + draft_order
- [ ] 投票结果公示

---

## Phase 7 — 选秀直播间（围观）

- [ ] `draftState` + `draftPicks` Realtime 订阅
- [ ] `/[seasonSlug]/draft` 围观页：8 队网格 + 倒计时 + 剩余选手池
- [ ] 已选 / 未选 / 当前轮次高亮
- [ ] 手机端响应式布局

---

## Phase 8 — 选秀队长端 + 超时 Cron

- [ ] `pickPlayer` Server Action（Postgres 事务 + SELECT FOR UPDATE + 幂等键）
- [ ] 同位置 ≤ 2 人约束校验
- [ ] `/[seasonSlug]/draft/captain` 队长选秀面板（仅当前轮队长可操作）
- [ ] `/api/cron/draft-timeout` Cron route：超时按 peak_rating 降序自动 pick
- [ ] `autoPick` Server Action

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

## Phase 11 — Bracket 视图 + 自动生成赛程

**赛制支持**
- [ ] 单循环排位赛（Round Robin）：按 `draftOrder` 为种子，生成所有两两对阵的 `matches` 行
- [ ] 双败淘汰正赛（Double Elimination）：排位赛结束后按名次分配种子，`brackets-manager` 生成 bracket 结构，写入 `matches`
- [ ] （远期）三败瑞士轮：用于 Major 预选，需自行实现配对算法，单独子 Phase

**自动生成流程**
- [ ] admin 页面「生成赛程」按钮：赛季状态为 `playing` 且尚无 matches 时可用
- [ ] Server Action `generateSchedule(seasonId, type)`：按赛制 insert 所有 `matches`（`status: scheduled`，`scheduledAt: null`）
- [ ] 管理员在赛程列表逐场填入 `scheduledAt`

**Bracket 视图**
- [ ] `brackets-manager` 双败淘汰赛数据结构初始化
- [ ] `brackets-viewer` 渲染集成（注入 season theme_color）
- [ ] `/[seasonSlug]/matches` 总览页（bracket 图 + 赛程列表联动）
- [ ] 比赛详情页与 bracket 节点双向跳转

---

## Phase 12 — 部署上线

- [ ] Vercel 环境变量配置
- [ ] Vercel Cron 接入（`/api/cron/draft-timeout`）
- [ ] 自定义域名绑定
- [ ] Playwright E2E 跑关键路径（注册 → 投票 → 选秀 → 比赛）
- [ ] 性能基准（LCP / FCP）验收

---

## v2 计划（不在 v1 范围）

- 多游戏/多赛制支持（位置系统已泛化，需扩展 UI 适配）
- 自由组队模式赛事完整实现
- 历史赛季归档多届展示
- 用户账号设置页
- i18n 多语言支持
