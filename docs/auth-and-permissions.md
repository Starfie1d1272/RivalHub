# 鉴权、权限与 Data API

## Normal account path

RivalHub 的唯一账户路径是 Supabase Auth email/password + `public.users` + `rivalhub-session`。`users.role` 只允许 `user` 与 `super_admin`；赛季管理员不是持久化全局角色，而是 `season_admin_grants` 中的精确用户—赛季授权事实。

```text
signup → confirmation email → confirmation page → explicit confirmation POST → application session
login  → password authentication → application session
forgot password → recovery email → /reset-password
```

注册与登录采用 email/password；邮件链接用于注册确认、既有邮箱重新验证和密码恢复。注册不会立即创建应用 session；确认页的 GET 不验证 token，而由用户显式确认后的 POST 同步 `users.emailVerifiedAt` 并建立 session。登录路径会同步应用账号，并在必要时检查 owner bootstrap。

## Owner bootstrap

Fresh deployment 的标准 bootstrap 是 `RIVALHUB_OWNER_EMAIL`：当该配置邮箱完成正常注册/登录，且 `public.users` 尚不存在任一 `super_admin` 时，事务与锁保护下将其升级为 `super_admin`。一旦已有 super_admin，此路径永久失效。管理员不依赖额外的用户名/密码根账户。

## Authorization

| 层级 | Server-side guard | 范围 |
|---|---|---|
| 已登录用户 | `requireAuth()` | 自己的账户和允许的参与者操作 |
| 赛季管理员 | `requireSeasonAdmin(seasonId)` | `season_admin_grants` 中与该赛季完全匹配的授权 |
| 管理员 | `requireAdmin()` | super admin 或至少一个赛季授权 |
| 超级管理员 | `requireSuperAdmin()` | 全局管理与高权限操作 |

客户端隐藏按钮不构成权限校验。所有业务 mutation 在 Server Action 内执行授权、输入校验、业务校验及适用的审计写入。

### Role and scope matrix

| 能力 | 普通 `user` | 持有 season grant 的用户 | `super_admin` |
|---|---:|---:|---:|
| 普通账户、报名与队伍参与操作 | ✓ | ✓ | ✓ |
| 管理被授权赛季的报名、选秀、比赛、Major runtime、纪律与赛后 | — | ✓ | ✓ |
| 创建或配置赛季、管理全局用户/机构与邀请码 | — | — | ✓ |
| 全局 audit 查询 | — | — | ✓ |

### Admin invitation workflow

`admin_invites` 是正常 Supabase 用户提权的标准路径。邀请码的 `role` 只有 `season_admin` 与 `super_admin`：前者必须绑定一个 `seasonId`，后者必须是 global invite。领取由 `claimAdminInviteInTx` 负责：锁定 invite、读取 `admin_invite_claims` 计数、检查有效性与 `maxUses`，再在同一事务中写入精确 grant 或全局角色、claim ledger 和 audit。`admin_invite_claims(inviteId, userId)` 的唯一约束禁止同一账号重复领取，并发领取不能超过 `maxUses`。

管理员创建/撤销 invitation 与撤销用户授权本身要求 `requireSuperAdmin()`；撤销授权会删除用户的全部 `season_admin_grants` 并将 `users.role` 设回 `user`。

## Sessions

`rivalhub-session` 是唯一应用会话，受 `ADMIN_SESSION_SECRET` 保护，只保存 `userId` 与 `email`。角色和赛季范围每次由当前 `users` 与 `season_admin_grants` 读取，因此数据库撤销会在下一次请求生效；客户端不能提交或延续权限缓存。所有 audit actor 都使用 session 的 `userId`。

## Data API / RLS baseline

当前安全基线是：业务数据库仅由 server-side application code 访问；`anon` 与 `authenticated` 对 public business tables 无业务 grants；Data API 默认拒绝。0034 active migration 对全部 application-owned public base tables 启用 RLS 并撤销 grants；完整的表级分类、consumer inventory 和 terminal facts 见 [`security/database-access-matrix.md`](./security/database-access-matrix.md)。Local Supabase 同时配置 `auto_expose_new_tables = false`。

这不是一份未来 direct-client 产品的 RLS policy matrix。若某一变更新增 direct Supabase client、公开数据面或 Realtime table，它必须在同一变更中明确提供：

1. 最小化的 `GRANT`；
2. 匹配的 RLS policy；
3. 正向与拒绝路径测试；
4. 对应文档更新。

当前 first-party browser Supabase client 仅用于 Auth。`DraftLiveRoom` 与 `CaptainVotingPanel` 的旧 Realtime 订阅已删除，UI 继续使用 server refresh/polling；任何未来 direct Data API 或 Realtime surface 都必须先更新访问矩阵并补齐实际 consumer、RLS/grant/publication 与正反例测试。

## Secrets and recovery

- `SUPABASE_SERVICE_ROLE_KEY` 仅在服务端使用，绝不放入 `NEXT_PUBLIC_*`。
- `CRON_SECRET` 用于 Cron bearer authentication。
- Turnstile site key 可以公开，`TURNSTILE_SECRET_KEY` 只能在服务端。
- 忘记密码邮件的跳转目标为 `/reset-password`；重置请求对外不泄露账户枚举信息。
