# RivalHub 文档

本目录维护 RivalHub 当前有效的产品、领域、工程与运营文档。README 负责帮助读者找到正确 owner；它不是文件百科，也不复制 GitHub Issues、代码或 release notes 中的瞬时状态。

## 从这里开始

| 我想做什么 | 先看这里 |
| --- | --- |
| 第一次了解 RivalHub | [`../README.md`](../README.md) |
| 参与开发或提交 PR | [`../CONTRIBUTING.md`](../CONTRIBUTING.md) |
| 理解系统架构 | [`architecture.md`](./architecture.md) |
| 理解核心领域实体和边界 | [`domain-model.md`](./domain-model.md) |
| 理解用户与赛事生命周期 | [`workflows.md`](./workflows.md) |
| 本地启动开发环境 | [`operations/local-development.md`](./operations/local-development.md) |
| 判断一个改动需要什么测试 | [`testing.md`](./testing.md) |
| 看 CI 为什么运行或失败 | [`operations/ci.md`](./operations/ci.md) |
| 新增或审查数据库 migration | [`operations/database-migrations.md`](./operations/database-migrations.md) |
| 做 staging 数据库演练 | [`operations/staging.md`](./operations/staging.md) |
| 准备和执行正式发布 | [`operations/release.md`](./operations/release.md) |
| 理解登录、角色和权限 | [`auth-and-permissions.md`](./auth-and-permissions.md) |
| 理解 UI 与产品语言 | [`ui-system.md`](./ui-system.md) |
| 查看 2.x 长期方向 | [`roadmap.md`](./roadmap.md) |
| 查看 NJU Major 赛事政策 | [`rules/nju-major.md`](./rules/nju-major.md) |
| 查看历史材料 | [`archive/README.md`](./archive/README.md) |

## Authority

RivalHub 避免让同一事实同时由多份文档维护。

| 事实 | Authority |
| --- | --- |
| 当前业务实现 | code、schema、active migrations 与 tests |
| 当前技术边界 | active technical docs + 对应 code/tests |
| 赛事政策 | [`rules/`](./rules/) |
| 已接受但尚未实现的产品/架构决策 | [`decisions/`](./decisions/) |
| 当前工作状态与优先级 | GitHub Issues / labels / PRs |
| 版本内容 | Changesets、CHANGELOG、GitHub Releases |
| 历史过程、旧设计与历史验收 | [`archive/`](./archive/) |

如果 active 文档与代码、schema、migration 或 tests 冲突，应在同一变更中修正文档，而不是继续维护两套事实。

## Active technical docs

- [`architecture.md`](./architecture.md)：系统边界、赛事运行时与 canonical code areas。
- [`domain-model.md`](./domain-model.md)：长期身份、Team、CompetitionEntry、比赛与赛事事实。
- [`workflows.md`](./workflows.md)：账号、报名、选秀、Major、比赛、纪律与赛后生命周期。
- [`auth-and-permissions.md`](./auth-and-permissions.md)：Auth、session、角色与 Data API 安全边界。
- [`security/database-access-matrix.md`](./security/database-access-matrix.md)：public application tables 的访问分类与生成式安全 contract。
- [`testing.md`](./testing.md)：不同验证层证明什么，以及如何选择证据。
- [`deployment.md`](./deployment.md)：local / preview / staging / production 的稳定边界。
- [`ui-system.md`](./ui-system.md)：UI tokens、组件语言与交互约束。
- [`roadmap.md`](./roadmap.md)：2.x 产品方向和长期依赖，不维护实时 TODO。

## Operations

`operations/` 回答“具体怎么做”，允许包含命令、workflow 名称和故障排查步骤；稳定概念仍由上面的 technical docs 拥有。

- [`operations/local-development.md`](./operations/local-development.md)
- [`operations/ci.md`](./operations/ci.md)
- [`operations/database-migrations.md`](./operations/database-migrations.md)
- [`operations/staging.md`](./operations/staging.md)
- [`operations/release.md`](./operations/release.md)
- [`operations/major-referee-guide.md`](./operations/major-referee-guide.md)

精确代码定位使用 repository search、IDE 或 GitHub search；本文档不维护逐文件清单。
