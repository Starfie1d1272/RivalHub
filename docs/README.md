# RivalHub 文档

本目录只维护当前有效、需要人类理解的产品与工程知识。实时进度看 GitHub Issues / PRs；精确实现以 code、schema、active migrations 和 tests 为准。

## 按任务进入

| 任务 | 文档 |
| --- | --- |
| 第一次了解项目 | [`../README.md`](../README.md) |
| 开发、PR、Changeset | [`../CONTRIBUTING.md`](../CONTRIBUTING.md) |
| 系统边界与代码分层 | [`architecture.md`](./architecture.md) |
| 核心领域实体与事实 ownership | [`domain-model.md`](./domain-model.md) |
| 账号、报名、赛事与比赛生命周期 | [`workflows.md`](./workflows.md) |
| 鉴权、权限、Data API | [`auth-and-permissions.md`](./auth-and-permissions.md) |
| 测试证据与 CI | [`testing.md`](./testing.md)、[`operations/ci.md`](./operations/ci.md) |
| 本地开发、migration、staging、release | [`operations/`](./operations/) |
| UI 与交互 contract | [`ui-system.md`](./ui-system.md) |
| 长期产品方向 | [`roadmap.md`](./roadmap.md) |
| NJU Major 正式政策 | [`rules/nju-major.md`](./rules/nju-major.md) |
| 重要决策及其理由 | [`decisions/`](./decisions/) |
| 历史设计、验收与过程材料 | [`archive/`](./archive/) |

## Authority

一种事实只保留一个完整 owner：

| 内容 | Authority |
| --- | --- |
| 当前实现、字段、约束、枚举 | code / schema / active migrations / tests |
| 稳定架构、领域和交互边界 | 对应 active technical doc + code/tests |
| 正式赛事政策 | [`rules/`](./rules/) |
| 重要设计决策与 rationale | [`decisions/`](./decisions/) |
| 当前工作、优先级、未完成设计 | GitHub Issues / labels / PRs |
| 已发布版本 | Changesets / `CHANGELOG.md` / GitHub Releases |
| 历史过程与旧设计 | [`archive/`](./archive/) |

生成式 reference 可以很长，但其源必须机器可追溯。例如 [`security/database-access-matrix.md`](./security/database-access-matrix.md) 由 `scripts/db/access-matrix.ts` 的 canonical config 生成并由数据库 verifier 校验。

## 维护原则

1. **One fact, one owner.** 其它文档链接 owner，不复制同一规则、数字或状态。
2. **Current docs describe current state.** 已被替代的设计、实施过程和历史验收进入 Git/Issue/archive，不在正文继续追加“后来又……”的补丁。
3. **不要手抄高频变化事实。** 版本号、Issue 状态、表/migration/test 数量、当前目录内容等能从机器事实获得时不建立第二份手工清单。
4. **改 contract 就重写相关段落。** 优先把旧解释替换成新的终态，而不是在后面继续追加例外说明。
5. **代码与文档同 PR 收敛。** 变更稳定 boundary、workflow、policy 或 operation 时同步更新其 canonical doc；纯实现细节不要求写文档。
6. **核心文档保持可完整阅读。** `architecture`、`domain-model`、`workflows`、`ui-system` 只保存跨模块理解所需知识；具体文件定位使用 repository search/IDE。

如果 active doc 与 code/schema/migration/tests 冲突，应在同一变更中收敛为一个事实源，不保留“两套都可能对”的说明。

## Operations

`operations/` 是按任务执行的 runbook，不要求线性阅读：

- [`local-development.md`](./operations/local-development.md)
- [`ci.md`](./operations/ci.md)
- [`observability.md`](./operations/observability.md)
- [`database-migrations.md`](./operations/database-migrations.md)
- [`staging.md`](./operations/staging.md)
- [`release.md`](./operations/release.md)
- [`major-referee-guide.md`](./operations/major-referee-guide.md)
