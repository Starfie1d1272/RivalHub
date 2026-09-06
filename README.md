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
  <a href="https://github.com/Starfie1d1272/RivalHub/releases"><img src="https://img.shields.io/github/v/release/Starfie1d1272/RivalHub?display_name=tag" alt="Latest Release" /></a>
  <a href="https://github.com/Starfie1d1272/RivalHub/actions/workflows/ci.yml"><img src="https://github.com/Starfie1d1272/RivalHub/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg" alt="License: AGPL-3.0" /></a>
  <img src="https://img.shields.io/badge/Next.js-App_Router-black?logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Drizzle-ORM-C5F74F?logo=drizzle&logoColor=black" alt="Drizzle ORM" />
  <img src="https://img.shields.io/badge/Supabase-Postgres%20%2F%20Auth-3FCF8E?logo=supabase&logoColor=white" alt="Supabase" />
  <a href="./CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome" /></a>
</p>

<p align="center">
  <a href="https://match.starfie1d.top">Live Site</a> ·
  <a href="./docs/README.md">Docs</a> ·
  <a href="./docs/roadmap.md">Roadmap</a> ·
  <a href="./CONTRIBUTING.md">Contributing</a>
</p>

![RivalHub — 赛事首页](./docs/assets/screenshots/rivalhub-home.png)

RivalHub 用于 NJU Rivals、NJU Major 等高校 CS 赛事，覆盖长期选手/Team 资料、报名资格、名单、赛程、比赛运营、统计、纪律与赛后事实。Rivals 与 Major 共享账号、Team、CompetitionEntry、Match 和数据基础设施，同时保留不同的报名与运行时流程。

## Capabilities

- **长期身份与竞技资料**：教育认证、Steam/竞技平台资料、长期 Team 与跨赛事身份。
- **报名与资格**：个人/队伍报名、成员确认、补正、候补、qualification 与管理员审核。
- **赛事运行时**：Rivals 投票/选秀，以及 Major 赛前冻结、Swiss/Playoffs 与恢复流程。
- **比赛运营**：时间、首发、BP、地图/系列赛结果、更正、纪律和赛后处理。
- **数据与历史**：赛事统计、Player/Team/Event facts、正式结果与后续分析集成基础。

| 内置体系 | 参赛方式 | 主流程 |
| --- | --- | --- |
| **Rivals** | 个人报名 | 审核 → 队长投票 → 蛇形选秀 → 赛事运行 |
| **Major** | 长期 Team 报名 | 成员确认 → 资格/审核 → 赛前冻结 → Stage runtime |

正式赛制与政策由赛事规则拥有，不在 README 复制具体人数、地图池或 BO 配置。

## Scope

RivalHub 2.x 优先把官方实例和真实高校 CS 赛事运营做好。代码以 AGPL-3.0 开源并支持本地开发；第三方 production self-hosting 暂不作为 2.x 的正式支持目标。长期方向见 [`docs/roadmap.md`](./docs/roadmap.md)，当前开发状态看 GitHub Issues。

## Local development

使用仓库 `package.json` / lockfile 声明的 Node/pnpm runtime，并准备 Docker-compatible runtime：

```bash
pnpm install
pnpm db:local:bootstrap
pnpm dev:local
```

完整本地环境、测试、migration、CI 和发布流程从 [`docs/README.md`](./docs/README.md) 进入。

## Documentation

| 文档 | 用途 |
| --- | --- |
| [`docs/README.md`](./docs/README.md) | 文档入口与 authority |
| [`docs/architecture.md`](./docs/architecture.md) | 系统边界 |
| [`docs/domain-model.md`](./docs/domain-model.md) | 领域事实 ownership |
| [`docs/workflows.md`](./docs/workflows.md) | 稳定生命周期 |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | 开发与交付规范 |

## Security

安全问题请不要在公开 Issue 中披露技术细节。RivalHub 使用账户级统一的 [Security Policy](https://github.com/Starfie1d1272/RivalHub/security/policy) 作为默认私密报告入口。

## License

[GNU Affero General Public License v3.0](./LICENSE)
