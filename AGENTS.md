# RivalHub Agent 入口

RivalHub 是基于 Next.js App Router、TypeScript、Drizzle/PostgreSQL、Supabase、Vitest 与 Playwright 的高校电竞赛事管理平台。

## 执行、澄清与批准

- 在平台与工具权限边界内，以用户当前目标和本轮会话中仍有效的授权为准；后续补充默认调整当前任务，不丢弃未完成目标。仓库具体契约约束通用 Skill 示例，Skill 只补充当前任务所需的专业步骤，不另设重复确认或验收流程。
- 对“帮我修改/修复/优化”等行动请求，完成定位、最小必要修改和相称验证后交付。常规、可逆的实现选择自主决定；不把计划、首次失败或“可以继续”当作完成。
- 先查会话、代码与相关文档。只有缺失信息会实质改变目标、验收、外部目标或难以撤销的结果，且无法可靠推断时才澄清；合并相关问题，只暂停依赖答案的步骤。可选偏好使用已知约定或说明假设后推进；未答复不等于批准。
- 执行动作前检查已有授权及其对象、范围和环境。同一范围已获授权时不重复申请；缺少有效授权的外部副作用或破坏性操作，以及平台要求的审批，才需要批准。需要批准时，先完成已授权且不依赖批准的准备，给出具体差异、目标、影响及要求批准的规则来源；不要先执行受限动作。
- Skill 中的“先确认”默认指通过证据核实；只有明确需要用户决定或授权时才向用户提问。发现失败后，修复请求继续定位、修复并复验；纯审阅请求交付发现。环境或权限阻塞时尝试适用的受支持替代路径，不绕过门禁，完成其余独立工作并准确报告缺失证据。
- 不为可能的未来需求增加抽象、基础设施、依赖或无关清理。按下文 Validation 选择最低充分证据；通过后仅在修改、失败或新风险出现时扩大或重跑。任务完成边界与 PR 交付规则见 [`CONTRIBUTING.md`](CONTRIBUTING.md#交付范围与完成条件)。

## 先定位 authority

- 文档入口与冲突处理：[`docs/README.md`](docs/README.md)。当前实现以 code/schema/active migrations/tests 为准；赛事政策在 `docs/rules/`，durable rationale 在 `docs/decisions/`，历史材料在 `docs/archive/`。
- UI / presentation 与产品语言：[`docs/ui-system.md`](docs/ui-system.md)。
- 架构边界：[`docs/architecture.md`](docs/architecture.md)；领域事实 ownership：[`docs/domain-model.md`](docs/domain-model.md)；生命周期：[`docs/workflows.md`](docs/workflows.md)。
- 测试证据：[`docs/testing.md`](docs/testing.md)；环境/迁移/release：[`docs/deployment.md`](docs/deployment.md) 与 `docs/operations/`；协作规则：[`CONTRIBUTING.md`](CONTRIBUTING.md)。
- 修改前先搜索 canonical owner。相同 transition、derived fact、validation、formatter 或 query/domain rule 只能有一个业务 owner；transport/presentation 复用它。
- 可执行架构契约见 `pnpm architecture:check`；Client 只能经 `use server` action boundary 进入 server workflow，`src/lib/` 不反向依赖 entrypoint/presentation。
- 仅在执行 release / tag / deploy / production mutation，或修改这些流程时，必须先完整读完 [`docs/operations/release.md`](docs/operations/release.md)；此时 repository search / `rg` 只用于定位，不能替代全文读取。普通本地编辑、检查与 feature branch/PR 操作按各自文档执行。

## Cross-domain contract

- entrypoint 校验不可信输入并完成 server-side authorization；public RSC payload / Client props 使用明确 DTO/read model，不序列化 internal query object 或 secret。
- DB、secret、privileged SDK 与 persistence owner 保持 server-only。新增 direct Supabase Data API/Realtime surface 必须同时定义 consumer、GRANT/RLS、一致性语义和正反例测试。
- active Drizzle migration chain 是唯一 schema evolution path；local/staging/production 严格隔离，禁止 `db:push` 或手工 remote patch 建立第二条路径。
- privileged mutation 保留 audit fact；runtime logs/traces 由 `src/lib/observability/` 独立拥有，见 [`docs/operations/observability.md`](docs/operations/observability.md)。
- 新增或扩大长期/敏感持久化数据时，同变更定义 owner、目的、可见性、保留/删除与 backup/restore 语义；已有类别引用 [`docs/security/data-lifecycle.md`](docs/security/data-lifecycle.md) 与原领域 owner。
- third-party runtime 通过 canonical adapter 接入；例如 `brackets-manager` 只能经 `@/lib/bracket`。
- frozen event/runtime facts 不从 mutable profile、catalog 或 presentation 重新解释。

## Documentation changes

`docs/rules/published/**` 是已发布的赛事治理事实。已有文件禁止修改、删除或重命名；后续规则变化新增 supplement 或独立版本，见 [`docs/rules/README.md`](docs/rules/README.md)。

变更稳定 boundary、workflow、policy 或 shared UI contract 时，同 PR 更新其 canonical doc。**重写被影响段落的终态，不在旧说明后继续追加实施过程或“后来又……”的补丁。** 能从 code/config/Issue 直接得到的高频变化事实不复制进 active docs。

## Validation

新增测试应能说明独立保护价值、具体失败风险、现有证据缺口与最低足够层；在交付说明或 PR 中简述即可，无需先等待用户批准测试方案。不为每个函数、组件或实现细节机械添加测试。安全、权限、业务不变量、事务、并发与真实 DB/provider 契约必须保留。源码写法、CSS class、重复跨层规则和第三方库转发不作为默认测试目标。

按风险选择 [`docs/testing.md`](docs/testing.md) 中的最小 evidence。日常优先使用与 changed surface 匹配的 `pnpm type-check:*`、定向 Vitest 和文件级 ESLint；`pnpm type-check`、`pnpm lint`、`pnpm test`、`pnpm db:check`、`pnpm knip`、`pnpm knip --production`、`pnpm verify` 是按风险选择的 broad host-only 或最终检查，不是每次迭代默认全跑。提交前检查完整 diff、未跟踪文件、敏感信息和临时产物。

进入 PR 交付范围时，按 [`CONTRIBUTING.md`](CONTRIBUTING.md#draft--ready-开发与-ci) 执行 Draft → Ready 和最新 commit 的 required checks；状态转换不自动扩大测试范围。本地只执行匹配改动的 host-only 快速检查，不为每次迭代默认启动 PostgreSQL、Local Supabase 或 browser 重型环境。

本地 `pnpm check` / `pnpm verify` 是可选 broad host-only gate，不是每次迭代或每次 push 的默认要求。需要真实数据库、Supabase 或 browser 复现时，按 [`docs/operations/local-development.md`](docs/operations/local-development.md) 只启动最小层级。

PR title、Changeset 与 closure 语义由 [`CONTRIBUTING.md`](CONTRIBUTING.md) 维护；release procedure 只由 [`docs/operations/release.md`](docs/operations/release.md) 维护。

## CI 等待

- 完成本地验证、push 并将 PR 标记为 Ready 后，不手写循环或每 10–15 秒调用 `gh pr checks`、`gh run view`、GitHub API/MCP workflow 查询等主动轮询。
- 优先使用 `gh pr checks <PR> --required --watch --interval 60 --fail-fast` 等单个阻塞 watch。若当前 runtime 无法阻塞，主动检查间隔至少约 60 秒；pending 状态不重复总结。
- 成功时只确认 required checks（尤其 `ci-gate`）成功，不读成功 job 的全量日志或逐步复述。
- 失败时先读取失败 check/job 摘要，只有摘要不足以定位才读取 `--log-failed` 等失败范围日志；本地修复和验证完成后再统一 push，避免边试边连续触发 CI。
- 不要用 `sleep 10 && query` 伪装等待，也不要为此增加 bot、server、daemon 或其他基础设施。
- watch 在工具支持时作为可恢复的运行中会话等待，保留进度沟通能力。正常 pending 继续等待；认证、审批、配额、失联或平台执行时限阻塞时，保留 PR/head SHA、最后状态和恢复方式，报告未完成的检查，不把 pending 当作成功或扩大权限来完成。

## Next.js 文档适用范围

下面是工具维护的框架提示。涉及 Next.js API、路由、渲染或配置时，写代码前读取相关本地指南；纯文档或无关领域逻辑只读取其相关 owner，不要求通读框架文档。保留生成区块，项目适用范围在区块外维护。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 依赖安装与更新

依赖维护遵循 [`docs/dependency-maintenance.md`](docs/dependency-maintenance.md)。使用 manifest 指定的 pnpm，日常冻结安装，版本更新时自动生成锁文件；不要手改锁文件或恢复旧文件掩盖依赖变化。

云环境中如存在 `/workspace/.onboarding/activate.sh`，每个 shell 执行仓库命令前先 source 该文件，以选择可写缓存和 manifest 对应的包管理器。
