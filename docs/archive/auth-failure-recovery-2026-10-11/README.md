# #912 认证失败分型与核查指引证据

范围：[原问题评论](https://github.com/Starfie1d1272/RivalHub/issues/912#issuecomment-6112761515) 的第 1、2 项。原版固定为 `e9f3e11297aa755a9cf2b91f6044eefc6b4c1e95`；分支基于更新后的 main。没有修改 #911 预测/低保/UI 文件，没有真实账号密码变更、生产写入、发布或 Windows 操作。这是实现者的回归证据，待父会话独立审核。

## 原版反证与修后 owner 链

将五个受影响生产文件临时替换为固定原版，保留新增回归，执行 auth、password mutation 与表单链三文件：50 项中 14 失败、36 通过；执行后恢复分支文件。原版反例包括 429/0/undefined/401/600/字符串状态被误报凭据、unknown/transport cause 丢失、两个表单收不到暂停登录的持续提示。反证不是源码字符串检查。

| 失败风险 | 受测真实 owner / 证据层 | 修后行为 |
| --- | --- | --- |
| 429、0/未知状态误报密码错误 | `loginWithPassword` + runtime logger；SDK 边界桩 | 429 提示等待几分钟；其他未知失败提示验证暂不可用；同编号日志不包含 provider body/输入 |
| 真无效凭据、未验证邮箱与 5xx 被混淆 | 既有 auth action 回归 | `invalid_credentials` 仍为预期拒绝；邮箱验证路径与原 5xx 指引保留；不创建 canonical identity/session |
| unknown cause 丢失 / generic INTERNAL 覆盖核查消息 | 真实 Reset/Change 表单 → `resetUserPassword` / `changeUserPassword` → `mutatePassword` → `actionError` → UI；外部 SDK、cookie 与 DB 边界桩 | 持续 alert 包含登录暂停、停止提交、平台管理员、时间与编号；禁用提交；不销毁/创建 cookie、不跳转成功页；日志同编号与 ETIMEDOUT，无密码/token/body |
| definite 422 误称成功或无法恢复 | 真实 reset action/表单链 | fence 完成并记录 failed，提示重新登录后重试，日志 expected，未显示成功 |
| unknown 更新后 fence 被解除 / old proof 复活 | 真实 PostgreSQL，实际 `mutatePassword`、audit、registry owner | pending 保留，旧 session 失效，错误 mutation ID 拒绝；精确完成 owner 后旧 proof 仍拒绝，仅新 proof 可建立 session |

本地定向证据：7 文件 69/69（增加 definite-rejection 用例之前）；最终 auth/password/UI 三文件 52/52。真实 PostgreSQL `application-sessions.test.ts` 6/6，包括实际 password owner 新回归。`type-check:app`、`type-check:tests`、变更文件 ESLint、architecture contract、diff whitespace 检查通过。

新增跨层测试保护拼装消息不被覆盖，而不重复密码/权限规则矩阵；新增 PG 测试保护实际 mutation owner 提交的 fence、审计与精确 ID 完成边界，而不把 registry 单独调用当成完整链。

## 恢复与证明限制

[核查手册](../../operations/auth-password-reconciliation.md) 给出实际可执行的只读核查：应用 requestId → runtime event → 对应业务审计 → Supabase Auth Audit Logs 的身份/时间窗口核对。Auth provider 不接收应用 requestId，不能声称可直接跨 provider 检索。

仓库搜索仅发现 `finishPasswordMutationInTx` 被 password owner 与 PG 测试调用；没有管理员 reconciliation UI 或受保护 CLI。PG 的匹配 ID 完成调用证明内部 owner 可达，不证明管理员产品入口、真实 provider 结果或生产恢复。这个端到端恢复缺口保留开放，未伪造按钮，未手工改控制表，未降低 fence。本 PR 不应关闭 #912。

官方合同已核对 [Supabase Auth error codes](https://supabase.com/docs/guides/auth/debugging/error-codes) 与 changelog；已安装 auth-js `2.117.2` 的 `src/lib/fetch.ts` 在网络失败时产生 `AuthRetryableFetchError(..., 0)`。测试的 SDK 返回是合成 contract fixture，不是线上 provider outage 或 sink 留存/告警证据。表单证据是 jsdom 的真实 owner 拼装，真实浏览器/provider 的 CI evidence 应单独读取，不能替代为本地浏览器验收。
