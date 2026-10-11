# RivalHub Demo Evidence V1 数据边界

**Status:** accepted

## Context

RivalHub 需要接收 DAK 对正式比赛 Demo 的赛后分析结果，用于比赛数据确认、公开统计与后续赛事级聚合。此前已有 OCR/手工赛后数据路径，但 DAK 已经拥有更完整、稳定的 Demo-specific semantics；如果 RivalHub 在云端重新实现 trade、KAST、economy、conversion 等判定，会形成重复算法和长期口径漂移。

同时，RivalHub 不应因此保存原始 `.dem`、复制 DAK 的完整事件/空间数据模型，或把 DAK runtime 直接耦合进 Web 生产环境。跨仓接缝需要既能支撑当前明确的 HLTV-class 透明统计，又保持足够窄、可审计、可版本化。

## Decision

一份 `RivalHubDemoEvidenceV1` 固定对应一张 official `MatchMap`。原始 `.dem` 始终在 DAK Studio 本地解析，不上传 RivalHub；DAK Studio 通过可撤销的设备级配对读取赛事目录并提交 evidence，正常路径由 RivalHub 服务端自动校验、确认并投影，异常才进入轻量 needs-attention 状态。

RivalHub 的远程赛事源复用 DAK Studio 现有的 `EventsView` 与 Event → Stage → Series → Map 目录。远程事件只以现有 Event/Series/Map record 的增量元数据缓存身份、revision、名单、目标与 Demo 同步状态；手工或 R2 赛事仍按原有本地路径工作。连接授权在系统浏览器完成，Studio 的长期 credential 由操作系统安全凭据存储（macOS Keychain / Windows Credential Manager）保存，浏览器开发环境只保存在进程内存。

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
- `summaries` 是 DAK 生成的传输/查询 cache；RivalHub 保留 participant identity/shape/basic invariant，并继续校验 contract 明确要求的 source/team/weapon 一致性，但不从 `playerRounds` 重算 `playerMaps` 的统计指标。
- RivalHub confirmed projections 是服务端硬校验通过后供官方产品与公开 read model 使用的持久化结果；自动确认、异常处理、配对撤销均保留 audit fact。

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

`semanticProfile` 采用 bundle-level 版本。当前 canonical profile 为 `dak-stable/3`，对应 DAK Core 的 enemy-only offensive kill credit 与 parity QA；如果 bugfix 会改变 Stable 历史输出，则提升 semantic profile。`dak-stable/1` 与 `dak-stable/2` 保持 immutable、read-only、可审计，但不允许新的 confirmation、retry promotion 或 canonical reprojection；未来 profile 在显式声明兼容前也不得 promotion。RivalHub 不得把不兼容 profile 的地图静默混合聚合。无需为每个指标建立独立版本号。

Quality 保持轻量：继续区分 `null != 0`、missing 与 empty，并保留 QA / availability。核心 Demo/Stats 明显不完整或 QA 失败时，整份 Evidence 不进入正常 confirm；可选高级 capability 缺失时，仅不展示对应统计，不为极端 partial case 建设通用 completeness framework。

`extensions["cs2dak/diagnostics"]` 是可选的版本化确定性诊断（`version: 1`）。QA 最多携带 64 条 `{severity, code, path, message}`，超出部分保留 `omittedIssueCount`，条数与既有 QA 摘要校验一致。code 最长 96 字符，path 是最长 128 字符的逻辑字段定位或 null，message 最长 320 字符；凭据、URL、个人路径、玩家昵称、原始日志不属于此 DTO。producer 在输出前脱敏，receiver 严格拒绝未脱敏或越界的已知扩展，不在摘要计算前悄悄改写输入。安全且未知的未来 QA code 保留；文案表不决定证据留存。其它命名空间扩展保持原有兼容性，新增扩展的内部对象拒绝未知字段与不支持版本。

能力原因只解释 Core 的既有判断，不重新检测 gameplay：`richKills` 携带 eventCount、flagsEventCount、namedActiveWeaponEventCount，以及 Core 给出的 reason。合法空事件为 available；扩展标记与可识别当前武器分别有观察时为 available，只有扩展标记为 partial，未观察到扩展标记为 missing。观察计数不意味着每条击杀都具备全部信息。QA 警告、QA 错误、能力降级是独立维度，警告本身不代表上传失败；既有确认安全校验不变。

