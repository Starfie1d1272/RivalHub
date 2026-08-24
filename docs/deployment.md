# Vercel 部署注意事项

生产域名：`https://match.starfie1d.top`。

## 环境分层

| 环境 | 用途 | 数据库 |
|---|---|---|
| production | 当前 NJU 赛事和正式站点 | 生产 Supabase 项目 |
| staging / preview | 外部试点、seed、E2E、demo 导入压测 | 独立 Supabase 项目 |
| local | 本地开发 | loopback Local Supabase，由 `db:local:*` 动态注入 |

外部试点必须使用独立 staging：独立 Vercel environment / preview deployment + 独立 Supabase 项目。不要在生产数据库上运行 seed、Playwright E2E、demo 批量导入压测或权限越权测试。

## 本地 2.0 数据库

本地开发不读取 `.env.local` 的 `DATABASE_URL`，也不允许 staging/production URL 作为 fallback。使用项目固定的 Supabase CLI：

```bash
pnpm db:local:start       # 完整 Local Supabase：Postgres/Auth/Storage/Data API
pnpm db:local:migrate     # 仅向已验证 loopback DB 应用 Drizzle active migrations
pnpm db:local:seed        # Root + Local Major fixture
pnpm db:local:verify      # migration ledger + Auth + Storage + Data API deny-by-default
pnpm db:local:bootstrap   # start → migrate → seed → verify
pnpm db:local:reset       # --local reset → migrate → seed → verify
pnpm dev:local            # 由 Local Supabase status 注入应用变量
```

所有命令从 `supabase status --output json` 读取实际端口，并再次验证 DB/API/Studio 都是 `localhost`、`127.0.0.1` 或 `::1`。启动使用只绑定 `127.0.0.1` 的 `rivalhub-local` Docker network。`reset` 显式传 `--local --no-seed`；Supabase migration/seed 被禁用，随后只重放 `drizzle/migrations`，因此不存在第二套业务 migration authority。

默认本地 Root 凭据为 `local-admin` / `local-admin-password`，仅由本地 wrapper 注入；可用 `RIVALHUB_LOCAL_ROOT_USERNAME` / `RIVALHUB_LOCAL_ROOT_PASSWORD` 覆盖。

直接 `pnpm seed` 不再读取 `.env.local`。远程 seed 必须同时声明：

```text
RIVALHUB_DB_TARGET=staging|production
RIVALHUB_DB_HOST_CONFIRM=<DATABASE_URL 中精确 host:port>
RIVALHUB_ALLOW_REMOTE_DB_WRITE=<与 target 相同>
```

这些变量只是防误操作确认，不替代 staging 隔离与 migration baseline gate。

staging 与 production 必须分离的变量：

| 变量 | 分离要求 |
|---|---|
| `DATABASE_URL` | 指向 staging Supabase Pooler |
| `NEXT_PUBLIC_SUPABASE_URL` | 指向 staging Supabase 项目 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 使用 staging anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | 使用 staging service role key |
| `ADMIN_SESSION_SECRET` | staging 独立生成 |
| `CRON_SECRET` | staging 独立生成；不要复用 GitHub Actions production secret |
| `NEXT_PUBLIC_APP_URL` | 指向 staging 域名 |
| `SILICONFLOW_API_KEY` | 可复用服务商账号，但建议用独立限额 key |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | 如启用 Turnstile，使用 staging 对应配置 |

---

## 数据库连接

### 为什么 Vercel 连不上 Supabase

Supabase 直接数据库主机名 `db.<project_ref>.supabase.co` 只有 IPv6 记录（无 A 记录），Vercel 无法通过 IPv6 访问，导致 `ENOTFOUND`。

### 解决方案：Transaction Pooler（推荐）

Session Pooler（5432）在 serverless 场景下容易连接池耗尽（`EMAXCONNSESSION`，pool_size=15）。Transaction Pooler（6543，PgBouncer 事务模式）将数千客户端连接复用到少量实际连接，专为 serverless 设计。

```
DATABASE_URL=postgresql://postgres.<project_ref>:<password>@aws-1-us-east-1.pooler.supabase.com:6543/postgres
```

| 项 | 值 |
|----|-----|
| 主机名 | `aws-1-us-east-1.pooler.supabase.com`（具体节点看 Supabase Dashboard） |
| 端口 | **6543**（Transaction Pooler） |
| 用户名 | `postgres.<project_ref>`（必须带 project ref，Pooler 用它识别租户） |
| SSL | 需要，`rejectUnauthorized: false` |

### 回滚：切回 Session Pooler

```
# 1. Vercel env → DATABASE_URL 端口改回 5432
# 2. db/client.ts → 删除 prepare: false，max 改回 1
```

### Pooler 节点

每个 Supabase 项目分配的 Pooler 节点不同（`aws-0` / `aws-1`），不能猜测。去 Supabase Dashboard → Project Settings → Database → Connection string 查看。

