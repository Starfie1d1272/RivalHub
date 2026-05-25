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
  │     ├── /api/cron/draft-timeout
  │     ├── /api/cron/check-registration-deadline
  │     └── /api/cron/match-time-auto-award
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
- `/login` — 邮箱+密码登录 / 注册页（生产关闭邮件确认，不依赖 Magic Link）
- `/settings/password` — 用户修改密码（需登录）
- `/invite` — 邀请码提权页（需已登录，URL 接收 `?code=xxx`）
- `/auth/callback` — Supabase Auth 回调兼容入口（生产主链路不依赖）
- `/admin/[seasonSlug]/...` — 管理员后台（`rivalhub-session` 或 `rivalhub-admin` 保护）
- `/admin/login` — Root 紧急登录（用户名+密码）
- `/api/cron/...` — Cron endpoint（当前由 GitHub Actions 触发，CRON_SECRET 验证）

### Server Actions 层（`src/actions/`）

**所有业务写逻辑的唯一入口**。每个 action 必须：
1. 校验输入（Zod）
2. 检查权限（admin action 调用 `requireAdmin()`）
3. 执行数据库事务
4. 写 audit_log（admin 操作）
5. 返回结构化错误（而非抛出异常给客户端）

具体文件清单请使用 CodeGraph（`codegraph_files src/actions/`）导航，避免本文档与代码不一致。

### DB 层（`src/db/`）

- `schema/` — Drizzle 表定义，18 张表（含 `admin_users` + `admin_invites` + `match_player_stats` + `registration_drafts`），严格 `season_id` 外键
- `client.ts` — Drizzle + pg Pool 单例（IPv4），通过 `DATABASE_URL` 连接 Supabase
- `seed.ts` — 种子数据（示例赛季 + 根管理员 RivalHub_root）

### Lib 层（`src/lib/`）

业务规则、查询辅助、赛制执行器、第三方适配层、工具函数。复杂逻辑优先从页面/action 下沉到这里。

- `auth/session.ts` — 双 Cookie iron-session：`rivalhub-session`（所有用户）+ `rivalhub-admin`（root 紧急）；`requireAdmin` / `requireSuperAdmin` / `requireSeasonAdmin` / `requireAuth`
- `auth/supabase.ts` — Supabase client（Server Action 调用 Auth；浏览器端用于 Realtime）
- `formats/` — StageExecutor 接口 + 赛制执行器（round-robin / double-elim / single-elim / swiss 预留）；注册表 `index.ts` 按 `StageType` 分发
- `bracket/` — `brackets-manager` 适配层（见下方 Bracket 适配层说明）
- `validators/` — Zod schema（中文错误消息）
- `utils/` — UTC 转换、season capability 判断、Tailwind class merge 等

其他模块请使用 CodeGraph（`codegraph_files src/lib/`）导航。

## 数据流：报名写入

```
用户填写表单（含 NJUBox 截图分享链接）
  → React Hook Form 校验（客户端 Zod）
  → submitRegistration Server Action
    → Zod 服务端二次校验
    → Upsert users（按 email）
    → 检查重复报名（UNIQUE user+season）
    → 检查位置满员（COUNT GROUP BY）
    → DB: INSERT season_registrations
  → 页面展示"报名成功"；选手通过 /login 使用邮箱+密码登录
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
      → 检查同位置 ≤ 2 人约束
      → INSERT draft_picks
      → UPDATE draftState (nextTeam / nextRound)
    → COMMIT
  → Supabase Realtime 广播 → 所有订阅客户端更新
```

## Server Action vs API Route 边界

| 操作 | 入口 |
|---|---|
| 所有业务写操作 | Server Action |
| Cron 触发（HTTP GET 无 body） | API Route |
| Supabase Webhook（未来） | API Route |
| 其他一切 | 禁止新增 API Route |

当前仅 3 个 Cron API Route：`draft-timeout`、`check-registration-deadline`、`match-time-auto-award`。`online-count` 已迁移为 Server Action。

## Bracket 适配层

所有 `brackets-manager` 调用必须经过 `src/lib/bracket/index.ts`，禁止在业务代码中直接 import 第三方库：

```
src/lib/bracket/index.ts
  ├── generateBracket()   → brackets-manager create
  ├── advanceMatch()      → brackets-manager update.match
  └── serializeBracket()  → brackets-viewer 数据格式
```

原因：`brackets-manager` 维护活跃度有限，换库时只需修改适配层，不影响业务代码。

## Realtime 订阅范围

**Realtime 是高成本能力，不是默认能力。** 订阅范围严格限定如下：

| 表 | 订阅方 | 触发场景 | 是否必须 |
|---|---|---|---|
| `draft_state` | 选秀围观页 + 队长面板 | 轮次 / 倒计时推进 | 必须 |
| `draft_picks` | 选秀围观页 | 新 pick 动画 | 必须 |
| `captain_votes` | 投票页面 | 实时票数（也可轮询替代） | 可选 |

**明确不使用 Realtime 的表**（用 RSC 刷新或轮询）：
`season_registrations`、`teams`、`team_members`、`matches`、`users`、`audit_logs`

**位置满员检测**：不使用 Realtime 订阅 `season_registrations`，改用提交报名时的服务端 COUNT 校验 + 页面加载时静态展示（位置满员时刷新后即显示，不需要推送）。

**禁止** `supabase.channel("*")` 或订阅上述列表以外的表。
