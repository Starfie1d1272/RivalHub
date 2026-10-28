# 密码更新结果未知的核查

Supabase Auth 与应用 PostgreSQL 不能原子提交。`mutatePassword` 在调用 Auth 前提交登录阻断并撤销旧会话；传输异常、0、408、5xx 或未知结果保留阻断。provider 已返回成功或明确拒绝后，完成 owner 必须在同一 PostgreSQL 事务内清除 fence 并写入完成审计。最终写入失败会回滚清除；连接中断或 COMMIT 确认丢失则不能直接证明事务未提交。`finalization_unknown` 保留已知 provider 结果与安全 DB cause，要求核查应用安全状态，不重试 provider、不自动解锁，也不把已知 provider 成功改称未知。错误编号不是密码更新成功或失败的证据。刷新、等待、重复提交、重新发找回邮件均不能解除这个阻断。

用户在 `/settings/password` 或 `/reset-password` 收到结果未知、应用安全状态未确认完成或已有 pending 提示时，停止提交，通过既有的平台管理员联系渠道提供操作时间、页面与排查编号。不要发送新旧密码、找回链接、token、Cookie 或凭据截图。表单持续展示这份指引并禁用提交；没有恢复按钮。

## 管理员只读核查

1. 按部署与时间窗口在 服务 journal 的结构化日志 中查询 `event=auth.password_update.failure`、页面给出的 `requestId`。区分 `outcome=unknown`（provider 结果不明）、`finalization_unknown`（应用最终事务不明，`phase=finalize`，`stage=succeeded/rejected` 为 provider 已知结果）与 `pending`（持久阻断拒绝新请求）。检查 HTTP 状态及有界 allowlist cause/SQLSTATE code；无日志不能推断操作未执行，先核对部署与 journal 留存。
2. 由有权限的平台维护人员在应用审计记录中核对 `user.password_update_started` 与后续 `user.change_password`、`user.reset_password` 或 `user.password_update_failed`。这些记录不存密码；只有 started 不能确定 provider 结果。核对当前 `passwordMutationId` 与完成审计是否在同一事务提交；不得只因 provider 成功、旧会话失效或一次 DB 错误就断言 fence 已清除或必须清除。
3. 由拥有对应 Supabase 项目权限的维护人员在 Auth 的 Audit Logs 核对同一身份、时间窗口与密码更新事件。应用 requestId 不传播给 Supabase，必须结合时间与受控身份映射核查，不宣称跨 provider 编号可直接检索。不要通过索取用户密码、重复调用更新或尝试新旧密码来“验证”。provider 结果仍无法确认时继续保持阻断，升级给项目维护人员核查。

## 管理员恢复入口

平台超级管理员在 `/admin/users?tab=users` 的「退出旧登录」中读取当前待核查 mutation ID。普通退出登录仅撤销会话，保留密码更新阻断。恢复登录需要明确核实本次 provider 请求已经结束，并选择成功或明确拒绝、核查来源及原系统的事件/排查编号。未知结果继续核查，不能选择推测结果。编号本身不是成功证据；管理员必须核对对应身份、时间和结果，系统记录的是管理员核查结论，不宣称自动验证了 provider 日志。不要粘贴密码、链接、token 或日志正文。

服务端独立校验超级管理员权限、精确 mutation ID 和结构化核查依据；历史版本仅传 `providerMutationSettled: true` 的解除请求被拒绝，需刷新页面后重新核查。`finishPasswordMutationInTx` 是唯一解除 owner：锁 active user、匹配当前 mutation ID、再次撤销会话和旧认证 proof、清除 pending。解除与包含核查来源、编号、结果及 mutation ID 的 `user.sessions_revoke` 审计在同一事务提交，审计失败整笔回滚。重复提交或过期页面不能解除另一轮更新的阻断。页面关闭或重新打开后的旧响应不会覆盖当前状态。

恢复后用户重新登录。该操作不调用 Auth 修改密码，不复用旧登录 proof。新密码更新的 started/完成审计均记录 mutation ID，便于将应用事实关联到当前阻断；旧记录按身份和时间核查，不能伪造缺失的关联字段。核查元数据沿用安全审计的可见性、保留和备份规则，见 `docs/security/data-lifecycle.md`；只存记录编号，不复制 provider 日志内容。生产恢复须由获授权管理员执行并验证用户重新登录，测试环境通过不代替生产操作证据。

官方错误合同：[Auth error codes](https://supabase.com/docs/guides/auth/debugging/error-codes)。429 应等待几分钟重试；`invalid_credentials` 与 `email_not_confirmed` 有明确含义。已安装 auth-js 的 retryable fetch error 在网络失败时携带 status=0；该值不证明密码错误。
