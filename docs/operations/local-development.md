# Local development

本页只描述 RivalHub 官方仓库的本地开发路径，不是 production self-hosting 指南。

## Runtime

仓库当前 runtime contract 由 `package.json` / lockfile 统一声明：

- Node.js 24.x
- pnpm 12.x

`packageManager`、`devEngines.runtime` 与 `engines.node` 共同声明仓库 runtime。pnpm 安装时会按 manifest 解析所需 Node，并把对应 runtime 记录到 lockfile；首次获取可能需要联网，后续可复用本机缓存。不要删除相关 lockfile runtime 条目，也不要在 workflow、脚本或个人环境里再维护另一份 Node/pnpm 版本常量；CI 同样从仓库 manifest/lockfile 取得 runtime。

## 需要真实服务时的第一次启动

```bash
pnpm install
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm db:local:bootstrap
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm dev:local
```

`db:local:bootstrap` 会准备 Local Supabase 所需服务、回放 active Drizzle migrations、加载开发 fixture 并执行验证。`dev:local` 使用 wrapper 注入 loopback 环境。

本地 wrapper 不会把 `.env.local` 中的远程 `DATABASE_URL` 当作 fallback。
默认 `pnpm check` / `pnpm verify` 只执行 host-only correctness、静态 guard、unit 和 production build，不启动 Docker、Local Supabase 或 PostgreSQL container。CI 运行重型 evidence；人工本地复现必须显式设置 `RIVALHUB_ALLOW_LOCAL_CONTAINERS=1`。

## Draft → Ready 迭代流程

日常开发默认在 Draft PR 中进行。每次 push 由 Evidence Planner 根据 changed surface 选择 affected evidence；本地只需运行与当前改动匹配的快速 host-only 检查。不要为了每次迭代重复启动 PostgreSQL、Local Supabase 或 browser 重型环境。

常用匹配方式：

- domain、formatter 或纯规则：`pnpm exec vitest run --project unit-domain-node path/to/related.spec.ts`；
- server action、route、数据库访问或 API：`pnpm type-check:app`，并运行 `unit-server-node` 的相关 spec；
- React component：`pnpm exec vitest run --project unit-react-jsdom path/to/related.spec.tsx`；
- tests：`pnpm type-check:tests`；scripts：`pnpm type-check:scripts`；
- 当前改动涉及的 TypeScript/JSON 文件：`pnpm exec eslint path/to/changed-file.ts`。

`pnpm check` / `pnpm verify` 可以在需要时作为 broad host-only 检查，但不要求每次迭代或每次 push 都运行。真实 PostgreSQL、Local Supabase 和 browser evidence 由 CI 按需运行；服务层本地复现只在排查失败、验证 migration/constraint，或需要检查真实浏览器组合行为时启动最小层级。准备交付时将 PR 标记为 Ready for review，由 Evidence Planner 按变更风险产生 required 的 `ci-gate`；Ready 后的新 push 会使旧 commit 的 evidence 失效，需等待新 commit 的 CI 检查。

## 只启动需要的层级

### PostgreSQL-only

适合 migration、真实约束、transaction 和 integration test：

```bash
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm db:local:start-db
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm db:local:bootstrap-db
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm db:local:verify-db
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm test:integration
```

### Supabase services

适合 Auth、Storage、Data API 和 browser E2E：

```bash
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm db:local:start-services
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm db:local:bootstrap-services
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm db:local:verify-supabase
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm test:e2e
```

### 完整本地验证

```bash
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm verify:services
```

它用于在本地组合 repository checks、real PostgreSQL 和 browser evidence。具体测试含义见 [`../testing.md`](../testing.md)。

## 常用命令

```bash
pnpm type-check
pnpm lint
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm check
pnpm verify
pnpm build
pnpm db:check
```

## 重建与停止

```bash
pnpm db:local:reset
pnpm db:local:stop
```

`reset` 是明确的本地破坏性操作；不要把它用于 staging 或 production。

## 多 worktree

数据库 bootstrap、migration、integration 和 E2E 会共享本机 Local Supabase 资源。仓库 wrapper 负责跨 worktree 串行化这些操作；普通 type-check、unit test 和 build 不需要等待数据库锁。

遇到数据库相关失败时，优先确认当前目标仍是 loopback、本地服务状态正常，并通过 canonical wrapper 复现；不要为了“让测试跑起来”临时改用远程数据库。

## Scheduler and registration recovery

本地不启动或 provision production `pg_cron`，也不把本地 workflow 当作 production scheduler evidence。active migration 在 plain PostgreSQL 上会对可用 extension 做条件处理；Local Supabase provider verification 会在回滚事务内用真实 Vault 与 pg_net 实际调用 dispatch helper，并确认 primary health 写入，不留下探针凭据或请求。production named jobs、真实 endpoint success 与 cadence 仍由受保护 release workflow 的 `db:production:scheduler:*` 命令验证。

调度 registry 的 pure contract、watchdog fresh/stale 分支、source 校验和 health projection 使用 unit tests 验证；真实 database lock、RLS、migration replay 和 HTTP dispatch 仍按 [`../testing.md`](../testing.md) 的对应层级执行。参与者报名的 due-opening recovery 只在 transaction 内 materialize opening fact，页面 GET 不承担此副作用。
