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

管理员使用 invite code + password 登录，获得加密 session cookie：

```
POST /admin/login (Server Action: adminLogin)
  → 校验 inviteCode === process.env.ADMIN_INVITE_CODE
  → 校验 password === process.env.ADMIN_PASSWORD (bcrypt)
  → getIronSession() → session.isAdmin = true → session.save()
  → 重定向到 /admin/[seasonSlug]/registrations
```

管理员能做：
- 审核所有报名（通过 / 拒绝 / 等待名单）
- 确认前 8 名队长，生成 teams + draft_order
- 控制选秀流程（开始 / 暂停 / 强制跳过）
- 录入比赛比分
- 查看 audit_logs

**所有管理操作必须先调用 `requireAdmin()`，否则抛出 Unauthorized 错误。**

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

-- captain_votes: 只能读 count（不暴露谁投了谁）
-- 实际做法：Realtime 订阅 season_registrations 的 vote_count 聚合视图
-- 而非直接订阅 captain_votes 表
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
  cookieName: "nju-cs2-admin",
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
