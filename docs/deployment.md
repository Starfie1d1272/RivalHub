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
pnpm build:local
pnpm verify:local
```

wrapper 从 `supabase status --output json` 获取连接，并验证 DB/API/Studio 都指向 loopback。它不会读取 `.env.local` 的远程 `DATABASE_URL`，也不接受远程 URL fallback。`reset` 仅重建 Local Supabase，再重放 active Drizzle migrations、fixtures 与验证；不存在第二套业务 migration authority。`verify:local` 会确保 Local ready，重放 bootstrap/verify、运行不依赖数据库的 `verify`，随后运行 real-PG integration 与 browser E2E，并清理专用 fixture。

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

### Protected production migration and release transaction

Production 的 active chain 仍只有一个 authority：`drizzle/migrations/meta/_journal.json` 与对应 SQL SHA-256。只读核验与前向迁移只能使用以下受保护命令；禁止裸 `drizzle-kit migrate`、手工 `ALTER TABLE`、`db:push`、seed 或 reset。

Production 与应用运行时统一使用同一个 Supabase **Transaction Pooler `DATABASE_URL`**：`aws-0-ap-northeast-1.pooler.supabase.com:6543`。Vercel 的 Sensitive runtime value 无法被 GitHub-hosted runner 导出，因此 release runner 在 GitHub `production` Environment 维护一份同值的 `DATABASE_URL` secret；它仅用于受保护的 migration/verify，不替代 Vercel runtime credential。受保护命令在任何查询或写入前严格验证固定 project ref、host、port、username 和 pooler shape，不接受任意 inherited connection string。

```bash
# DATABASE_URL 使用与 production runtime 相同的现有 Transaction Pooler secret。
# Strictly read-only: rejects a pending, divergent or unexpected ledger entry.
DATABASE_URL='<existing production runtime DATABASE_URL>' \
RIVALHUB_DB_TARGET=production \
RIVALHUB_PRODUCTION_PROJECT_CONFIRM=sucokfotkypwqkckfynp \
RIVALHUB_PRODUCTION_DB_HOST_CONFIRM=aws-0-ap-northeast-1.pooler.supabase.com:6543 \
pnpm db:production:verify

# Authorized forward migration only. It first validates the active chain in
# Local PostgreSQL, reads the production preflight, runs Drizzle migrate, then
# automatically runs the strict production verifier again.
DATABASE_URL='<existing production runtime DATABASE_URL>' \
RIVALHUB_DB_TARGET=production \
RIVALHUB_PRODUCTION_PROJECT_CONFIRM=sucokfotkypwqkckfynp \
RIVALHUB_PRODUCTION_DB_HOST_CONFIRM=aws-0-ap-northeast-1.pooler.supabase.com:6543 \
RIVALHUB_ALLOW_REMOTE_DB_WRITE=production \
pnpm db:production:migrate
```

Vercel Production 的 `DATABASE_URL` 是应用 runtime secret；GitHub `production` Environment 的同值 `DATABASE_URL` 是 release runner secret。两处均通过环境变量注入，绝不进入 repository、日志、tag 或 release notes。显式 target、project、host 和 write authorization 仍是独立安全门禁。

Production preflight 以 `0024_major_runtime_convergence` 为已确认最低 baseline：早于 0024 的 ledger 直接拒绝；恰好位于 0024 时会在只读事务内验证旧 schema 形态以及 0025 CHSI-code extraction / 0026 role values 的 fail-closed predicates；任何晚于 0024 且仍是 active chain **精确前缀**的状态都允许继续前向执行，因此某个后续 migration 已成功、再后一个 migration 失败时可以安全重试 canonical runner。hash/timestamp divergence、unexpected entry 或超出 active chain 仍然 fail closed。迁移完成后 verify 要求完整 ledger SHA/timestamp sequence，并验证 `evidence_code` present/`evidence_url` absent、`perfect_id` absent 与 canonical `cs2_role` enum。

正式 production release 由 `.github/workflows/release.yml` 的 `v*` tag workflow 独占：tag commit 必须已经包含在 `main`；runner 从 GitHub `production` Environment 取得 `VERCEL_TOKEN` 与仅用于 migration/verify 的 `DATABASE_URL`。workflow 的固定顺序是 **tag/main 校验 → Local migration validation → production migrate → production verify → exact tag Vercel Production deploy → smoke test → GitHub Release**。数据库迁移因此属于 release transaction，而不是发版后的人工补丁。若已发布 tag 的 workflow 因基础设施故障中止，可用同一 workflow 的手动入口指定该既有 tag 重试；它会重新核对 tag commit、完整 ledger 与 deploy provenance，不会移动 tag。

Vercel production builds 使用 [`scripts/vercel-build.ts`](../scripts/vercel-build.ts)：当 `VERCEL_ENV=production` 时，只有 release workflow 注入合法 `RIVALHUB_RELEASE_TAG` 与 `RIVALHUB_RELEASE_COMMIT` 后才继续；随后它使用现有 runtime Transaction Pooler `DATABASE_URL` 执行 exact production migration verify，再进入 `next build`。普通 `main` Git auto-deploy 即使被 Vercel 创建，也会在没有 release marker 时 fail closed 并保留上一版 production；Preview builds 不读取 production DB。build gate 只验证，不自动执行 migration，从而避免“DB 已前进但 application build 随后失败”的反向半发布状态。

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
- `NEXT_PUBLIC_AUTH_EMAIL_RESEND_COOLDOWN_SECONDS`（必须与 Hosted Supabase Auth 的 `auth.email.max_frequency` 相同）
- Turnstile 与第三方服务 key

生产启用 Supabase Confirm email。owner 经注册、邮箱确认和登录触发一次性 bootstrap；管理员统一使用 Supabase Auth 与数据库中的当前授权事实。

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
