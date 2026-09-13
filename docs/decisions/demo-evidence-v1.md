# RivalHub Demo Evidence V1 数据边界

**Status:** accepted

## Context

RivalHub 需要接收 DAK 对正式比赛 Demo 的赛后分析结果，用于比赛数据确认、公开统计与后续赛事级聚合。此前已有 OCR/手工赛后数据路径，但 DAK 已经拥有更完整、稳定的 Demo-specific semantics；如果 RivalHub 在云端重新实现 trade、KAST、economy、conversion 等判定，会形成重复算法和长期口径漂移。

同时，RivalHub 不应因此保存原始 `.dem`、复制 DAK 的完整事件/空间数据模型，或把 DAK runtime 直接耦合进 Web 生产环境。跨仓接缝需要既能支撑当前明确的 HLTV-class 透明统计，又保持足够窄、可审计、可版本化。

## Decision

一份 `RivalHubDemoEvidenceV1` 固定对应一张 official `MatchMap`。原始 `.dem` 始终在本地解析，不上传 RivalHub；Phase 1 由独立 RivalHub Demo Assistant 生成 evidence，经 RivalHub pending review / human confirm 后才进入官方赛事统计。

Evidence 按以下权威关系组织：

```text
sourceFacts
    ↓
semanticFacts
    ↓
summaries
    ↓
RivalHub confirmed projections
```

- `sourceFacts` 保存紧凑的 normalized Demo facts，例如 rounds、kills、objectives。
- `semanticFacts` 保存 DAK 拥有定义权的 Stable semantics，例如 player-round、trade、KAST、opening、economy 与 conversion；RivalHub 不从 source facts 重新实现这些算法。
- `summaries` 是可由前述事实重建并 cross-check 的传输/查询 cache，不是另一份独立 truth。
- RivalHub confirmed projections 是人工确认后供官方产品与公开 read model 使用的持久化结果。

Base V1 只保存当前赛事统计所需的低维 sufficient facts。`playerRounds` 除基础 combat facts 外，应包含可加总的 utility facts，包括 flash throws、enemy/team blind seconds、enemy blind victims、flash assists、HE/fire throws 与 damage、smokes thrown、utility kills。逐颗 grenade/blind event、raw damage stream、spatial/heatmap source、reaction/preaim/mechanics、Coach/anti-strat 等不进入 Base V1；确有消费需求时通过 versioned extension 增加。

时间只保存 source facts：`tickRateHz`、round/event ticks，以及必要的 freeze/bomb 边界。`1:55`、C4 倒计时等展示时钟由 DAK 内部统一派生，不固化进跨仓 Evidence contract。

Round 只保留稳定 `roundSeq` 及必要的 source/parser round、regulation/OT 信息。V1 不建设逐回合“是否计入官方结果”的裁决模型或 UI；若 Demo 出现 restart/restore/异常重复 execution，首轮由 DAK QA 阻止正常确认并进入人工检查，而不是让 DAK 猜测官方裁决。

Participant 同时保留 Demo observation 与 RivalHub identity resolution：Steam64、name snapshot、observed team 不因成功映射而丢失；`userId` / `eventRosterMemberId` / `entryId` 属于 RivalHub resolution。昵称不得作为 mapped canonical player statistics 的稳定 identity。

必须区分三个版本概念：

```text
contractVersion   = wire/schema compatibility
semanticProfile  = Stable statistics semantics compatibility
analysisVersion  = actual DAK analysis software version
```

`semanticProfile` 采用 bundle-level 版本，例如 `dak-stable/1`。如果 bugfix 会改变 Stable 历史输出，则提升 semantic profile；RivalHub 不得默认把不兼容 profile 的地图静默混合聚合。无需为每个指标建立独立版本号。

Quality 保持轻量：继续区分 `null != 0`、missing 与 empty，并保留 QA / availability。核心 Demo/Stats 明显不完整或 QA 失败时，整份 Evidence 不进入正常 confirm；可选高级 capability 缺失时，仅不展示对应统计，不为极端 partial case 建设通用 completeness framework。

OCR 与 DAK 不进入通用 per-metric provenance framework，而按 source group 明确 ownership：DAK/Demo 拥有 rounds、KDA、damage、HS、KAST、opening、trade、clutch、utility、weapon、team conversions 等；Scoreboard/OCR 拥有 Rating Pro、RWS、WE 等外部 scoreboard 字段。两条写入路径不得清空对方拥有的数据，现有 destructive map-level replace 在接入时应退役。

Evidence artifact 本身 immutable；pending / confirmed / rejected / stale / superseded 属于 RivalHub import/review decision。Schema V1 允许 additive optional field/capability/extension；删除字段、改变类型/单位/既有语义属于 breaking change。跨仓兼容以 machine-readable contract 与 golden JSON fixtures 验证，不重新通过共享裸 TypeScript runtime package 耦合两个仓库。

SQL projection 按真实 consumer 物化，不与 artifact 一比一建表。Confirmed artifact 可以比首轮 SQL projection 更宽，以便后续在不重新解析 Demo 的情况下 backfill 新的 read model。

## Consequences

- RivalHub 可以构建当前明确计划中的基础、T/CT、opening、trade、clutch、weapon/sniper、utility、pistol/R2、economy、man-advantage、team map/side 等赛事统计，而不复制 DAK 算法。
- RivalHub 不承诺复刻 HLTV Rating、Impact、attribute scores 等私有公式；规则不公开的指标采用 DAK/RivalHub 自己的公开、版本化定义。
- DAK 可以继续独立演进高级 replay、spatial、mechanics、Coach 与 rating 能力，而不扩大 Base Evidence。
- 不为尚未在真实赛事中出现的逐回合裁决或极端 partial-data 场景提前建设复杂 UI/数据流程；出现真实需求后通过兼容扩展演进。
- 后续 exact JSON Schema / Zod / fixtures / migrations 与实现进度由 #268 及对应 PR 跟踪；本 decision 只维护长期边界与 rationale。
