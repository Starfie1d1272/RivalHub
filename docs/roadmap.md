# RivalHub Roadmap

Roadmap 只维护长期产品方向、依赖和 major-version 边界。当前工作、优先级和实施进度以 GitHub Issues / labels / PRs 为准；已发布内容以 CHANGELOG 和 GitHub Releases 为准。

## Product direction

RivalHub 2.x 的目标是把官方实例做成一套成熟、可审计、可恢复的高校 CS 赛事运营产品：

```text
稳定赛事运营
    ↓
可长期引用的 Player / Team / Event facts
    ↓
更完整的赛后数据与观赛参与
```

2.x 已经建立长期 Team、CompetitionEntry、资格与名单、Major/Rivals runtime、比赛管理、赛后事实、审计与生产运维基础。后续演进继续围绕四条主线展开。

## 2.x themes

### Tournament operations

减少真实办赛对临时页面、站外表格和隐式人工经验的依赖，使报名、审核、名单、种子、比赛、恢复和赛后操作形成顺畅且可解释的完整流程。

重点原则：运营 UI 只消费 canonical domain facts；正常 participant workflow 与管理员例外处理分离；失败和 blocker 必须可定位、可恢复、可审计。

### History, honors and data

赛事结束后继续沉淀长期可查询、可纠错、可追溯的 Player / Team / Event 历史，并明确官方赛事事实、OCR/Demo 等分析来源及其 provenance。

长期目标包括赛事履历、正式 honor、跨赛事统计，以及 RivalHub 与 DAK 等外部分析工具之间稳定的数据交换边界。

### Spectator participation

在 official runtime 稳定的前提下增加模拟、Pick'Em、预测积分等观赛玩法。此类功能只能消费正式赛事状态，不能反向影响 pairing、seed、result、placement 或其它官方事实。

### Player progression

在历史和统计来源足够稳定后扩展长期 Player 产品，例如跨赛事表现、Rating 趋势、荣誉和成就。任何长期指标都必须说明数据来源与可比范围，不重新解释历史比赛结果。

## Dependencies

```text
canonical tournament facts
        ↓
Player / Team / Event history
        ├─→ honors / long-lived profiles
        └─→ + OCR / DAK → richer post-event data

stable tournament runtime
        ↓
simulator / Pick'Em
        ↓
optional prediction progression
```

## 3.x horizon

3.x 不是已承诺功能清单。只有在 2.x 的官方实例和高校 CS 办赛能力成熟、并出现真实需求后，才评估：

- **多组织 / 多社区**：同一实例承载多个运营组织，同时保留跨组织 Player identity；
- **正式 production self-hosting**：安装、升级、Secrets、Auth、Storage、migration、监控、备份和恢复成为受支持产品能力；
- **更通用的游戏边界**：把赛事通用能力与 CS 特有身份、地图/BP、阵容和统计进一步分离；
- **稳定 API / Webhook / integrations**：让外部工具受控消费 RivalHub official facts。

## 2.x non-goals

- 不把第三方 production self-hosting 作为正式支持目标；
- 不为了抽象而提前建设多组织、多游戏或通用赛事 SaaS 框架；
- 不让分析、预测或社区玩法成为 official result 的第二 owner。

## Maintenance

只有长期方向、依赖或 major-version boundary 改变时更新本文件。不要写当前 Issue 编号、当前版本号、近期优先级、测试/migration 数量或单个 PR 的完成状态。
