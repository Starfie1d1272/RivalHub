# RivalHub 文档入口

这个目录只保留当前实现仍需要维护的文档。历史交付物和过程材料在 `docs/archive/`。

项目结构导航用 CodeGraph（`codegraph_files`），本文档只做业务域指引。

## 核心架构

| 文档 | 读它当你要… |
|---|---|
| [`architecture.md`](./architecture.md) | 理解模块依赖、数据流、技术边界 |
| [`season-abstraction.md`](./season-abstraction.md) | 理解多赛事 capability 驱动的设计原则 |
| [`state-machines.md`](./state-machines.md) | 修改任何实体的状态流转 |

## 数据层

| 文档 | 读它当你要… |
|---|---|
| [`data-model.md`](./data-model.md) | 了解表结构和字段含义 |
| [`data-integrity.md`](./data-integrity.md) | 了解约束在哪层保证（DB vs 应用层） |

## 业务流程

| 文档 | 读它当你要… |
|---|---|
| [`auth-and-permissions.md`](./auth-and-permissions.md) | 改登录、鉴权、权限分级 |
| [`registration-flow.md`](./registration-flow.md) | 改个人报名流程；队伍报名仍是待实现分支 |
| [`draft-flow.md`](./draft-flow.md) | 改选秀流程（事务、并发、超时） |
| [`code-map.md`](./code-map.md) | 快速找到业务域对应的代码入口 |
| [`external-pilot-readiness.md`](./external-pilot-readiness.md) | 判断外部试点前哪些能力可承诺、哪些必须声明限制 |

## 运维 & 测试

| 文档 | 读它当你要… |
|---|---|
| [`deployment.md`](./deployment.md) | 改部署配置、排查数据库连接 |
| [`testing.md`](./testing.md) | 了解测试策略和覆盖率要求 |
| [`error-reference.md`](./error-reference.md) | 了解错误处理约定和排查方法 |

## 其他

| 文档 | 说明 |
|---|---|
| [`ui-system.md`](./ui-system.md) | 视觉设计规范 + 设计 token 定义 |
| [`demo-export/handoff.md`](./demo-export/handoff.md) | Demo 数据导出/导入交接（开发中） |
| [`archive/launch-readiness.md`](./archive/launch-readiness.md) | 上线前审查记录（2026-05-14） |

## 维护规则

- 顶层文档只记录当前有效的架构、流程、约束和运维信息。
- 临时计划、调研、设计稿放入 `docs/archive/`。
- 修改状态机、数据库约束、权限或部署流程时，同步更新对应文档。
- 对外能力描述必须区分已实战验证、已实现待验收、设计/配置基础和新增开发。
- 两个文档冲突时，以更贴近代码入口的专题文档为准，并顺手修正旧描述。
