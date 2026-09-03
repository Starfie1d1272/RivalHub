# RivalHub 2.x Roadmap

## 文档定位

本文件只维护 **2.x 的长期产品方向、依赖关系、release contract 与领域边界**，不再充当实时 TODO、Issue 状态表或变更日志。

以下信息应分别以各自 authority 为准：

- 当前优先级、是否正在执行、是否完成：GitHub Issues / labels；
- 当前实现：code、schema、active migrations、tests 与 technical docs；
- 已接受但尚未实现的设计：`docs/decisions/**`；
- release 内容：Changesets、CHANGELOG 与 GitHub Release；
- 历史过程与验收记录：`docs/archive/**`。

因此，PR 合并、Issue 关闭或 `next` 标签变化通常不需要同步修改本文件。只有产品方向、依赖、release boundary 或领域 owner 发生变化时才更新 Roadmap。

## Issue metadata

2.x Issue 使用 GitHub labels 表达执行优先级：

- `priority:P0`：production outage、数据完整性或需要立即处理的安全事件；
- `priority:P1`：当前产品主线、release gate 或正式运营前必须收口的能力；
- `priority:P2`：明确要做，但不阻塞当前主线；
- `priority:P3`：长期增强、spectator engagement 或无当前交付时限的 backlog；
- `next`：当前正在推进或紧接着要推进的极少数主题，不是新的优先级等级。

Issue 标题保留 `[2.x]` 表示版本线；优先级变化只调整 label，不修改标题。

实时执行顺序直接查询 GitHub：

```text
is:open label:next
```

当前 P1：

```text
is:open label:"priority:P1"
```

Roadmap 不复制这些查询结果。

## v2.0 stable contract

v2.0 stable 的目标不是把整个 2.x backlog 一次完成，而是形成一套可以长期演进、可以真实办赛、且领域边界已经稳定的基础产品。

稳定版应满足以下产品合同：

### 长期参与者身份

- 用户身份、教育认证、竞技档案属于长期事实，不绑定某一届赛事；
- 展示名称、竞技目录与 qualification 等均有明确 canonical owner；
- `profile readiness` 与 `event eligibility` 明确分离。

### 长期 Team 与赛事参赛身份

- Team 是长期一级实体；
- CompetitionEntry 是某支长期 Team / 某组参赛者进入某届赛事的规范参赛身份；
- 加入长期 Team 不等于自动参加任何赛事；
- 报名承诺 roster、正式赛事 roster、Stage entrants 与 match roster 保持分层。

### Major 正式报名与资格

- captain、member、admin 围绕同一 CompetitionEntry 完成报名、确认、qualification、补正、审核和批准；
- qualification 只由服务端 canonical evaluator 计算，UI 不建立平行规则；
- 报名截止、补正和 approved revision 有明确边界；
- prestart 只冻结已批准的正式赛事事实。

### 竞技平台目录

- Platform 拥有长期 rank ladder；
- Platform Season 只表达时间目录；
- 用户竞技事实记录 rank / stars / platform Rating，各自语义独立；
- Event 在实际开放报名时引用并冻结当时的 competitive context；发布只锁定公开赛事规则；
- 后续目录变化不得改写已经实际开放报名赛事的资格语义。

### “我的”任务入口

- 用户可以从稳定入口理解自己的长期资料、Team、CompetitionEntry、qualification 与本人可见 active sanction；
- 每个 blocker 明确说明事实、处理方和 CTA；
- 未知事实 fail closed，不以空值伪装为 ready。

### 奖项与报名边界

- 正式 Major 报名不为未来奖项预收 MVP / EVP 申请、社区奖声明、趣味奖材料或领奖信息；
- 正式荣誉和社区奖均在报名后基于实际 roster、比赛事实、解说记录、人工证据或后续奖项流程产生；
- `tournament_honors` 只表示最终确认的官方荣誉事实。

### Release 与数据升级

- active Drizzle migrations 是唯一 migration authority；
- stable 发布必须验证真实前序版本到当前 schema 的升级路径，而不只验证 fresh database；
- release commit、production migration、smoke、tag 与 GitHub Release 按仓库 release 规则执行；
- 已进入 `dev` 但仍保持 Open 的 release-gate Issue，在对应变更进入 `main` / release convergence 后统一关闭。

## 2.x 产品主线

### 1. 长期参与者、Team 与 Eligibility

这一产品线负责“一个人 / 一支队伍长期是谁，以及在某届赛事中现在能做什么”。

主要主题包括：

- 长期 Team 与 CompetitionEntry；
- 竞技平台目录与长期竞技档案；
- 正式赛事报名 acceptance；
- “我的” readiness / eligibility 聚合；
- 教育认证、纪律限制与赛事冻结事实的协作。

