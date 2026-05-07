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
| Bracket 渲染 | `brackets-manager` + `brackets-viewer`（经 `lib/bracket/` 适配层访问） |
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
5. **选秀并发安全**：Postgres 事务 + `SELECT ... FOR UPDATE` 行锁，`client_request_id` 幂等，8 步全在同一事务（见 `docs/draft-flow.md`）。
6. **所有管理操作写 audit_logs**，不允许跳过。
7. **时间统一存 UTC**，展示层转换为 Asia/Shanghai。

---

## 三条硬性禁令

### ❌ 禁止用 `season.kind` 做功能分支

```typescript
// ❌ 绝对禁止——这是 if 地狱的起点
if (season.kind === "rivals") { ... }
if (season.kind === "major") { ... }

// ✅ 正确——读 capability 字段
if (season.hasDraft) { ... }
if (season.hasCaptainVoting) { ... }
if (season.registrationMode === "solo") { ... }
```

`season.kind` 仅用于界面展示和历史记录。所有功能门控必须读 capability 字段。
新增赛事类型时，只需在种子数据里配置 capability，不改业务代码。

### ❌ 禁止在事务外广播 Realtime

```typescript
// ❌ 错误——commit 前广播，客户端可能看到回滚后的幽灵数据
await db.transaction(async (tx) => {
  await tx.insert(draftPicks)...;
  supabase.channel(...).send(...);  // ← 不允许
});

// ✅ 正确——commit 成功后再广播
await db.transaction(async (tx) => { ... });
await supabase.channel(...).send(...);  // ← commit 后
```

### ❌ 禁止直接 import brackets-manager

```typescript
// ❌ 全站耦合第三方库
import { BracketsManager } from "brackets-manager";

// ✅ 经过适配层
import { generateBracket, advanceMatch } from "@/lib/bracket";
```

---

## Realtime 是高成本能力，不是默认能力

**应该用 Realtime 的表（仅这三张）：**

| 表 | 场景 |
|---|---|
| `draft_state` | 选秀围观页 + 队长面板的轮次/倒计时更新 |
| `draft_picks` | 选秀围观页新 pick 动画 |
| `captain_votes` | 投票页实时票数（可选，也可轮询） |

**不应该用 Realtime 的表：**
`registrations`、`teams`、`team_members`、`matches`、`users`、`audit_logs`

禁止 `supabase.channel("*")` 或订阅上面列表以外的表。

---

## 状态机

所有实体的合法状态迁移规则见 `docs/state-machines.md`。
修改任何状态转换逻辑前，必须先更新该文档。

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
│   ├── schema/       # Drizzle 表定义（10 张表）
│   ├── client.ts     # Drizzle client 单例
│   └── seed.ts       # 种子数据
├── lib/
│   ├── auth/         # session.ts（iron-session）+ supabase.ts
│   ├── bracket/      # brackets-manager 适配层（禁止绕过）
│   ├── realtime/     # Supabase Realtime 订阅辅助
│   ├── validators/   # Zod schema（registration / vote）
│   └── utils/        # date（UTC/CST）+ season（capability 工具）+ cn
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

## 其他约束提醒

- **禁止在 v1 实现 Major 业务**：Major 相关路由占位显示"敬请期待"，v2 实装。
- **禁止跳过 audit_log**：任何 admin action（审核、确认队长、录入比分）都必须写 audit_logs。
- **禁止物化计数字段**：如 `position_count`、`vote_count` 等字段不在 schema 里，靠查询聚合。
- **禁止在 Server Action 外写 DB 逻辑**：页面文件只做数据读取（RSC fetch），写操作必须是 Server Action。
- **shadcn 组件按需 add**：`pnpm dlx shadcn@latest add button`，不要手工写 shadcn 组件。

---

## 进度与参考文档

| 文档 | 内容 |
|---|---|
| `PHASES.md` | 12 阶段 checkbox 路线图 |
| `docs/state-machines.md` | 所有实体状态机（必读） |
| `docs/draft-flow.md` | 选秀事务边界与并发安全（必读） |
| `docs/architecture.md` | 整体架构与模块边界 |
| `docs/data-model.md` | ER 图 + 字段定义 |
| `docs/season-abstraction.md` | capability 驱动的多赛事设计 |
| `docs/auth-and-permissions.md` | 鉴权流程与 RLS 策略 |
| `docs/registration-flow.md` | 报名表单与截图直传 |
| `docs/ui-design.md` | 页面级视觉设计 |
| `docs/ui-tokens.md` | 设计 tokens |
| `docs/testing.md` | 测试策略 |
