# Account/evidence canonical lock consumers

正确依赖组合的源码候选为 `1e8b54e431c670b8bda1843206ffd738762e4977`，branch `integration/w12-w13-ocr-locks`：main `49c6c7fd` + receipt 增量及 actor/OCR 竞态修复 + W03 locks `0e4b2ea9` + OCR migration `0f1cdaa3` + BP fixture `7e58a816`。0097/0098 snapshot 均保留五类 facts、上限 5，正式 revalidation 导出已存在。它是跨 owner 验证分支，不应整体合并到 main 或 feature；自有 consumer 独立提交为 `e8c4dfdf`。

Roster confirmation 无锁发现 parent，再 canonical season/match，然后 roster UPDATE 并复核 match/entry；Action 传入已授权的 expected match/season，锁后变化 fail closed。冻结来源、锁后完整资格断言和幂等 confirmed 分支保留。OCR save/clear 在 season UPDATE 后保留 match SHARE → map UPDATE → stats，重新校验授权赛事和 map 归属，facts/audit/receipt 原子性不变。

MVP 仅作为统一 evidence helper consumer 接入；原 vote-only 路径未被本专项证明存在 audit/season 反序死锁，不计为 P1 修复。Archived/结果后窗口准入、24h 截止、winner cutoff 与 SHARE 排他结算边界保留；没有弱化 season 锁，不宣称并发吞吐收益。

该源码候选的 app/tests types、architecture、Drizzle check 通过。`db:migration-risk` 报告无工作区变更，因此不把其空跑当作独立风险签署。Canonical runner 迁移重放 99 项、fixture 与 126 表 deny-by-default/RLS access matrix 通过。真实隔离 PG：

- `scoreboard-receipts.test.ts`：2 项，非空实际保存与跨 actor 拒绝、同 operation 并发仅一次 facts/audit/receipt、双 command CAS、复用冲突、真实 receipt INSERT 故障整体回滚、真实 COMMIT 后 adapter 模拟丢失响应（非真实 PG-wire 断连）、原 actor 恢复与 superseded，通过。
- `major-roster-safety.test.ts`：canonical/frozen/confirmed/idempotent，通过。
- `account-lock-consumers.test.ts`：独立连接持 season UPDATE，通过 pg_blocking_pids 观察 consumer 等待；持锁者仍可 NOWAIT 锁 match/roster/map，再放行，四入口通过。Archived OCR 与窗口内 MVP 正向、winner/25h 负向通过。首次 fixture 缺少 frozen event roster；修正 fixture 后通过，未放宽业务断言。
- `match-lock-order.test.ts`：3 项通过，包括旧 match-first / season-first 的实际 40P01 对照，不盲重放。
- 初次兼容检查 `demo-integration-submit.test.ts -t 'adopts a submitted 10-player roster despite OCR scoreboard drift and preserves OCR-owned stats'`：1 项通过，另一无关用例按 filter 跳过。保留 DAK/OCR 各自字段权威，不采用该测试中其它领域的性能输出作为本专项收益。

最终在该候选五文件完整重跑合计 9 项 PG 通过（receipt 非空链与 Demo 第二项亦包含）。main-base receipt 分支单元/组件为 16 项通过。原生 Chromium 持久磁盘 profile 的整个浏览器关闭重开四项通过，覆盖真实非空提交丢 HTTP 响应、missing、superseded、actor 与权限变化，详见 ocr-receipts.md / ocr-browser-proof.json。全域财务/身份并发、最终 main required CI 与发布验证仍由父统一安排；局部证据不冒充全域 W15 完成。未修改共享 migration/snapshot/revalidation/identity 源码，只组合 owner 提交。最终统一切换必须执行 W03 的旧 worker drain 协议，不能以盲重放兼容混合锁序。
