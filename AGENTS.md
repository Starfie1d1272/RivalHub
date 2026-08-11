# RivalHub · Claude Code 工程手册

## 1. 项目概述

RivalHub 是开源电竞赛事管理平台，通过 capability 驱动多赛事模型支持选秀联赛、公开赛、杯赛等全流程运营。
技术栈：Next.js 15 App Router + TypeScript strict + Tailwind CSS v4 + shadcn/ui + Supabase + Drizzle ORM。
部署：Vercel（`match.starfie1d.top`），当前 v1.30.1。

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
9. **组件 PascalCase 命名** — 文件名与 export 一致（`ui/` 目录除外）。代码结构查询统一用 CodeGraph（如 `codegraph_files src/components/`），`docs/code-map.md` 仅作业务域入口参考、不再强制同步。

## 6. 缓存策略

- `force-dynamic` 仅选秀和后台路由，其余 RSC 默认缓存。
- 写操作后 `revalidatePath(具体路径)`，不调 `revalidatePath("/")`。
- 不引入 Redis。

## 7. 分支管理

### Branch workflow

- `main` = production branch（受保护，禁 force push，仅 PR 合入）。
- `dev` = next-release integration / staging branch。
- 常规功能开发：`dev` → `feat/*` → PR → `dev`。
- 下一版本常规修复：`dev` → `fix/*` → PR → `dev`。
- 生产 hotfix：`main` → `hotfix/*` → PR → `main`；hotfix merge 后必须把 main 的修复同步到 `dev`。
- 发版：`dev` → PR → `main`（打 tag + 部署）。
- 不长期维护 `release/2.0.0`。
- RivalHub 2.0：所有 feature branches 从 `dev` 创建，PR base = `dev`。
- `archive/*` 为历史只读分支，不参与 active development。

分支命名：`feat/` / `fix/` / `hotfix/` / `docs/` / `refactor/` / `chore/`。

### Staging DB safety gate

`dev` / Preview deployment 并不自动证明数据库已经与 production 隔离。
在确认 Preview/Staging 使用独立 Supabase 之前，禁止在该环境执行：

- seed
- db:push / migration rehearsal
- Playwright E2E
- 权限写入测试
- 有写操作的 tournament simulation

（staging-environment gate 单独处理，不涉及 Vercel settings / Supabase / environment secrets 修改。）

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
- **版本号与 CHANGELOG 由 changeset 管理**：日常 `pnpm changeset`，发版 `pnpm changeset version`；CHANGELOG 必须在打 tag 之前提交，否则 release workflow 找不到版本条目。详见 `.claude/skills/release.md`。
- **push 必须带 tag**：`git push origin <分支> --follow-tags`，否则 GitHub Release 不会触发。
- **Demo 与评分外部包属 2.0 线**：v1.30.0 起 1.x 移除 Demo 导入及评分外部包（`@cs2dak/core` / `@rivalhub/rival-rating`），旧 Demo/DAK 历史已归档至 `archive/legacy-demo-dak` / `archive/legacy-original-lineage`（含 `archive/worktree-*` tags），不再有长期 `release/2.0.0` 分支；2.0 开发从 `dev` 开分支；生产库 demo 相关表保留空置、不删除。

## 11. Generated/custom migration safety

从 0020 canonical team identity migration 开始：

- `pnpm db:push` **不得**用于应用 0020——它按 TypeScript schema 与远端 DB 直接 diff 同步，不执行 migration SQL 里的 custom backfill / fail-closed RAISE 逻辑；
- 0020 的 backfill 与 fail-closed checks 存在于 migration SQL 中，必须通过能够实际执行该 SQL 的 migration workflow 应用；
- 当前 staging DB isolation 尚未验证；
- 在独立 staging Supabase 建立之前，**不得应用 0020 到任何 remote DB**；
- 建立 staging 后必须先检查：1) actual database schema；2) Drizzle migration history table / baseline state；3) 0000–0019 的实际应用状态；
- 然后再决定一次性的 migration baseline/adoption 方案；
- 不允许盲目运行 `drizzle-kit migrate` 去假设历史 migration log 已完整。

保留现有 staging data gate（第 7 节）。
