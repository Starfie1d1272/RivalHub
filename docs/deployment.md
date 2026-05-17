# Vercel 部署注意事项

生产域名：`https://match.starfie1d.top`。

## 数据库连接

### 为什么 Vercel 连不上 Supabase

Supabase 直接数据库主机名 `db.<project_ref>.supabase.co` 只有 IPv6 记录（无 A 记录），Vercel 无法通过 IPv6 访问，导致 `ENOTFOUND`。

### 解决方案：Session Pooler

使用 Supabase Session Pooler 主机名，它同时有 IPv4 和 IPv6 记录。

```
DATABASE_URL=postgresql://postgres.<project_ref>:<password>@aws-1-us-east-1.pooler.supabase.com:5432/postgres
```

| 项 | 值 |
|----|-----|
| 主机名 | `aws-1-us-east-1.pooler.supabase.com`（具体节点看 Supabase Dashboard） |
| 端口 | **5432**（Session Pooler，非 Transaction Pooler 的 6543） |
| 用户名 | `postgres.<project_ref>`（必须带 project ref，Pooler 用它识别租户） |
| SSL | 需要，`rejectUnauthorized: false` |

### Pooler 节点

每个 Supabase 项目分配的 Pooler 节点不同（`aws-0` / `aws-1`），不能猜测。去 Supabase Dashboard → Project Settings → Database → Connection string → Session Pooler 查看。

### db/client.ts 配置

```typescript
const pgConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,                   // Vercel serverless 必须限制池大小
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
};
```

### 注意事项

- **不要用 198.18.x.x IP**：这是国内 DNS 劫持返回的虚假地址，本地偶然能通但 Vercel 上不行
- **不要本地测试 Pooler 连接**：本地 DNS 可能返回虚假 IP，以 Vercel 运行时日志为准
- **Hobby 计划**：数据库 90 天不活跃会被暂停，定期访问保持活跃
- **生产环境变量**：所有 Supabase 相关变量（`DATABASE_URL`、`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`）需在 Vercel Dashboard 设置

## 环境变量清单

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | Session Pooler 连接字符串 |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project_ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon API key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key（仅服务端） |
| `ADMIN_SESSION_SECRET` | iron-session 加密密钥 |
| `ADMIN_INVITE_CODE` | 管理员邀请码 |
| `CRON_SECRET` | Cron endpoint 鉴权密钥 |
| `NEXT_PUBLIC_APP_URL` | 应用生产 URL（`https://match.starfie1d.top`） |
| `STEAM_API_KEY` | 可选，用于抓取选手 Steam 头像 |
| `SILICONFLOW_API_KEY` | 可选，用于玩家数据 OCR |

## 生产环境排错

### Vercel Runtime Logs 优先原则

生产环境报错时，**第一步永远是查 Vercel Runtime Logs**，凭堆栈推断错误源很容易猜错（堆栈是 minified 的，没有表名/路由信息）。

使用 MCP `get_runtime_logs` 过滤 `level=error`，看 Method + Path 列确定是哪个路由崩溃，再针对该路由的查询进行排查。

### 数据库迁移

新增表/列后，Schema 定义只在代码中，**生产数据库不会自动同步**：

```bash
pnpm db:push    # 将 Drizzle schema 推送到 Supabase 生产数据库
```

### Drizzle 关系查询已知陷阱

`matchRosterPlayers` 是全库唯一没有 `primaryKey()` 的表（用 `unique()` 复合约束）。任何 `db.query.matchRosters.findMany/findFirst({ with: { players: true } })` 都会触发 Drizzle 的 `buildRelationalQueryWithoutPK` 路径。若引用表解析失败会抛 `Cannot read properties of undefined (reading 'referencedTable')`。

**修复方式**：拆为两个独立 `db.select()` + 应用层 join，绕过关系查询构建器。

## Cron

Cron endpoint 均通过 `Authorization: Bearer $CRON_SECRET` 鉴权。

当前生产调用由 `.github/workflows/cron.yml` 每 5 分钟触发：

```text
https://match.starfie1d.top/api/cron/draft-timeout
https://match.starfie1d.top/api/cron/check-registration-deadline
https://match.starfie1d.top/api/cron/match-time-auto-award
```

Vercel Cron 当前未使用（依赖 GitHub Actions 调度）。需同时配置：

- Vercel 环境变量：`CRON_SECRET`
- GitHub Actions Secret：`CRON_SECRET`

若后续迁回 Vercel Cron，再更新 `vercel.json` 并确认计划支持所需频率。

## Auth

生产登录使用 Supabase email+password，Supabase 邮件确认关闭，不依赖邮件确认或 Magic Link。`/auth/callback` 仅作为兼容入口保留。
