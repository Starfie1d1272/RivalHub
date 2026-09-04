# RivalHub 部署与环境边界

本文档描述 RivalHub 2.x 的稳定环境模型和发布边界。它不是第三方 self-hosting 教程，也不复制具体 workflow 中已经固定的 project ID、host、secret 名称或实现细节。

## 2.x deployment scope

RivalHub 2.x 的正式运维目标是官方实例。仓库支持本地开发和验证，但不承诺第三方 production self-hosting、通用安装器或跨云部署兼容性。

当前官方运行栈以 Vercel + Supabase/PostgreSQL 为基础。具体 provider 配置由受保护的仓库 workflow、runtime environment 和 canonical scripts 管理。

## Environments

| 环境 | 主要用途 | 数据边界 |
| --- | --- | --- |
| **local** | 开发、migration replay、integration、browser E2E | 只允许 loopback Local Supabase/PostgreSQL |
| **preview** | PR / branch 的应用预览 | 不是 staging 数据库授权，不应获得远程写权限 |
| **staging** | 受保护的远程 migration / schema rehearsal | 独立远程数据库，只通过受保护 workflow 访问 |
| **production** | 正式赛事与真实用户 | 只执行正式发布和真实运营所需操作 |

最重要的边界是：**Preview ≠ staging authorization，main merge ≠ production deployment。**

## Release identity

`main` 是唯一长期 integration / releasable trunk，但普通 `main` merge 只表示代码已经进入可发布基线。

正式 production identity 是不可移动的 `vX.Y.Z` tag。release workflow 必须从同一个 tag commit 完成：

```text
exact release tag
→ validate migration chain / compatibility
→ migrate + verify production database
→ deploy exact tag commit
→ smoke
→ publish/update GitHub Release metadata
```

任何一步失败都应围绕同一个 tag 安全重试，而不是临时从另一个 commit 继续发布。

## Database authority

- `drizzle/migrations/` 是 active migration chain；
- `drizzle/legacy-migrations/` 只保留历史；
- `pnpm db:push` 被显式阻止；
- RLS、grant、trigger、policy、custom SQL 与 data backfill 都必须进入 active migration；
- remote schema change 只能通过受保护的 staging / production wrapper 执行。

Schema evolution 默认遵循 **expand → deploy → contract**。会让上一稳定版本失去兼容性的 contract cleanup，必须等旧应用不再依赖对应 owner 后再进入后续 release。

Migration 的具体开发流程见 [`operations/database-migrations.md`](./operations/database-migrations.md)。

## Remote write policy

本地命令不应从 `.env.local` 静默继承远程数据库作为 fallback。远程写入必须同时满足：

1. 明确的 target environment；
2. 受保护 workflow / environment；
3. canonical wrapper 对目标进行 fail-closed 校验；
4. 显式 remote-write authorization；
5. migration / verify / smoke 按固定顺序执行。

不要在普通 shell、PR Preview、手工 SQL console 或裸 Drizzle CLI 中绕过这些边界。

## Operations

具体执行步骤拆分到：

- [`operations/local-development.md`](./operations/local-development.md)：本地环境；
- [`operations/database-migrations.md`](./operations/database-migrations.md)：migration 开发与验证；
- [`operations/staging.md`](./operations/staging.md)：受保护 staging rehearsal；
- [`operations/release.md`](./operations/release.md)：正式发布。

测试证据模型见 [`testing.md`](./testing.md)，协作和 release branch 规则见 [`../CONTRIBUTING.md`](../CONTRIBUTING.md)。
