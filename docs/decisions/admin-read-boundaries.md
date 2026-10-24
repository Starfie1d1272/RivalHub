# 后台读取与辅助展示边界

后台赛事上下文通过 `src/lib/admin/season-context.ts` 在单次 RSC 请求中复用。侧栏和目录复用经当前管理员授权的窄目录；内部完整赛事行只供 server reader 使用，页面向 Client 显式投影。React request cache 不承担跨请求权限缓存，每个独立 action 保留 fresh authorization。

后台比赛工作台的开赛 preflight、实际首发、地图与来源 authority 仍由原领域 owner 判定。Demo 身份复核在事务内读取 canonical identity，Steam persona 只在所有相关事务结束后批量补充，不参与决定可确认身份。Bilibili 状态与 Uploader 下载信息在独立 Suspense 区域读取，辅助失败不改变正式比赛事实。下载与设备弹窗通过首次打开后的 action 读取，action 重新检查赛事权限。

地图截图编辑器只在默认聚焦或首次展开时挂载。关闭已激活地图不会卸载编辑器，避免丢失截图与未保存草稿。工作台不接管 OCR 写入、DAK 字段或 unknown commit 恢复协议。赛程阶段切换由 URL 驱动，服务端只构建当前阶段的列表内容；全局解说和测试赛冲突范围仍独立保留。折叠的解说有效场次报告在展开后授权读取。

审计列表唯一读取 authority 是 URL 驱动的 RSC。Client 只发起导航和独立授权的详情读取，直接呈现新 RSC props；赛事页在服务器固定 season scope，并应用相同筛选。排序使用时间与 ID 的稳定组合。标签仅在本次读取中解析；pool 路径最多同时处理三个目标类型，显式传入 transaction executor 的路径保持串行。

Major 已开赛、结束与归档的总览只读人数和状态摘要，不计算准备期 readiness；完整筹备页仍保留全部冻结事实、种子与资格核验。运营统计在 SQL 内计数和按北京时间分日，历史增长不受当前用户归并、队伍解散或成员离队过滤；教育通过人数保留每用户每日去重。邀请码状态筛选先于分页，时间边界和 revoked、expired、exhausted 的优先级保持不变。

遥测面板的短合并窗口仅消除尚未发起的中间筛选读取；已经发出的 server read 不被浏览器取消标志回滚。旧结果仍受组件取消标志保护，活动标签页才构建其列表。缺失指标不补零；受控空提示与局部错误恢复不构成历史客户端异常的根因证明。

confirmed Demo质量详情由展开后的独立授权读取提供；首屏保留当前import metadata。needs_attention仍执行canonical身份与目标核验。Steam缓存或upsert失败仅影响persona展示，保留原blocker、候选与规范化身份。工作台解说只读全部active赛事和当前场的历史分配，全局下一场与测试赛冲突范围不随局部历史窗口缩小。execution页面通过单次coordinator让赛务与解说共享活动比赛事实，不建立跨请求缓存。

反馈列表只下发25条正文摘要；详情action每次重新验证超级管理员并按ID读取完整正文。纪律页仍调用唯一的canonical状态/时窗解析，在只读repeatable-read快照内先读窄事实，再仅为当前页读取内部证据；未把显示优化作为处罚authority。

比赛三view的普通列表为25条，分页与阶段/队伍/状态保存在URL；切换筛选重置页号。execution读取当前阶段窄排序事实后仅读当前页完整展示字段；schedule的frozen runtime、积分榜和批量排期保留全阶段事实。materials在canonical完整判定后分页，不把原始finished行截断成错误的待办总数。Main Swiss房间提示复用冻结投影，仅返回该场record。

公告列表消费canonical summary/count；季赛详情将id、seasonId和actor scope交同一个owner。赛事信息目录只消费两种计数，详情保持直接scoped读取。教育概览与审核队列是独立服务端区域，概览失败不把队列伪装成空集合；审核队列primary-ready仅在真实内容旁记录。
队长确认面板只消费前八名的展示字段和完整候选人数；后台reader只读取approved、active且愿任队长的报名，复用canonical排序，确认action仍重新核验。换算策略赛事引用按当前SQL顺序一次分组，保留显式版本优先于fallback及报名冻结状态。

筹备页的最近阵容差异只读取按revisionNumber排序的倒数第二个approvedAt事实，不重新解释冻结来源。后台选秀pool的state/teams/picks可并行，members仍依赖teams，事务内默认顺序保留；catalog后台pool消费者显式使用共享reader的concurrent选项，冻结事务保持默认顺序。
