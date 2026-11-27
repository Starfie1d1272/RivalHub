# Staging database rehearsal

RivalHub staging 是**受保护的远程数据库 rehearsal 环境**，不是自动 Preview 数据库，也不是通用的 staging app promotion pipeline。

## 什么时候使用

不是每个 PR 都需要 staging。以下情况优先考虑：

- migration 涉及 contract cleanup、回填或明显锁风险；
- 需要确认远程 migration ledger / schema 与预期一致；
- release 前需要验证远程 migration path；
- local PostgreSQL 无法覆盖的环境差异需要确认。

## 入口

在受保护环境中通过 canonical wrapper 执行 staging migration 与校验：

```bash
pnpm db:staging:migrate
pnpm db:staging:verify
```

独立的 `staging.yml` workflow 已下线，发版前的 migration rehearsal 由 [Release workflow](./release.md#3-protected-release-workflow) 的 PostgreSQL 17 阶段统一承担。不要把个人 shell、Preview 或普通 PR job 当成 staging 写入口。

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

## Preview mirror

`rivalhub-dev` 是可牺牲的 shared staging，同时承载 production 派生的脱敏 Preview mirror。它不是 production fallback 或灾备 artifact；[Preview mirror workflow](./preview-mirror.md) 负责 reset/refresh。Preview 可正常写入它，下一次 refresh 会覆盖这些测试数据；普通本地 shell 仍不得直接写入该目标。
