# NJU CS2 Platform · Claude Code 工程手册

## 项目概述

南京大学 CS2 社团多赛事管理平台，支持 NJU Rivals（春季）和 NJU Major（秋季）两个赛事品牌的全流程运营：报名 → 审核 → 队长投票 → 蛇形选秀 → 队伍展示 → 赛程 + Bracket 视图 → 部署。

当前阶段：**Phase 1（脚手架）已完成，Phase 2+ 为业务实现。**

---

## 技术栈速查

| 层 | 选型 |
|---|---|
| 框架 | Next.js 15 App Router + TypeScript strict |
| 样式 | Tailwind CSS v4 + shadcn/ui |
| 数据库 | Supabase Postgres + Auth + Realtime + Storage |
| ORM | Drizzle ORM |
| 表单 | React Hook Form + Zod（中文校验消息） |
| 管理员鉴权 | iron-session 加密 Cookie + invite code |
| 用户鉴权 | Supabase Auth magic link |
| 定时任务 | Vercel Cron（选秀超时自动 pick） |
| Bracket 渲染 | `brackets-manager` + `brackets-viewer` |
| 单元/集成测试 | Vitest + React Testing Library + jsdom |
| E2E 测试 | Playwright |
| 包管理 | pnpm |
| 部署 | Vercel |

---

## 架构原则（必须遵守）

1. **业务逻辑全部走 Server Actions**，仅 Cron 触发用 API Route。
2. **多赛事抽象 day-1 到位**：所有赛事相关表含 `season_id` 外键，路由前缀 `/[seasonSlug]/...`，禁止在 v1 写死 Rivals 赛季 ID。
3. **不做物化计数**：位置满员等聚合靠 `COUNT GROUP BY`，前端用 Supabase Realtime 实时刷新。
4. **Server Components 为主**，仅 Realtime 订阅 / 表单 / 倒计时等局部标注 `"use client"`。
5. **选秀并发安全**：Postgres 事务 + `SELECT ... FOR UPDATE` 行锁，`client_request_id` 幂等。
6. **所有管理操作写 audit_logs**，不允许跳过。
7. **时间统一存 UTC**，展示层转换为 Asia/Shanghai。

---

## 目录索引

```
src/
├── app/              # Next.js App Router 路由
│   ├── [seasonSlug]/ # 公开赛季页面（注册/投票/选秀/队伍/赛程）
│   ├── admin/        # 管理员后台（iron-session 保护）
│   └── api/cron/     # Vercel Cron API Route
├── actions/          # Server Actions（所有业务逻辑入口）
├── db/
│   ├── schema/       # Drizzle 表定义（8 张表）
│   ├── client.ts     # Drizzle client 单例
│   └── seed.ts       # 种子数据
├── lib/
│   ├── auth/         # session.ts（iron-session）+ supabase.ts
│   ├── realtime/     # Supabase Realtime 订阅辅助
│   ├── validators/   # Zod schema（registration / vote）
│   └── utils/        # date（UTC/CST）+ season（slug 解析）+ cn
├── components/
│   ├── layout/       # Header / Footer
│   ├── ui/           # shadcn 组件（按需 add）
│   ├── register/     # 报名业务组件
│   ├── draft/        # 选秀业务组件
│   ├── captains/     # 队长投票业务组件
│   ├── teams/        # 队伍展示业务组件
│   └── matches/      # 赛程 / bracket 业务组件
└── types/            # 共享 TypeScript 类型
```

---

## 常用命令

```bash
pnpm dev               # 启动开发服务器
pnpm build             # 生产构建
pnpm tsc --noEmit      # 类型检查
pnpm lint              # ESLint

pnpm db:generate       # drizzle-kit generate（生成迁移 SQL，不执行）
pnpm db:push           # drizzle-kit push（推送到 Supabase，仅阶段2+使用）
pnpm db:studio         # Drizzle Studio

pnpm test              # Vitest 单元 + 集成测试
pnpm test:e2e          # Playwright E2E 测试
pnpm seed              # 运行种子脚本（阶段2+ 有真实 DB 后使用）
```

---

## 关键约束提醒

- **禁止在 v1 实现 Major 业务**：Major 相关路由占位显示"敬请期待"，v2 实装。
- **禁止跳过 audit_log**：任何 admin action（审核、确认队长、录入比分）都必须写 audit_logs。
- **禁止物化计数字段**：如 `position_count`、`vote_count` 等字段不在 schema 里，靠查询聚合。
- **禁止在 Server Action 外写 DB 逻辑**：页面文件只做数据读取（RSC fetch），写操作必须是 Server Action。
- **shadcn 组件按需 add**：`pnpm dlx shadcn@latest add button`，不要手工写 shadcn 组件。

---

## 进度文档

见 `PHASES.md` — 12 阶段 checkbox 路线图。
