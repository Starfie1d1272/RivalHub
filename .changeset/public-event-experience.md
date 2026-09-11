---
"rivalhub": patch
---

refactor(public): 优化公共赛事浏览体验、档案语义与站内观赛组件 (Refs #452, Review #5183045382)

- 修复 Rivals 选手目录可选位置筛选 Toolbar 入口；
- 精简 Event Team 顶部 Hero 与长期队伍 bridge 分层，移除模型解释文案与重复 Panel；
- 长期 Team 赛事履历与变更历史清理，过滤 bootstrap 初始记录，仅展示真实完赛事实；
- 长期 Player 区分报名档案（报名时资料）与正式参赛履历；
- 社区奖获奖人增加 public target 语义，仅确认具备选手公开身份时链接选手主页，更新 UI 文档；
- 根首页生命周期与 capability 对齐：已完赛赛事进入历史/最近结束语义，数据排行快捷入口遵循 showStats(season)，HomeSeasonPanel 移除凑数项；
- 队伍目录列表预览新增 batch read model，消除单卡 N+1 查询；
- Bilibili 官方 iframe 播放器渐进增强：click-to-load 模式、仅进行中突出、赛前外链入口、赛后隐藏并回退至录像；
- 修复 roundWeightedAvg 乘法优先级错误与 Major 浏览器 fixture 模板配置缺失。
