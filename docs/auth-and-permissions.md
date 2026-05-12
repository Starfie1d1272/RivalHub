# 鉴权与权限

## 统一鉴权架构（auth-v2）

所有用户（普通选手、赛季管理员、超级管理员）统一通过 **Supabase email+password** 登录，登录成功后建立 `rivalhub-session` iron-session Cookie，`users.role` 字段控制权限分级。

生产环境关闭 Supabase 邮件确认，不依赖 Magic Link。原因是免费版 Supabase 邮件额度较低，不适合作为赛事高峰期登录链路。

Root 紧急账号（`RivalHub_root`）保留原有用户名+密码登录方式，使用独立的 `rivalhub-admin` Cookie，不影响日常管理流程。

---

## 登录流程

### 普通用户 / 管理员（邮箱+密码）

```
用户访问 /login
  → 选择注册或登录
  → signUp / loginWithPassword Server Action
    → supabase.auth.signUp 或 signInWithPassword
    → db.users upsert / insert
    → createUserSession({ userId, email, role, adminSeasonIds })
    → 写入 rivalhub-session Cookie（iron-session 加密，30 天）
    → redirect(next ?? "/")
```

`/auth/callback` 保留为 Supabase Auth 兼容入口，但生产登录流程不依赖邮件确认或 Magic Link。

### Root 紧急登录（用户名+密码）

```
POST /admin/login (Server Action: adminLogin)
  → 查询 admin_users 表按 username
  → scrypt 验证 password vs password_hash
  → 写入 rivalhub-admin Cookie（iron-session，8 小时）
  → redirect("/admin")
```

---

## 管理员提权（邀请码）

```
管理员创建邀请码 → /admin/invites
  → createInviteCode({ role, seasonId?, maxUses, expiresInHours })
    → role = "admin"（→ season_admin）或 "super_admin"
    → seasonId 仅在创建 season_admin 邀请时填写（绑定赛季）

用户获得邀请码 → /invite?code=xxx
  → 未登录：redirect /login?next=/invite?code=xxx
  → 已登录：展示邀请确认表单
    → claimInviteCode(code)
      → 校验邀请码（isActive / usedCount / expiresAt）
      → users.role 更新：role="admin" → "season_admin"，role="super_admin" → "super_admin"
      → 若 seasonId 存在：users.adminSeasonIds 追加该赛季 UUID
      → 刷新 rivalhub-session Cookie（同步新权限）
      → redirect("/admin")
```

---

## 角色定义

### 用户角色（`users.role`）

| 角色 | 值 | 说明 |
|---|---|---|
| `user` | 默认 | 普通选手，可登录、查看报名状态、投票 |
| `season_admin` | 提权后 | 赛季管理员，可管理 `adminSeasonIds` 中指定赛季 |
| `super_admin` | 提权后 | 超级管理员，可管理所有赛季 + 创建 super_admin 邀请码 |

### 系统角色（兼容旧体系）

| 角色 | 标识方式 | 说明 |
|---|---|---|
| `guest` | 未登录 | 访问公开页面 |
| `root` | `rivalhub-admin` Cookie | 紧急登录账号，等价于 super_admin 权限 |

### 前端展示角色（无持久化，由查询推导）

| 角色 | 推导来源 | 说明 |
|---|---|---|
| `registered` | `season_registrations` 存在记录 | 已提交本届报名 |
| `approved` | `registrations.status = "approved"` | 审核通过的选手 |
| `captain` | `teams.captain_registration_id` 指向自己 | 当前赛季的队长 |

---

## 能力 × 角色矩阵

| 能力 | guest | user | season_admin | super_admin/root |
|---|---|---|---|---|
| 查看赛季 hero / 规则书 | ✅ | ✅ | ✅ | ✅ |
| 查看队伍列表 / 详情 | ✅ | ✅ | ✅ | ✅ |
| 查看赛程 / Bracket / 比赛详情 | ✅ | ✅ | ✅ | ✅ |
| 查看自己的报名状态 | ❌ | ✅ | ✅ | ✅ |
| 提交报名 | ✅ | ✅（未报名） | ✅ | ✅ |
| 投队长票 | ❌ | ✅（审核通过且 voting 阶段） | ✅ | ✅ |
| 撤票 | ❌ | ✅（审核通过且 voting 阶段） | ✅ | ✅ |
| 围观选秀 | ✅ | ✅ | ✅ | ✅ |
| 操作选秀 pick | ❌ | ❌ | ❌ | ✅（代选/调试） |
| 审核报名 | ❌ | ❌ | ✅（管辖赛季） | ✅ |
| 确认队长名单 | ❌ | ❌ | ✅（管辖赛季） | ✅ |
| 录入比分 | ❌ | ❌ | ✅（管辖赛季） | ✅ |
| 创建邀请码 | ❌ | ❌ | ✅（仅 admin 级） | ✅（含 super_admin 级） |
| 停用 / 启用管理员账户 | ❌ | ❌ | ❌ | ✅ |
| 查看 audit log | ❌ | ❌ | ✅（管辖赛季） | ✅ |

