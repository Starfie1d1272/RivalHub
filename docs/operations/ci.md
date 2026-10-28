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

`draft-gate` 汇总 Draft PR 的 affected evidence，用于开发中快速反馈，不能满足 ruleset 的 merge requirement。`ci-gate` 由 Ready PR、`main` push、merge queue、nightly schedule 和手动运行产生；它是代码正确性 evidence 的 required check：planner 明确允许跳过的 job 可以 skipped；本应运行却 failure / cancelled / unexpected skipped 的 capability 会阻断合并。PR metadata policy 由独立的 `pr-title` check 负责；要使其阻断合并，Main ruleset 需与 `ci-gate` 一起要求该 check。

## Capabilities

### static

用于不依赖真实数据库服务的代码质量和构建证据，当前包括：

- app / tests / scripts TypeScript；
- ESLint；
- architecture dependency contract；
- Vitest unit suite；
- dead-code / dependency hygiene；
- production build。

FULL 将 app/tests/scripts 类型、ESLint、architecture 与两种 knip 检查交给一个 `checks` runner 依次执行，逐项记录原命令的 wall time，任何失败、信号或启动错误都使该 runner 失败；早期失败后仍收集其它独立检查。三个 Vitest project 和 production build 保持独立并行 runner。此分组减少 FULL 的短任务 runner 分配与重复依赖安装；普通 affected static 的选择和并行方式不变。

Vitest 的 React/jsdom project 只在 GitHub Actions 使用一次 diagnostic retry，本地默认不 retry。每个 static matrix task 完成后，React project 由 `scripts/ci/assert-no-flaky.mjs` 读取 `vitest-timing-reporter.ts` 产出的 machine-readable evidence；首次失败、retry 通过会被标记为 flaky 并让 static job 非零退出。其它 Vitest project 不继承该 retry，普通 PR 也不传入 `repeats`。

### postgres

使用 PostgreSQL 17 service container，验证：

- active migration chain；
- migration risk；
- previous stable → candidate 的 release compatibility；
- seed / fixture / schema verification；
- real PostgreSQL integration tests。

CI 不使用 mock 来替代 constraint、transaction、locking 或并发证据。affected PG 从真实测试的传递依赖计算消费者（含动态 import 与 vi.mock 引用），混合修改取并集；schema、migration、harness 或未知消费者回退 FULL。容量测量由独立 experiments config 运行，不进入 required PG suite。

FULL PostgreSQL 固定使用两个 runner，以 Vitest 原生 `1/2`、`2/2` 按文件分片完整 integration 集合；affected PG 仍使用一个 `1/1` runner 与原选择集合。两个 FULL runner 各自启动真实 `postgres:17`，执行 migration risk/release compatibility、active-chain replay、seed/fixture/schema verification，并为原有三个并发 worker 克隆独立数据库；不共享数据库或事务。matrix 禁用 fail-fast、最多并发两个 runner，保留每片 timing/test-count evidence；任一片失败或取消使 `postgres` 聚合失败，gate 等待全部分片，180 秒预算按实际执行关键路径计算，排队不计入。

Release 的 migration rehearsal 使用同一套 plain `postgres:17` service、`preparePg17Database()` 和 active migration replay owner；它不启动 Local Supabase。CI PostgreSQL lane、Release workflow 与本地 `db:local:migrate` 共享 `scripts/db/migration-replay.ts`，避免出现第二套只在发布时运行的 migration runner。

### system

启动最小 Local Supabase services，并运行：

- Supabase service / access contract verification；
- affected 关键 browser E2E 与 production build/start App Shell smoke。

浏览器 lane 使用 runner 已有 Chrome，不需要在每个 run 重新安装 Playwright browser。
system matrix 将 provider contract、production smoke 和独立的 LIVE、系列比分更正、会话撤销 browser 分片与最多七个其它 browser 分片并行执行；每个 runner 只启动自己的最小 Supabase，只有 provider 的 LIVE evidence 与含 LIVE spec 的分片启动 Realtime。受影响 spec 集合按文件精确分割，空集合不创建 browser job；provider 与 production 各执行一次，统一 gate 等待整个 matrix 成功。系列比分更正分片独占 runner，避免其它公开路由冷编译挤占其 30 秒测试预算；测试断言、超时和 flaky gate 保持原值。会话撤销分片与其 spec 的 auth scenario 使用相同的最小服务层，不与免费预测等其它冷路由共用 runner。每个 browser runner 使用两个 worker；E2E 每个 test attempt 创建独立的 DB/Auth scenario，清理仅限该场景。`major-entry` 与 production smoke 使用真实 UI 登录；其它 dev 已登录流程通过受保护的 test-only route 调用同一个 `loginWithPassword`，不会伪造应用 cookie。

