# CompetitionEntry 作为赛事参赛方唯一身份

**Status:** implemented

## Context

旧模型同时存在 season-bound team/application/runtime team 等多层参赛方身份，导致长期 Team、报名、比赛和历史事实边界不清。Rivals 的赛事临时队伍又不一定对应真实长期 Team，因此不能把 Team 直接当作所有比赛的稳定 identity。

## Decision

`CompetitionEntry` 是一届赛事中的唯一参赛方身份，并从报名延续到比赛与历史：

```text
Long-lived Team (optional)
→ CompetitionEntry
→ Roster Revision
→ EventRoster
→ MatchRoster / Stage entrant / Match / Final result
```

人员事实保持分层：长期 Team membership、本届 participant confirmation、报名 revision、正式 EventRoster 与单场 MatchRoster 分别拥有自己的语义，互不替代。

Rivals 的赛事原生队伍使用 `teamId = null` 的 CompetitionEntry；不为历史选秀队伪造长期 Team。长期 Team 后续变更也不重写历史 CompetitionEntry 或 roster snapshot。

## Consequences

- 比赛、阶段参与方、赛后结果和历史查询都可以稳定引用同一个 Entry identity。
- MatchRoster 只消费本届 EventRoster，不回退到可变 Team membership 或报名草稿。
- 长期 Team 与赛事快照可以独立演进，同时保留明确互链。
- 迁移 provenance 只用于历史来源追溯，不构成运行时兼容 API 或第二个参赛方 owner。

## Migration note

2.x 的 terminal migration 已完成旧 application/season team/runtime identity 的回填与退役，并对历史 Rivals/Major facts 保留可解析的 CompetitionEntry/EventRoster identity。精确 migration 与当前 schema 以 active migration ledger、schema 和 integration tests 为准，不在本 decision 重复维护旧表清单或验收命令。
