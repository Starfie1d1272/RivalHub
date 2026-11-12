# 公共缓存失效合同

共享 owner 是 `src/lib/cache/tags.ts` 与 `src/lib/revalidation.ts`。领域 mutation 提供已提交的真实变化；entrypoint 在提交后调用失效，再做可失败的响应投影。stale/idempotent/响应失败不代表没有提交。权限与 public membership 仍在缓存外 fresh 校验，私有余额、选择和管理员 DTO 不进入共享公共缓存。

## 消费者和事实边界

| 读模型 | 缓存依赖 | 必须保留的 fresh 边界 |
| --- | --- | --- |
| 平台/赛事统计、地图/选手/队伍详情与 MVP 摘要 | 平台使用平台统计 tag，赛事使用赛事 tag 与跨赛事身份 tag，单场表现使用比赛 tag 与跨赛事身份 tag；公开范围及投影版本进入对应 key | 公开赛事/entry 可见性；统计只使用 canonical 当前证据及冻结人口 |
| career、benchmark、lineup style | 全局统计安全 tag | 身份归属、完整历史人口与当前证据选择 |
| lineup comparison | 事务内推进的公开总体版本；固定 cutoff 和必要的比赛排除进入 key | 比赛与公开权限 fresh 校验；总体回填在同一只读快照校验采纳 Demo、名单与身份 |
| BET 公共池与免费预测支持率 | 单赛事 BET、公开 season、赛事统计 tag 与跨赛事身份 tag | 每次请求的个人资金/选择、准入、封盘与事实签名；草稿不共享 |
| 进行中 BP 房间 | 无跨请求共享 room cache；no-store transport | fresh 权限、DB 时钟、revision、实际 lineup 与命令状态 |
| 公共玩家资料及统计里的玩家名称 | public player tag；名称批量投影按统计展示 tag 更新 | viewer overlay、资格与当前身份授权；统计计算复用原有数值结果 |

不按页面名称推断依赖：统计中的 veto reader 限定 finished；BET 公共 snapshot 则确实消费进行中 BP 的支持率和市场事实。lineup/appeal 等已证明无地图目录变化的 BP 变化豁免历史统计重建时，BET tag 仍必须立即过期。`veto` 旧 receipt 同时包含普通步骤与 map-plan 完成/重建；后者改变 scheduled/in_progress 地图目录及统计 selection/options，因此仍走宽失效。只有 locks canonical owner 明确产生的 veto_step 表示普通非地图计划步骤；map_plan、旧 veto 和未知事实始终宽失效，混合事实采用并集，不能用不存在 map_plan 来推断旧 veto 等同 veto_step。不能仅凭 finished veto reader 推断全部统计消费者只依赖完赛事实。

## Mutation 合同

赛果、正式名单、当前 Demo 采纳、统计投影与已核实记分板在事务内更新按场 watermark。同场同事务合并事实类别和代次；同值保存、审核时间戳及等价的统计传输 sidecar 跳过统计登记。Demo 原样重传继续核对当前依赖，已有待办由投递 owner 接手。比赛时间与展示路径的刷新独立于统计 tag。

`src/lib/matches/projection-invalidation/` 负责已提交事实的投递。前台写入口和既有 scheduler 共用同一查询、失效计划及按场代次确认。补发按现有 pending index 取最多 50 场；同一批中的平台、赛事及共享展示 tag 各投递一次。Server Action 用 `updateTag`，Route Handler 用 `{ expire: 0 }`。Next 在请求完成时执行 tag 更新，`after` 回调观察当前 handler 的硬过期标记推进后，用一次 CAS 确认已捕获的代次。失败项轮转，未确认项由 scheduler 恢复。重试只投递缓存义务。

单场结果、赛事及平台的统计依赖按范围显式传入。跨赛事身份修改使用全局身份 tag；公开范围由读入口 fresh 校验。普通 season/page 刷新仅更新展示。进行中的 BP 会继续立即过期对应赛事的 BET；仅 lineup、appeal 和普通 veto step 的开赛前及直播变化保留历史统计。旧或未知类别保守处理。

Steam 昵称、站内昵称与完美昵称由展示投影按 UUID 批量读取，附加到已计算的公开 DTO。头像和资料链接继续通过个人资料缓存更新。Steam 身份绑定、退役和账号归并保留跨赛事统计失效。队伍名称仅刷新其变更的 active entry 和平台展示。

## 测量边界

`use cache: remote` 的函数调用不是已知 miss；真实填充 body 内的 span 可以表示 fill，但外层调用减 fill 不能直接当 hit（存在并发合并）。缓存命中、填充、驱逐和 tag 更新时间应从真实 handler 边界测量。框架已有 pending set 等待时，不再叠加第二套无界协调。

Next 内置内存 handler 的隔离 fixture 可验证 hard-expire、SWR、独立读取流、失败恢复与 LRU；它不能证明生产命中率、容量或重启频率。默认 cache debug 输出含 key/tag，不直接作为可公开生产遥测。缓存对象、序列化峰值和共享连接预算须在集成混合负载中量测后决定是否调整基础设施。
