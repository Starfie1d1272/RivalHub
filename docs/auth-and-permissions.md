# 鉴权、权限与 Data API

本文件只描述安全 contract。精确输入、错误码和 transaction 以 auth code/tests 为准；表级访问事实见生成式 [`security/database-access-matrix.md`](./security/database-access-matrix.md)。

## Account path

RivalHub 使用 Supabase Auth email/password + `public.users` + `rivalhub-session`：

```text
signup → confirmation email → explicit confirmation → application session
login  → password authentication → application session
forgot password → recovery email → /reset-password
```

每个环境的 Supabase Auth redirect allowlist 必须包含该环境 `NEXT_PUBLIC_APP_URL` 下的 `/reset-password` 精确地址，否则恢复邮件可能回退到首页。本地配置同时覆盖 localhost 与 127.0.0.1；Hosted 配置在对应环境迁移/上线时核实。

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

Server Action 返回赛事范围的读取 DTO 时，也必须在 action 自身解析赛事公开状态或草稿授权，并确认目标资源属于该赛事；页面 Route 的访问检查不能替代 action 边界的校验。

教育证据是敏感的 server-only 数据。CHSI 与录取通知书提交必须重新验证当前 canonical user、verified email ownership 和 canonical institution；学校邮箱即时认证还必须命中 exact、active、auto-verify 且 `credentialType=student` 的 registry mapping。录取通知书图片只能由提交者经 Server Action 写入 private Storage，普通用户、season admin 和浏览器 Data API 没有 direct Storage 读策略；只有 `super_admin` 能通过受保护的 GET Route Handler 获取 60 秒 signed URL 并重定向至材料。object key、signed URL、原始文件名、图片内容和 CHSI code 不进入 public/client DTO 或 runtime log。

管理员邀请只给正常 Supabase 用户授予 `season_admin` scope 或 `super_admin`。invite usage、claim ledger、并发上限和重复领取由 transaction + DB constraint 保护；撤销授权读取当前数据库事实，不依赖客户端缓存。

系统状态页中的 scheduler health 和“立即运行一次”属于 `requireSuperAdmin()` 保护的 break-glass 能力。人工运行通过 shared scheduler execution owner 调用 canonical runner，并写入 `scheduler.manual_trigger` audit；按钮不是授权边界，也不允许客户端直接调用数据库或 endpoint。

## Session

`rivalhub-session` 保存最小身份信息和随机 session id；每个请求必须同时命中未过期的 `application_sessions` 注册记录及 active user。有效期 30 天，旧版本没有 session id 的 cookie 一律要求重新登录。读取不沿 merged alias 继承身份；当前邮箱、role 和 season grants 从数据库读取，权限撤销仍独立于登录撤销生效。React cache 只复用当前请求的认证快照，不跨请求缓存。

| 操作 | 会话结果 |
| --- | --- |
| 主动退出 | 删除当前注册记录；复制的同一 cookie 也失效，其它登录保留 |
| 改密、找回、撤销备用登录凭据 | 撤销该 canonical user 的全部应用会话，要求重新登录 |
| 账号归并 | 双方全部旧会话失效；重新证明凭据后才能登录保留账号 |
| 管理员强制退出 | 经 `revokeUserSessions`、`requireSuperAdmin` 与 audit 撤销目标的全部应用会话 |
| 修改角色、赛季授权、领取邀请码 | 后续请求读取最新权限，不补发登录会话 |

`src/lib/auth/session-registry.ts` 是唯一注册/校验/撤销 owner。颁发与撤销按 user row lock 串行；provider 验证前从数据库获取 authentication start timestamp，注册时与持久化撤销边界比较，避免旧登录请求在撤销后补发会话。时间比较留在 PostgreSQL，不将微秒精度降为 JavaScript Date 毫秒。注册时按用户清理过期记录，退出和全撤销直接删除对应记录。`user_sessions` 仅是在线心跳表，不承担认证。

