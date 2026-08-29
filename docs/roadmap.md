# RivalHub 2.x Roadmap

## Baseline

当前基线为已发布并恢复 production 的 v2.0.0-rc.4：active Drizzle migrations 为 17/17，production smoke 正常，2.0 release-hardening 已结束。本文只描述 2.x 的方向、顺序和依赖，不承诺日期，也不把已完成的 RC4 工作重新列为 TODO。

2.x 不继续进行无目标的架构审查。具体实施、产品决策与验收由主题 GitHub Issues 承担；code、schema、active migrations、tests 与 active technical docs 仍是当前实现 authority。

## Priority order

| 优先级 | 工作域 | 方向 | 实施入口 |
|---|---|---|---|
| P0 | Production 与账号入口 | RC4 production 已完成；开放账号注册，支持用户持续完善长期资料。真实注册确认邮件和密码重置邮件作为 production canary/运营观察项，不是 RC4 blocker。 | 运营观察 |
| P1 | 长期 Team 与赛事参与 | 建立赛事外的长期 Team 边界，以及 Team 与赛事参赛事实之间的 CompetitionEntry 关系。 | [#269](https://github.com/Starfie1d1272/RivalHub/issues/269) |
| P1 | “我的”与准备度 | 聚合个人资料、教育认证、竞技档案、我的队伍、我的赛事，并明确显示缺口与下一步。 | [#270](https://github.com/Starfie1d1272/RivalHub/issues/270) |
| P1 | Major 正式报名 | 形成面向长期 Team 的创建参赛条目、成员确认、资格、材料、审核与状态反馈体验。 | [#267](https://github.com/Starfie1d1272/RivalHub/issues/267) |
| P1 | 奖项产品设计 | 尽早确定奖项定义、申领/提名、材料和审核流程；最迟在正式报名开放前判断是否需要提前收集字段或材料。 | [#266](https://github.com/Starfie1d1272/RivalHub/issues/266) |
| P2 | RivalHub ↔ DAK 数据闭环 | 以清晰 owner 和版本化 artifact 建立比赛上下文、Demo 导入与差异核对闭环；短期保留 OCR，尤其 Rating Pro。 | [#268](https://github.com/Starfie1d1272/RivalHub/issues/268) |
| P2 | 历史与统一赛后产品 | 建立赛事历史、Team/Player 页面和区分官方事实与分析数据的统一赛后面板；2026 Spring Rivals 是第一份真实历史验收数据。 | [#265](https://github.com/Starfie1d1272/RivalHub/issues/265) |
| P3 | 深入分析与长期增强 | 在数据闭环稳定后逐步开放 DAK 深入分析；Rating 趋势和长期个人成就保持为较长期增强。 | [#153](https://github.com/Starfie1d1272/RivalHub/issues/153) |

## Dependencies

```text
RC4 production + long-lived participant profiles
                 │
                 ├─→ long-lived Team + CompetitionEntry
                 │          ├─→ “我的” team/event readiness
                 │          ├─→ Major registration experience
                 │          └─→ event history + Team/Player pages
                 │
                 ├─→ award product decision ─→ Major registration fields/materials
                 │
                 └─→ RivalHub/DAK artifact contract ─→ unified post-event panel
                                                     └─→ deeper DAK analytics

stable official history ─→ Rating trends and long-term achievements
```

Team/CompetitionEntry 与奖项产品判断是正式 Major 报名之前的关键前置。历史产品应复用统一赛事事实，不为 Spring Rivals 写死专用页面；DAK 深入分析必须建立在可核对的 artifact 闭环之上。

## Direction boundaries

- Team 是长期一级实体；赛事 roster、资格、种子与成绩属于 CompetitionEntry/赛事冻结事实，不能被后续 Team 变更覆盖。
- `tournament_honors` 继续表示最终官方荣誉；奖项申请、材料和审核是独立且尚待设计的上游流程。
- RivalHub 拥有赛事、身份、赛程、正式 roster、赛果、裁决和历史事实；DAK 拥有 Demo 解析与派生分析。
- “我的”面向用户任务和 readiness；统一赛后产品明确区分官方赛事事实与分析数据。
- 当前 season-bound `teams` / `teamApplications` 如何迁移仍待单独设计；roadmap 不提前写死 schema。

详细已接受边界和待决策问题见 [`decisions/2.x-product-domains.md`](./decisions/2.x-product-domains.md)。

## Dependency security backlog

生产依赖中的 high/moderate advisories 单独进入 [#271](https://github.com/Starfie1d1272/RivalHub/issues/271) 定向升级 backlog。升级时按直接依赖与传递路径分组，确认真实可达性、最小安全版本、兼容风险、锁文件变化和回归范围；本轮 planning convergence 不升级任何依赖。

## Non-goals of this convergence

- 不发版、不改版本号、不操作 production。
- 不实现 Team、CompetitionEntry、奖项、DAK、历史或“我的”功能。
- 不修改 schema，不新增 migration，不做依赖升级。
- 不继续 2.0 release-hardening、架构审查或相邻功能修补。
