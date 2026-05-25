# RivalHub 错误处理约定

## 统一返回格式

所有 Server Action 返回 `ActionResult<T>`（定义在 `src/types/action.ts`）：
- 成功：`ok(data)` → `{ success: true, data }`
- 失败：`fail({ code, message })` → `{ success: false, error: { code, message } }`
- 异常：`actionError()` 自动捕获 `AppError` 并转为 `fail`

## 错误码命名规范

错误码定义在 `src/lib/errors.ts` 的 `ErrorCode` 枚举中，按模块分组：
- `VALIDATION_FAILED` — 输入校验失败（Zod 或手动）
- `UNAUTHORIZED` / `FORBIDDEN` — 鉴权/权限不足
- `SEASON_*` / `REGISTRATION_*` / `DRAFT_*` / `MATCH_*` — 业务领域错误
- `NOT_FOUND` — 实体不存在
- `INTERNAL_ERROR` — 服务端异常

## 通用排查

- 页面级鉴权失败 → 重定向到登录页
- Zod 表单校验错误 → 客户端即时反馈，对应字段 `fieldErrors`
- 业务规则冲突 → 查看对应状态机文档（`docs/state-machines.md`）
- 数据库约束冲突 → 查看 `docs/data-integrity.md`

## 查找具体错误

具体错误码和触发条件请直接查看源代码：
- `src/lib/errors.ts` — 所有错误码定义
- `src/lib/validators/` — 表单校验消息
- 各 `src/actions/*.ts` — 业务错误触发位置
