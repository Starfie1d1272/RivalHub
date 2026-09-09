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

`draft-gate` 只汇总 Draft affected evidence，不能满足 ruleset 的 merge requirement。`ci-gate` 只由 Ready PR、Ready 后新 push、`main`、merge queue、release 和手动 FULL 运行产生；它是代码正确性 evidence 的 required check：planner 明确允许跳过的 job 可以 skipped；本应运行却 failure / cancelled / unexpected skipped 的 capability 会阻断合并。PR metadata policy 由独立的 `pr-title` check 负责；要使其阻断合并，Main ruleset 需与 `ci-gate` 一起要求该 check。

## Capabilities

### static

用于不依赖真实数据库服务的代码质量和构建证据，当前包括：

- app / tests / scripts TypeScript；
- ESLint；
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

Pull Request 使用 Draft → Ready 两阶段流程。新 PR 默认保持 Draft：

1. Draft 的 `opened` / `synchronize` 由 changed-surface planner 选择本次改动需要的 capability 和 evidence task，并以 `draft-gate` 汇总。static 可以只跑 affected Vitest project 与 changed-file lint，postgres/system 可以只跑明确的 integration spec 或 semantic E2E flow；只有真实 `*.test.*` / `*.spec.*` 文件可作为 direct selector，fixture、helper、snapshot 与 harness 改动会保留对应 lane 的 full suite。
2. 实现完成并标记 Ready for review 时，`ready_for_review` 以 `PR_DRAFT=false` 重新运行 planner，直接输出 FULL matrix。该事件必须产生完整 static、postgres、system evidence，不得被 affected heuristic 削减。
3. Ready PR 后续的每次 `synchronize` 仍然是 FULL；新 commit 产生后，旧 commit 的 FULL CI 不再是当前 merge evidence。

Draft planner 的 capability 规则为：

- docs-only 可以只保留 planner + gate；
- pure app/domain/presentation 通常需要 static；
- DB-backed code / schema / migration 需要 postgres；
- Auth、Supabase service 或 browser critical path 需要 system；
- rename/delete、workflow/toolchain、无法分类的变化 fail closed 到 full。

Draft PR 还会由同一个 planner 输出 static matrix、related source、explicit test、PG integration spec 和 semantic E2E flow；Vitest project 只把 source 交给 `vitest related`，而变更的 unit test 与 global contract 以 `vitest run <test path>` 直接执行。affected plan 只用于 Draft 快速反馈，不降低最终 merge evidence。只有最新 commit 的 FULL CI、required `ci-gate` / `pr-title` 和 ruleset 要求的其它 checks 全绿，才能 merge。

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
