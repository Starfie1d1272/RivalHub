# Staging database rehearsal

RivalHub staging 是**受保护的远程数据库 rehearsal 环境**，不是自动 Preview 数据库，也不是通用的 staging app promotion pipeline。

## 什么时候使用

不是每个 PR 都需要 staging。以下情况优先考虑：

- migration 涉及 contract cleanup、回填或明显锁风险；
- 需要确认远程 migration ledger / schema 与预期一致；
- release 前需要验证远程 migration path；
- local PostgreSQL 无法覆盖的环境差异需要确认。

## 入口

使用 GitHub Actions 中的：

> **Staging database rehearsal**

通过 `workflow_dispatch` 指定要验证的 branch、tag 或 commit。默认使用 `main`。

不要把个人 shell、Vercel Preview 或普通 PR job 当成 staging 写入口。

## Workflow 做什么

受保护 workflow 当前执行：

```text
checkout requested ref
→ record exact commit
→ start Local PostgreSQL
→ protected staging migrate
→ protected staging verify
→ stop Local PostgreSQL
```

远程 migration 前先在 local replay，确保 active chain 本身可用。staging wrapper 负责目标确认和 remote-write authorization。

## 不做什么

Staging rehearsal 不：

- seed/reset 远程 staging 数据；
- 使用 `db:push`；
- 自动创建 staging application deployment；
- 自动把 `main` promote 到 production；
- 替代 production release smoke。

## 验收

一个成功 rehearsal 至少应确认：

- workflow checkout 的 exact commit 与预期一致；
- local migration replay 成功；
- staging migration 成功；
- staging ledger 与 terminal schema verify 成功；
- 没有依赖手工 dashboard patch 才能通过。

如果 rehearsal 暴露数据库漂移或兼容性问题，应回到 migration/code 修复，再重新完整运行，而不是在 staging 手工“修到能过”。
