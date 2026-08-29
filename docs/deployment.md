# 部署与数据库运行边界

## Environments

| 环境 | 用途 | 数据库规则 |
|---|---|---|
| local | 开发、migration/fixture 验证、并发与破坏性测试 | 仅 loopback Local Supabase，由 `db:local:*` 注入 |
| staging / preview | 独立的上线前 lifecycle rehearsal | 独立 Supabase project，与 production 隔离 |
| production | 正式赛事与真实用户 | 只做真实赛事所需操作；不运行 destructive rehearsal |

`dev` 或 Vercel Preview 不自动证明数据库隔离。确认 target Vercel environment 和 Supabase project 后，才可在 staging 执行 seed、migration rehearsal、写入型 E2E 或赛事模拟。

## Local Supabase

```bash
pnpm db:local:start
pnpm db:local:migrate
pnpm db:local:seed
pnpm db:local:verify
pnpm db:local:bootstrap
pnpm db:local:reset
pnpm dev:local
```

wrapper 从 `supabase status --output json` 获取连接，并验证 DB/API/Studio 都指向 loopback。它不会读取 `.env.local` 的远程 `DATABASE_URL`，也不接受远程 URL fallback。`reset` 仅重建 Local Supabase，再重放 active Drizzle migrations、fixtures 与验证；不存在第二套业务 migration authority。

## Active migrations

`drizzle/migrations/` 是活动迁移链，`drizzle/legacy-migrations/` 是只读历史。`pnpm db:check` 校验活动链；`pnpm db:push` 被阻止，因为它无法执行 custom SQL、data backfill 或 fail-closed validation。

远程 migration 前必须确认独立环境、当前 migration baseline、精确 target 及显式写入授权。RLS、policy、trigger 和 Data API grants 应作为同一 active Drizzle migration 的 custom SQL 管理，不使用手工 schema patch。

### Protected staging migration

`pnpm db:staging:migrate` 和 `pnpm db:staging:verify` 只服务受保护的 `rivalhub-dev` staging workflow。命令拒绝继承 `DATABASE_URL` 或 `.env.local`，并对 project ref、Transaction Pooler shape 和写入授权 fail closed。

```bash
# Read-only ledger and schema verification
RIVALHUB_STAGING_PROJECT_CONFIRM=cueazphyskstwdhnzsxx \
RIVALHUB_STAGING_DB_PASSWORD='<staging database password>' \
pnpm db:staging:verify

# Local validation precedes the authorized staging migration
RIVALHUB_STAGING_PROJECT_CONFIRM=cueazphyskstwdhnzsxx \
RIVALHUB_STAGING_DB_PASSWORD='<staging database password>' \
RIVALHUB_ALLOW_REMOTE_DB_WRITE=staging \
pnpm db:staging:migrate
```

这些命令不执行 seed 或 `db:push`。缺少 Local 验证、确认值、staging 密码或写入 opt-in 时，命令在任何远程写入前停止。

### Explicit remote seed guard

`pnpm seed` 不从 `.env.local` 读取远程目标。对 staging 或 production 的 seed 必须同时提供：

```text
RIVALHUB_DB_TARGET=staging|production
RIVALHUB_DB_HOST_CONFIRM=<DATABASE_URL 的精确 host:port>
RIVALHUB_ALLOW_REMOTE_DB_WRITE=<与 target 相同>
```

这些确认防止误写，不能替代独立 staging、migration baseline 或人工授权。

## Hosted database connection

当前 `src/db/client.ts` 按 **Supabase Transaction Pooler** 模式配置：port `6543`、`prepare: false`，production pool 最大连接数为 `3`。部署时从目标 Supabase Dashboard 复制对应 Transaction Pooler connection string；pooler hostname 属于项目配置，不能猜测或硬编码。

如果运行时改用 Session Pooler，必须把该改动作为代码与部署的同一变更：移除 `prepare: false`，并将 pool 参数调整为与 Session Pooler 相符的设置。`.env.example` 保留空 `DATABASE_URL`，避免复制到错误项目或连接模式。

staging 与 production 分别配置：

- `DATABASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_SESSION_SECRET`
- `RIVALHUB_OWNER_EMAIL`
- `CRON_SECRET`
- `NEXT_PUBLIC_APP_URL`
- Turnstile 与第三方服务 key

生产启用 Supabase Confirm email。owner 经注册、邮箱确认和登录触发一次性 bootstrap；Root credentials 只用于明确启用的 emergency compatibility path。

## Cron

生产 Cron 由 `.github/workflows/cron.yml` 每 5 分钟调用：

```text
/api/cron/draft-timeout
/api/cron/check-registration-deadline
/api/cron/match-time-auto-award
```

请求使用 `Authorization: Bearer $CRON_SECRET`。Vercel 环境变量和 GitHub Actions secret 必须配置相同的 `CRON_SECRET`；调度方式变化时，同步更新 workflow、部署配置和本文件。

## Production diagnostics

生产故障先在 Vercel Runtime Logs 中按 method、path 和 error 查证，再定位到相应路由、query 或 action。不要从 minified stack 或本地连接现象推断 production 状态。数据库 schema/迁移问题以 active migration ledger、migration SQL 与对应验证为准。

完整变量模板见 [`.env.example`](../.env.example)。真实值不得进入 repository、release notes 或操作日志。
