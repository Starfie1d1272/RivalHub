# 整体架构

## 模块依赖图

```
Browser
  ↕ HTTP (RSC / Server Action / API Route)
Next.js App Router (Vercel Edge / Node.js)
  ├── Server Components (数据读取)
  │     └── src/db/client (Drizzle → Supabase Postgres)
  ├── Server Actions (数据写入)
  │     ├── src/db/client
  │     └── src/lib/auth/session (iron-session)
  ├── API Route (Cron only)
  │     └── /api/cron/draft-timeout
  └── Client Components ("use client")
        └── Supabase Realtime (ws)
              └── Supabase Postgres (LISTEN/NOTIFY)
```

## 层次说明

### App Router 页面层（`src/app/`）

- **Server Components（默认）**：直接 `await db.query(...)` 读取数据，无需 `useEffect`。
- **Client Components**：仅用于：
  - Supabase Realtime 订阅（选秀、投票实时更新）
  - React Hook Form 表单
  - 倒计时组件
  - Toast / Dialog 等需要客户端状态的 UI

路由前缀：
- `/[seasonSlug]/...` — 公开赛季页面（无需登录）
- `/admin/[seasonSlug]/...` — 管理员后台（iron-session 保护）
- `/api/cron/...` — Vercel Cron 触发（CRON_SECRET 验证）

### Server Actions 层（`src/actions/`）

**所有业务写逻辑的唯一入口**。每个 action 必须：
1. 校验输入（Zod）
2. 检查权限（admin action 调用 `requireAdmin()`）
3. 执行数据库事务
4. 写 audit_log（admin 操作）
5. 返回结构化错误（而非抛出异常给客户端）

| 文件 | 职责 |
|---|---|
| `register.ts` | 提交报名、检查位置满员 |
| `admin.ts` | 登录、审核报名、确认队长 |
| `captains.ts` | 投 / 撤销队长票 |
| `draft.ts` | pick 选手、autoPick 超时 |
| `matches.ts` | 创建比赛、录入比分、更新 bracket |

### DB 层（`src/db/`）

- `schema/` — Drizzle 表定义，8 张表，严格 `season_id` 外键
- `client.ts` — Drizzle + pg Pool 单例，通过 `DATABASE_URL` 连接 Supabase
- `seed.ts` — 种子数据（Rivals 2026 Spring + Major 2026 Autumn 占位）

### Lib 层（`src/lib/`）

- `auth/session.ts` — iron-session（管理员）
- `auth/supabase.ts` — Supabase client（用户 magic link + Storage）
- `realtime/subscribe.ts` — Supabase Realtime 订阅封装
- `validators/` — Zod schema（中文错误消息）
- `utils/date.ts` — UTC ↔ Asia/Shanghai
- `utils/season.ts` — slug 解析与赛季状态判断
- `utils/cn.ts` — Tailwind class merge 工具

## 数据流：报名写入

```
用户填写表单
  → React Hook Form 校验（客户端 Zod）
  → submitRegistration Server Action
    → Zod 服务端二次校验
    → DB: INSERT season_registrations
    → Supabase Auth: sendMagicLink(email)
  → 页面重定向至"报名成功"
```

## 数据流：选秀 pick（并发安全）

```
队长点击"选择"按钮
  → pickPlayer(teamId, registrationId, clientRequestId)
    → Zod 校验
    → requireAdmin() / 验证 teamId 属于当前队长
    → BEGIN TRANSACTION
      → SELECT draftState WHERE seasonId FOR UPDATE  ← 行锁
      → 验证当前轮次是该队
      → 检查 clientRequestId 幂等（查 draft_picks）
      → 检查同位置 ≤ 3 人约束
      → INSERT draft_picks
      → UPDATE draftState (nextTeam / nextRound)
    → COMMIT
  → Supabase Realtime 广播 → 所有订阅客户端更新
```

## Server Action vs API Route 边界

| 操作 | 入口 |
|---|---|
| 所有业务写操作 | Server Action |
| Vercel Cron 触发（HTTP GET 无 body） | API Route |
| Supabase Webhook（未来） | API Route |
| 其他一切 | 禁止新增 API Route |

## Realtime 订阅范围

| 表 | 订阅方 | 触发场景 |
|---|---|---|
| `captain_votes` | 投票页面（所有登录用户） | 实时票数更新 |
| `draft_state` | 选秀围观页 + 队长面板 | 当前轮次 / 倒计时更新 |
| `draft_picks` | 选秀围观页 | 新 pick 动画 |
| `season_registrations` | 报名页（位置计数） | 位置满员实时关闭 |
