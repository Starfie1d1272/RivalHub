# 部署与数据库运行边界

## Environments

| 环境 | 用途 | 数据库规则 |
|---|---|---|
| local | 开发、migration/fixture 验证、并发与破坏性测试 | 仅 loopback Local Supabase，由 `db:local:*` 注入 |
| preview | feature branch、PR 和 release branch 的应用预览 | 由 Vercel Git Preview 提供；不授予 staging 数据库写入权限 |
| staging | 受保护的 migration rehearsal 与 schema verification | 独立 Supabase project，由手动 GitHub Environment workflow 访问 |
| production | 正式赛事与真实用户 | 只做真实赛事所需操作；不运行 destructive rehearsal |

Vercel Preview 不自动证明数据库隔离。**Preview ≠ staging DB authorization**：必须确认 target Vercel environment 和 Supabase project，才可在 staging 执行 seed、migration rehearsal、写入型 E2E 或赛事模拟。

## Vercel deployment contract

Repository-level Vercel Functions region 固定为 `hnd1`，与 production 当前运行配置一致。不要在本仓库增加 fallback 或多 region；也不要借此调整 Function runtime、memory 或 Supabase region。

### Preview

feature branch、PR 和 release branch 继续通过 Vercel Git Integration 创建 Preview deployment。`vercel.json` 只关闭 `main` branch 的 Git auto-deployment，未声明的 branch 继续使用默认开启语义；GitHub Integration、PR Preview 与 CLI deployment 均保留。

### Production

普通 `main` merge 不再创建 Vercel Git Production deployment。正式发布仍只有以下入口：

```text
release commit 合入 main
→ 创建 v* tag
→ .github/workflows/release.yml
→ active Drizzle migration / verify
→ vercel deploy --prod（精确 release commit）
→ smoke
```

`scripts/vercel-build.ts` 与 `assertProductionReleaseBuild()` 继续保留：任何意外的 Production build 若没有合法 release marker，仍会 fail closed。关闭 `main` auto-deployment 不等于移除 production provenance gate。

### Staging

应用 Preview 不会自动部署或迁移 staging。需要真实 staging rehearsal 时，人工触发 [`.github/workflows/staging.yml`](../.github/workflows/staging.yml) 的 `workflow_dispatch`，并使用 `ref` input 指定 branch、tag 或 commit（默认 `main`）。workflow 会记录实际 checkout 的 commit SHA，在 GitHub `staging` Environment 保护下执行：

```text
checkout requested ref
→ pnpm db:local:start-db
→ pnpm db:staging:migrate
→ pnpm db:staging:verify
→ always stop Local PostgreSQL
```

`db:staging:migrate` 内部已经负责 `drizzle check`、Local migration replay、Local verify、protected staging migrate 和 staging verify；workflow 不复制 migration algorithm、不执行 seed、reset 或 `db:push`。GitHub `staging` Environment 需要提供 `RIVALHUB_STAGING_DB_PASSWORD`；project confirmation 固定使用 `cueazphyskstwdhnzsxx`，写入必须由 `RIVALHUB_ALLOW_REMOTE_DB_WRITE=staging` 显式授权。该 workflow 只准备和验证 staging DB，不创建 staging app deployment，也不形成自动 `main → staging → production` promotion pipeline。

## Local Supabase

```bash
pnpm db:local:start
pnpm db:local:start-db
pnpm db:local:start-services
pnpm db:local:migrate
pnpm db:local:seed
pnpm db:local:verify
pnpm db:local:verify-db
pnpm db:local:verify-supabase
pnpm db:local:bootstrap
pnpm db:local:bootstrap-db
pnpm db:local:bootstrap-services
pnpm db:local:reset
pnpm dev:local
pnpm build:local
pnpm verify:local
```

`start-db` 使用 `supabase db start` 只启动 PostgreSQL；`start-services` 使用最小服务集合启动 PostgreSQL、Auth、Storage、PostgREST 和 Kong，并排除 Realtime、Mailpit、Studio、imgproxy、PgMeta、Edge Runtime、Logflare、Vector 与 Supavisor。`start` 和 `bootstrap` 保留为完整兼容入口；`bootstrap-db` / `verify-db` 只处理数据库，`bootstrap-services` / `verify-supabase` 只处理服务 contract。

`0034_database_access_boundary` 将所有 application-owned public base tables 收口为 server-only：撤销 `anon`/`authenticated` 的 table privileges、启用 RLS，并确保这些表不属于 `supabase_realtime` publication。`verify-db`、`verify-supabase`、migration verification 与 `db:production:verify` 都会读取 [`security/database-access-matrix.md`](./security/database-access-matrix.md) 对实际 PostgreSQL facts 做 fail-closed 比对；新增 public table 若没有矩阵分类不会通过验证。浏览器选秀/投票页面继续使用既有 polling，不依赖 Realtime 服务。

