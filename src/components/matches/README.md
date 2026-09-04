# components/matches

赛程与比赛详情 UI 组件。

## 规划组件

| 组件 | 说明 |
|---|---|
| `MatchCard` | 比赛卡片（双方队名 + 系列赛比分 + stage/format 标签 + 状态 badge） |
| `MatchDetail` | 比赛详情（系列赛比分 + 单图列表 + 双方阵容） |
| `MapResultRow` | 单图结果行（地图 + 双方比分 + picked-by 标记 + 起始边） |
| `BracketView` | `brackets-viewer` 封装组件（注入 theme_color，多 stage 支持） |
| `ScoreInput` | 管理员控制 scheduled 比赛开始/取消（admin only） |
| `MapResultInput` | 管理员录入单图结果（admin only，BO3/BO5 多次提交） |

## v1 范围

- 展示 BO1/BO3/BO5 的比赛详情（依赖 `match_maps`）
- 管理员后台按地图录入实际回合比分；系列赛比分由已完成地图自动推导
- Bracket 视图（排位赛排名表 + 正赛 brackets-viewer 双视图）

## 推到后续阶段

- 队长在线 BP（需要 BP 状态机 + Realtime + 倒计时）
- 服务器 BP
- 比赛实时直播间（地图内得分推送）

## 实装阶段

- Phase 10：比赛详情 + 单图录入
- Phase 11：Bracket 视图
