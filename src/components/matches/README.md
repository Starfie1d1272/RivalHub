# components/matches

赛程与比赛详情 UI 组件。

## 组件清单

### 公开比赛页（Spectator & Participant）

| 组件 | 说明 |
|---|---|
| `MatchHeroHeader` | 比赛头部展示（队伍双方、比分、赛制与比赛阶段） |
| `MatchMapProfile` | 赛前地图池队伍战绩与胜选禁率分析（PRE） |
| `MatchRecentResults` | 队伍本赛季近期赛果（PRE） |
| `MatchHeadToHead` | 双方历史交锋与胜负记录（PRE） |
| `MatchRosterView` | 本场阵容展示（首发与替补） |
| `MatchRosterForm` | 队长首发阵容提交与调整弹窗 |
| `MatchTimeNegotiation` | 队长 / 管理员比赛时间协商弹窗 |
| `TimeProposalHistory` | 时间协商历史记录 |
| `VetoView` | 比赛禁选（BP）步骤与地图决定展示 |
| `MatchMapTabsNavigation` | 地图标签导航（支持整场汇总与单图切换） |
| `MatchSummaryStats` | 赛后整场选手与队伍综合数据汇总（POST） |
| `PlayerStatsTable` | 单图选手统计面板（Rating、K、D、A、ADR 等）（POST） |
| `MatchMvpVote` | 赛后 MVP 投票与胜出者公示（POST） |
| `MatchLiveViewing` | 直播与解说状态展示 |

### 赛事与赛程通用组件

| 组件 | 说明 |
|---|---|
| `MatchCard` | 比赛卡片（双方队名 + 系列赛比分 + 阶段/赛制标签 + 状态 badge） |
| `BracketView` | 淘汰赛双败 / 单败对阵树视图封装 |
| `StageSwissReadModel` | 瑞士轮阶段积分与对阵只读展示 |

### 管理员工作台（Admin Only）

| 组件 | 说明 |
|---|---|
| `ScoreInput` | 管理员控制 scheduled 比赛开始 / 取消（admin only） |
| `MapByMapInput` | 管理员逐图录入官方比分（admin only） |
| `ResultCorrectionPanel` | 管理员赛后赛果更正面板 |
| `AdminMatchRow` | 赛事管理页比赛行展示 |
| `AdminMatchWorkbench` | 比赛管理工作台聚合面板 |
| `StatsOCRPanel` | 计分板截图 OCR 识别与手工修正面板（admin only，只在管理工作台挂载） |
