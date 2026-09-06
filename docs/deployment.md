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

`main` 是唯一长期 releasable trunk；不可移动的 `vX.Y.Z` tag 才是 shipped production identity。正式发布围绕同一个 tag commit 完成 migration、verify、exact-source deployment、smoke 与 GitHub Release；失败时重试同一安全步骤，不移动已公开 tag。

执行流程见 [`operations/release.md`](./operations/release.md)。

## Database authority

- `src/db/schema/`：当前应用 schema；
- `drizzle/migrations/`：active migration ledger；
- `drizzle/legacy-migrations/`：历史只读；
- `pnpm db:push`：禁止。

RLS、GRANT、trigger、policy、backfill 和 custom SQL 都进入 active migration。schema evolution 默认遵守 expand → deploy → contract；会破坏上一稳定应用兼容性的 cleanup 必须等待旧 owner 不再被 shipped version 依赖。

迁移开发见 [`operations/database-migrations.md`](./operations/database-migrations.md)。

## Remote write policy

远程写入必须同时具备：

1. 明确 target environment；
2. 受保护 workflow/environment；
3. canonical wrapper 的 fail-closed target 校验；
4. 显式 remote-write authorization；
5. 固定 migrate/verify/deploy/smoke 顺序。

普通本地 shell、Vercel Preview、Dashboard 手工 patch 或裸 Drizzle CLI 都不是 production/staging write path。本地工具也不能从 `.env.local` 静默 fallback 到远程数据库。

## Operations

- 本地环境：[`operations/local-development.md`](./operations/local-development.md)
- migration：[`operations/database-migrations.md`](./operations/database-migrations.md)
- staging：[`operations/staging.md`](./operations/staging.md)
- release：[`operations/release.md`](./operations/release.md)
- 测试证据：[`testing.md`](./testing.md)

provider project ID、host、secret 和 workflow 具体实现由受保护配置/代码拥有，不在本文件复制。
