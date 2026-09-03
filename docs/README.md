# RivalHub 文档入口

## Authority

每一项稳定事实只有一个 active documentation owner：

| 事实类型 | Authority |
|---|---|
| 赛事政策 | [`rules/`](./rules/) |
| 当前技术实现 | code、schema、active migrations、tests 与下列 active technical docs |
| 已接受但尚未实现的设计 | [`decisions/`](./decisions/) |
| 历史过程、旧交付物与历史验收 | [`archive/`](./archive/) |

发现 active 文档冲突时，应在同一变更中消除冲突，而不是以“更靠近代码”的描述临时裁决。

## Active technical docs

| 文档 | 阅读目的 |
|---|---|
| [`roadmap.md`](./roadmap.md) | 2.x 长期方向、顺序与依赖 |
| [`architecture.md`](./architecture.md) | 架构边界、赛事运行时与稳定代码域映射 |
| [`domain-model.md`](./domain-model.md) | 领域实体、关系、冻结事实与 integrity owner |
| [`workflows.md`](./workflows.md) | 报名、比赛与赛后生命周期 |
| [`auth-and-permissions.md`](./auth-and-permissions.md) | 登录、角色、会话与 Data API 安全基线 |
| [`security/database-access-matrix.md`](./security/database-access-matrix.md) | 所有 public application table 的 browser/Realtime/服务端访问分类与 terminal contract |
| [`deployment.md`](./deployment.md) | Local、staging、production 与迁移安全 |
| [`testing.md`](./testing.md) | 自动化验证、环境分层、专项演练与 production canary |
| [`ui-system.md`](./ui-system.md) | UI tokens、交互与产品文案 |
| [`operations/major-referee-guide.md`](./operations/major-referee-guide.md) | Major 当日裁判/管理员操作 |

仓库协作与交付规则见根目录 [`CONTRIBUTING.md`](../CONTRIBUTING.md)；Agent 的最小入口见 [`AGENTS.md`](../AGENTS.md)。两者不复制本文档中的技术 authority。

## Decisions and history

- [`decisions/2.x-product-domains.md`](./decisions/2.x-product-domains.md) 记录 Team、奖项、DAK、个人工作台与历史产品的已接受边界和待决策问题。
- [`decisions/competition-entry-terminal-migration.md`](./decisions/competition-entry-terminal-migration.md) 记录长期队伍与赛事参赛记录的终态迁移、旧 ID 来源追溯和退役验收条件。
- [`archive/README.md`](./archive/README.md) 是历史 process artifacts、兼容记录、readiness snapshot、rehearsal 与集成交接材料的分类入口。

精确代码定位使用 repository search、IDE 或 GitHub search；本文档不维护逐文件百科。
