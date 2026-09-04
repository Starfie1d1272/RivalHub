<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./public/brand/rivalhub/rivalhub-lockup-horizontal-transparent-tight.png" />
    <source media="(prefers-color-scheme: light)" srcset="./public/brand/rivalhub/rivalhub-lockup-horizontal-transparent-tight-light.png" />
    <img src="./public/brand/rivalhub/rivalhub-lockup-horizontal-transparent-tight-light.png" alt="RivalHub" width="360" />
  </picture>
</p>

<p align="center">
  <strong>面向高校电竞赛事的开源赛事运营平台</strong><br />
  <sub>Open-source tournament operations for collegiate esports.</sub>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg" alt="License: AGPL-3.0" /></a>
  <img src="https://img.shields.io/badge/Next.js-App_Router-black?logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Drizzle-ORM-C5F74F?logo=drizzle&logoColor=black" alt="Drizzle ORM" />
  <img src="https://img.shields.io/badge/Supabase-Postgres%20%2F%20Auth-3FCF8E?logo=supabase&logoColor=white" alt="Supabase" />
  <img src="https://img.shields.io/badge/pnpm-11-F69220?logo=pnpm&logoColor=white" alt="pnpm" />
  <a href="./CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome" /></a>
</p>

<p align="center">
  <a href="https://match.starfie1d.top">Live Site</a> ·
  <a href="./docs/README.md">Docs</a> ·
  <a href="./docs/roadmap.md">Roadmap</a> ·
  <a href="./CONTRIBUTING.md">Contributing</a>
</p>

![RivalHub — 赛事首页](./docs/assets/screenshots/rivalhub-home.png)

RivalHub 从真实高校电竞赛事的运营需求出发，把报名、资格、组队、赛制运行、比赛管理、数据统计与赛后历史放在同一个系统里。

当前官方实例服务于 NJU 电竞赛事，但 RivalHub 的领域模型面向可以持续运营、跨赛季沉淀的高校电竞赛事。

## Features

- **选手档案** — 跨赛季的统一身份，维护账号、教育资格与竞技记录。
- **队伍与参赛管理** — 队伍作为长期实体存在，每届赛事通过独立参赛记录管理名单与审核，历史赛事记录不受后续变更影响。
- **报名与资格审核** — 个人 / 队伍报名、成员确认、资格核验、补正、候补与管理员审核。
- **赛事运行** — 选秀、Swiss、循环赛、双败淘汰、Playoffs；赛制推进与名单冻结基于结构化赛事状态。
- **比赛运营** — 时间协商、阵容与 BP、地图与系列赛结果、弃赛、更正、恢复、纪律与赛后确认。
- **数据与历史** — 赛季排行榜、选手与队伍表现、比赛结果沉淀为可查询的长期记录。

## Built-in Tournament Systems

RivalHub 内置 Rivals 与 Major 两套平行赛事体系，共享长期身份、Team、比赛与数据基础设施，保留各自参赛与赛制语义。

| 体系       | 参赛方式           | 主要流程                                                     |
| ---------- | ------------------ | ------------------------------------------------------------ |
| **Rivals** | 个人报名           | 审核 → 队长投票 → 蛇形选秀 → 循环赛 → 双败淘汰               |
| **Major**  | 长期 Team 组队报名 | 成员确认 → qualification → 管理审核 → 赛前冻结 → 三阶段 Swiss → Playoffs |

2026 NJU Rivals 已通过 RivalHub 完成真实赛事运行，覆盖从报名、选秀到比赛、统计与赛季收尾的完整链路。

## Tournament in Action

赛程推进、胜负关系和阶段状态直接由结构化赛事数据驱动，不依赖人工维护的展示副本。管理侧保留资格、名单、赛制、赛果更正与恢复等受控入口。

![Rivals 双败淘汰赛](./docs/assets/screenshots/rivals-bracket.png)

## Data & History

比赛结束不是数据生命周期的终点。地图、系列赛、选手表现、队伍与赛季结果持续沉淀为公开数据和长期档案。

![Rivals 赛季排行榜](./docs/assets/screenshots/rivals-ranking.png)

## Scope

RivalHub 2.x 专注于把官方实例和真实赛事运营做完整、做稳定。代码以 AGPL-3.0 开源，可用于阅读、研究、修改和本地开发。2.x 阶段暂不将第三方 production self-hosting 作为正式支持目标。

未来产品方向与领域依赖见 [`docs/roadmap.md`](./docs/roadmap.md)。实时开发状态以 GitHub Issues 为准。

## Getting Started

### Prerequisites

| 依赖    | 版本                |
| ------- | ------------------- |
| Node.js | `24.x`              |
| pnpm    | `11.x`              |
| Docker  | Local Supabase 需要 |

### Quick Start

```bash
pnpm install
pnpm db:local:bootstrap
pnpm dev:local
```

Local Supabase 由仓库 wrapper 启动并注入 loopback 连接；不会把 `.env.local` 的远程数据库作为 fallback。环境与迁移边界见 [docs/deployment.md](./docs/deployment.md)。

## Docs

| 文档                                                         | 说明                              |
| ------------------------------------------------------------ | --------------------------------- |
| [AGENTS.md](./AGENTS.md)                                     | 持久工程约束                      |
| [docs/README.md](./docs/README.md)                           | 文档入口与 authority              |
| [docs/roadmap.md](./docs/roadmap.md)                         | 2.x 方向、顺序与依赖              |
| [docs/architecture.md](./docs/architecture.md)               | 技术架构与代码域映射              |
| [docs/domain-model.md](./docs/domain-model.md)               | 领域模型与数据边界                |
| [docs/workflows.md](./docs/workflows.md)                     | 用户与运营生命周期                |
| [docs/auth-and-permissions.md](./docs/auth-and-permissions.md) | Auth、权限与 Data API 安全基线    |
| [docs/deployment.md](./docs/deployment.md)                   | Local / Staging / Production 环境 |
| [docs/testing.md](./docs/testing.md)                         | 测试策略与环境分层                |
| [docs/ui-system.md](./docs/ui-system.md)                     | UI 系统与产品语言                 |
| [docs/rules/nju-major.md](./docs/rules/nju-major.md)         | NJU Major 赛事政策                |

历史过程材料在 [docs/archive/](./docs/archive/)。

## Security

安全问题请不要在公开 Issue 中披露技术细节，按仓库的 [Security Policy](https://github.com/Starfie1d1272/RivalHub/security/policy) 使用私密渠道报告。

## License

[GNU Affero General Public License v3.0](./LICENSE)
