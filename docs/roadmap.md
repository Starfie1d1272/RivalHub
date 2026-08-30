# RivalHub 2.x Roadmap

## Baseline

当前基线为已发布并恢复 production 的 v2.0.0-rc.4。2.0 release-hardening 已结束；2.x 继续围绕长期参与者、长期 Team、Major 正式运营、历史产品与赛事互动能力推进。

本文只维护方向、依赖和主线顺序，不作为完整 TODO 镜像。具体范围、验收和实施状态以 GitHub Issues、PR、active schema、tests 与 technical docs 为准。

## Issue metadata

2.x Issue 的优先级不再编码在标题中，统一使用 GitHub labels：

- `priority:P0`：production outage、数据完整性或需要立即处理的安全事件；
- `priority:P1`：当前产品主线 / 正式 Major 开放前必须收口；
- `priority:P2`：明确要做，但不阻塞当前主线；
- `priority:P3`：backlog、spectator enhancement 或长期增强；
- `next`：当前正在推进或紧接着应推进的极少数主题。

Issue 标题保留 `[2.x]` 作为版本线标识。优先级发生变化时只调整 label，不修改标题。

`next` 应保持稀疏，通常只标记 1–2 个当前执行焦点；它不是新的优先级等级。

## Current execution

当前唯一主线执行焦点：

1. [#276 竞技平台目录后台](https://github.com/Starfie1d1272/RivalHub/issues/276) —— 把 Platform 级 rank ladder 与 Season 时间目录拆成可运营的长期后台配置，并保持赛事 publish-time snapshot 与历史竞技事实不被后续目录修改重写。

当前仅 #276 使用 `next` label。

## Recently completed

以下主题已经在 `dev` 完成并关闭，不再属于 active backlog：

- [#269 长期 Team 与赛事参赛模型](https://github.com/Starfie1d1272/RivalHub/issues/269)：PR #275 完成长周期 Team / CompetitionEntry 终态、0017 migration、Major/Rivals 历史兼容与赛事 roster 分层；遗漏 Changeset 已由 #287 补齐。
- [#278 补齐已实现赛务能力的后台运营入口](https://github.com/Starfie1d1272/RivalHub/issues/278)：#280 接入赛事总控制台，#286 完成纪律处罚管理页，#288 将纪律处罚接入赛事级子导航。
- [#277 设置页桌面端导航移至左侧](https://github.com/Starfie1d1272/RivalHub/issues/277)：#279 已完成桌面左侧导航并保留移动端原有行为。

## P1 — Major 开放前主线

当前剩余 P1：

- [#276 竞技平台目录后台](https://github.com/Starfie1d1272/RivalHub/issues/276)：当前 `next`；
- [#266 奖项定义、申领、审核与展示](https://github.com/Starfie1d1272/RivalHub/issues/266)：在正式报名开放前确定是否需要提前收集奖项字段/材料；
- [#270 “我的”资料、队伍与赛事准备度](https://github.com/Starfie1d1272/RivalHub/issues/270)：收敛 profile readiness、Team/CompetitionEntry、qualification 与本人可见 eligibility；
- [#267 2026 NJU Major 正式报名体验](https://github.com/Starfie1d1272/RivalHub/issues/267)：完成 captain/member/admin 的真实开放前 acceptance。

建议依赖顺序：

```text
#276 competitive catalog
      │
      ├─→ #270 我的 / eligibility
      └─→ #267 Major registration acceptance

#266 award decision ───────────────→ #267 final registration fields
```

#266 可以与 #276 并行做产品/领域决策，但必须在 #267 正式开放前给出“需要哪些报名字段 / 无需提前收集”的明确结论。

## P2 — 数据闭环与长期历史

- [#268 RivalHub ↔ DAK 数据闭环](https://github.com/Starfie1d1272/RivalHub/issues/268)：建立版本化 artifact、身份匹配、差异核对和 provenance；
- [#265 赛事历史与统一赛后面板](https://github.com/Starfie1d1272/RivalHub/issues/265)：统一赛事历史、Team/Player 长期页面、official facts、裁决与 honor，并接入允许公开的教育/纪律身份事实；
- [#271 依赖安全定向升级 backlog](https://github.com/Starfie1d1272/RivalHub/issues/271)：独立 maintenance lane；Critical 已通过定向 Vitest / tar 修复清理，但 runtime High/Medium 与其余 development advisories 仍需按依赖路径持续收敛。

统一赛后分析区域依赖 #268；纯 official history 可以在 artifact contract 完整落地前并行推进。

## P3 — Spectator 与长期增强

- [#273 Major 赛事模拟器与 Pick'Em 竞猜](https://github.com/Starfie1d1272/RivalHub/issues/273)；
- [#274 Major Prediction Points](https://github.com/Starfie1d1272/RivalHub/issues/274)；
- [#153 Rating 趋势与长期个人成就](https://github.com/Starfie1d1272/RivalHub/issues/153)。

P3 不代表“必须等所有 P2 完成后才能写代码”；priority 表示主线重要性，而不是严格串行依赖。

## Domain boundaries

- Team 是长期一级实体；CompetitionEntry 是赛事参赛身份；赛事 roster、seed、qualification 与成绩属于赛事冻结事实。
- Platform 拥有长期 rank ladder 与赛季时间目录；Event 只在发布时引用并冻结 competitive context。
- `profile readiness` 与 `event eligibility` 分离；纪律 sanction 可以阻止报名/roster/出场，但不改写历史比赛、placement 或 honor。
- `tournament_honors` 表示最终官方荣誉；奖项申请/提名/材料/审核是独立上游流程。
- Pick'Em、Coin/Badge 与 Prediction Points 属于 spectator engagement，不自动成为官方 tournament honor。
- RivalHub 拥有赛事、身份、赛程、正式 roster、赛果、裁决和历史事实；DAK 拥有 Demo 解析和派生分析。

详细边界见 [`decisions/2.x-product-domains.md`](./decisions/2.x-product-domains.md) 与对应主题 Issues。

## Operating rule

日常决定“先做什么”时优先看 GitHub metadata：

```text
is:open label:next
```

查看当前主线：

```text
is:open label:"priority:P1"
```

Roadmap 不重复维护每个 Issue 的细粒度状态，避免文档与实际 backlog 再次漂移。
