# RivalHub · Claude Code 工程手册

## 1. 项目概述

RivalHub 是开源电竞赛事管理平台，通过 capability 驱动多赛事模型支持选秀联赛、公开赛、杯赛等全流程运营。
技术栈：Next.js 15 App Router + TypeScript strict + Tailwind CSS v4 + shadcn/ui + Supabase + Drizzle ORM。
部署：Vercel（`match.starfie1d.top`），当前 v1.25.3。

## 2. 常用命令

```bash
pnpm dev               # 启动开发服务器
pnpm build             # 生产构建
pnpm tsc --noEmit      # 类型检查
pnpm lint              # ESLint
pnpm test              # Vitest 单元 + 集成测试
pnpm test:e2e          # Playwright E2E
pnpm db:generate       # drizzle-kit generate（生成迁移 SQL）
pnpm db:push           # drizzle-kit push（推送到 Supabase）
pnpm db:studio         # Drizzle Studio
pnpm seed              # 种子数据
```

## 3. 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Next.js 15 App Router + TypeScript strict |
| 样式 | Tailwind CSS v4 + shadcn/ui |
| 数据库 | Supabase Postgres + Auth + Realtime + Storage |
| ORM | Drizzle ORM |
| 表单 | React Hook Form + Zod |
| 鉴权 | Supabase Auth + iron-session（双 Cookie：`rivalhub-session` + `rivalhub-admin`） |
| 定时任务 | GitHub Actions 每 5 分钟调 `/api/cron/*` |
| Bracket | `brackets-manager` 经 `lib/bracket/` 适配层 |
| 测试 | Vitest + React Testing Library + Playwright |
| 部署 | Vercel |

## 4. 架构原则

1. **业务逻辑全部走 Server Actions**，仅 Cron 触发用 API Route。
2. **多赛事抽象用 capability 字段**，禁止 `season.kind` 做功能分支。所有赛事相关表含 `season_id`，路由前缀 `/[seasonSlug]/...`。
3. **不做物化计数**：聚合靠 `COUNT GROUP BY`，Server Component 渲染，提交时服务端二次校验。
4. **Server Components 为主**，仅 Realtime / 表单 / 倒计时局部标注 `"use client"`。
5. **选秀并发安全**：Postgres 事务 + `SELECT ... FOR UPDATE` + `client_request_id` 幂等。详见 `docs/draft-flow.md`。
6. **所有管理操作写 audit_logs**。
7. **时间统一存 UTC**，展示层转 Asia/Shanghai。

## 5. 硬性禁令

1. **禁止 `season.kind` 做功能分支** — 读 capability 字段（`hasDraft` 等），`season.kind` 仅展示用。
2. **禁止事务内广播 Realtime** — commit 成功后再 `supabase.channel(...).send(...)`。
3. **禁止直接 import brackets-manager** — 必须经 `@/lib/bracket` 适配层。
4. **Realtime 仅限三张表** — `draft_state`、`draft_picks`、`captain_votes`。禁止 `channel("*")`。
5. **Server Action 必须返回 `ActionResult<T>`** — `ok()` / `fail()`，禁止抛异常或返回原始值。错误码在 `src/lib/errors.ts`。
6. **禁止手动改 `package.json` version** — 用 `npm version <patch|minor|major>`。发版走 `.claude/skills/release.md`。
7. **禁止 Server Action 外写 DB** — 页面只读（RSC fetch），写操作必须是 Server Action。
8. **shadcn 组件按需 add** — `pnpm dlx shadcn@latest add button`，不手写。
9. **组件 PascalCase 命名** — 文件名与 export 一致（`ui/` 目录除外）。新增后更新 `docs/code-map.md` 并跑 `zsh scripts/check-claude-md.sh`。

## 6. 缓存策略

- `force-dynamic` 仅选秀和后台路由，其余 RSC 默认缓存。
- 写操作后 `revalidatePath(具体路径)`，不调 `revalidatePath("/")`。
- 不引入 Redis。

## 7. 分支管理

日常 `dev`，`main` 仅 PR 合入（受保护，禁 force push）。

| 场景 | 做法 |
|---|---|
| 小修复 / 联调 | 直接 push `dev` |
| 功能开发 | `dev` → 功能分支 → PR 回 `dev` |
| 紧急 hotfix | `main` → hotfix 分支 → PR 回 `main` → cherry-pick 到 `dev` |
| 里程碑 | `dev` → `main` PR（打 tag + 部署） |

分支命名：`feat/` / `fix/` / `hotfix/` / `docs/` / `refactor/` / `chore/`。

## 8. 目录速查

```
src/
├── app/              # App Router（[seasonSlug] 多赛季路由）
├── actions/          # Server Actions（所有业务逻辑入口）
├── db/schema/        # Drizzle 表定义
├── lib/              # auth / bracket / formats / validators / utils
├── components/       # ui(shadcn) / rivalhub / 各业务模块
└── types/            # 共享类型
```

完整目录树和组件清单见 `docs/code-map.md`。

## 9. 关键文档

| 文档 | 内容 |
|---|---|
| `docs/state-machines.md` | 实体状态机，修改状态前必读 |
| `docs/draft-flow.md` | 选秀事务边界与并发安全 |
| `docs/data-integrity.md` | DB 约束、Storage、soft delete |
| `docs/architecture.md` | 整体架构与模块边界 |
| `docs/code-map.md` | 完整代码地图与修改入口 |
| `docs/README.md` | 文档索引入口 |

## 10. 踩坑记录

- **生产调试看 Vercel dashboard**，不在终端。用 Supabase `get_logs` MCP 或 Vercel dashboard。
- **Drizzle `buildRelationalQueryWithoutPK` 陷阱**：关联查询时确保主键在 select 中。
- **macOS 上 `pnpm db:push` 偶发失败**：检查 Supabase Session Pooler 连接（`aws-1-us-east-1.pooler.supabase.com:5432`）。
- **pnpm 要求 Node ≥ 22**，CI（GitHub Actions）需版本匹配。
- **CHANGELOG 必须在 `npm version` 之前更新并提交**，否则 release workflow 找不到对应版本条目。
- **push 必须带 tag**：`git push origin dev --follow-tags`，否则 GitHub Release 不会触发。
