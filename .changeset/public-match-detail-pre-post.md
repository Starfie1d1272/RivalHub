---
"rivalhub": minor
---

收敛公开比赛详情页的赛前（PRE）与赛后（POST）展示体验：
- 赛前提供双方阵容、地图胜选禁率分析（MatchMapProfile）、近期赛果（MatchRecentResults）、积分预测（MatchPrediction）、历史交锋（MatchHeadToHead）及 Veto 入口，移除旧重型对阵与六维雷达图；
- 赛后提供单图比分与记分板（PlayerStatsTable）、整场数据汇总（MatchSummaryStats）、详细指标深链（PlayerWorkspace）、MVP 投票（MatchMvpVote）与录像解说；
- 剥离公共页面上直接挂载的计分板 OCR 编辑器，保持公开浏览与后台管理严格分离。
