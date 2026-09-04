# RivalHub 2.x Roadmap

## 文档定位

本文件只描述 RivalHub 2.x 的长期产品方向、领域边界与结构性依赖。

它**不是**实时 TODO、Issue 状态表、版本 changelog 或 release checklist。当前优先级与实施状态以 GitHub Issues / labels / PRs 为准；已发布内容以 Changesets、CHANGELOG 和 GitHub Releases 为准。

## 2.x 已建立的基础

RivalHub 2.x 的基础目标已经从“单届赛事工具”转向“可跨赛季持续运营的赛事平台”。后续能力应继续建立在以下事实边界之上。

### 长期参与者身份

- 用户账号、教育资格与竞技档案属于跨赛事长期事实；
- profile readiness 与某届赛事的 event eligibility 分离；
- 展示身份、竞技目录、qualification 和赛事快照各自拥有明确 owner。

### 长期 Team 与赛事参赛

- Team 是长期一级实体；
- CompetitionEntry 表示某支 Team 或某组参赛者进入某一届赛事的参赛身份；
- 加入长期 Team 不等于自动参加赛事；
- 报名名单、正式赛事名单、阶段 entrants 与 match roster 保持分层。

### 正式赛事事实

- qualification 由服务端 canonical evaluator 计算；
- 赛事在关键节点冻结需要稳定复现的参赛和竞技上下文；
- 比赛、赛果、恢复、纪律、placement 与 honor 不互相用 UI projection 推断；
- 赛后历史消费已经确认的正式事实，而不是重算过去。

### 数据与发布边界

- active Drizzle migrations 是唯一数据库迁移 authority；
- schema evolution 需要兼顾上一稳定版本与下一版本的部署兼容性；
- `main` 是 releasable trunk，`v*` tag 才是正式 shipped identity；
- production migration、exact-tag deployment 与 smoke 属于受保护 release transaction。

## 2.x 产品主线

### 1. 参与者、Team 与 Eligibility

继续完善“一个人 / 一支队伍长期是谁，以及在某届赛事里现在能做什么”。

重点包括：

- 长期 profile 与竞技档案；
- 长期 Team 的成员、队长、邀请与招募；
- CompetitionEntry 的报名、成员确认、qualification、补正、审核与 readiness；
- 教育资格、竞技上下文和 sanction 与 event eligibility 的组合；
- “我的 RivalHub”作为个人任务和 blocker 的稳定入口。

### 2. 赛事运行与运营质量

继续收口真实办赛过程中最容易出现人工旁路和状态歧义的环节。

重点包括：

- Rivals 与 Major 的正式生命周期；
- 赛前名单、种子与 opening plan；
- Stage runtime、pairing、bracket 与比赛推进；
- match roster、时间协商、BP、地图和系列赛结果；
- result correction / recovery、纪律与赛后确认；
- 管理员工作台的可解释状态、明确 blocker 与安全操作边界。

### 3. 历史、荣誉与长期展示

让一届赛事结束后留下稳定、可引用、可纠错的长期事实。

重点包括：

- Player / Team / Event 长期历史；
- placement、正式荣誉、社区奖与纪律记录的边界；
- tournament honor 的提名、证据、投票、审核与最终确认；
- 公开事实、本人可见事实和管理员内部事实的展示隔离。

### 4. RivalHub ↔ DAK 数据闭环

把 Demo / OCR / 分析产物接入赛事运营，但不改变 official facts owner。

目标包括：

- 版本化 artifact contract；
- Steam、roster、match identity 对齐；
- provenance、人工确认、更正与失败回退；
- OCR / DAK 派生数据与官方赛果的差异核对；
- 为赛后分析与奖项提供可追溯证据。

RivalHub 继续拥有身份、正式 roster、赛程、赛果、裁决和最终 honor；分析系统拥有解析与派生分析。

### 5. Spectator engagement

在不污染正式赛事事实的前提下扩展观赛参与感。

可能包括：

- Major scenario simulator；
- Pick'Em 与挑战；
- Coin / Badge progression；
- Prediction Points、settlement ledger 与 leaderboard。

预测、模拟和积分默认都不是 official tournament facts，也不建立现实货币充值、提现或兑换。

### 6. Player progression

在稳定赛事事实和长期竞技档案之上继续扩展个人产品：

- Rating / performance 趋势；
- 跨赛事统计；
- 长期成绩与荣誉；
- profile 中的赛事历史和成就表达。

派生展示可以演进，但不得重新定义已经确认的比赛或赛事结果。

## 主要依赖关系

```text
Competitive Platform Catalog
          ↓
long-term Competitive Profile
          ↓
qualification ───────────────┐
                             ↓
Long-lived Team → CompetitionEntry → readiness → prestart → event runtime
                             │                         │
                             └──────────────→ history ←┘

RivalHub official facts ───────────────┐
                                       ├→ post-event / history / awards
DAK artifacts + provenance ────────────┘

Simulator / Prediction ─X→ official match facts
```

`─X→` 表示明确禁止作为正式事实来源。

## 2.x 非目标

2.x 不以“支持任意第三方 production 部署”为产品目标。仓库保持开源并支持本地开发，但当前产品、运维和发布设计优先服务 RivalHub 官方实例与真实赛事运营。

如果未来将 self-hosting 作为正式产品能力，应单独定义：安装、升级、Secrets、邮件、Auth、Storage、数据库迁移、监控、备份、灾难恢复和版本兼容承诺，而不是把现有 production runbook 包装成通用教程。

## 维护规则

只有以下变化需要更新 Roadmap：

- 2.x 产品方向新增、取消或明显重排；
- 长期领域边界或 canonical owner 改变；
- 两个产品域之间的结构性依赖改变；
- release contract 或产品支持范围改变；
- 某条主线移出 2.x 或进入下一 major version。

普通 PR merge、Issue close、label 变化、测试数量、migration 数量和当前版本号都不应写入本文件。
