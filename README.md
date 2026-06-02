# RivalHub

RivalHub 是一个面向高校电竞赛事的开源赛事管理平台。当前生产验证重点是 NJU 选秀联赛流程：个人报名、审核、队长投票、选秀、排位赛、双败淘汰赛、基础比分和数据录入。

项目采用 capability 驱动的多赛事模型。赛季能力由配置决定，公开路由以 `seasonSlug` 区分，避免把具体赛事、赛制或阶段硬编码进业务逻辑。

生产站点：[match.starfie1d.top](https://match.starfie1d.top)

## 当前能力状态

不要把 capability 预设或设计文档等同于生产可用能力。外部试点前请先阅读 [docs/external-pilot-readiness.md](./docs/external-pilot-readiness.md)。

| 状态 | 模块 | 能力 |
|---|---|
| 已实战验证 | 赛季 | 多赛季路由、能力开关、阶段状态机、赛季发布与归档 |
| 已实战验证 | 个人报名 | 邮箱账号、表单校验、草稿恢复、位置与人数限制、截图链接 |
| 已实战验证 | 审核 | 管理员审核、候补名单、邀请码提权、操作审计 |
| 已实战验证 | 队长投票 | 候选人确认、限票规则、票数展示与实时更新 |
| 已实战验证 | 选秀 | 蛇形选秀、事务行锁、幂等 pick、超时自动递补 |
| 已实战验证 | 队伍 | 选秀生成队伍后的阵容展示、队长标识、队名与队徽管理 |
| 已实战验证 | 比赛 | 排位赛、双败淘汰、BP / 地图结果、阵容提交、比分录入、MVP 投票 |
| 已实战验证 | 协商 | 比赛时间提议、接受/拒绝、管理员强制设定、截止自动裁定 |
| 已实战验证 | 数据 | OCR 录入、选手/队伍基础统计、排行榜、审计日志 |
| 已实现待验收 | Demo | demo ZIP 导入、批量匹配、OCR 冲突确认、覆盖导入、Steam alias 绑定、部分详情展示 |
| 已实现待验收 | 评分 | `@rivalhub/rival-rating` 接入、RR / PRISM 重算入口 |
| 设计/配置中 | Major / Swiss | Major preset、Swiss executor 和展示基础；完整三段 Swiss 运营闭环仍需 staging 验收和 UI 补强 |
| 尚未实现 | 队伍报名 | 外部队伍自助报名、审核、生成队伍流程 |
| 尚未实现 | Broadcast | public broadcast API、OBS / vMix overlay、MVP 转播卡 |

## 技术栈

| 层 | 选型 |
|---|---|
| Web | Next.js App Router, React, TypeScript strict |
| UI | Tailwind CSS, shadcn/ui, 自定义 Tactical Grid 组件 |
| Demo 解析 | `cs2-demo-format` ZIP 导入；完整分析展示仍在建设 |
| 数据 | Supabase Postgres, Auth, Realtime, Storage |
| ORM | Drizzle ORM |
| 表单 | React Hook Form, Zod |
| 鉴权 | Supabase email/password + iron-session |
| Bracket | `brackets-manager` / `brackets-viewer`，经 `src/lib/bracket` 适配 |
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

`pnpm seed` 会创建初始 Root 管理员。首次部署后请尽快在后台修改默认密码。

```text
username: RivalHub_root
password: RivalHub_password
```

## 环境变量

完整模板见 [.env.example](./.env.example)。

| 变量 | 用途 |
|---|---|
| `DATABASE_URL` | Supabase Postgres 连接串；生产建议使用 Session Pooler |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 浏览器端 Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | 服务端 Supabase service role key |
| `ADMIN_SESSION_SECRET` | iron-session 加密密钥，至少 32 字符 |
| `NEXT_PUBLIC_APP_URL` | 应用公开 URL |
| `CRON_SECRET` | Cron API 鉴权密钥 |
| `STEAM_API_KEY` | 可选，抓取 Steam 头像 |
| `SILICONFLOW_API_KEY` | 可选，玩家数据 OCR |

不要把 `SUPABASE_SERVICE_ROLE_KEY` 暴露到任何 `NEXT_PUBLIC_` 变量中。

## 部署

生产部署目标是 Vercel + Supabase：

1. 在 Supabase 创建项目并应用 Drizzle schema / migration。
2. 在 Vercel 配置 `.env.example` 中列出的环境变量。
3. 生产 `DATABASE_URL` 使用 Supabase Dashboard 提供的 Session Pooler 连接串。
4. 运行 `pnpm seed` 或等价脚本创建 Root 管理员。
5. 在 GitHub Actions Secrets 配置 `CRON_SECRET`。
6. 合并到 `main` 后由 Vercel 部署生产站点。

Cron 由 GitHub Actions 调用，端点与频率见 [.github/workflows/cron.yml](./.github/workflows/cron.yml)。部署细节见 [docs/deployment.md](./docs/deployment.md)。

外部试点必须使用独立 staging 环境：独立 Vercel environment / preview deployment + 独立 Supabase 项目。不要把试点 seed、E2E 或 demo 导入压测指向生产数据库。

## 安全边界

- 业务写操作走 Server Actions；Cron 触发才使用 API Route。
- 浏览器只订阅必要的 Supabase Realtime 表。
- 管理操作必须写入审计日志。
- 生产环境启用 RLS；除公开实时表外，不给浏览器直接访问业务表的 policy。
- 第三方服务密钥只放服务端环境变量。

更多权限与 RLS 细节见 [docs/auth-and-permissions.md](./docs/auth-and-permissions.md)。

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

发布前至少运行：

```bash
pnpm type-check
pnpm test
pnpm build
```

## 文档

| 文档 | 内容 |
|---|---|
| [AGENTS.md](./AGENTS.md) | 项目工程手册与 AI 协作约束 |
| [docs/README.md](./docs/README.md) | 文档入口与维护规则 |
| [docs/code-map.md](./docs/code-map.md) | 代码结构地图与修改入口 |
| [docs/architecture.md](./docs/architecture.md) | 架构与模块边界 |
| [docs/data-model.md](./docs/data-model.md) | 数据模型与约束 |
| [docs/data-integrity.md](./docs/data-integrity.md) | 数据一致性与 Storage 策略 |
| [docs/auth-and-permissions.md](./docs/auth-and-permissions.md) | 鉴权、权限与 RLS 策略 |
| [docs/season-abstraction.md](./docs/season-abstraction.md) | capability 驱动的多赛事设计 |
| [docs/registration-flow.md](./docs/registration-flow.md) | 报名流程 |
| [docs/draft-flow.md](./docs/draft-flow.md) | 选秀事务与并发安全 |
| [docs/state-machines.md](./docs/state-machines.md) | 关键业务状态机 |
| [docs/deployment.md](./docs/deployment.md) | Vercel / Supabase 部署手册 |
| [docs/testing.md](./docs/testing.md) | 测试策略 |
| [docs/external-pilot-readiness.md](./docs/external-pilot-readiness.md) | 外部试点前能力边界、staging 和整改清单 |
| [CHANGELOG.md](./CHANGELOG.md) | 版本发布记录 |

历史设计稿、一次性计划和过程材料已归档到 [docs/archive](./docs/archive)，不作为当前实现的事实来源。

## License

[GNU AGPLv3](./LICENSE)

RivalHub is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published
by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