接收端必须先兼容，再启用 producer 发送。Base V1 / semantic profile 不变；producerVersion 用 `cs2dak-rivalhub-evidence/0.2.0` 标识新输出。完整 payload 仍参与现有稳定序列化的 idempotency key / payloadSha256，诊断不从 hash 中剔除。相同输入重试得到相同身份；带诊断的新 payload 与旧 payload 是同 Demo 的不同 artifact，经既有同 Demo lineage promotion 保留 predecessor，不能复用旧 idempotency key，不能改写历史 payload/hash。attempt、requestId、runtime cause、当前时间不得进入此扩展，canonical gameplay facts 的身份与内容不受它影响。

管理员工作台只为每图当前 confirmed / needs-attention artifact 读取证据并投影有界质量详情；确认后的警告仍可查看，确认/拒绝动作继续只用于待处理记录。旧版摘要明确显示“详情未提供”，不能依据数量补造历史 warning 或把 richKills 降级当成 warning 原因。诊断原文不进入公开统计 DTO；公开页沿用必要的能力/数据可用性说明。此兼容变更不重算或回填任何历史数据。

OCR 与 DAK 不进入通用 per-metric provenance framework，而按 source group 明确 ownership：DAK/Demo 拥有 rounds、KDA、damage、HS、KAST、opening、trade、clutch、utility、weapon、team conversions 等；Scoreboard/OCR 拥有 Rating Pro、RWS、WE 等外部 scoreboard 字段。官方单图结果完成后即可接收该图的 operator-confirmed scoreboard 与 DAK Evidence，即使系列赛仍在进行中；地图结果变化会使对应 Evidence revision 失效，而系列赛完成、弃权或取消不会单独使已确认单图失效。两条写入路径不得清空对方拥有的数据。

Evidence artifact 本身 immutable；pending / confirmed / rejected / stale / superseded 属于 RivalHub import/review decision。`dak-stable/3` 是当前唯一可 promotion 的 profile；同一 Demo 从 `/2` 迁移到 `/3` 时保持 `evidenceRevision` 不变，使用新的 payload/idempotency identity。Promotion owner 在同一事务内锁定整张 map 的 import lineage，选择 canonical predecessor、把同一 Demo 的其它 active source 一并置为 `superseded`，并由新 import 的 `supersedesImportId` 保留历史 parent；不同 Demo 的 confirmed content 必须保持显式冲突，不能被 lineage cleanup 静默替换。`/1` 与 `/2` 的既有 Evidence 只读保留，read model 只选择当前 profile 的 active import，不因迟到的历史 profile row 回退。Schema V1 允许 additive optional field/capability/extension；删除字段、改变类型/单位/既有语义属于 breaking change。跨仓兼容以 machine-readable contract 与 golden JSON fixtures 验证，不重新通过共享裸 TypeScript runtime package 耦合两个仓库。

SQL projection 按真实 consumer 物化，不与 artifact 一比一建表。Confirmed artifact 可以比首轮 SQL projection 更宽，以便后续在不重新解析 Demo 的情况下 backfill 新的 read model。

## Consequences

- RivalHub 可以构建当前明确计划中的基础、T/CT、opening、trade、clutch、weapon/sniper、utility、pistol/R2、economy、man-advantage、team map/side 等赛事统计，而不复制 DAK 算法。
- RivalHub 不承诺复刻 HLTV Rating、Impact、attribute scores 等私有公式；规则不公开的指标采用 DAK/RivalHub 自己的公开、版本化定义。
- DAK 可以继续独立演进高级 replay、spatial、mechanics、Coach 与 rating 能力，而不扩大 Base Evidence。
- 不为尚未在真实赛事中出现的逐回合裁决或极端 partial-data 场景提前建设复杂 UI/数据流程；出现真实需求后通过兼容扩展演进。
- 后续 exact JSON Schema / Zod / fixtures / migrations 与实现进度由 #268 及对应 PR 跟踪；本 decision 只维护长期边界与 rationale。
