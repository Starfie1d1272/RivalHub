# RivalHub Roadmap

## 定位

Roadmap 只描述 RivalHub 的长期产品方向、主要依赖和版本边界。

具体工作状态、优先级和实施进度以 GitHub Issues / labels / PRs 为准；已经发布的内容以 Changesets、CHANGELOG 和 GitHub Releases 为准。

## 从 2.0 到 2.x

RivalHub 2.0 最初围绕 Major 的正式运营需求展开。为了把 Major 从报名真正推进到开赛和赛后，项目逐步补齐了长期 Team、CompetitionEntry、资格审核、赛事生命周期、赛前冻结、Swiss / Playoffs、比赛管理和赛后事实等能力。

这些能力后来不再只服务 Major，而是成为 RivalHub 2.x 的整体基础。2.x 接下来的目标，是把 RivalHub 做成一套成熟的高校 CS 赛事运营产品：赛事本身能稳定运行，Player / Team / Event 能跨赛季沉淀，赛后数据能继续利用，用户也有更多观赛和参与方式。

## 2.x 当前主线

### 1. 赛事运营成熟度

先把真实办赛过程中最容易依赖人工判断、临时页面和现场经验的部分继续收口。

当前重点包括：

- [#424 生产可观测性、Tracing 与敏感日志治理](https://github.com/Starfie1d1272/RivalHub/issues/424)；
- [#368 赛事后台工作区与 Major 赛前运营流程](https://github.com/Starfie1d1272/RivalHub/issues/368)；
- [#409 高价值列表的搜索、筛选、排序与分页](https://github.com/Starfie1d1272/RivalHub/issues/409)；
- [#365 版本化 5E → Perfect 换算策略与赛事冻结快照](https://github.com/Starfie1d1272/RivalHub/issues/365) 的剩余管理与展示能力。

这一阶段的目标不是继续增加更多后台页面，而是让报名、审核、名单、种子、比赛和赛后操作形成顺畅、可解释、可恢复的完整工作流。

### 2. 历史、荣誉与数据

赛事结束以后，结果不应只留在当届页面里。2.x 会继续把正式赛事事实整理成长期可查看、可纠错、可复用的数据。

主要方向：

- [#265 赛事历史与统一赛后面板](https://github.com/Starfie1d1272/RivalHub/issues/265)；
- [#266 奖项、荣誉与赛后产品](https://github.com/Starfie1d1272/RivalHub/issues/266)；
- [#268 RivalHub ↔ DAK 数据闭环](https://github.com/Starfie1d1272/RivalHub/issues/268)。

目标包括更完整的 Player / Team / Event 历史、正式荣誉、可追溯的赛后数据，以及 RivalHub 与 Demo / OCR / DAK 之间清晰的数据边界。

### 3. 观赛互动

在正式赛事运行稳定以后，RivalHub 可以进一步增加不影响正式赛果的观赛与预测玩法。

主要方向：

- [#273 Major 赛事模拟器与 Pick'Em 竞猜](https://github.com/Starfie1d1272/RivalHub/issues/273)；
- [#274 Major Prediction Points](https://github.com/Starfie1d1272/RivalHub/issues/274)。

Simulator、Pick'Em 和 Prediction Points 都只消费正式赛事结果，不反向影响比赛、pairing、seed 或 placement。

### 4. Player progression

当赛事历史和数据来源稳定以后，再继续扩展长期 Player 产品。

当前保留方向：

- [#153 Rating 趋势与长期个人成就](https://github.com/Starfie1d1272/RivalHub/issues/153)；
- 跨赛事统计；
- 长期成绩、荣誉和成就展示。

这些能力建立在已经确认的赛事事实和明确来源的数据上，不重新定义过去的比赛结果。

## 主要依赖

```text
赛事运营事实
    ↓
Player / Team / Event 历史
    ├──→ 荣誉与赛后展示
    └──→ + DAK / OCR → 更完整的赛后数据

稳定 Major runtime
    ↓
Simulator / Pick'Em
    ↓
Prediction Points
```

## 3.x 展望

3.x 目前不是已经承诺的功能清单，也没有确定发布时间。它表示在 2.x 把官方实例和高校 CS 赛事运营做成熟以后，RivalHub 可能进入的下一阶段。

如果说 2.x 主要解决“RivalHub 能稳定办好一套完整赛事”，那么 3.x 更可能讨论“同一套产品能力如何服务更多组织、更多部署场景和更广的赛事生态”。

候选方向包括：

### 多组织与多社区

让同一个 RivalHub 实例承载多个赛事组织或高校社群，各自拥有赛事、管理员、品牌和权限范围，同时保留跨组织的 Player 身份。

### 正式支持 production self-hosting

如果未来把第三方部署作为正式产品能力，需要给出完整的安装、升级、Secrets、Auth、Storage、数据库迁移、监控、备份和恢复约定，而不是直接复用官方实例的运维流程。

### 更清晰的游戏能力边界

RivalHub 当前明显以 CS 赛事为主。未来如果出现真实的多游戏需求，应把通用赛事能力与游戏特有的竞技身份、地图 / BP、阵容和统计能力进一步分开，而不是简单增加一个游戏字段。

### API 与外部集成

随着 DAK、直播工具、Bot 或其它赛事服务增加，可以再考虑稳定的 API、Webhook 和集成边界，让外部工具消费 RivalHub 的正式赛事事实。

这些方向只有在出现真实需求并形成明确产品边界后，才进入正式 3.x 规划。

## 2.x 非目标

2.x 不把第三方 production self-hosting 作为正式支持目标。仓库继续保持开源并支持本地开发，但当前产品、运维和发布设计优先服务 RivalHub 官方实例与真实赛事运营。

## 维护

只有长期产品方向、主要依赖或 major version 边界发生变化时才更新本文件。

普通 PR merge、Issue close、label 变化、当前版本号、测试数量和 migration 数量不写入 Roadmap。
