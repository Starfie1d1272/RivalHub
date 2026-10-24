# OCR 提交回执与内容版本

本补充已 rebase/retarget main `49c6c7fd`，应用/测试类型与 2 项版本/摘要、12 项恢复组件通过。迁移 owner 的 `0f1cdaa3` 已让 0097/0098 snapshot 对齐五类 facts。正确依赖组合源码 `8b26c009` 上，本专项真实 PG receipt、canonical lock barrier、Major roster safety、旧新锁序对照及 DAK/OCR 兼容合计 7 项通过，详见 `account-lock-consumers.md`（集成分支）。该证据覆盖局部集成，不替代最终 required CI、完整 W15 浏览器/财务并发和发布验证。

- 保存/清除必须携带 UUID operationId 与安全快照返回的不透明内容版本。版本覆盖全部内部计分板字段及精确 PG 时间戳，浏览器只获得安全 editor DTO 与 SHA256。
- 原 match SHARE → map UPDATE → stats 锁序保留。锁后检查版本，事实、审计和 actor/operation 唯一回执同事务提交；同编号同上下文只返回原回执，不重复事实或审计；跨 map/kind/digest 复用拒绝。
- recovery 必须 fresh season-admin，只查询当前 actor/map 的原 operation。未找到回执保持 unconfirmed，不证明 rollback；有回执但当前 hash 不同为 superseded，不用原草稿覆盖后续事实。
- unknown 时当前编辑器保留草稿；仅将 actor/map/operationId、操作类型和基准版本 locator 放入 localStorage，按 map/actor/operation 独立键保存，不保存草稿、截图或凭据。重新挂载先 fresh 授权核对当前 actor，再按原编号查持久回执；locator 存储失败时不发送写入。确认后只删除当前操作 locator，不删除其他 actor/操作。未找到回执继续阻止写入，不能把缺失解释为回滚。重挂载、跨 actor 与存储失败组件测试已过，真实浏览器关闭重开仍由父统一验证；不宣称恢复丢失草稿。
- 回执只保存输入摘要、版本、数量和时间，不持久化原输入/图片/凭据。RLS/权限/迁移 replay 与 N+1 由迁移 owner 验证；业务 PG 文件覆盖同编号并发、双 command CAS、原子回滚、真实 COMMIT 后丢失响应、权限与 superseded。

最终迁移链与全域 consumer 集成后，须重新使用 canonical local runner 执行 `tests/integration/db/scoreboard-receipts.test.ts`。不绕过迁移链创建生产或测试业务表，不启用 provider，不做生产写入。
