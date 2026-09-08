# CI operations

RivalHub 的 PR CI 按 changed surface 选择所需 evidence，而不是所有改动都启动完整数据库与浏览器环境。精确规则以 `.github/workflows/ci.yml` 和 `scripts/ci/plan.mjs` 为 authority。

## CI graph

```text
plan ─→ static ─────┐
   ├─→ postgres ────┤
   ├─→ system ──────┼→ ci-gate
   └─→ dependency-review（PR）
```

`ci-gate` 是最终 required check：planner 明确允许跳过的 job 可以 skipped；本应运行却 failure / cancelled / unexpected skipped 的 capability 会阻断合并。

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

### dependency review

Pull Request 额外运行 dependency review；达到 workflow 设定的严重度阈值时阻断。

## Selective vs full

Pull Request 使用 changed-surface planner：

- docs-only 可以只保留 planner + gate；
- pure app/domain/presentation 通常需要 static；
- DB-backed code / schema / migration 需要 postgres；
- Auth、Supabase service 或 browser critical path 需要 system；
- rename/delete、workflow/toolchain、无法分类的变化 fail closed 到 full。

`push` 到 `main`、merge queue、release 和手动 workflow 运行完整 convergence gate。

不要在本文复制每个路径匹配规则；需要修改 planner 时同时更新 `scripts/ci/plan.mjs` 和对应 regression tests。

## 本地复现

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
pnpm verify:local
```

## 排查顺序

1. 先看 `plan` 输出，确认 planner 为什么要求当前 capability；
2. 找到第一个真实失败 job，不从 `ci-gate` 的汇总错误倒推业务原因；
3. 在本地用同一 canonical pnpm command 复现；
4. PostgreSQL / system 失败时确认是测试本身、环境启动还是 cleanup；
5. 只有 planner 分类错误时才修改 planner，不要为了缩短 CI 把必要证据降级成 skipped。
