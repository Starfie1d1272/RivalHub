# 部署与数据库运行边界

## Environments

| 环境 | 用途 | 数据库规则 |
|---|---|---|
| local | 开发、migration/fixture 验证、并发与破坏性测试 | 仅 loopback Local Supabase，由 `db:local:*` 注入 |
| staging / preview | 独立的上线前 lifecycle rehearsal | 独立 Supabase project，与 production 隔离 |
| production | 正式赛事与真实用户 | 只做真实赛事所需操作；不运行 destructive rehearsal |

`dev` 或 Vercel Preview 本身不证明数据库隔离。必须先确认 target Vercel environment 和 Supabase project，才可在 staging 执行 seed、migration rehearsal、写入型 E2E 或赛事模拟。

## Local

```bash
pnpm db:local:start
pnpm db:local:migrate
pnpm db:local:seed
pnpm db:local:verify
pnpm db:local:bootstrap
pnpm db:local:reset
pnpm dev:local
```

wrapper 从 `supabase status` 获取连接并验证 loopback host。它不读取 `.env.local` 的远程 `DATABASE_URL`，也不接受远程 URL fallback。`reset` 仅重建 Local Supabase，然后重放 active Drizzle migrations、fixtures 与验证。

## Active migrations

`drizzle/migrations/` 是活动迁移链。`pnpm db:check` 进行静态链校验；`pnpm db:push` 被故意阻止，因为它不会执行 custom SQL、data backfill 或 fail-closed validation。

远程 migration 前必须确认：独立环境、当前 migration baseline、精确 target 及显式写入授权。`pnpm db:staging:migrate` / `pnpm db:staging:verify` 只面向受保护的 staging workflow；它们拒绝从 shell 或 `.env.local` 继承任意 `DATABASE_URL`。不要用手工 schema patch 替代 active migration。

## Hosted configuration

Hosted `DATABASE_URL` 应从目标 Supabase project Dashboard 获取，选择与部署环境和运行时模型匹配的正式连接方式。不要在文档、代码或 script 中猜测或固定 provider hostname / pooler endpoint。

staging 与 production 必须各自配置并隔离：

- `DATABASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_SESSION_SECRET`
- `RIVALHUB_OWNER_EMAIL`
- `CRON_SECRET`
- `NEXT_PUBLIC_APP_URL`
- Turnstile 配置与任何第三方 service key

生产启用 Supabase Confirm email。owner 通过正常注册、确认和登录流程触发一次性 bootstrap；Root credentials 仅是明确启用的 emergency compatibility path。

完整变量模板见 [`.env.example`](../.env.example)。禁止把真实值写入 repository、release notes 或操作日志。
