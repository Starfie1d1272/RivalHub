# RivalHub

RivalHub 是面向高校电竞赛事的开源赛事管理平台，并为其他赛事形态保留可扩展的架构边界。

当前内置两套平行赛事体系：

- **Rivals · Spring**：个人报名、队长投票、蛇形选秀、循环赛与双败淘汰。
- **Major · Autumn**：队伍报名、资格核验、赛前冻结、三段 Swiss 与淘汰赛。

生产站点：[match.starfie1d.top](https://match.starfie1d.top)。版本与发布状态以 [GitHub Releases](https://github.com/Starfie1d1272/RivalHub/releases) 为准。

## 当前能力

| 体系 | 当前验证层级 | 已验证范围 |
|---|---|---|
| Rivals · Spring | 已实战验证 | 2026 NJU Rivals 已完成个人报名、审核、队长投票、蛇形选秀、循环赛、双败淘汰、比赛管理、时间协商、BP/赛果、MVP、OCR 统计与赛季结束 |
| Major · Autumn | 已实现并完成自动化生命周期验证 | 队伍报名、资格、赛前冻结、三阶段 Swiss、Playoffs、阵容、恢复、纪律与赛后 |
| 通用赛事框架 | 扩展框架已建立 | `StagePlan`、`StageExecutor` 等通用接口；更多赛事形态按实际需求逐步接入 |

验证证据按实现、自动化验证、完整环境演练与生产实战验证递进。测试策略和环境边界见 [docs/testing.md](./docs/testing.md)。

当前发布基线为 v2.0.0。后续 2.x 的方向、优先级与依赖见 [docs/roadmap.md](./docs/roadmap.md)；完整 staging lifecycle 保留为专项演练，不是稳定版的强制 gate。

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
pnpm test:integration
pnpm test:e2e
pnpm check
pnpm verify
pnpm verify:local
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
| [docs/roadmap.md](./docs/roadmap.md) | 2.x 方向、顺序与依赖 |
| [docs/architecture.md](./docs/architecture.md) | 技术架构、内置赛事与代码域映射 |
| [docs/domain-model.md](./docs/domain-model.md) | 领域模型、冻结事实与数据边界 |
| [docs/workflows.md](./docs/workflows.md) | 用户与运营生命周期 |
| [docs/auth-and-permissions.md](./docs/auth-and-permissions.md) | Auth、权限与 Data API 安全基线 |
| [docs/deployment.md](./docs/deployment.md) | Local、staging、production 运行与迁移 |
| [docs/testing.md](./docs/testing.md) | 自动化测试、环境分层与 production canary |
| [docs/ui-system.md](./docs/ui-system.md) | UI 系统与产品语言 |
| [docs/rules/nju-major.md](./docs/rules/nju-major.md) | NJU Major 赛事政策 |

历史过程材料与历史验收记录在 [docs/archive/](./docs/archive/)，不描述当前实现。

## License

[GNU AGPLv3](./LICENSE)
