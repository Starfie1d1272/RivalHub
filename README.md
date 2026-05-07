# RivalHub

> 开源电竞赛事管理平台 — 报名 · 选秀 · 赛程一体化

## 功能概览

| 功能 | 说明 | 状态 |
|---|---|---|
| 多赛事抽象 | capability 驱动多赛事共存，路由前缀 `/[seasonSlug]/` | ✅ 架构就绪 |
| 玩家报名 | 表单校验、截图直传 Storage、位置实时满员 | 🔄 Phase 4 |
| 管理员审核 | 通过 / 拒绝 / 等待名单 + audit log | 🔄 Phase 5 |
| 队长投票 | 全体选手投票，Realtime 票数，得票前 8 名为队长 | 🔄 Phase 6 |
| 蛇形选秀直播间 | Realtime 围观，倒计时，剩余选手池 | 🔄 Phase 7 |
| 队长选秀面板 | 事务行锁、幂等 pick、超时 Cron 自动递补 | 🔄 Phase 8 |
| 队伍展示 | 7 人阵容按位置排版 | 🔄 Phase 9 |
| 赛程管理 | 比赛详情 + 比分录入 + 状态机 | 🔄 Phase 10 |
| Bracket 视图 | `brackets-manager` 双败淘汰图 | 🔄 Phase 11 |
| 部署上线 | Vercel + 自定义域名 + Cron + E2E 验证 | 🔄 Phase 12 |

## 技术栈

- **框架**：Next.js 15 App Router + TypeScript strict
- **样式**：Tailwind CSS v4 + shadcn/ui
- **数据库**：Supabase Postgres + Auth + Realtime + Storage
- **ORM**：Drizzle ORM
- **部署**：Vercel

## 本地启动

### 前置条件

- Node.js ≥ 22（见 `.nvmrc`）
- pnpm 11（由 `package.json` 的 `packageManager` 字段锁定）
- Supabase 账号（Phase 2+ 需要）

### 步骤

```bash
# 1. 安装依赖
pnpm install

# 2. 复制环境变量模板
cp .env.example .env.local
# 编辑 .env.local，填入 Supabase URL / keys 等

# 3. 初始化数据库（Phase 2+ 需要真实 Supabase 项目）
pnpm db:push
pnpm seed

# 4. 启动开发服务器
pnpm dev
# → http://localhost:3000
```

Phase 1 本地前端验证成功时，`http://localhost:3000` 首页应显示 `RivalHub`。

### Phase 1 仅验证脚手架（无需真实数据库）

```bash
pnpm install
pnpm tsc --noEmit     # 类型检查通过
pnpm build            # 构建通过
pnpm test             # hello-world 测试通过
pnpm db:generate      # 离线生成迁移 SQL（不连接 DB）
```

## 环境变量

见 `.env.example` — 所有变量均有说明注释。

## 部署（Vercel）

1. 在 Vercel 导入仓库，配置 `.env.example` 中的所有环境变量。
2. 在 Vercel 项目设置 → Cron Jobs 添加：
   - `*/1 * * * *` → `/api/cron/draft-timeout`（仅选秀活跃期需要，可通过 `ENABLE_DRAFT_CRON` 控制）
3. 绑定自定义域名。
4. 运行 `pnpm test:e2e` 对生产 URL 验证关键路径。

## 文档索引

| 文档 | 说明 |
|---|---|
| `PHASES.md` | 12 阶段开发路线图 |
| `docs/architecture.md` | 整体架构与模块边界 |
| `docs/data-model.md` | ER 图 + 字段定义 |
| `docs/auth-and-permissions.md` | 鉴权流程与 RLS 策略 |
| `docs/draft-flow.md` | 蛇形选秀状态机与并发安全 |
| `docs/registration-flow.md` | 报名表单与截图直传 |
| `docs/season-abstraction.md` | 多赛事抽象设计 |
| `docs/ui-design.md` | 页面级视觉设计与 ASCII 线框 |
| `docs/ui-tokens.md` | 设计 tokens（色板/字体/间距） |
| `docs/testing.md` | 测试策略与配置 |
| `CLAUDE.md` | 面向 Claude Code 的工程手册 |

## 贡献指南

1. 在 `PHASES.md` 中找到对应阶段，阅读 `docs/` 相关文档后再动手。
2. 每个 Server Action 必须有对应的 Zod 校验和 audit log（admin 操作）。
3. PR 标题格式：`[phase-N] 简短描述`，附带通过的 `pnpm tsc --noEmit` 和 `pnpm test`。
