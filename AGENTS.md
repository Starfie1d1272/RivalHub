# RivalHub Agent 入口

RivalHub 是基于 Next.js App Router、TypeScript、Drizzle/PostgreSQL、Supabase、Vitest 与 Playwright 的高校电竞赛事管理平台，包含 Rivals 与 Major 两套内置赛事体系。

## 先定位 authority

- 文档索引与冲突处理：[`docs/README.md`](docs/README.md)。赛事政策在 `docs/rules/`，当前实现以 code/schema/active migrations/tests 为准，已接受未实现设计在 `docs/decisions/`，历史材料在 `docs/archive/`。
- 架构、public/server boundary 与稳定代码域：[`docs/architecture.md`](docs/architecture.md)；领域实体和 owner：[`docs/domain-model.md`](docs/domain-model.md)。
- 测试分层与 CI 证据：[`docs/testing.md`](docs/testing.md)；环境、迁移和发布安全：[`docs/deployment.md`](docs/deployment.md)。分支、Issue、PR、Changeset 与 release 协作：[`CONTRIBUTING.md`](CONTRIBUTING.md)。
- 修改前先搜索现有 canonical owner。相同的 transition、derived fact、formatter 或验证规则只能有一个业务 owner；transport 或展示层复用它，不建立平行实现。

## 跨域 contract

- entrypoint 校验不可信输入并完成服务端鉴权；公开 RSC payload 和 Client props 使用明确 projection/DTO，不序列化内部查询对象或 secret。
- 数据库、secret、privileged SDK 与 persistence owner 保持 server-only；Client Component 按真实 browser/runtime 需求使用并尽量缩小 client graph。
- active Drizzle migration chain 是唯一 schema authority；local、staging、production 严格隔离，禁止用 `db:push` 绕过 active chain。
- 管理员或其它特权状态变更形成 audit fact，并尽可能与业务 mutation 处在同一一致性边界。
- 第三方或特殊运行时通过 canonical adapter/contract 接入；`brackets-manager` 只能经 `@/lib/bracket`，新增 Realtime 或 direct Supabase surface 必须同时定义权限、RLS/GRANT、一致性语义和正反例测试。

这些是跨域性质级约束，不是当前实现枚举：first-party UI mutation 通常使用 Server Action，但 HTTP/protocol integration 可以使用 Route Handler；Client Component、Realtime surface 和 transaction service 按实际 runtime 与 domain owner 判断。Draft locking/idempotency、capability 及具体 Realtime allowlist 由对应 domain docs/tests 维护。

## 验证入口

按变更风险选择最小证据；完整矩阵见 [`docs/testing.md`](docs/testing.md)。常用入口为 `pnpm type-check`、`pnpm lint`、`pnpm test`、`pnpm db:check`、`pnpm knip`、`pnpm knip --production` 与 `pnpm verify`。提交前检查完整 diff、未跟踪文件、敏感信息和临时产物。

协作流程、changeset 判断、PR closure 语义与 release 操作不在本文件重复维护；以 `CONTRIBUTING.md` 为准。`CLAUDE.md` 只引用本文件，不建立平行规则集。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
