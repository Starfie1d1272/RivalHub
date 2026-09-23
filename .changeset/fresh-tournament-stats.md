---
"rivalhub": minor
---

赛事统计重构为 Overview、Players、Teams、Maps 和 Weapons 五个一级入口。Player/Team 目录统一跳转到现有公共实体页，Map 保留 Stats 内的专属详情；赛事级 Weapons 独立展示，并在 Overview 提供摘要。

统计范围支持 Stage、Best-of、Map 与 Team 等可分享 scope。Maps 增加 Map Pool / Veto 视图，Veto 使用当前范围实际参赛队伍与明确的 recorded / missing / not-applicable 样本边界，并以紧凑的 Team × Map Pick/Ban 矩阵展示。Team Rating 复用既有 player-map Rating 原始指标做队伍级聚合。

正式赛果、BP 暴露和已确认 DAK 详细覆盖继续分开呈现；地图详情只读取所选地图数据，内部统计导航保留滚动位置。
