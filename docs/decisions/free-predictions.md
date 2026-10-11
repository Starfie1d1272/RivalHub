# 免费赛果与 BP 预测

`src/lib/free-predictions/` 独立拥有提交、幂等修订、匿名支持率与成绩投影；不使用 BET account、ledger、stake，也不复用自由推演 Prediction 或 Pick’Em 存储。

`submitFreePredictionInTx` 先取得 canonical Match 行锁，重读 active/verified 用户和官方比赛，验证赛果的一项队伍或 BP 的 BO1/3/5 个不同地图。本人队伍不限制免费提交。BET join、暂停与余额不参与免费资格。已结束/归档的赛事拒绝新提交。

官方 Match gameplay、Map 开始/完成、Veto session 开始/完成在同一事务捕获 `free_prediction_locks` 单向截止事实；比赛实际开始同时关闭 BP。回退或更正不能清除截止。服务器基于当前正式事实再次判断截止，预约时间和金融提前封盘不构成免费截止。迁移仅初始化已存在开始事实，不制造预测参与。

当前有效选择保存在 `free_prediction_choices`，冻结双方、run、赛制及 BP 地图池；重选覆盖当前选择并追加 `free_prediction_requests` 修订。相同用户/requestId 重放返回原 receipt，不恢复旧选择；不同参数重用同一键拒绝。所有写入在一个事务，唯一约束兜底。

赛果消费既有 `resolveBetFact` 正式赛果投影，取消/弃权/更换对阵或缺失比赛不记有效次数。BP 消费完整合法 BP 集合，不依赖实际已打地图数量；待申诉或尚未完成时 pending，无效结果 void。成绩从当前 canonical facts 读取时计算，更正自动改变成绩，不持久化另一份官方答案。

`getFreePredictionBoard({seasonId})` 安全地返回当前会话本人的选择和成绩、双方匿名赛果人数/比例以及 BP 地图计数。访客 mine/grade 为 null；零人数的比例为 null。`getFreePredictionRanking({seasonId,sort,userIds?})` 的 sort 为 profit/hits/accuracy，同表保留三列；没有已判定赛果时 hits/judged/accuracy 为 null。只计算赛果，BP 永不入榜。完整赛事总体经 `partitionRankingPopulation` 计算 P75 × 25% 动态资格线，再筛选用户；净收益沿用 BET 的资格、并列排名与有效净收益投影。

三表为 server-only，启用 RLS 且拒绝 anon/authenticated Data API。公开服务只输出本人选择与匿名统计，排行允许公开成绩及既有公开身份，不输出参与者逐场选择。

持久化目的为预测截止、修订审计与赛事个人成绩。选择与 request revision 为私有长期赛事历史，fence 为可审计开始边界；保留到正式赛事历史结束的长期理由与其他赛事事实一致。账号撤销/归并不自动删除或转移预测；账号删除/匿名化交由独立 identity/data-lifecycle 契约，不通过此功能新增 purge。备份包含私有选择和 receipt，恢复必须按 exact migration 验证 fence，不得从恢复后当前可变状态重开窗口。缺失 canonical Match 时历史选择只投影为无效。
