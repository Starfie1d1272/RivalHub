# components/matches

赛程与比赛详情 UI 组件。

## 规划组件

| 组件 | 说明 |
|---|---|
| `MatchCard` | 比赛卡片（双方队名 + 比分 + 状态 badge） |
| `MatchDetail` | 比赛详情（地图结果 + 双方阵容） |
| `BracketView` | `brackets-viewer` 封装组件（注入 theme_color） |
| `ScoreInput` | 管理员录入比分表单（admin only） |
| `MapResult` | 单图结果行（地图名 + 双方得分 + 赢家标记） |

## 实装阶段

- Phase 10：比赛详情
- Phase 11：Bracket 视图（brackets-manager + brackets-viewer）
