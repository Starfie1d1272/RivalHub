# 鉴权、权限与 Data API

本文件只描述安全 contract。精确输入、错误码和 transaction 以 auth code/tests 为准；表级访问事实见生成式 [`security/database-access-matrix.md`](./security/database-access-matrix.md)。

## Account path

RivalHub 使用 Supabase Auth email/password + `public.users` + `rivalhub-session`：

```text
signup → confirmation email → explicit confirmation → application session
login  → password authentication → application session
forgot password → recovery email → /reset-password
```

注册不会直接根据 signup response 建立应用身份或 session；确认/登录成功后才同步 `public.users`。对外提示不得泄露账号是否已存在等可枚举状态。

Fresh deployment 的 owner bootstrap 只通过 `RIVALHUB_OWNER_EMAIL`：当尚无 `super_admin` 时，该邮箱的正常账号流程可在锁保护下完成首次提权；一旦已有 super admin，此路径失效。

## Authorization

`users.role` 只有 `user` 与 `super_admin`；赛季管理员由 `season_admin_grants` 表达，不是第三个全局 role。

| Guard | Scope |
| --- | --- |
| `requireAuth()` | 当前登录用户允许的 participant 操作 |
| `requireSeasonAdmin(seasonId)` | 指定赛季授权 |
| `requireAdmin()` | super admin 或至少一个 season grant |
| `requireSuperAdmin()` | 全局高权限操作 |

| 能力 | 普通用户 | Season admin | Super admin |
| --- | ---: | ---: | ---: |
| 账户、报名、Team 等参与者操作 | ✓ | ✓ | ✓ |
| 管理获授权赛事的报名、比赛、纪律与赛后 | — | ✓ | ✓ |
| 创建/配置赛事、管理全局用户/机构/邀请码 | — | — | ✓ |
| 查询全局 audit | — | — | ✓ |

客户端隐藏按钮不构成授权。所有 privileged mutation 必须在服务端重新鉴权，并在适用时写 audit。

管理员邀请只给正常 Supabase 用户授予 `season_admin` scope 或 `super_admin`。invite usage、claim ledger、并发上限和重复领取由 transaction + DB constraint 保护；撤销授权读取当前数据库事实，不依赖客户端缓存。

系统状态页中的 scheduler health 和“立即运行一次”属于 `requireSuperAdmin()` 保护的 break-glass 能力。人工运行通过 shared scheduler execution owner 调用 canonical runner，并写入 `scheduler.manual_trigger` audit；按钮不是授权边界，也不允许客户端直接调用数据库或 endpoint。

## Session

`rivalhub-session` 只保存最小身份信息。当前 role 与 season grants 每次从数据库读取，因此撤销权限会在后续请求生效；session 不保存可长期延续的授权快照。

## Data API baseline

业务数据库默认 **server-only**：`anon` / `authenticated` 对 application-owned public tables 无业务 grants，RLS 默认 deny。first-party browser Supabase client 只用于 Auth；业务 live view 使用 server refresh/polling，而不是旁路直连表。

如果未来新增 direct Data API 或 Realtime surface，同一变更必须同时定义：

1. 实际 browser consumer；
2. 最小 `GRANT`；
3. 对应 RLS policy/publication；
4. 一致性与授权语义；
5. 允许与拒绝路径测试；
6. database access matrix 更新。

不得先在客户端接表、再把权限治理留作后续工作。

## Secrets

- `SUPABASE_SERVICE_ROLE_KEY`、`ADMIN_SESSION_SECRET`、`CRON_SECRET`、Turnstile secret 等只在服务端使用。`CRON_SECRET` 是 provider-neutral 的 endpoint credential；Supabase primary 另从 Vault 的 `rivalhub_scheduler_base_url` 与 `rivalhub_cron_secret` 读取同一受保护凭据，GitHub watchdog 只从 protected secret 注入。
- `X-RivalHub-Cron-Source` 只用于 primary/watchdog/manual/legacy execution 分支与健康投影，不替代 `Authorization: Bearer CRON_SECRET`；缺失 header 兼容 legacy，未知值拒绝。
- `scheduled_job_health` 是 server-only 的有界当前投影，默认 RLS deny 且撤销 `anon`/`authenticated` grants；不提供浏览器 Data API 或 Realtime surface。
- secret 不进入 `NEXT_PUBLIC_*`、Client props、Issue/PR、fixture 或日志。
- recovery/signup/token、Cookie、Authorization 和教育证据遵守相同的默认敏感边界。
- runtime 日志的脱敏与安全序列化见 [`operations/observability.md`](./operations/observability.md)。
