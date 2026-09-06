# Decision records

`decisions/` 记录需要长期保留 rationale 的重要产品或架构决策。Decision 即使已经实施仍然保留；它回答“为什么这样做”，不维护实时实施进度。

## Status

使用下列状态之一：

- `proposed`：已形成明确方案，尚未接受；
- `accepted`：已接受，是否完成实现由 Issue/PR 跟踪；
- `implemented`：已落地，但 rationale 仍有长期价值；
- `superseded`：被新的 decision 明确替代；
- `rejected`：曾认真评估但未采用。

## Minimal structure

一份 durable decision 只需要：

```text
Status
Context        为什么必须做决定
Decision       选择了什么稳定方向
Consequences   获得什么、承担什么约束
Supersedes / Superseded by（需要时）
```

不要在 decision 中维护 PR 拆分、当前 checklist、实时优先级、完整代码 inventory 或实施日志。这些属于 GitHub Issues/PRs；已经失去当前价值的 planning/design handoff 进入 [`../archive/`](../archive/)。

当前系统事实仍以 code/schema/tests 和 active technical docs 为准。Decision 与实现冲突时，应确认是实现回归、文档过期还是已有新 decision，而不是静默重写旧 decision 的历史理由。