wrapper 从 `supabase status --output json` 获取连接，并验证 DB/API 指向 loopback；若状态包含 Studio，也会校验其 loopback URL。它不会读取 `.env.local` 的远程 `DATABASE_URL`，也不接受远程 URL fallback。`reset` 仅用于开发者明确要求的 Local 破坏性重建，再重放 active Drizzle migrations、fixtures 与验证；CI migration replay 使用独立 scratch/template database，不调用 `db reset`，不存在第二套业务 migration authority。`verify:local` 会确保最小服务栈 ready，重放 bootstrap/verify、运行不依赖数据库的 `verify`，随后运行 real-PG integration 与 browser E2E，并清理专用 fixture。

CI 的 DB-only critical path 不使用 `start-db`：`.github/workflows/ci.yml` 的 `postgres` job 直接使用官方 `postgres:17` service container，设置最小 `anon` / `authenticated` `NOLOGIN` prerequisite 后，通过 `test:integration:pg17` 回放完整 active Drizzle chain、seed、fixtures、`verify-db` 与 template-clone integration。`start-db` 仍是开发者 Local Supabase 兼容命令；无论 Local 还是 CI，active migrations 都只由 canonical Drizzle chain 执行。

## Active migrations

`drizzle/migrations/` 是活动迁移链，`drizzle/legacy-migrations/` 是只读历史。`pnpm db:check` 先对 changed surface 运行 migration-risk classifier，再校验活动链；`pnpm db:push` 被阻止，因为它无法执行 custom SQL、data backfill 或 fail-closed validation。

远程 migration 前必须确认独立环境、当前 migration baseline、精确 target 及显式写入授权。RLS、policy、trigger 和 Data API grants 应作为同一 active Drizzle migration 的 custom SQL 管理，不使用手工 schema patch。

### Migration compatibility contract

Production schema evolution 默认遵循 **expand → deploy → contract**：先加入新结构或兼容读写所需的 backfill，再部署能够同时处理旧/新形态的应用；只有旧应用不再读写旧结构后，后续 release 才进行 contract cleanup。小型纯 additive migration 不需要为了形式主义拆成多个 release，但会破坏旧应用兼容性的变化必须跨 release 收敛。

`pnpm db:migration-risk` 是 active Drizzle SQL changed surface 的风险分类器，不是兼容性证明器。它默认比较 `RIVALHUB_MIGRATION_BASE_SHA` 与 `RIVALHUB_MIGRATION_HEAD_SHA`（本地未提供 baseline 时检查当前未提交/未跟踪的 active migration），并报告以下 compatibility/locking risk：`DROP TABLE/COLUMN/TYPE`、rename、`ALTER COLUMN TYPE`、`SET NOT NULL`，以及明显可能 rewrite 或取得 exclusive lock 的 DDL。它不会重新分类未改动的历史 migration，也不建立第二份 migration ledger。两类风险必须使用与 statement category 对应的 durable annotation：

```sql
-- rivalhub:migration-risk: contract-cleanup <why the previous app no longer reads or writes the owner>
ALTER TABLE ... DROP COLUMN ...;
```

```sql
-- rivalhub:migration-risk: locking-reviewed <why this rewrite or lock is bounded and acceptable>
CREATE INDEX ...;
```

`contract-cleanup` 只接受 `DROP`、rename、`ALTER TYPE`/`ALTER COLUMN TYPE` 与 `SET NOT NULL`；`locking-reviewed` 只接受 `rewrite-or-exclusive-lock`（例如非 concurrent `CREATE INDEX` 与 `ADD CONSTRAINT`）。annotation category 错配或缺失都会 fail closed。注释只记录风险策略、阶段和原因，不自动证明安全；带风险的 migration 仍须通过 Local/real-PG replay、必要的 staging rehearsal 与 production preflight。active Drizzle ledger 仍是唯一 migration authority，checker 不建立 shadow migration system。明显 blocking risk 的 SQL 可以在经过验证的 SQL/session 中显式设置 bounded `lock_timeout` 或 `statement_timeout`，但本仓库不向 Drizzle URL 猜测性注入全局 timeout。

本地要复现 CI 的 changed-surface 判定，应显式使用当前 `main` 基线，例如：`RIVALHUB_MIGRATION_BASE_SHA=$(git merge-base HEAD origin/main) RIVALHUB_MIGRATION_HEAD_SHA=HEAD pnpm db:migration-risk`。CI 在 checkout 完整历史后传入 PR base/head SHA；没有 active migration 变化时，checker 明确输出 no changed active migrations。

