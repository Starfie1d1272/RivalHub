> 历史性能记录：下文一次性基准脚本已清理，命令保留为当时的证据，不再作为运行入口。

# W10/W11 后台读取实验快照

基线是已包含 #1081 的 `4ebecf5d5e1b629371c7d0c8851b6bab9c31d7f8`。未部署；这些实验不证明生产 LCP、CLS、核心可操作时间或混合负载下的 pool wait 已达预算。

35 个真实后台 page 入口逐项记录于 [route-status.json](./route-status.json)。状态保留已实现局部、被源码否定的具体假设及待执行的具体实验和 owner；不能把“没有访问样本”当作完成。

## 配对读取实验

隔离 loopback PostgreSQL，保留 active migrations 和真实约束，附加 1000 名用户、1000 条邀请码；Major 摘要 fixture 没有 entrants，不代表真实冻结名单规模。每个 reader 先比较可观察 DTO，然后交错 A/B 10 轮，未注入 RTT。原始数值在 [read-cost.json](./read-cost.json)，只保存 fixture 规模和数值，不含用户、邀请码、SQL参数或原始生产证据。

| reader | SQL 次数 before → after | 返回行 before → after | 结果 JSON bytes before → after | 本地 p50 ms before → after | 本地 p95 ms before → after |
| --- | --- | --- | --- | --- | --- |
| operations | 13 → 11 | 1005 → 7 | 69053 → 161 | 7.727 → 6.308 | 9.931 → 11.716 |
| invites | 2 → 2 | 1001 → 26 | 148011 → 3818 | 6.181 → 2.089 | 14.552 → 5.824 |
| Major summary | 14 → 9 | 4 → 5 | 346 → 345 | 5.593 → 3.835 | 8.365 → 5.136 |

返回行/JSON bytes 是 PostgreSQL 驱动结果的计数/再序列化大小，不是压缩传输、RSC bytes 或数据库 wire bytes。N=10 的 nearest-rank p95 即最大值；operations 尾部没有证明改善。Major 空名单实验主要证实少 5 条查询，不能推断已减少多少真实名单 payload。邀请码越界页仍可能执行一次纠正页查询，正常页 count/page 并行。

历史配对实验的临时 benchmark 已移除；本页数值保留为当时的记录，不能直接复现。

真实 PostgreSQL 约束、生命周期、时区和权限的定向 correctness suite 不依赖这些临时文件。

## 验证与尚缺证据

冻结批次已 rebase 到包含 #1082/#1086 的 main `d58ab7c4fb97cef7795ee2de9d9b5d6a2e208eaf`。正式分支直接消费 BET snapshot；没有复制 BET 领域文件。`git range-diff` 确认此前17个提交与 rebase 后逐一等价，无业务修改。read-cost 数值测于此前 core `647db7db` 的对应 reader，不能声称是后续新增 tracing 的再次测量。

- 正式分支新 main：app/tests 类型检查；受影响文件 ESLint、architecture contract。
- React/领域：21 例通过（后台上下文10、persona故障隔离4、OCR激活2、audit单读1、telemetry4）；后台continuity单独2例。
- 新 main 真实 PostgreSQL：prestart资格合批7例，match/commentary 11例，operations/invites/users/Major/feedback/audit/Demo egress 8例，纪律67case fixture 1例。合入BET后的正式分支将上述用例与BET read-footprint4例一起重跑：9文件31例全部通过。
- Steam DB cache/upsert/provider抛错为注入用例，保留blocker/candidate/profile-null。额外在真实PG workbench fixture注入display failure，确认整页仍返回；该fixture的review result也是注入，**不能冒充实际PG故障或canonical validation并发测试**。
- Chromium：隔离fixture真实后台登录→启用按钮可用→确认→启用提交→暂停按钮可用，并核实program已创建，1例通过；按W07首场BO3条件/retry0/显式trace再次通过，新main正式分支再跑1例通过（15.1s），见 [hydration-fixture.json](./hydration-fixture.json)。应用同源script/pageerror为失败门槛；本机第三方Vercel debug script证书失败不代表应用未hydration。开发服务器同时产生 `instrumentation.ts→observability/server.ts→runtime-health.ts` Edge导入Node API警告，需观测owner审查。
- confirmed Demo：首屏无完整artifact读，展开只读指定current confirmed import；过期import/跨match拒绝。needs_attention详细核验仍在首读，尚未拆分。
- 100/500场execution fixture证明当前stage窗口、全局count及unconfigured诊断范围，**不是有界分页或RSC/浏览器规模验收**。materials仍需全局任务摘要/有界详情；schedule、三view RSC bytes/primary-ready/CLS仍待实验。
- audit同match/map/import共用request-local标签，真实PG证实match/entry各一次；30target混合规模与back/forward浏览器实验仍缺。
- 纪律页只缩小完整内部证据读取；metadata仍按全赛事canonical JS筛选/排序，未声称完整SQL分页。没有为猜测的query plan加索引。
- 历史5次telemetry客户端异常无stack；安全fingerprint与空数据防线不能作为根因关闭证据。上限fixture浏览器profile、single-flight并发与实际部署cohort比较仍待观测owner。

跨组接入按精确文件/API推进：`registrations/admin-review.ts` current revision-only投影、`admin/season-workspace/major-prestart.ts`同profile合批consumer已完成；accounts raw bundle也已在#1085核实，`education/admin-review.ts` queue/overview（accounts）；`season-public-info/read-model.ts` groupCount/contactCount summary与direct scoped detail，`announcements/read-model.ts` paged summary/id+role+scope detail（public）。收到契约后admin接consumer，不复制这些canonical领域规则。captains/draft/awards的共享reader改动也由public owner协调。

[route-status.json](./route-status.json) 区分全部35入口的已实施、被源码否定的假设和具体待实验。没有production负载/业务写入、没有部署或发布；最终required CI只认待合并精确head。
