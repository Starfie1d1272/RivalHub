# 登录/注册上游 5xx 归因

Refs #912/#571。baseline main `296e35db` 的Supabase SDK-returned登录error只有email_not_confirmed单独分支，其它error一律UNAUTHORIZED与“邮箱或密码错误”；注册只有email rate limit分支，其余一律VALIDATION_FAILED。5xx既被归咎用户输入，也未产生dependency事件。throw路径另由actionError处理，不由本批改动。

本批仅分离number/integer/500–599的权威HTTP状态。登录提示账号服务暂不可用；注册提示结果无法确认，先检查验证邮件再重试或联系管理员。canonical日志只投影安全status、固定operation/provider/errorCode与同一requestId，SDK raw body/message、邮箱、密码与token不被序列化。预期invalid_credentials、email_not_confirmed、防枚举注册结果与rate limit保持原分支；仅覆盖权威HTTP 5xx；网络/未知status与登录限流的原映射仍需下一轮证据，不宣称已修复全部Auth错误。

测试保护价值：既有auth tests没有SDK返回5xx反例。新增500/503登录及503注册证据要求正确归因、UI编号=log编号、安全投影且未建立canonical identity/session；增强invalid_credentials反例明确其status400与不新增outage日志。旧owner三个故障反例失败；修复后auth/reverification定向33 passed。仅mock provider returned-error，实际canonical Action/logger/redactor执行；真实provider自然故障与当前sink接收没有验收。

本批不修改会话/fence/密码、权限或DB事实，不修宽catch/未知password结果等其它队列；没有provider配置/生产账号创建、发布、凭据扩权或Windows操作。未编辑src live读链。中文patch changeset和canonical auth文档同步。

复现：

```bash
pnpm exec vitest run tests/unit/actions/auth.test.ts tests/unit/actions/auth-reverification.test.ts
pnpm type-check:app
pnpm type-check:tests
pnpm exec eslint src/actions/auth.ts tests/unit/actions/auth.test.ts
pnpm architecture:check
```