`pnpm db:release-compat` 是独立于 `db:migration-risk` 的 N/N+1 兼容性门禁。它解析的是 single-trunk 上实际的 previous production stable，而不是 candidate branch 上偶然可见的最高 tag：若设置 `RIVALHUB_PREVIOUS_RELEASE_TAG`，该值必须是可解析的 stable `vX.Y.Z` tag；空值、raw revision、无效 tag 与 `-rc` 等 prerelease 都直接 fail closed。未显式指定时，CI/release 将 `RIVALHUB_PRODUCTION_STABLE_REF` 设为 `origin/main`，resolver 在该 main lineage 上按 semver 选择早于 candidate 的最新 stable tag；显式提供的 production ref 为空或不可解析时同样 fail closed。release retry 的 candidate tag 必须是实际 checkout commit，也没有静默退回其它 tag 的路径。CI 与 release workflow 都在 gate 前取得完整的 `origin/main`/tag history。PR CI 通过 `RIVALHUB_MIGRATION_BASE_SHA` / `RIVALHUB_MIGRATION_HEAD_SHA` 仅限定 candidate changed surface；release tag workflow 在没有这两个覆盖值时，以 previous production stable commit 到 candidate HEAD 的 active migration surface 复核一次。需要 source 证明时，checker 只读取 previous stable tag 中的 `src/db/schema/**`、`src/actions/**`、`src/lib/**`、`src/app/**`、`src/components/**` 与 `scripts/**`，并输出 migration `path:line` 及 previous source `path:line` evidence。

DROP/RENAME 的 relation、column、type owner 若仍被 previous stable shipped code 以 Drizzle schema/property 或带 table context 的 SQL 使用则拒绝；migration-risk annotation 只表示 cleanup 意图，不能绕过该证明。`ALTER TYPE` 与 `SET NOT NULL` 第一版始终 fail closed；`rewrite-or-exclusive-lock` 仍由 migration-risk 和 migration review 负责，不被误当作 app contract 证明。无法安全解析 owner 或无法判断 schema context 时同样拒绝猜测。

发布顺序固定为：

```text
Release N+1: expand + backfill + app switch；保留 N 仍依赖的旧 owner
Release N+2: previous stable 已不再读写 old owner 后才允许 contract
```

### Protected staging migration

`pnpm db:staging:migrate` 和 `pnpm db:staging:verify` 只服务受保护的 staging workflow。命令拒绝继承 `DATABASE_URL` 或 `.env.local`，并对 project ref、Transaction Pooler shape 和写入授权 fail closed。

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

正式 production release 由 `.github/workflows/release.yml` 的 `v*` tag workflow 独占：tag commit 必须已经包含在 `main`；runner 从 GitHub `production` Environment 取得 `VERCEL_TOKEN` 与仅用于 migration/verify 的 `DATABASE_URL`。workflow 的固定顺序是 **tag/main 校验 → Local migration validation → production migrate → production verify → exact tag Vercel Production deploy → smoke test → GitHub Release**。数据库迁移因此属于 release transaction，而不是发版后的人工补丁。若已发布 tag 的 workflow 因基础设施故障中止，可用同一 workflow 的手动入口指定该既有 tag 重试；它会重新核对 tag commit、完整 ledger 与 deploy provenance，不会移动 tag。若该 tag 的 GitHub Release 已处于 Immutable 状态，重试会保留其已发布 metadata，并继续完成此前未完成的 release transaction 验证。

Vercel production builds 使用 [`scripts/vercel-build.ts`](../scripts/vercel-build.ts)：当 `VERCEL_ENV=production` 时，只有 release workflow 注入合法 `RIVALHUB_RELEASE_TAG` 与 `RIVALHUB_RELEASE_COMMIT` 后才继续；随后它使用现有 runtime Transaction Pooler `DATABASE_URL` 执行 exact production migration verify，再进入 `next build`。普通 `main` Git auto-deploy 已由 repository config 关闭；如果出现其它意外 Production build，没有 release marker 时仍会 fail closed。Preview builds 不读取 production DB。build gate 只验证，不自动执行 migration，从而避免“DB 已前进但 application build 随后失败”的反向半发布状态。

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

生产 Cron 由 `.github/workflows/cron.yml` 每 5 分钟触发一个 `fail-fast: false` matrix；三个 endpoint 是三个独立 execution。单个 child 使用 connection timeout 10 秒、request max 60 秒、2 次 retry（最多 3 次尝试，retry 总窗口 180 秒），job timeout 为 5 分钟。一个 endpoint 最终失败不会取消其它两个 child，但不会被 `continue-on-error` 或 `|| true` 吞掉，因此 workflow 最终会显示 failure。

```text
/api/cron/draft-timeout
/api/cron/check-registration-deadline
/api/cron/match-time-auto-award
```

请求使用 `Authorization: Bearer $CRON_SECRET`，secret 只通过 GitHub Actions 环境变量注入。Vercel 环境变量和 GitHub Actions secret 必须配置相同的 `CRON_SECRET`；三个 Cron route 的业务幂等 owner 不变，调度、retry 或 timeout 变化时同步更新 workflow 与本文件。

## Production diagnostics

生产故障先在 Vercel Runtime Logs 中按 method、path 和 error 查证，再定位到相应路由、query 或 action。不要从 minified stack 或本地连接现象推断 production 状态。数据库 schema/迁移问题以 active migration ledger、migration SQL 与对应验证为准。

完整变量模板见 [`.env.example`](../.env.example)。真实值不得进入 repository、release notes 或操作日志。
