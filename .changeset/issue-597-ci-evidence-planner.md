---
"rivalhub": patch
---

按风险分层重构 CI Evidence Planner：解耦 Draft/Ready 状态与测试深度、收窄 System provider 边界，并将 main 分支 push 调整为 affected smoke 规划，避免普通业务变更进入不必要的 System / FULL critical path。
