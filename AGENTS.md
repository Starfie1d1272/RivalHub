# RivalHub Agent 入口

RivalHub 是基于 Next.js App Router、TypeScript、Drizzle/PostgreSQL、Supabase、Vitest 与 Playwright 的高校电竞赛事管理平台。

## 先定位 authority

- 文档入口与冲突处理：[`docs/README.md`](docs/README.md)。当前实现以 code/schema/active migrations/tests 为准；赛事政策在 `docs/rules/`，durable rationale 在 `docs/decisions/`，历史材料在 `docs/archive/`。
- 架构边界：[`docs/architecture.md`](docs/architecture.md)；领域事实 ownership：[`docs/domain-model.md`](docs/domain-model.md)；生命周期：[`docs/workflows.md`](docs/workflows.md)。
- 测试证据：[`docs/testing.md`](docs/testing.md)；环境/迁移/release：[`docs/deployment.md`](docs/deployment.md) 与 `docs/operations/`；协作规则：[`CONTRIBUTING.md`](CONTRIBUTING.md)。
- 修改前先搜索 canonical owner。相同 transition、derived fact、validation、formatter 或 query/domain rule 只能有一个业务 owner；transport/presentation 复用它。
- 可执行架构契约见 `pnpm architecture:check`；Client 只能经 `use server` action boundary 进入 server workflow，`src/lib/` 不反向依赖 entrypoint/presentation。
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

按风险选择 [`docs/testing.md`](docs/testing.md) 中的最小 evidence。日常优先使用与 changed surface 匹配的 `pnpm type-check:*`、定向 Vitest 和文件级 ESLint；`pnpm type-check`、`pnpm lint`、`pnpm test`、`pnpm db:check`、`pnpm knip`、`pnpm knip --production`、`pnpm verify` 是按风险选择的 broad host-only 或最终检查，不是每次迭代默认全跑。提交前检查完整 diff、未跟踪文件、敏感信息和临时产物。

默认开发与交付流程是 Draft → Ready：开发阶段使用 Draft PR，push 后由 Evidence Planner 只运行与 changed surface 匹配的 affected evidence；本地只执行匹配改动的 host-only 快速检查，不为每次迭代默认启动 PostgreSQL、Local Supabase 或 browser 重型环境。准备交付时将 PR 标记为 Ready for review；`ready_for_review` 及 Ready PR 后续每次 push 必须触发该 commit 的 FULL CI。只有最新 FULL CI 与 required checks 全绿后才能 merge；新 push 会使旧 commit 的最终 evidence 失效。

本地 `pnpm check` / `pnpm verify` 是可选 broad host-only gate，不是每次迭代或每次 push 的默认要求。需要真实数据库、Supabase 或 browser 复现时，按 [`docs/operations/local-development.md`](docs/operations/local-development.md) 只启动最小层级。

PR title、Changeset 与 closure 语义由 [`CONTRIBUTING.md`](CONTRIBUTING.md) 维护；release procedure 只由 [`docs/operations/release.md`](docs/operations/release.md) 维护。

## CI 等待

- 完成本地验证、push 并将 PR 标记为 Ready 后，不手写循环或每 10–15 秒调用 `gh pr checks`、`gh run view`、GitHub API/MCP workflow 查询等主动轮询。
- 优先使用 `gh pr checks <PR> --required --watch --interval 60 --fail-fast` 等单个阻塞 watch。若当前 runtime 无法阻塞，主动检查间隔至少约 60 秒；pending 状态不重复总结。
- 成功时只确认 required checks（尤其 `ci-gate`）成功，不读成功 job 的全量日志或逐步复述。
- 失败时先读取失败 check/job 摘要，只有摘要不足以定位才读取 `--log-failed` 等失败范围日志；本地修复和验证完成后再统一 push，避免边试边连续触发 CI。
- 不要用 `sleep 10 && query` 伪装等待，也不要为此增加 bot、server、daemon 或其他基础设施。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
