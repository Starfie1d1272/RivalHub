# Local development

本页只描述 RivalHub 官方仓库的本地开发路径，不是 production self-hosting 指南。

## Runtime

仓库当前 runtime contract 由 `package.json` / lockfile 统一声明：

- Node.js 24.x
- pnpm 11.x

优先使用仓库声明的 runtime，不要在 workflow 或个人脚本里再维护另一份 Node/pnpm 版本常量。

## 第一次启动

```bash
pnpm install
pnpm db:local:bootstrap
pnpm dev:local
```

`db:local:bootstrap` 会准备 Local Supabase 所需服务、回放 active Drizzle migrations、加载开发 fixture 并执行验证。`dev:local` 使用 wrapper 注入 loopback 环境。

本地 wrapper 不会把 `.env.local` 中的远程 `DATABASE_URL` 当作 fallback。

## 只启动需要的层级

### PostgreSQL-only

适合 migration、真实约束、transaction 和 integration test：

```bash
pnpm db:local:start-db
pnpm db:local:bootstrap-db
pnpm db:local:verify-db
pnpm test:integration
```

### Supabase services

适合 Auth、Storage、Data API 和 browser E2E：

```bash
pnpm db:local:start-services
pnpm db:local:bootstrap-services
pnpm db:local:verify-supabase
pnpm test:e2e
```

### 完整本地验证

```bash
pnpm verify:local
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
