# 公共缓存失效合同

共享 owner 是 `src/lib/cache/tags.ts` 与 `src/lib/revalidation.ts`。领域 mutation 提供已提交的真实变化；entrypoint 在提交后调用失效，再做可失败的响应投影。stale/idempotent/响应失败不代表没有提交。权限与 public membership 仍在缓存外 fresh 校验，私有余额、选择和管理员 DTO 不进入共享公共缓存。

## 消费者和事实边界

| 读模型 | 缓存依赖 | 必须保留的 fresh 边界 |
| --- | --- | --- |
| 平台/赛事统计、地图/选手/队伍详情与 MVP 摘要 | 全局统计安全 tag；scope、公开赛事集合及投影版本进入 key | 公开赛事/entry 可见性；统计只使用 canonical 当前证据及冻结人口 |
| career、benchmark、lineup style/comparison | 全局统计安全 tag | 身份归属、完整历史人口与当前证据选择；comparison 排除当前比赛 |
| BET 公共池与免费预测支持率 | 单赛事 BET、公开 season、全局统计安全 tag | 每次请求的个人资金/选择、准入、封盘与事实签名；草稿不共享 |
| 进行中 BP 房间 | 无跨请求共享 room cache；no-store transport | fresh 权限、DB 时钟、revision、实际 lineup 与命令状态 |
| 公共玩家基础资料 | public player tag；统计支路使用统计安全 tag | viewer overlay、资格与当前身份授权 |

不按页面名称推断依赖：统计中的 veto reader 限定 finished；BET 公共 snapshot 则确实消费进行中 BP 的支持率和市场事实。lineup/appeal 等已证明无地图目录变化的 BP 变化豁免历史统计重建时，BET tag 仍必须立即过期。`veto` 旧 receipt 同时包含普通步骤与 map-plan 完成/重建；后者改变 scheduled/in_progress 地图目录及统计 selection/options，因此目前仍走宽失效，不能仅凭 finished veto reader 推断全部统计消费者只依赖完赛事实。

## Mutation 合同

`revalidateVetoRoomPaths(context, receipt, options)` 接收服务端读取的 slug/seasonId/matchId/matchStatus，以及领域 owner 的 changed/affectedFacts。没有真实变化时不失效。仅 scheduled/in_progress 且事实集合非空、全部属于 lineups/appeals 时，允许跳过全局统计失效；finished、cancelled、缺失/未知事实继续宽失效。`statistics:true` 是明确的紧急回退。

该 BP 专用合同保留现有 match/season 页面刷新，并立即失效单届 BET tag。Server Action 用 updateTag 保持 read-your-writes；Route Handler 用 `{ expire: 0 }`，不将 generic season 的 SWR 语义套到实时支持率。

官方赛果、地图、首发/证据更正、身份归并、Steam 绑定/退休、公开撤回仍使用全局统计硬失效和 fresh public guard。名称/logo 改变需要失效嵌入 label 的投影；worker settlement/reversal/credits 需要覆盖其公共结算/排名消费者，不只依赖公共池的 TTL。未知提交先安全回读，不重放业务写入。

## 测量边界

`use cache: remote` 的函数调用不是已知 miss；真实填充 body 内的 span 可以表示 fill，但外层调用减 fill 不能直接当 hit（存在并发合并）。缓存命中、填充、驱逐和 tag 更新时间应从真实 handler 边界测量。框架已有 pending set 等待时，不再叠加第二套无界协调。

Next 内置内存 handler 的隔离 fixture 可验证 hard-expire、SWR、独立读取流、失败恢复与 LRU；它不能证明生产命中率、容量或重启频率。默认 cache debug 输出含 key/tag，不直接作为可公开生产遥测。缓存对象、序列化峰值和共享连接预算须在集成混合负载中量测后决定是否调整基础设施。