### 校验位置

| 能力类型 | 校验位置 |
|---|---|
| 公开能力 | 无 |
| 任意已登录用户 | Server Action 内 `await requireAuth()` |
| season_admin / super_admin | Server Action 内 `await requireAdmin()` |
| 仅 super_admin | Server Action 内 `await requireSuperAdmin()` |
| 特定赛季 admin | Server Action 内 `await requireSeasonAdmin(seasonId)` |

**禁止仅在客户端隐藏按钮就视为已校验**。

---

## Supabase RLS 策略

### 默认原则：拒绝一切

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
-- 不添加 PERMISSIVE policy = 所有操作均被拒绝
```

### 表级读写权限矩阵

| 表 | 匿名读 | 登录用户读 | 登录用户写 | Service Role |
|---|---|---|---|---|
| `seasons` | ✅ 公开 | ✅ | ❌ | ✅ |
| `users` | ❌ | 仅自己 | 仅自己 | ✅ |
| `season_registrations` | ❌ | 仅自己 | 仅自己（INSERT） | ✅ |
| `captain_votes` | ❌ | 仅自己 | 仅自己（INSERT/DELETE） | ✅ |
| `teams` | ✅ | ✅ | ❌ | ✅ |
| `team_members` | ✅ | ✅ | ❌ | ✅ |
| `draft_state` | ✅ | ✅ | ❌ | ✅ |
| `draft_picks` | ✅ | ✅ | ❌ | ✅ |
| `matches` | ✅ | ✅ | ❌ | ✅ |
| `audit_logs` | ❌ | ❌ | ❌ | ✅ |

> **重要**：Server Actions 通过 `DATABASE_URL`（Postgres 直连）以 Service Role 权限执行，绕过 RLS。RLS 仅限制 Supabase JS Client 的直接查询（如 Realtime 订阅）。

### Realtime 订阅 RLS

```sql
CREATE POLICY "draft_state_public_read" ON draft_state FOR SELECT USING (true);
CREATE POLICY "draft_picks_public_read" ON draft_picks FOR SELECT USING (true);
CREATE POLICY "captain_votes_public_read" ON captain_votes FOR SELECT USING (true);
```

---

## Session 管理

### `rivalhub-session`（所有已登录用户）

```typescript
// src/lib/auth/session.ts
interface UserSession {
  userId: string;        // users.id
  email: string;
  role: "user" | "season_admin" | "super_admin";
  adminSeasonIds: string[];  // season_admin 的管辖赛季列表
}
```

| 配置项 | 值 |
|---|---|
| Cookie 名 | `rivalhub-session` |
| 加密 Secret | `ADMIN_SESSION_SECRET`（≥ 32 字符） |
| 有效期 | 30 天 |

工具函数：
- `getUserSession()` → `UserSession | null`
- `createUserSession(user)` → 写 Cookie
- `destroyUserSession()` → 清除 Cookie
- `requireAuth()` → `UserSession`（未登录抛 UNAUTHORIZED）
- `requireAdmin()` → `UserSession`（role ≠ user 或 root，否则抛 UNAUTHORIZED）
- `requireSuperAdmin()` → `UserSession`（role = super_admin 或 root）
- `requireSeasonAdmin(seasonId)` → `UserSession`（super_admin 或持有该赛季权限的 season_admin）

### `rivalhub-admin`（仅 Root 紧急登录）

```typescript
interface AdminSessionData {
  isAdmin: boolean;
  adminId?: string;       // admin_users.id
  adminUsername?: string;
  adminRole?: "super_admin" | "admin";
}
```

| 配置项 | 值 |
|---|---|
| Cookie 名 | `rivalhub-admin` |
| 有效期 | 8 小时 |

> `requireAdmin()` 优先检查 `rivalhub-session`，若无再 fallback `rivalhub-admin`（root）。两者共用 `ADMIN_SESSION_SECRET`。

---

## 安全注意事项

1. `ADMIN_SESSION_SECRET` 必须 ≥ 32 字符，由 `pnpm seed` 自动生成，生产环境在 Vercel 配置，不提交 git。
2. `SUPABASE_SERVICE_ROLE_KEY` 仅在 Server Action / API Route 使用，**禁止**暴露给客户端。
3. Cron route 通过 `Authorization: Bearer $CRON_SECRET` 验证，防止未授权触发。
4. v1 报名截图使用 NJUBox 分享链接，不走 Supabase Storage；若后续恢复私有 bucket，必须通过 Service Role 生成短期签名 URL。
5. 生产环境关闭邮件确认，避免 Supabase 免费邮件额度限制影响登录。
