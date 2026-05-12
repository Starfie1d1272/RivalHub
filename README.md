# RivalHub

RivalHub 是一个面向高校电竞赛事的开源赛事管理平台，覆盖报名、审核、队长投票、蛇形选秀、队伍展示、赛程管理、Bracket、比分录入、数据统计与上线部署。

当前 `1.0.0` 版本服务于 **2026 NJU Rivals 春季赛**：8 支队伍、队长投票、蛇形选秀、排位赛 + 双败淘汰，生产站点部署在 [match.starfie1d.top](https://match.starfie1d.top)。

## 功能状态

| 模块 | 1.0.0 能力 |
|---|---|
| 赛季管理 | capability 驱动的多赛事模型，所有公开页面使用 `/[seasonSlug]` 路由 |
| 报名 | 邮箱密码账号、报名草稿、Zod 校验、位置/人数上限、NJUBox 截图链接 |
| 审核 | 管理员审核、等待名单、邀请码提权、操作审计 |
| 队长投票 | 每人最多 3 票，Realtime 刷新票数 |
| 选秀 | 队长面板、围观直播间、倒计时、事务行锁、幂等 pick、超时自动递补 |
| 队伍 | 阵容展示、首发/替补、队长标识 |
| 比赛 | 赛程、Bracket、地图结果、比分录入、比赛状态流转 |
| 协商 | 管理员设置最晚完成时间，队长协商截止自动为前 24 小时 |
| 名单 | 每场比赛提交 5 名首发 + 最多 2 名替补 |
| 数据 | 完美平台截图 OCR、比赛数据表、MVP 投票、选手/队伍统计 |
| 部署 | Vercel + Supabase + GitHub Actions Cron |

## 技术栈

| 层 | 选型 |
|---|---|
| Web | Next.js 15 App Router, React 19, TypeScript strict |
| UI | Tailwind CSS v4, shadcn/ui, 自定义 Tactical Grid 组件 |
| 数据 | Supabase Postgres, Auth, Realtime |
| ORM | Drizzle ORM |
| 表单 | React Hook Form, Zod |
| 鉴权 | Supabase email+password + iron-session |
| 赛程图 | `brackets-manager` / `brackets-viewer`，经 `src/lib/bracket` 适配 |
| 测试 | Vitest, React Testing Library, Playwright |
| 部署 | Vercel |

## 快速开始

```bash
pnpm install
cp .env.example .env.local
pnpm db:push
pnpm seed
pnpm dev
```

本地开发地址：`http://localhost:3000`

`pnpm seed` 会创建 Root 管理员：

```text
username: RivalHub_root
password: RivalHub_password
```

首次部署后请尽快在后台修改默认密码。

## 环境变量

完整模板见 [.env.example](./.env.example)。

| 变量 | 用途 |
|---|---|
| `DATABASE_URL` | Supabase Postgres 连接串；Vercel 生产建议使用 Session Pooler |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 浏览器端 Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | 服务端 Supabase service role key |
| `ADMIN_SESSION_SECRET` | iron-session 加密密钥，至少 32 字符 |
| `NEXT_PUBLIC_APP_URL` | 应用公开 URL |
| `CRON_SECRET` | 选秀超时 Cron 鉴权密钥 |
| `STEAM_API_KEY` | 可选，抓取选手 Steam 头像 |
| `SILICONFLOW_API_KEY` | 可选，玩家数据 OCR |

## 部署

生产部署目标是 Vercel + Supabase：

1. 在 Supabase 创建项目并应用 Drizzle 迁移。
2. 在 Vercel 配置 `.env.example` 中的环境变量。
3. 生产 `DATABASE_URL` 使用 Supabase Dashboard 提供的 **Session Pooler** 连接串。
4. 运行 `pnpm seed` 或等价脚本创建 Root 管理员。
5. 在 GitHub Actions Secrets 配置 `CRON_SECRET`。
6. 合并到 `main` 后由 Vercel 部署生产站点。

当前选秀超时自动递补由 `.github/workflows/cron.yml` 每分钟请求：

```text
https://match.starfie1d.top/api/cron/draft-timeout
```

更多细节见 [docs/deployment.md](./docs/deployment.md)。

## 数据库与安全

RivalHub 的业务写操作走 Server Actions，浏览器只使用 Supabase Realtime 订阅少数公开变化。

上线推荐的 RLS 形态：

| 表 | 浏览器权限 |
|---|---|
| `draft_state` | `SELECT` + Realtime |
| `draft_picks` | `SELECT` + Realtime |
| `captain_votes` | `SELECT` + Realtime |
| 其它业务表 | 启用 RLS，但不创建浏览器访问 policy |

不要把 `SUPABASE_SERVICE_ROLE_KEY` 暴露到任何 `NEXT_PUBLIC_` 变量中。

## 常用命令

```bash
pnpm dev          # 本地开发
pnpm build        # 生产构建
pnpm type-check   # Next route typegen + TypeScript
pnpm test         # Vitest
pnpm test:e2e     # Playwright
pnpm db:generate  # 生成 Drizzle migration
pnpm db:push      # 推送 schema 到数据库
pnpm seed         # 创建 Root 管理员
```

## 文档

| 文档 | 内容 |
|---|---|
| [PHASES.md](./PHASES.md) | 开发阶段与完成情况 |
| [CLAUDE.md](./CLAUDE.md) | 项目工程手册与 AI 协作约束 |
| [docs/launch-readiness.md](./docs/launch-readiness.md) | 1.0.0 上线前规则与功能对照 |
| [docs/architecture.md](./docs/architecture.md) | 架构与模块边界 |
| [docs/data-model.md](./docs/data-model.md) | 数据模型、ER 图、约束 |
| [docs/auth-and-permissions.md](./docs/auth-and-permissions.md) | 鉴权、权限与 RLS 策略 |
| [docs/registration-flow.md](./docs/registration-flow.md) | 报名流程 |
| [docs/draft-flow.md](./docs/draft-flow.md) | 选秀事务与并发安全 |
| [docs/state-machines.md](./docs/state-machines.md) | 关键业务状态机 |
| [docs/deployment.md](./docs/deployment.md) | Vercel/Supabase 部署手册 |
| [docs/testing.md](./docs/testing.md) | 测试策略 |
| [docs/superpowers/archive/](./docs/superpowers/archive/) | 过程性设计稿与执行计划归档 |

## 分支与发布

| 分支 | 用途 |
|---|---|
| `main` | 生产部署分支，只通过 PR 合入 |
| `dev` | 日常集成分支 |
| `v2` | NJU Major / 32 队公开赛方向 |
| `v3` | 泛用赛事平台方向 |

发布前至少运行：

```bash
pnpm type-check
pnpm test
pnpm build
```

## License

[MIT](./LICENSE)