相关 Issues：[#269](https://github.com/Starfie1d1272/RivalHub/issues/269)、[#276](https://github.com/Starfie1d1272/RivalHub/issues/276)、[#267](https://github.com/Starfie1d1272/RivalHub/issues/267)、[#270](https://github.com/Starfie1d1272/RivalHub/issues/270)。

### 2. 奖项、历史与长期展示

这一产品线负责让真实赛事结束后留下长期可引用、可纠错、可解释的正式结果。

主要主题包括：

- 正式赛事荣誉与社区奖的定义、举证、投票、结奖；
- `tournament_honors` 作为最终官方 honor fact；
- 通用赛事历史、Team / Player 长期页面；
- placement、adjudication、discipline 与 honor 的历史边界；
- 公开事实与本人 / 管理员私密事实的展示边界。

相关 Issues：[#266](https://github.com/Starfie1d1272/RivalHub/issues/266)、[#265](https://github.com/Starfie1d1272/RivalHub/issues/265)。

### 3. RivalHub ↔ DAK 数据闭环

这一产品线负责把 Demo 分析能力接入赛事事实，而不改变官方事实 owner。

目标包括：

- 版本化 artifact contract；
- Steam / roster / match identity 对齐；
- OCR、DAK 与 official facts 的差异核对；
- provenance、人工确认、更正与失败回退；
- 为赛后分析和社区奖提供可追溯证据。

RivalHub 继续拥有赛事、身份、正式 roster、赛程、赛果、裁决和最终 honor；DAK 拥有 Demo 解析与派生分析。

相关 Issue：[#268](https://github.com/Starfie1d1272/RivalHub/issues/268)。

### 4. Spectator engagement

这一产品线负责观赛参与感，不改变官方赛事事实。

主要主题包括：

- Major scenario simulator；
- Pick'Em、Challenge、Coin / Badge progression；
- Prediction Points、market settlement、ledger 与 leaderboard。

Pick'Em correctness、Coin / Badge 与 Prediction Points 保持独立事实模型；Prediction Points 无现实货币价值，不建立充值、提现或现实兑换。

相关 Issues：[#273](https://github.com/Starfie1d1272/RivalHub/issues/273)、[#274](https://github.com/Starfie1d1272/RivalHub/issues/274)。

### 5. 长期 Player progression

长期个人产品在稳定赛事事实基础上继续扩展：

- Rating 趋势；
- 长期成绩与荣誉；
- profile 上的赛事历史与成就表达。

这些展示消费正式赛事事实或明确来源的派生数据，不重新定义赛事结果。

相关 Issue：[#153](https://github.com/Starfie1d1272/RivalHub/issues/153)。

## 主要依赖关系

Roadmap 只记录长期结构性依赖，不记录“某个 PR 当前是否已经 merge”。

```text
Competitive Platform Catalog
          ↓
long-term Competitive Profile
          ↓
qualification ───────────────┐
                             ↓
Long-lived Team → CompetitionEntry → registration / readiness → prestart
                             │
                             └────────────→ event history

RivalHub official facts ───────────────┐
                                       ├→ post-event / history
DAK artifacts + provenance ────────────┤
                                       └→ award evidence

Award process → final tournament_honors → history / profile

Pick'Em completion fact → optional Prediction Points reward policy
Simulator hypothetical state ─X→ official match / settlement facts
```

其中 `─X→` 表示明确禁止作为事实来源。

## Domain boundaries

### Team / CompetitionEntry / Event

- Team 是长期身份；
- CompetitionEntry 是赛事参赛身份；
- Event runtime 只消费赛事自己的冻结事实；
- 长期 Team 后续变化不得静默改写已报名或已发布赛事。

### Competitive Platform / Event qualification

- Platform 拥有 rank ladder 与平台 identity；
- Platform Season 是时间目录；
- Event 在实际开放报名时冻结 qualification context；publish 只锁定公开赛事规则与政策身份；
- rank、stars 与 performance Rating 是不同事实，不因 UI 展示方便而合并。

### Readiness / Eligibility / Sanction

- `profile readiness ≠ event eligibility`；
- qualification、CompetitionEntry 状态、赛事 roster 与 sanction 是并列事实；
- sanction 可以阻止 registration / roster / match participation，但不改写既有比赛、placement 或 honor；
- 普通用户只消费本人可见或公开 serializer，不泄露 internal evidence / admin notes。

### Awards / Honors

- award definition、candidate、evidence、vote、review 属于上游流程；
- `tournament_honors` 只存最终确认的正式荣誉；
- award 撤销、空缺和重新授予必须显式处理，不靠覆盖旧事实实现。

### Official facts / Analytics

- RivalHub 是 official tournament facts owner；
- OCR / DAK / simulator / prediction 都不能直接改写 official result；
- 外部或派生数据必须保留 provenance 和确认边界。

### Spectator products

- Simulator hypothetical state 不写 canonical match / StageRun；
- Pick'Em submission 与 Prediction Points ledger 独立；
- 互动 Badge、Coin、Prediction Points 默认不成为 tournament honor。

## Roadmap 维护规则

以下变化应更新 Roadmap：

- 2.x 产品方向新增、取消或发生明显重排；
- release contract 改变；
- 两个产品域之间的长期依赖改变；
- canonical owner / domain boundary 改变；
- 一个主题从 2.x 移出或进入新的 major version。

以下变化通常 **不应** 更新 Roadmap：

- 某个 PR merge；
- 某个 Issue close；
- `priority:*` 或 `next` label 调整；
- 测试数量、migration 数量、当前 commit SHA 变化；
- 一次性的 release acceptance 进度。

这些瞬时信息应留在 GitHub、Changesets、CHANGELOG、release notes 或 archive 中，而不是让 Roadmap 变成需要持续人工同步的第二份状态数据库。
