# CI operations

RivalHub 的 PR CI 按 changed surface 选择所需 evidence，而不是所有改动都启动完整数据库与浏览器环境。精确规则以 `.github/workflows/ci.yml` 和 `scripts/ci/plan.mjs` 为 authority。

## CI graph

```text
plan ─→ static ─────┐
   ├─→ postgres ────┤
   ├─→ system ──────┼→ draft-gate（Draft）
   │                └→ ci-gate（Ready / protected FULL）
   └─→ dependency-review（PR）
```

`draft-gate` 汇总 Draft PR 的 affected evidence，用于开发中快速反馈，不能满足 ruleset 的 merge requirement。`ci-gate` 由 Ready PR、`main` push、merge queue、release、nightly schedule 和手动运行产生；它是代码正确性 evidence 的 required check：planner 明确允许跳过的 job 可以 skipped；本应运行却 failure / cancelled / unexpected skipped 的 capability 会阻断合并。PR metadata policy 由独立的 `pr-title` check 负责；要使其阻断合并，Main ruleset 需与 `ci-gate` 一起要求该 check。

## Capabilities

### static

用于不依赖真实数据库服务的代码质量和构建证据，当前包括：

- app / tests / scripts TypeScript；
- ESLint；
- architecture dependency contract；
- Vitest unit suite；
- dead-code / dependency hygiene；
- production build。

### postgres

使用 PostgreSQL 17 service container，验证：

- active migration chain；
- migration risk；
- previous stable → candidate 的 release compatibility；
- seed / fixture / schema verification；
- real PostgreSQL integration tests。

CI 不使用 mock 来替代 constraint、transaction、locking 或并发证据。

### system

启动最小 Local Supabase services，并运行：

- Supabase service / access contract verification；
- browser E2E。

浏览器 lane 使用 runner 已有 Chrome，不需要在每个 run 重新安装 Playwright browser。
同一个 system job 只启动一次 Supabase：`start-services → bootstrap-services → verify-supabase → test:e2e`。E2E 每个 test attempt 创建独立的 DB/Auth scenario；除 `major-entry` 的 canonical UI 登录外，其它已登录流程通过受保护的 test-only route 调用同一个 `loginWithPassword`，不会伪造应用 cookie。

CI 会把 bootstrap、各 capability lane、Vitest project、真实 PG integration、E2E body 与 FULL wall time 写入 GitHub Step Summary。system 失败或 retry/flaky 时保留 trace、screenshot、HTML report、脱敏 Next 日志和 scenario/attempt manifest；成功 run 不上传这些大体积 artifact。Playwright 在 CI 使用一次 retry，并以 `failOnFlakyTests` 阻断“首次失败、重试成功”的假绿。

### dependency review

Pull Request 额外运行 dependency review；达到 workflow 设定的严重度阈值时阻断。

## Selective vs full

CI 遵循 L0–L4 风险分层与最低且足够可信证据原则：

- **L0 Metadata**：docs、Changeset、纯 release metadata，仅保留 planner + gate，不启动测试容器。
- **L1 Static**：pure rule、formatter、presenter、component、UI/layout 等不跨 persistence/provider 边界的变化，运行 affected type/lint/architecture/unit。
- **L2 PostgreSQL**：Server Action persistence、DB query、transaction、migration 等，运行 L1 + real PostgreSQL。
- **L3 System**：Auth、Session、Storage provider 或 browser/provider glue，运行 L1/L2 + Local Supabase + targeted E2E。
- **L4 Full convergence**：CI/toolchain/harness/unknown/destructive 改动、手动 FULL、release 发布或 nightly 定时收敛，运行完整 static + postgres + system。

Pull Request 的 Draft / Ready 仅代表协作与合并准入状态，不直接决定测试深度：

1. Draft PR 由 changed-surface planner 输出本次改动所需最低充分 evidence，以 `draft-gate` 汇总，供开发阶段快速迭代。
2. Ready PR 使用同一个 changed-surface planner 输出匹配风险的 evidence，并以 required `ci-gate` 汇总；不因 Ready 状态机械升级为 FULL。普通 UI / Server Action PR 仅支付对应静态或 PG 验证时间，不进入昂贵的 system 冷启动。
3. `push` 到 `main` 同样使用 changed-surface 规划 affected smoke，不默认重复跑 FULL。
4. 无法分类的变化、rename/delete、CI/toolchain/harness 改动 fail closed 到 FULL。

`scripts/ci/timing.mjs` 的 command wrapper 是 project wall-time owner。`vitest-timing-reporter.ts` 只输出 per-project facts 与 top 15 per-file diagnostic duration，Step Summary 会明确区分两者。

`push` 到 `main`、merge queue、release 和手动 workflow 运行完整 convergence gate。

`ci.yml` 只响应会改变代码 evidence 的 PR event（opened、synchronize、reopened、ready_for_review）。`.github/workflows/pr-metadata.yml` 在上述事件和 `edited` 上独立运行 `pr-title`；因此 title/body 编辑不会取消、覆盖或重跑当前 head 的 `ci-gate`，而新 commit 的 `synchronize` 仍会为其 SHA 重新产生 title check。Ready PR 的新 push 必须等待该 SHA 的 FULL CI 完成，不能沿用旧 SHA 的成功结果。

不要在本文复制每个路径匹配规则；需要修改 planner 时同时更新 `scripts/ci/plan.mjs` 和对应 regression tests。

## 本地复现

本地开发阶段默认只做 host-only 的 changed-surface 检查；不要为了每次迭代启动重型环境。以下命令只在需要复现对应失败或改动确实涉及该层时使用。

### Static

```bash
pnpm type-check
pnpm lint
pnpm architecture:check
pnpm test
pnpm build
```

### PostgreSQL

```bash
pnpm db:check
pnpm db:release-compat
pnpm test:integration
```

### System

```bash
pnpm db:local:start-services
pnpm db:local:bootstrap-services
pnpm db:local:verify-supabase
pnpm test:e2e
```

或者运行：

```bash
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm verify:services
```

普通 `pnpm check` / `pnpm verify` 不会启动容器，但它们是 broad host-only gate，不是每次迭代的默认要求。所有会启动或使用本地重型 service evidence 的 canonical wrapper 都要求 `CI=true` 或显式 `RIVALHUB_ALLOW_LOCAL_CONTAINERS=1`，不会静默 fallback 到远程目标。

## 排查顺序

1. 先看 `plan` 输出，确认 planner 为什么要求当前 capability；
2. 找到第一个真实失败 job，不从 `ci-gate` 的汇总错误倒推业务原因；
3. 在本地用同一 canonical pnpm command 复现；
4. PostgreSQL / system 失败时确认是测试本身、环境启动还是 cleanup；
5. 只有 planner 分类错误时才修改 planner，不要为了缩短 CI 把必要证据降级成 skipped。
