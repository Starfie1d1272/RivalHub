# 密码更新结果未知的核查

Supabase Auth 与应用 PostgreSQL 不能原子提交。`mutatePassword` 在调用 Auth 前提交登录阻断并撤销旧会话；传输异常、0、408、5xx 或未知结果保留阻断。错误编号不是密码更新成功或失败的证据。刷新、等待、重复提交、重新发找回邮件均不能解除这个阻断。

用户在 `/settings/password` 或 `/reset-password` 收到结果未知时，停止提交，通过既有的平台管理员联系渠道提供操作时间、页面与排查编号。不要发送新旧密码、找回链接、token、Cookie 或凭据截图。表单持续展示这份指引并禁用提交；没有恢复按钮。

## 管理员只读核查

1. 按部署与时间窗口在 Vercel Runtime Logs 或已配置的 Better Stack 中查询 `event=auth.password_update.failure`、页面给出的 `requestId`。检查 `outcome=unknown`、HTTP 状态及脱敏 cause code；无日志不能推断操作未执行，先核对部署、sink 与留存。
2. 由有权限的平台维护人员在应用审计记录中核对 `user.password_update_started` 与后续 `user.change_password`、`user.reset_password` 或 `user.password_update_failed`。这些记录不存密码；只有 started 不能确定 provider 结果。
3. 由拥有对应 Supabase 项目权限的维护人员在 Auth 的 Audit Logs 核对同一身份、时间窗口与密码更新事件。应用 requestId 不传播给 Supabase，必须结合时间与受控身份映射核查，不宣称跨 provider 编号可直接检索。不要通过索取用户密码、重复调用更新或尝试新旧密码来“验证”。provider 结果仍无法确认时继续保持阻断，升级给项目维护人员核查。

## 解除阻断的现有边界与缺口

`src/lib/auth/session-registry.ts` 的 `finishPasswordMutationInTx` 是唯一完成 owner：在事务内锁 active user，要求精确匹配当前 `passwordMutationId`，再次撤销会话与旧认证 proof，最后清除 pending。不能直接 UPDATE 控制表或以随机/过期 mutation ID 解除。真实 PostgreSQL 回归证明 owner 接受匹配 ID 后仅允许之后取得的认证 proof 登录；它不证明 provider 已更新密码。

当前产品没有管理员核查/解除阻断页面，也没有受保护的 reconciliation CLI；普通用户重置入口仍会被 pending fence 拒绝。本手册的只读核查可以执行，但不能据此承诺管理员已能从产品恢复登录。内部 owner 的直接测试调用不等于部署的运维入口。核查后仍需另行实现并独立审查带授权、精确 mutation ID、已确认 provider 结果与审计的恢复入口，再按生产操作授权执行；本变更不创建这个功能，也不执行生产写入。该端到端恢复缺口保持开放。

官方错误合同：[Auth error codes](https://supabase.com/docs/guides/auth/debugging/error-codes)。429 应等待几分钟重试；`invalid_credentials` 与 `email_not_confirmed` 有明确含义。已安装 auth-js 的 retryable fetch error 在网络失败时携带 status=0；该值不证明密码错误。
