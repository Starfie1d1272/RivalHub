# Account/evidence canonical lock consumers

临时集成 branch `integration/w12-w13-ocr-locks` 组合 receipt 增量、W03 `408b9a4f` 及 canonical helper `d224b88c`，并保留 account 冻结候选。它是依赖验证分支，不应整体合并到 main 或 feature 分支；业务 consumer 独立提交只修改自有文件。

Roster confirmation 先无锁发现 parent，再 canonical season/match，然后 roster UPDATE 并复核 match/entry；Action 传入已授权的 expected match/season，锁后变化 fail closed。冻结来源、锁后完整资格断言和幂等 confirmed 分支保留。OCR save/clear 在 season UPDATE 后保留 match SHARE → map UPDATE → stats，重新校验授权赛事和 map 归属，facts/audit/receipt 原子性不变。

MVP 仅作为统一 evidence helper consumer 接入；原 vote-only 路径未被本专项证明存在 audit/season 反序死锁，不计为 P1 修复。Archived/结果后窗口准入、24h 截止、winner cutoff 与 SHARE 排他结算边界保留；没有弱化 season 锁，也不宣称并发吞吐收益。

临时真实 PG 证据（待最终链修正后重跑，尚非最终候选验收）：

- `scoreboard-receipts.test.ts`：同 operation 并发仅一次 facts/audit/receipt、双 command CAS、复用冲突、真实 receipt INSERT 故障整体回滚、真实 COMMIT 后丢失响应、原 actor 恢复与 superseded，通过。
- `major-roster-safety.test.ts`：canonical/frozen/confirmed/idempotent 通过。
- `account-lock-consumers.test.ts`：独立连接持 season UPDATE，通过 pg_blocking_pids 观察 consumer 等待；持锁者仍可 NOWAIT 锁 match/roster/map，再放行，四入口通过。Archived OCR 与窗口内 MVP 正向、winner/25h 负向通过。首次 fixture 的 event roster 未 frozen 导致 canonical 准入拒绝；修为真实 frozen fixture 后通过，未放宽业务断言。

当前不能关闭最终验收：0097/0098 snapshot 尚待迁移 owner 对齐最终五类 facts；临时集成 app/tests types 因 W03 `veto-room/invalidation.ts` 引用不存在的 `revalidateVetoRoomPaths` 导出而失败，需共享 owner 的精确依赖。未直接修改共享 migration/snapshot/revalidation/identity 全域锁文件，未运行全仓 build 或生产写入。最终统一切换必须执行 W03 的旧 worker drain 协议，不以盲重放解决混合锁序。