CI 会把 bootstrap、各 capability lane、Vitest project、真实 PG integration、E2E body 与 FULL wall time 写入 GitHub Step Summary；其中 Vitest flaky evidence 会列出 project、file、full test name、首次失败、retry 通过和 retry count。system 失败或 retry/flaky 时保留 trace、screenshot、HTML report、脱敏 Next 日志和 scenario/attempt manifest；成功 run 不上传这些大体积 artifact。Playwright 在 CI 使用一次 retry，并以 `failOnFlakyTests` 阻断“首次失败、重试成功”的假绿；Vitest 使用同一原则，但由显式 flaky guard 保留 static job 的失败语义。

### dependency review

Pull Request 额外运行 dependency review；达到 workflow 设定的严重度阈值时阻断。

PR 的 `dependency-graph-build` 只生成来源绑定 artifact；远端 main 图由独立 `Dependency graph` workflow 提交并逐项回读。后者的写权限、触发范围、stale-source 拒绝与恢复步骤见 [依赖维护](../dependency-maintenance.md#github-graph-与-updater)。该 lane 不取代 required PR dependency-review，也不以 main 图成功宣称 PR/fork/Dependabot coverage 已恢复。

## Selective vs full

CI 遵循 L0–L4 风险分层与最低且足够可信证据原则：

- **L0 Metadata**：docs、Changeset，以及只改变 `package.json` 顶层 `version` 的 release metadata（可伴随 `CHANGELOG.md` 与 Changeset），仅保留 planner + gate，不启动测试容器。消费 Changeset 时删除对应 Markdown 记录按 metadata 处理；与源码混合时仍按源码选择验证，其他删除保持 FULL。package dependency、script、packageManager、lockfile 或任意 source 变化都不能走该 bypass。
- **L1 Static**：pure rule、formatter、presenter、component、UI/layout 等不跨 persistence/provider 边界的变化，运行 affected type/lint/architecture/unit。
- **L2 PostgreSQL**：Server Action persistence、DB query、transaction、migration 等，运行 L1 + real PostgreSQL。
- **L3 System**：Auth、Session、Storage provider 或 browser/provider glue，运行 L1/L2 + Local Supabase + targeted E2E。
- **L4 Full convergence**：CI/toolchain/harness/unknown/destructive 改动、手动 FULL 或 nightly 定时收敛，运行完整 static + postgres + system。Release 直接消费 exact release SHA 在 `main` 上的 canonical CI evidence，不重复触发或等待第二套 FULL CI。

Pull Request 的 Draft / Ready 仅代表协作与合并准入状态，不直接决定测试深度：

1. Draft PR 由 changed-surface planner 输出本次改动所需最低充分 evidence，以 `draft-gate` 汇总，供开发阶段快速迭代。
2. Ready PR 使用同一个 changed-surface planner 输出匹配风险的 evidence，并以 required `ci-gate` 汇总；不因 Ready 状态机械升级为 FULL。普通 UI / Server Action PR 仅支付对应静态或 PG 验证时间，不进入昂贵的 system 冷启动。
3. `push` 到 `main` 同样使用 changed-surface 规划 affected smoke，不默认重复跑 FULL。
4. 无法分类的变化、rename/delete、CI/toolchain/harness 改动 fail closed 到 FULL。

`scripts/ci/timing.mjs` 的 command wrapper 是 project wall-time owner。`vitest-timing-reporter.ts` 只输出 per-project facts 与 top 15 per-file diagnostic duration，Step Summary 会明确区分两者。

`push` 到 `main` 同样采用 changed-surface 规划 affected evidence 并产生 exact-SHA CI evidence，遇到未知/破坏性/工具链变更时 fail closed 到 FULL；merge queue、nightly 与手动 workflow 运行完整 convergence gate。Release 消费 exact tag commit SHA 的 push CI 成功证据，不重复执行代码正确性 CI。

## Concurrency 与 exact-SHA 证据隔离

CI 的 concurrency 分组策略兼顾 PR 快速取消与 release exact-SHA 证据保护：

- **Pull Request**：按 PR 编号独立分组（`ci-CI-pull_request-<number>`），启用 `cancel-in-progress: true`；同 PR 的新 push 立即取消旧 SHA 的在途 run，避免积压 CI 资源。
- **main push**：按 exact commit SHA 独立分组（`ci-CI-push-<sha>`），配置 `cancel-in-progress: false`；每个进入 main 的 commit run 独立执行，不被后续 main push 误取消，确保 release 所需的 exact-SHA CI 证据永久可靠。
- **schedule / merge queue / workflow_dispatch**：按各自 event 语义稳定分组。

`ci.yml` 只响应会改变代码 evidence 的 PR event（opened、synchronize、reopened、ready_for_review）。`.github/workflows/pr-metadata.yml` 在上述事件和 `edited` 上独立运行 `pr-title`；因此 title/body 编辑不会取消、覆盖或重跑当前 head 的 `ci-gate`，而新 commit 的 `synchronize` 仍会为其 SHA 重新产生 title check。Ready PR 的新 push 必须等待该 SHA 所需的 CI 完成，不能沿用旧 SHA 的成功结果。

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

## 执行耗时门禁

`execution-budget.mjs` 只读取当前 `run_id` / `run_attempt` 的分页 job/step 计时。每个 job 累计真实执行的 step 区间（重叠部分仅算一次），不把 job `started_at` 到第一条 step 之间的 runner 排队或 step 间调度空档当作执行。CI 图按 `max(plan + max(static, postgres, system), dependency-graph-build, dependency-review) + gate` 计算实际关键路径；matrix 各片取最长执行耗时，保留并行语义。gate 的本地计时在计时 API 请求前冻结，截止到核验步骤开始，不包含该次 GitHub API 等待及核验后的报告/runner post-cleanup。

`timing.mjs` 直接执行验证命令并记录本地耗时，不依赖 GitHub job/step 元数据才能启动。CI 命令未指定超时时使用本地 180 秒上限，显式超时和 job 平台超时仍生效；最终 gate 另行核验执行预算，远端计时不可用时不得声称速度达标。

wrapper 同时等待 leader 和 stdio 关闭，因此 leader 退出 0、测试打印通过但 detached 后代持有 stdout 时仍受截止约束。每次顶层命令生成独立环境 token，嵌套 timing 命令继承同一 owner；只扫描并终止该 token 的进程与原进程组，不按进程名或端口清理。截止或取消先写失败证据，再 TERM，最多 2 秒后 KILL 并关闭残留管道；超时返回 124，取消与清理错误也保留非零结果。Linux runner 通过 `/proc` 查归属，macOS 本地通过 `ps`；进程环境只在内存中匹配，不写入日志。

system browser 结束后独立执行有界 `cleanup-e2e`，复用本 workspace 既有 fixture manifest 与 cleanup owner；每项成功清理后才移除 manifest，失败保留以供诊断。该清理最多 15 秒加 2 秒进程回收，不覆盖测试原失败，也不延长最终 180 秒预算。能力 job 的 10 分钟平台超时约束整个 job；命令按显式超时或默认 180 秒上限运行。失败或取消后仍尝试上传脱敏 system artifacts 与 machine-readable timing；平台强制结束 runner 时，远端 artifact 上传本身无法保证完成。

原 workflow wall time 仍写入报告，供排队和整体交付延迟诊断；合并门禁使用 180 秒执行预算。GitHub 计时元数据暂未补齐时有限重读，等待不计入执行预算；已测得超时立即阻断，不重试。读取持续失败、缺失 required lane/step 或 CI 图出现未知 job 均失败，不用缺失值、旧 attempt 或跳过 evidence 达成速度预算。修改 CI 图时同改此执行路径 owner 与边界测试。
