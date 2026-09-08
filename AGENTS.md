# RivalHub Agent 入口

RivalHub 是基于 Next.js App Router、TypeScript、Drizzle/PostgreSQL、Supabase、Vitest 与 Playwright 的高校电竞赛事管理平台。

## 先定位 authority

- 文档入口与冲突处理：[`docs/README.md`](docs/README.md)。当前实现以 code/schema/active migrations/tests 为准；赛事政策在 `docs/rules/`，durable rationale 在 `docs/decisions/`，历史材料在 `docs/archive/`。
- 架构边界：[`docs/architecture.md`](docs/architecture.md)；领域事实 ownership：[`docs/domain-model.md`](docs/domain-model.md)；生命周期：[`docs/workflows.md`](docs/workflows.md)。
- 测试证据：[`docs/testing.md`](docs/testing.md)；环境/迁移/release：[`docs/deployment.md`](docs/deployment.md) 与 `docs/operations/`；协作规则：[`CONTRIBUTING.md`](CONTRIBUTING.md)。
- 修改前先搜索 canonical owner。相同 transition、derived fact、validation、formatter 或 query/domain rule 只能有一个业务 owner；transport/presentation 复用它。
- Release / tag / deploy / production mutation 有更严格入口：任何写操作或远端 mutation 前，必须完整读完 [`docs/operations/release.md`](docs/operations/release.md)；repository search / `rg` 只用于定位，不能替代全文读取。

## Cross-domain contract

- entrypoint 校验不可信输入并完成 server-side authorization；public RSC payload / Client props 使用明确 DTO/read model，不序列化 internal query object 或 secret。
- DB、secret、privileged SDK 与 persistence owner 保持 server-only。新增 direct Supabase Data API/Realtime surface 必须同时定义 consumer、GRANT/RLS、一致性语义和正反例测试。
- active Drizzle migration chain 是唯一 schema evolution path；local/staging/production 严格隔离，禁止 `db:push` 或手工 remote patch 建立第二条路径。
- privileged mutation 保留 audit fact；runtime logs/traces 由 `src/lib/observability/` 独立拥有，见 [`docs/operations/observability.md`](docs/operations/observability.md)。
- third-party runtime 通过 canonical adapter 接入；例如 `brackets-manager` 只能经 `@/lib/bracket`。
- frozen event/runtime facts 不从 mutable profile、catalog 或 presentation 重新解释。

## Documentation changes

`docs/rules/published/**` 是已发布的赛事治理事实。已有文件禁止修改、删除或重命名；后续规则变化新增 supplement 或独立版本，见 [`docs/rules/README.md`](docs/rules/README.md)。

变更稳定 boundary、workflow、policy 或 shared UI contract 时，同 PR 更新其 canonical doc。**重写被影响段落的终态，不在旧说明后继续追加实施过程或“后来又……”的补丁。** 能从 code/config/Issue 直接得到的高频变化事实不复制进 active docs。

## Validation

按风险选择 [`docs/testing.md`](docs/testing.md) 中的最小 evidence。常用入口：`pnpm type-check`、`pnpm lint`、`pnpm test`、`pnpm db:check`、`pnpm knip`、`pnpm knip --production`、`pnpm verify`。提交前检查完整 diff、未跟踪文件、敏感信息和临时产物。

PR title、Changeset 与 closure 语义由 [`CONTRIBUTING.md`](CONTRIBUTING.md) 维护；release procedure 只由 [`docs/operations/release.md`](docs/operations/release.md) 维护。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
