# 鉴权与权限

## 两套鉴权体系

### 1. 普通用户 — Supabase Auth Magic Link

用户无需密码，通过邮件魔法链接完成登录：

```
用户填写报名表单（含 email）
  → submitRegistration Server Action
    → INSERT season_registrations
    → supabase.auth.signInWithOtp({ email })
  → 用户点击邮件链接
    → Supabase Auth 回调 → 写入 auth session cookie
    → 关联 users 表（auth_id）
```

用户登录后能做：
- 查看自己的报名状态
- 在投票阶段为最多 3 名候选人投票
- 在选秀阶段（若为队长）操作选秀面板

### 2. 管理员 — iron-session 加密 Cookie

管理员使用用户名 + 密码登录，通过 `admin_users` 表进行 scrypt 密码验证：

```
POST /admin/login (Server Action: adminLogin)
  → 查询 admin_users 表按 username
  → 校验 is_active = true
  → scrypt 验证 password vs password_hash
  → getIronSession() → session.isAdmin = true + adminId/username/role → session.save()
  → 重定向到 /admin（管理仪表盘）
```

新管理员通过邀请码注册：
```
POST /admin/register (Server Action: registerAdmin)
  → 校验邀请码（admin_invites.code，检查 isActive / usedCount / expiresAt）
  → 自设用户名 + 密码（scrypt 哈希存储）
  → INSERT admin_users，更新邀请码使用次数
  → 自动登录 → 重定向到 /admin
```

根管理员通过 `pnpm seed` 创建（`RivalHub_root` / `RivalHub_password`，super_admin 角色）。

管理员角色分级：
- `super_admin`：可管理其他管理员（停用/启用），创建 super_admin 邀请码
- `admin`：审核报名等日常操作

管理员能做：
- 审核所有报名（通过 / 拒绝 / 等待名单）
- 创建/撤销管理员邀请码
- 停用/启用其他管理员（仅 super_admin）
- 修改自己的密码
- 确认前 8 名队长，生成 teams + draft_order（Phase 6）
- 控制选秀流程（Phase 7-8）
- 录入比赛比分（Phase 10）
- 查看 audit_logs

**所有管理操作必须先调用 `requireAdmin()`，否则抛出 Unauthorized 错误。**

---

## 角色定义

| 角色 | 标识方式 | 说明 |
|---|---|---|
| `guest` | 未登录 | 访问公开页面 |
| `user` | Supabase Auth session | 登录但未报名当前赛季 |
| `registered` | season_registrations 存在记录（任意 status）| 已提交本届报名 |
| `approved` | registrations.status = `approved` | 审核通过的选手 |
| `captain` | teams.captain_registration_id 指向自己 | 当前赛季的队长 |
| `admin` | iron-session.isAdmin = true | 赛委会管理员（v1 单一角色，v2 可拆 super_admin / admin / observer） |

> **v2 规划**：admin 角色拆分为 `super_admin / admin / observer`，并在 audit_log 记录 actor_role。v1 暂用单一 admin。

---

## 能力 × 角色矩阵

| 能力 | guest | user | registered | approved | captain | admin |
|---|---|---|---|---|---|---|
| 查看赛季 hero / 规则书 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 查看队伍列表 / 详情 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 查看赛程 / Bracket / 比赛详情 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 查看自己的报名状态 | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 提交报名 | ❌ | ✅ | ❌（已报名） | ❌ | ❌ | ❌ |
| 投队长票 | ❌ | ❌ | ✅(仅 voting 阶段) | ✅ | ✅ | ✅ |
| 撤票 | ❌ | ❌ | ✅(仅 voting 阶段) | ✅ | ✅ | ✅ |
| 围观选秀 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 操作选秀 pick | ❌ | ❌ | ❌ | ❌ | ✅(仅自己回合) | ✅(代选/调试) |
| 查看选秀历史记录 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 审核报名 | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| 确认队长名单 | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| 启动 / 暂停选秀 | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| 录入比分 | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| 查看 audit log | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| 生成 / 访问私有 Storage 签名 URL | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

### 校验位置

| 能力类型 | 校验位置 |
|---|---|
| 公开能力 | 无 |
| user / registered / approved 能力 | Server Action 内 `await requireAuthenticatedUser()` + 业务条件查询 |
| captain 能力 | Server Action 内验证 `team.captainRegistrationId` 与当前用户 registration_id 一致 |
| admin 能力 | Server Action 内 `await requireAdmin()`（首行） |

**禁止仅在客户端隐藏按钮就视为已校验**。所有 Server Action 必须在服务端做权限校验。

---

## Supabase RLS 策略

### 默认原则：拒绝一切

```sql
-- 对每张表执行
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

> **重要**：Server Actions 通过 `DATABASE_URL`（Postgres 直连）以 Service Role 权限执行，绕过 RLS。RLS 仅限制 Supabase JS Client 的直接查询（如 Realtime 订阅用的 select）。

### Realtime 订阅 RLS

Realtime 走 Supabase JS Client，受 RLS 约束。需添加以下 SELECT policy 让客户端能接收 broadcast：

```sql
-- draft_state: 所有人可读（围观）
CREATE POLICY "draft_state_public_read" ON draft_state
  FOR SELECT USING (true);

-- draft_picks: 所有人可读
CREATE POLICY "draft_picks_public_read" ON draft_picks
  FOR SELECT USING (true);

-- captain_votes: 公开 SELECT，前端订阅 INSERT/DELETE 后自行 COUNT 聚合
-- （不需要单独的物化视图；不暴露 voter_registration_id 时可在 SELECT policy 中 column-level 限制）
CREATE POLICY "captain_votes_public_read" ON captain_votes
  FOR SELECT USING (true);
```

---

## Session 管理（iron-session）

```typescript
// src/lib/auth/session.ts
interface AdminSessionData {
  isAdmin: boolean;
  seasonSlug?: string; // 可选赛季范围限定
}

const sessionOptions = {
  password: process.env.ADMIN_SESSION_SECRET, // ≥ 32 字符随机串
  cookieName: "rivalhub-admin",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 8, // 8 小时
  },
};
```

---

## 安全注意事项

1. `ADMIN_SESSION_SECRET` 必须 ≥ 32 字符，生产环境在 Vercel 环境变量配置，不提交到 git。
2. `SUPABASE_SERVICE_ROLE_KEY` 仅在 Server Action / API Route 使用，**禁止**暴露给客户端。
3. Cron route 通过 `Authorization: Bearer $CRON_SECRET` 验证，防止未授权触发。
4. 报名截图存储在私有 bucket，需通过 Service Role 生成签名 URL，管理员审核时才读取。
