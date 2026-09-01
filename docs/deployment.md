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

### Production migration and release transaction

Production 的 active chain 只有一个 authority：`drizzle/migrations/meta/_journal.json` 与对应 SQL SHA-256。禁止裸 `drizzle-kit migrate`、手工 `ALTER TABLE`、`db:push`、seed 或 reset。

Production 与应用运行时统一使用同一个 Supabase **Transaction Pooler `DATABASE_URL`**：`aws-0-ap-northeast-1.pooler.supabase.com:6543`。不维护第二份 production database password。受保护命令复用 Vercel Production 的 runtime `DATABASE_URL`，但在查询或写入前仍严格验证固定 project ref、host、port、username 和 pooler shape；写入还必须显式设置 `RIVALHUB_ALLOW_REMOTE_DB_WRITE=production`。

正常 production owner 是 [`.github/workflows/release.yml`](../.github/workflows/release.yml)，由不可变 `v*` tag 触发。它把数据库与应用部署作为同一条 release transaction 串行执行：

1. checkout 精确 tag commit，并确认该 commit 已进入 `main`；
2. 安装依赖与固定版本 Vercel CLI，读取 Vercel Production project/environment；
3. 启动 Local Supabase，验证 active migration chain 可在真实 PostgreSQL 重放；
4. 使用 Vercel 已有 Production `DATABASE_URL` 执行 production preflight、Drizzle forward migration 与 exact ledger/schema verify；
5. 仅在数据库已达到该 tag 的 active chain 后，部署这个精确 tag commit 到 Vercel Production；
6. 对 deployment URL 与 `match.starfie1d.top` 做 smoke test；
7. 前述步骤全部成功后才创建或更新 GitHub Release。

workflow 使用 GitHub `production` environment 串行化发版，并要求其中存在 `VERCEL_TOKEN`。这是 release runner 访问 Vercel 的部署凭据，不是第二份数据库凭据；`DATABASE_URL` 的 source of truth 仍只有 Vercel Production Environment。

Vercel production builds 使用 [`scripts/vercel-build.ts`](../scripts/vercel-build.ts) 做最后一道 fail-closed gate：

- Preview build 不读取 production DB；
- Production build 必须携带 release workflow 注入的 `RIVALHUB_RELEASE_TAG` 与 `RIVALHUB_RELEASE_COMMIT`，普通 `main` Git auto-deploy 因缺少 release provenance 会在 `next build` 前失败，因此不会绕过 tag release；
- release build 还必须通过 exact production migration ledger 与 terminal schema verification；build 本身永远不执行 migration。

因此 production invariant 是：**schema first, exact verify, then exact tagged application deploy**。即使 Vercel Git integration 对 `main` 发起 production build attempt，也只能失败并保留上一版 production，不会把未正式发版的 commit 提升到 production。

`db:production:migrate` 与 `db:production:verify` 仍保留为 workflow 使用的底层 primitive，也可用于明确授权的 break-glass 运维；日常发版不应依赖操作者在 tag 后手工补 migration。

```bash
# Break-glass read-only verification. DATABASE_URL 必须是既有 production runtime secret。
DATABASE_URL='<existing production runtime DATABASE_URL>' \
RIVALHUB_DB_TARGET=production \
RIVALHUB_PRODUCTION_PROJECT_CONFIRM=sucokfotkypwqkckfynp \
RIVALHUB_PRODUCTION_DB_HOST_CONFIRM=aws-0-ap-northeast-1.pooler.supabase.com:6543 \
pnpm db:production:verify

# Break-glass forward migration only; normal releases use release.yml.
DATABASE_URL='<existing production runtime DATABASE_URL>' \
RIVALHUB_DB_TARGET=production \
RIVALHUB_PRODUCTION_PROJECT_CONFIRM=sucokfotkypwqkckfynp \
RIVALHUB_PRODUCTION_DB_HOST_CONFIRM=aws-0-ap-northeast-1.pooler.supabase.com:6543 \
RIVALHUB_ALLOW_REMOTE_DB_WRITE=production \
pnpm db:production:migrate
```

当前 production preflight 只接受已确认的 `0024_major_runtime_convergence` ledger prefix 或完整 active chain。处于 0024 prefix 时，会在只读 transaction 中验证旧 schema shape，以及 0025 CHSI code extraction、0026 canonical role 的 fail-closed predicate。migration 后 verifier 要求完整 ledger SHA/timestamp sequence、`evidence_code` 存在、`evidence_url`/`perfect_id` 不存在，并要求 canonical `cs2_role` enum。

对于未来 migration，仍优先采用 expand → migrate/backfill → contract 的兼容策略。release workflow 的顺序保证不能替代 backward-compatible schema 设计：如果 migration 已成功而应用部署失败，上一版 production application 应尽可能仍能运行。

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
