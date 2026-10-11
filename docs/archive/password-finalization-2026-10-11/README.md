# 密码最终事务与原密码验证证据

Refs #912；依赖 #921 固定 head `26f4db6efb605b30f4248d2f3804064180d3f838`。本变更抽取该 head 的既有 SDK 登录分型，让 account 原密码验证共用；没有写入 #921 分支。实现者证据供父会话独立审查，不自称独立验收。

新增测试的独立保护价值：登录测试不覆盖 account 的旧密码验证入口；密码 provider 未知结果测试不覆盖 provider 已返回后最终事务的失败；registry 的单独调用不证明真实 mutatePassword 中完成审计失败会回滚 fence 清除。最低充分层分别是 action SDK contract 矩阵、真实表单拼装与真实 PostgreSQL owner 故障注入。

- 固定依赖 head 临时替换六个受影响生产文件，保留新增测试，三文件 32 项中 16 失败、16 通过；finally 恢复所有修复文件。修后相同三文件 32/32。
- 定向 action 四文件 65/65，password owner 12/12，真实表单链 7/7，合计 84 项。app/tests 类型检查、变更文件 ESLint、architecture contract 与 diff whitespace 检查通过。
- 真实 PostgreSQL application-sessions 9/9：实际调用 mutatePassword；针对独立 fixture 的审计 INSERT trigger 在 finish 清除 fence 后抛 23514，最终事务回滚，成功/拒绝两种 provider 返回均只保留 started 审计与原 mutation ID，旧 session 无效，新 DB clock proof 仍不能登录/重复更新，provider 只调用一次，错误 ID 不能完成。实际 actionError/logger 的投影保留同编号、database/finalize/stage 与 SQLSTATE，不输出合成 provider body。
- 另一用例在真实 PG 最终事务提交后，于应用 DB 适配器边界抛合成 ECONNRESET：证明提示不能断言 fence 必然保留，provider 不重试，旧 proof 仍被拒绝。它是确认丢失的边界模型，不是 PG wire protocol 断流实验。
- 重载使用新请求的 DB clock proof；表单测试中新 reset 表单收到模拟持久 pending 指引，持续 alert 并禁用再次提交。真实浏览器/provider 故障与生产 sink 留存、跨服务检索、管理员恢复入口均未验收。

SDK fixtures 是合成 returned-error 合同矩阵，不创建真实 Auth 账号。官方 Auth error codes 与 Supabase changelog 已核对；相关近期变更没有改变本任务的 returned-error 合同。真实 PG 使用 canonical loopback wrapper、隔离 worker 数据库与 synthetic fixture；没有生产写入、真实凭据收集/修改、正式发布或危险管理入口。管理员 reconciliation UI/受保护 CLI 缺口仍保留，操作边界见 [核查手册](../../operations/auth-password-reconciliation.md)。
