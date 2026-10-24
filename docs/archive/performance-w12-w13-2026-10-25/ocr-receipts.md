# OCR 提交回执与内容版本

本补充实现尚依赖 W03 的 `operator_scoreboard_receipts` active migration。应用/测试类型、changed ESLint、architecture、2 项内容版本/摘要与 7 项恢复组件通过；真实 PG 测试已编写，未执行，不能将组件模拟结果计作并发或原子性证据。

- 保存/清除必须携带 UUID operationId 与安全快照返回的不透明内容版本。版本覆盖全部内部计分板字段及精确 PG 时间戳，浏览器只获得安全 editor DTO 与 SHA256。
- 原 match SHARE → map UPDATE → stats 锁序保留。锁后检查版本，事实、审计和 actor/operation 唯一回执同事务提交；同编号同上下文只返回原回执，不重复事实或审计；跨 map/kind/digest 复用拒绝。
- recovery 必须 fresh season-admin，只查询当前 actor/map 的原 operation。未找到回执保持 unconfirmed，不证明 rollback；有回执但当前 hash 不同为 superseded，不用原草稿覆盖后续事实。
- unknown 时当前已挂载编辑器保留原 command 与草稿，查询原回执并单独重试失效。原 command 当前只保存在组件内存中；关闭页面会失去自动核对所需的客户端上下文，服务端回执保留。尚未宣称浏览器崩溃后的草稿恢复。
- 回执只保存输入摘要、版本、数量和时间，不持久化原输入/图片/凭据。RLS/权限/迁移 replay 与 N+1 由迁移 owner 验证；业务 PG 文件覆盖同编号并发、双 command CAS、原子回滚、真实 COMMIT 后丢失响应、权限与 superseded。

迁移集成后使用 canonical local runner 执行 `tests/integration/db/scoreboard-receipts.test.ts`。不绕过迁移链创建生产或测试业务表，不启用 provider，不做生产写入。
