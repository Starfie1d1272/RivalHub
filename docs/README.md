# RivalHub 文档入口

这个目录只保留当前实现仍需要维护的文档。历史设计交付物、一次性计划和过程材料已移入 `docs/archive/`，不再作为当前实现的事实来源。

## 先读这几份

| 场景 | 文档 |
|---|---|
| 了解整体边界 | [`architecture.md`](./architecture.md) |
| 找代码入口 | [`code-map.md`](./code-map.md) |
| 改状态流转 | [`state-machines.md`](./state-machines.md) |
| 改数据库 / 约束 | [`data-model.md`](./data-model.md)、[`data-integrity.md`](./data-integrity.md) |
| 改权限 / 登录 | [`auth-and-permissions.md`](./auth-and-permissions.md) |
| 改报名 | [`registration-flow.md`](./registration-flow.md) |
| 改选秀 | [`draft-flow.md`](./draft-flow.md) |
| 改多赛季能力 | [`season-abstraction.md`](./season-abstraction.md) |
| 改部署 / Cron | [`deployment.md`](./deployment.md) |
| 改测试策略 | [`testing.md`](./testing.md) |

## 文档维护规则

- 顶层文档只记录“当前仍然有效”的架构、流程、约束和运维信息。
- 临时计划、调研、设计稿、会议材料放入 `docs/archive/`，不要放在顶层。
- 修改状态机、数据库约束、权限或部署流程时，同步更新对应文档。
- 如果两个文档冲突，以更贴近代码入口的专题文档为准，并顺手修正旧描述。