密码更新先提交全撤销与 durable issuance block，再调用 Auth，最后重新推进撤销边界并解除 block。明确的 provider 拒绝不会报告成功，旧登录仍保持撤销；网络异常、5xx、数据库最终提交失败或进程中断时保留 block，避免跨系统未知结果下继续颁发会话。找回页面把 provider access token 交给 server boundary，通过 Supabase `getUser(token)` 远程验证 subject，再解析有效 credential 绑定；不相信客户端自报已改密，也不根据未经验证的 JWT claim 更新账号。

外部 Auth Dashboard/API 修改密码不会自动触发应用数据库撤销。受支持操作必须配套调用管理员 `revokeUserSessions`，且在 provider 修改前后各撤销一次；不能将 provider refresh token 撤销等同于应用会话撤销。若有中断的密码更新，先确认 provider 请求已终止、核实账号密码状态或完成受控重置，再由 super admin 显式调用 `revokeUserSessions({ userId, providerMutationSettled: true })` 解除阻断并再次全撤销；未核实结果不得解除。入口为管理员「所有用户 → 退出旧登录」；解除阻断必须显式勾选已核实声明。该操作有 audit，不提供设备列表 UI，不自动重试未知结果的密码写入。数据库备份可能携带历史注册记录；灾难恢复切换前必须轮换 `ADMIN_SESSION_SECRET`，避免恢复已撤销 cookie 的有效性。

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

- `SUPABASE_SECRET_KEY`、`ADMIN_SESSION_SECRET`、`CRON_SECRET`、Turnstile secret 等只在服务端使用；`SUPABASE_SERVICE_ROLE_KEY` 只兼容尚未迁移的环境。`CRON_SECRET` 是 provider-neutral 的 endpoint credential；Supabase primary 另从 Vault 的 `rivalhub_scheduler_base_url` 与 `rivalhub_cron_secret` 读取同一受保护凭据，GitHub watchdog 只从 protected secret 注入。
- `X-RivalHub-Cron-Source` 只用于 primary/watchdog/manual/legacy execution 分支与健康投影，不替代 `Authorization: Bearer CRON_SECRET`；缺失 header 兼容 legacy，未知值拒绝。
- `scheduled_job_health` 是 server-only 的有界当前投影，默认 RLS deny 且撤销 `anon`/`authenticated` grants；不提供浏览器 Data API 或 Realtime surface。
- secret 不进入 `NEXT_PUBLIC_*`、Client props、Issue/PR、fixture 或日志。
- Preview persona password 是公开的 disposable fixture credential，不属于 secret contract；具体账号和统一密码由 [`operations/preview-mirror.md`](./operations/preview-mirror.md) 维护。
- recovery/signup/token、Cookie、Authorization 和教育证据遵守相同的默认敏感边界。
- runtime 日志的脱敏与安全序列化见 [`operations/observability.md`](./operations/observability.md)。

## Preview personas

Preview 固定使用 `rivalhub-dev` 的 Auth。refresh 会提供 deterministic `player`、`invited`、`captain`、`season-admin`、`super-admin` 便捷测试账号：队长优先绑定当前赛事 linked Team 的 captain，season-admin 获得当前赛季 grant，super-admin 独立选择。它们使用公开、统一、可重置的 disposable fixture credential，不是安全边界；Vercel Deployment Protection 仍负责 Preview 访问控制。它们不是唯一允许登录的账号；正常 dev 注册、登录、重置和业务写入都可用。

Vercel Preview 仅可配置 dev-scoped Supabase URL、publishable/secret credential（旧 anon 配置兼容）、独立 `ADMIN_SESSION_SECRET` 与必要的 dev/sandbox provider credential；`SUPABASE_SERVICE_ROLE_KEY` 仅作为尚未迁移环境的 fallback。privileged credential 可以存在，但其权限必须只限 `rivalhub-dev`；production credential 永远不得进入 Preview。
