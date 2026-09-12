# RivalHub 部署与环境边界

本文件定义稳定环境模型；具体命令见 [`operations/`](./operations/)。RivalHub 2.x 优先服务官方实例，不承诺第三方 production self-hosting。

## Environments

| 环境 | 用途 | 写入边界 |
| --- | --- | --- |
| local | 开发、migration replay、integration、E2E | 只允许 loopback Local Supabase/PostgreSQL |
| preview | PR / branch 应用预览 | 不获得 staging/production 数据库写权限 |
| staging | 远程 migration/schema rehearsal | 仅受保护 workflow |
| production | 正式赛事与真实用户 | 仅正式 release path |

核心原则：**Preview ≠ staging authorization；main merge ≠ production deployment。**

## Release identity

`main` 是唯一长期 releasable trunk；不可移动的 `vX.Y.Z` tag 才是 shipped production identity。正式发布在验证 exact tag SHA 拥有成功的 canonical CI 证据后，围绕同一个 tag commit 完成 pre-release backup、DB-only migration rehearsal、production migration/verify、staged production deployment (`--prod --skip-domain`)、candidate smoke、promotion、canonical domain smoke 与 GitHub Release；失败时重试同一安全步骤，不移动已公开 tag。

Production 对外提供 public、no-store 的 `/api/system/release` read-back endpoint，只返回 deployed `releaseTag` 与 `releaseCommit`；受保护 backup runner 以该响应作为 production source identity，并在本地 checkout 验证 tag 到 commit 的关系。

执行流程见 [`operations/release.md`](./operations/release.md)。

## Database authority

- `src/db/schema/`：当前应用 schema；
- `drizzle/migrations/`：active migration ledger；
- `drizzle/legacy-migrations/`：历史只读；
- `pnpm db:push`：禁止。

RLS、GRANT、trigger、policy、backfill 和 custom SQL 都进入 active migration。schema evolution 默认遵守 expand → deploy → contract；会破坏上一稳定应用兼容性的 cleanup 必须等待旧 owner 不再被 shipped version 依赖。

敏感教育证据使用 private Storage，公开赛事二维码使用 dedicated `season-public-assets` public Storage；两类 bucket 的大小、MIME allowlist 与 public/private 属性均由 active migration 收敛；有 `storage.buckets` 的 Local/Hosted Supabase 才应用 bucket contract，plain PostgreSQL replay 只验证 public schema。不得在 `supabase/config.toml`、Dashboard 或额外 provisioning workflow 建立第二个 bucket owner；Local Supabase 的真实 Storage/Auth/Data API/browser 证据由对应 system lane 提供。

迁移开发见 [`operations/database-migrations.md`](./operations/database-migrations.md)。

## Remote write policy

远程写入必须同时具备：

1. 明确 target environment；
2. 受保护 workflow/environment；
3. canonical wrapper 的 fail-closed target 校验；
4. 显式 remote-write authorization；
5. 固定 migrate/verify/deploy/smoke 顺序。

普通本地 shell、Vercel Preview、Dashboard 手工 patch 或裸 Drizzle CLI 都不是 production/staging write path。本地工具也不能从 `.env.local` 静默 fallback 到远程数据库。

## Scheduler boundary

业务关键定时任务由 `src/lib/scheduler/definitions.ts` 维护唯一 registry：它拥有稳定 job key（Route Handler 路径由 job key 推导）、primary UTC cron 和 watchdog stale threshold。教育凭证清理的产品时间是北京时间每日 06:00，持久化为 UTC `0 22 * * *`；不要在 GitHub workflow、Vercel 配置或页面复制另一份 schedule。

Production primary 使用 Supabase `pg_cron` + `pg_net`：`public.dispatch_rivalhub_scheduler_job(text)` 只接受安全的 route segment、写入有界的 `scheduled_job_health.last_primary_triggered_at`，再从 Vault 读取固定名称的调度 base URL/credential 并异步调用现有 `/api/cron/<job-key>` endpoint。哪些 job 实际被创建由受保护的 TypeScript registry/provisioning command 唯一决定；领域 transition 仍由现有 TypeScript owner 执行，数据库函数不实现业务规则。

`.github/workflows/cron.yml` 保留每 5 分钟的四路调用，作为 watchdog 和人工 dispatch fallback。请求携带 `X-RivalHub-Cron-Source`；只有 primary trigger 与 primary endpoint success 都在 stale threshold 内时，watchdog 才返回 no-op，否则执行 canonical runner。缺少该 header 的旧调用按 `legacy` 执行，未知 source fail closed。浏览器不直连健康表、Data API 或 Realtime。

参与者在报名页看到“已到开放时间但 canonical opening fact 尚未落库”时，页面只触发一次受保护的 recovery Server Action；真正的 `registrationOpenedAt` 物化、重读和后续报名写入仍在同一 transaction owner 中完成。GET/RSC 本身不执行 mutation。

Release workflow 在 deployment smoke 成功后，使用受保护 production environment 执行 `pnpm db:production:scheduler:provision` 和 `pnpm db:production:scheduler:verify`：前者通过 named schedule upsert 幂等收敛 Vault secret 与 `cron.job`，后者实际调用 dispatch，并在有界窗口内等到 fresh primary trigger、endpoint success 与分钟级 job 成功证据，再发布 GitHub Release。普通本地命令不 provision production scheduler。

## Operations

- 本地环境：[`operations/local-development.md`](./operations/local-development.md)
- migration：[`operations/database-migrations.md`](./operations/database-migrations.md)
- staging：[`operations/staging.md`](./operations/staging.md)
- release：[`operations/release.md`](./operations/release.md)
- 测试证据：[`testing.md`](./testing.md)

provider project ID、host、secret 和 workflow 具体实现由受保护配置/代码拥有，不在本文件复制。

## Preview 数据边界

Vercel Preview 使用生产派生的脱敏 `rivalhub-dev` mirror，只读 role，不直接访问 production，也不使用 #569 的正式 R2 DR artifact。刷新由受保护的 [`Refresh Preview Data`](./operations/preview-mirror.md) workflow 执行；详见 [Preview 脱敏镜像运行手册](./operations/preview-mirror.md)。
