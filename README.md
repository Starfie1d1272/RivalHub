# RivalHub

RivalHub 是面向高校电竞赛事的开源赛事管理平台，并为其他赛事形态保留可扩展的架构边界。

当前内置两套平行赛事体系：

- **Rivals · Spring**：个人报名、队长投票、蛇形选秀与联赛赛程。
- **Major · Autumn**：队伍报名、资格核验、赛前冻结、三段 Swiss 与淘汰赛。

生产站点：[match.starfie1d.top](https://match.starfie1d.top)。版本与发布状态以 [GitHub Releases](https://github.com/Starfie1d1272/RivalHub/releases) 为准。

## 当前能力

| 状态 | 领域 | 能力 |
|---|---|---|
| 已实现并自动化验证 | Rivals | 个人报名、审核、队长投票、蛇形选秀、队伍、赛程、比赛结果与审计 |
| 已实现并自动化验证 | Major | 队伍申请、成员确认、资格资料、赛前 entrants / roster / seed 冻结、三段 Swiss、淘汰赛、阵容、赛果恢复、纪律与赛后归档 |
| 已实现，待最终 staging 验收 | 2.0 生命周期 | 邮箱确认起点下的完整 Major 运营链路与独立 staging destructive rehearsal |
| 延后/非 2.0 blocker | 赛事扩展 | 自定义赛事创建体验、更多通用赛制的产品化支持、转播与外部集成 |

“已实现并自动化验证”表示仓库中有相应代码和测试；它不替代真实赛事运营验收。

## 技术栈

Next.js App Router、TypeScript strict、Tailwind CSS、shadcn/ui、Drizzle ORM、Supabase Postgres/Auth/Storage/Realtime、iron-session、Vitest、Playwright 与 Vercel。架构与边界见 [docs/architecture.md](./docs/architecture.md)。

## 快速开始

```bash
pnpm install
pnpm db:local:bootstrap
pnpm dev:local
```

Local Supabase 由仓库 wrapper 启动并注入 loopback 连接；不会把 `.env.local` 的远程数据库作为 fallback。完整的环境与迁移边界见 [docs/deployment.md](./docs/deployment.md)。

## 常用命令

```bash
pnpm dev
pnpm dev:local
pnpm type-check
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
pnpm db:check
pnpm db:local:bootstrap
pnpm db:local:reset
```

`pnpm db:push` 被显式阻止。活动 Drizzle migration chain 是唯一迁移 authority；远程操作前须通过 [部署安全门](./docs/deployment.md)。

## 文档

| 文档 | 说明 |
|---|---|
| [AGENTS.md](./AGENTS.md) | 持久工程约束 |
| [docs/README.md](./docs/README.md) | 文档 authority 与入口 |
| [docs/architecture.md](./docs/architecture.md) | 技术架构、内置赛事与代码域映射 |
| [docs/domain-model.md](./docs/domain-model.md) | 领域模型、冻结事实与数据边界 |
| [docs/workflows.md](./docs/workflows.md) | 用户与运营生命周期 |
| [docs/auth-and-permissions.md](./docs/auth-and-permissions.md) | Auth、权限与 Data API 安全基线 |
| [docs/deployment.md](./docs/deployment.md) | Local、staging、production 运行与迁移 |
| [docs/testing.md](./docs/testing.md) | 自动化测试与 staging lifecycle gate |
| [docs/ui-system.md](./docs/ui-system.md) | UI 系统与产品语言 |
| [docs/rules/nju-major.md](./docs/rules/nju-major.md) | NJU Major 赛事政策 |

历史过程材料与历史验收记录在 [docs/archive/](./docs/archive/)，不描述当前实现。

## License

[GNU AGPLv3](./LICENSE)