### db/client.ts 配置

```typescript
const pgConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  prepare: false,            // Transaction Pooler 不支持 prepared statements
  max: 3,                    // 允许单实例内并行查询
  idleTimeoutMillis: 5000,
  connectionTimeoutMillis: 10000,
};
```

### 注意事项

- **不要用 198.18.x.x IP**：这是国内 DNS 劫持返回的虚假地址，本地偶然能通但 Vercel 上不行
- **不要本地测试 Pooler 连接**：本地 DNS 可能返回虚假 IP，以 Vercel 运行时日志为准
- **Hobby 计划**：数据库 90 天不活跃会被暂停，定期访问保持活跃
- **生产环境变量**：所有 Supabase 相关变量（`DATABASE_URL`、`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`）需在 Vercel Dashboard 设置
- **在线人数轮询**：每 5 分钟心跳，`user_sessions` 表写入失败时静默跳过

## 环境变量清单

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | Session Pooler 连接字符串 |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project_ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon API key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key（仅服务端） |
| `ADMIN_SESSION_SECRET` | iron-session 加密密钥 |
| `ADMIN_INVITE_CODE` | 管理员邀请码 |
| `CRON_SECRET` | Cron endpoint 鉴权密钥 |
| `NEXT_PUBLIC_APP_URL` | 应用生产 URL（`https://match.starfie1d.top`） |
| `STEAM_API_KEY` | 可选，用于抓取选手 Steam 头像 |
| `SILICONFLOW_API_KEY` | 可选，用于玩家数据 OCR |

## 生产环境排错

### Vercel Runtime Logs 优先原则

生产环境报错时，**第一步永远是查 Vercel Runtime Logs**，凭堆栈推断错误源很容易猜错（堆栈是 minified 的，没有表名/路由信息）。

使用 MCP `get_runtime_logs` 过滤 `level=error`，看 Method + Path 列确定是哪个路由崩溃，再针对该路由的查询进行排查。

### 数据库迁移

Schema 定义只在代码中，远程数据库不会自动同步。`pnpm db:push` 已 fail closed 禁用：

- `db:push` 按 TypeScript schema 与远端 DB 直接 diff 同步，**不执行** migration SQL 中的 custom SQL / data backfill / fail-closed validation 逻辑，无法替代包含这些内容的 migration；
- pre-2.0 legacy migration chain 已冻结至 `drizzle/legacy-migrations/`（只读历史，禁止修改）；
- 2.0 active chain 位于 `drizzle/migrations/`，从 fresh baseline 开始：
  - `0000_v2_baseline` = PR1 之前（pre-PR1）的完整 schema；
  - `0001_canonical_team_identity` = canonical team identity 数据迁移（backfill + fail-closed validation），是 existing DB 必须实际执行的第一条 2.0 migration；
- **existing DB 不能执行 baseline DDL**（`0000_v2_baseline` 只用于 empty/fresh 数据库）；
- existing DB adoption 流程：先确认真实 schema 与 baseline 等价 → 建立 baseline ledger marker → 再由 migrator 执行 `0001+`；
- staging 隔离与 remote adoption 仍未确认：**禁止任何远程 migration**（包括盲目运行 `drizzle-kit migrate`）；
- RLS、policy、trigger 和显式 Data API grants 如需新增，必须作为 custom SQL 留在同一 Drizzle active migration chain；禁止另建 `supabase/migrations` 业务链；

（migration 的校验实现以对应 migration SQL 与测试为 source of truth。）

### Drizzle 关系查询已知陷阱

`matchRosterPlayers` 是全库唯一没有 `primaryKey()` 的表（用 `unique()` 复合约束）。任何 `db.query.matchRosters.findMany/findFirst({ with: { players: true } })` 都会触发 Drizzle 的 `buildRelationalQueryWithoutPK` 路径。若引用表解析失败会抛 `Cannot read properties of undefined (reading 'referencedTable')`。

**修复方式**：拆为两个独立 `db.select()` + 应用层 join，绕过关系查询构建器。

## Cron

Cron endpoint 均通过 `Authorization: Bearer $CRON_SECRET` 鉴权。

当前生产调用由 `.github/workflows/cron.yml` 每 5 分钟触发：

```text
https://match.starfie1d.top/api/cron/draft-timeout
https://match.starfie1d.top/api/cron/check-registration-deadline
https://match.starfie1d.top/api/cron/match-time-auto-award
```

Vercel Cron 当前未使用（依赖 GitHub Actions 调度）。需同时配置：

- Vercel 环境变量：`CRON_SECRET`
- GitHub Actions Secret：`CRON_SECRET`

若后续迁回 Vercel Cron，再更新 `vercel.json` 并确认计划支持所需频率。

## Auth

生产登录使用 Supabase email+password，Supabase 邮件确认关闭，不依赖邮件确认或 Magic Link。`/auth/callback` 仅作为兼容入口保留。
