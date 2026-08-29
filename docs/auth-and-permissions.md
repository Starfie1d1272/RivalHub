# 鉴权、权限与 Data API

## Normal account path

RivalHub 的正常账户路径是 Supabase Auth email/password + `public.users.role` + `rivalhub-session`。角色为 `user`、`season_admin` 与 `super_admin`。

```text
signup → confirmation email → auth callback → application session
login  → password authentication → application session
forgot password → recovery email → /reset-password
```

注册与登录采用 email/password；邮件链接用于注册确认、既有邮箱重新验证和密码恢复。注册不会立即创建应用 session；auth callback 在确认邮箱后同步 `users.emailVerifiedAt` 并建立 session。登录路径会同步应用账号，并在必要时检查 owner bootstrap。

## Owner bootstrap and emergency Root

Fresh deployment 的标准 bootstrap 是 `RIVALHUB_OWNER_EMAIL`：当该配置邮箱完成正常注册/登录，且 `public.users` 尚不存在任一 `super_admin` 时，事务与锁保护下将其升级为 `super_admin`。一旦已有 super_admin，此路径永久失效。

`admin_users` + `rivalhub-admin` 仍提供 legacy emergency Root compatibility path。它不承担正常 owner bootstrap，也不应用于常规管理员创建。常规权限授予经 `admin_invites` 和既有 Supabase 用户完成。

## Authorization

| 层级 | Server-side guard | 范围 |
|---|---|---|
| 已登录用户 | `requireAuth()` | 自己的账户和允许的参与者操作 |
| 赛季管理员 | `requireSeasonAdmin(seasonId)` | 被授权赛季 |
| 管理员 | `requireAdmin()` | 管理操作 |
| 超级管理员 | `requireSuperAdmin()` | 全局管理与高权限操作 |

客户端隐藏按钮不构成权限校验。所有业务 mutation 在 Server Action 内执行授权、输入校验、业务校验及适用的审计写入。

### Role and scope matrix

| 能力 | user | season_admin | super_admin | emergency Root |
|---|---:|---:|---:|---:|
| 普通账户、报名与队伍参与操作 | ✓ | ✓ | ✓ | — |
| 管理已授权赛季的报名、选秀、比赛、Major runtime、纪律与赛后 | — | ✓ | ✓ | ✓ |
| 创建或配置赛季、管理全局用户/机构与邀请码 | — | — | ✓ | ✓ |
| 全局 audit 查询 | — | — | ✓ | ✓ |

`season_admin` 的范围由 `users.adminSeasonIds` 保存。邀请被成功领取后，服务端更新角色/赛季范围并刷新 `rivalhub-session`，使后续 `requireSeasonAdmin(seasonId)` 使用新的授权事实。`super_admin` 不受单赛季列表限制。

### Admin invitation workflow

`admin_invites` 是正常 Supabase 用户提权的标准路径。超级管理员创建 scoped season-admin 或 global super-admin invitation；领取时服务端校验有效性、使用次数、过期时间与 season scope，在同一事务中更新用户授权、消耗 invitation 并写 audit。管理员创建/管理 invitation 本身要求 `requireSuperAdmin()`。

## Sessions

`rivalhub-session` 是正常用户/管理员会话，受 `ADMIN_SESSION_SECRET` 保护。`rivalhub-admin` 是 Root emergency session；两者分离以保留兼容边界。会话中的角色必须来自已建立的服务端事实，不能由客户端提交值推断。

## Data API / RLS baseline

当前安全基线是：业务数据库仅由 server-side application code 访问；`anon` 与 `authenticated` 对 public business tables 无业务 grants；Data API 默认拒绝。active migrations 已撤销 public business-table grants，Local Supabase 同时配置 `auto_expose_new_tables = false`。

这不是一份未来 direct-client 产品的 RLS policy matrix。若某一变更新增 direct Supabase client、公开数据面或 Realtime table，它必须在同一变更中明确提供：

1. 最小化的 `GRANT`；
2. 匹配的 RLS policy；
3. 正向与拒绝路径测试；
4. 对应文档更新。

现有 Realtime 仅允许 `draft_state`、`draft_picks` 与 `captain_votes`。

## Secrets and recovery

- `SUPABASE_SERVICE_ROLE_KEY` 仅在服务端使用，绝不放入 `NEXT_PUBLIC_*`。
- `CRON_SECRET` 用于 Cron bearer authentication。
- Turnstile site key 可以公开，`TURNSTILE_SECRET_KEY` 只能在服务端。
- 忘记密码邮件的跳转目标为 `/reset-password`；重置请求对外不泄露账户枚举信息。
