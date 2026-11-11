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

`draft-gate` 汇总 Draft PR 的 affected evidence，用于开发中快速反馈，不能满足 ruleset 的 merge requirement。`ci-gate` 由 Ready PR、`main` push、merge queue 和手动运行产生；它是代码正确性 evidence 的 required check：planner 明确允许跳过的 job 可以 skipped；本应运行却 failure / cancelled / unexpected skipped 的 capability 会阻断合并。PR metadata policy 由独立的 `pr-title` check 负责；要使其阻断合并，Main ruleset 需与 `ci-gate` 一起要求该 check。

## Capabilities

### static

用于不依赖真实数据库服务的代码质量和构建证据，当前包括：

- app / tests / scripts TypeScript；
- ESLint；
- architecture dependency contract；
- Vitest unit suite；
- dead-code / dependency hygiene；
- production build。

普通 affected 任务在一个 runner 上安装一次依赖。格式检查只读取改动的源码，格式、类型、lint 和架构检查与相关 Vitest 并行；FULL 保留全量源码格式检查。跨 project 消费者由一次 `vitest related` 发现；变更的测试按所属 project 显式执行，未发现指定文件时阻断。FULL 并行执行静态检查、现有 unit suite 和 hermetic production build。DAK 输入契约、生成器或公开 JSON Schema 变化时验证生成物一致性。安装／恢复工具变化时，在静态 runner 执行现有 Linux 安装器和流量状态测试。

普通门禁中 Vitest 和 Playwright 首次失败即失败。需要复现间歇性问题时可以定向重试。Vitest reporter 记录 project 测试结果和较慢文件，外层 wrapper 单独计量命令耗时。

### postgres

使用 PostgreSQL 17 service container，验证：

- active migration chain；
- migration risk；
- previous stable → candidate 的 release compatibility；
- seed / fixture / schema verification；
- real PostgreSQL integration tests。

CI 不使用 mock 来替代 constraint、transaction、locking 或并发证据。affected PG 从真实测试的传递依赖计算消费者（含动态 import 与 vi.mock 引用），混合修改取并集。报名窗口、赛果与下注准入共享规则直接匹配各自的 PostgreSQL 事务用例。schema、migration、harness 或未知消费者回退 FULL。容量测量由独立 experiments config 运行，不进入 required PG suite。

FULL PostgreSQL 固定使用两个 runner，以 Vitest 原生 `1/2`、`2/2` 按文件分片完整 integration 集合；affected PG 仍使用一个 `1/1` runner 与原选择集合。两个 FULL runner 各自启动真实 `postgres:17`，执行 active-chain replay、seed/fixture/schema verification，并为三个并发 worker 克隆独立数据库。FULL 的第 1 片承担 migration risk 和 previous-stable release compatibility；affected 的单片承担相同职责。matrix 禁用 fail-fast、最多并发两个 runner，保留每片 timing/test-count evidence；任一片失败或取消使 `postgres` 聚合失败，gate 等待全部分片，180 秒预算按实际执行关键路径计算，排队不计入。

Release 的 migration rehearsal 使用同一套 plain `postgres:17` service、`preparePg17Database()` 和 active migration replay owner；它不启动 Local Supabase。CI PostgreSQL lane、Release workflow 与本地 `db:local:migrate` 共享 `scripts/db/migration-replay.ts`，避免出现第二套只在发布时运行的 migration runner。

### system

启动最小 Local Supabase services，并运行：

- Supabase service / access contract verification；
- affected 关键 browser E2E 与 production build/start App Shell smoke。

浏览器使用 runner 已有的 Chrome。Provider、普通浏览器路径与 production smoke 独立选择。普通浏览器按固定任务组共用 Next server 与最小 Local Supabase，新增 spec 进入已有组；未归组的 spec 仍执行。需验证 Storage 的组启动完整服务，Realtime 仅用于 LIVE provider 证据。比赛、账号和管理流程选一个主要视口，触屏提交与下载保留 mobile project。Production 的 App Shell 在两个视口共用一次 build/start，每条运行仍创建自己的 fixture 与 browser context。与视口无关的 BET transport 在桌面跑一次。涉及故障恢复的场景保持账户、赛事和数据隔离。

System 失败时上传限额内的脱敏日志、截图和场景记录，不上传 trace archive。Step Summary 保存关键路径、各验证命令及诊断用的实际耗时。

### dependency review

每个 PR 保留依赖漏洞审查。依赖变化的 main 快照生成、提交和回读由独立 `Dependency graph` workflow 负责，见 [依赖维护](../dependency-maintenance.md#github-graph-与-updater)。

## Selective vs full

CI 遵循 L0–L4 风险分层与最低且足够可信证据原则：

- **L0 Metadata**：docs、Changeset，以及只改变 `package.json` 顶层 `version` 的 release metadata（可伴随 `CHANGELOG.md` 与 Changeset），仅保留 planner + gate，不启动测试容器。文档、设计元数据和 Changeset 的移动与删除沿用元数据分类。删除独立测试时检查剩余消费者，重命名按新旧两侧分类；删除可执行源码或无法分类时保守回退 FULL。package dependency、script、packageManager、lockfile 或任意 source 变化都不能走该 bypass。
- **L1 Static**：pure rule、formatter、presenter、component、UI/layout 等不跨 persistence/provider 边界的变化，运行 affected type/lint/architecture/unit。
- **L2 PostgreSQL**：Server Action persistence、DB query、transaction、migration 等，运行 L1 + real PostgreSQL。
- **L3 System**：Auth、Session、Storage provider 或 browser/provider glue，运行 L1/L2 + Local Supabase + targeted E2E。
- **L4 Full convergence**：CI/toolchain/harness/unknown/destructive 改动、merge queue 或手动 FULL，运行完整 static + postgres + system。Release 直接消费 exact release SHA 在 `main` 上的 canonical CI evidence，不重复触发或等待第二套 FULL CI。

Pull Request 的 Draft / Ready 仅代表协作与合并准入状态，不直接决定测试深度：

1. Draft PR 由 changed-surface planner 输出本次改动所需最低充分 evidence，以 `draft-gate` 汇总，供开发阶段快速迭代。
2. Ready PR 使用同一个 changed-surface planner 输出匹配风险的 evidence，并以 required `ci-gate` 汇总；不因 Ready 状态机械升级为 FULL。普通 UI / Server Action PR 仅支付对应静态或 PG 验证时间，不进入昂贵的 system 冷启动。
3. `push` 到 `main` 同样使用 changed-surface 规划 affected smoke，不默认重复跑 FULL。
4. 无法分类的变化、CI/toolchain/harness 改动 fail closed 到 FULL。

`scripts/ci/timing.mjs` 的 command wrapper 是 project wall-time owner。`vitest-timing-reporter.ts` 只输出 per-project facts 与 top 15 per-file diagnostic duration，Step Summary 会明确区分两者。

`push` 到 `main` 同样采用 changed-surface 规划 affected evidence 并产生 exact-SHA CI evidence，遇到未知/破坏性/工具链变更时 fail closed 到 FULL；merge queue 与手动 workflow 运行完整 convergence gate。Release 消费 exact tag commit SHA 的 push CI 成功证据，不重复执行代码正确性 CI。

最近 PR 的墙钟和重跑按 lane 核对。运行 `node scripts/ci/pr-wall-time.mjs 30`，它使用 GitHub 的 run 创建时间、gate 完成时间及 plan 实际 runner 初始化时间，分别给出墙钟 P95 与初始分配延迟。样本同时记录失败步骤、取消、排队与同 run 重跑。Step Summary 的 180 秒是执行关键路径，普通 PR 的墙钟目标为 P95 ≤ 180 秒。

## Concurrency 与 exact-SHA 证据隔离

CI 的 concurrency 分组策略兼顾 PR 快速取消与 release exact-SHA 证据保护：

- **Pull Request**：按 PR 编号独立分组（`ci-CI-pull_request-<number>`），启用 `cancel-in-progress: true`；同 PR 的新 push 立即取消旧 SHA 的在途 run，避免积压 CI 资源。
- **main push**：按 exact commit SHA 独立分组（`ci-CI-push-<sha>`），配置 `cancel-in-progress: false`；每个进入 main 的 commit run 独立执行，不被后续 main push 误取消，确保 release 所需的 exact-SHA CI 证据永久可靠。
- **merge queue / workflow_dispatch**：按各自 event 语义稳定分组。

`ci.yml` 只响应会改变代码 evidence 的 PR event（opened、synchronize、reopened、ready_for_review）。`.github/workflows/pr-metadata.yml` 在上述事件和 `edited` 上独立运行 `pr-title`；因此 title/body 编辑不会取消、覆盖或重跑当前 head 的 `ci-gate`，而新 commit 的 `synchronize` 仍会为其 SHA 重新产生 title check。Ready PR 的新 push 必须等待该 SHA 所需的 CI 完成，不能沿用旧 SHA 的成功结果。

路径规则由 `scripts/ci/plan.mjs` 维护，现有 planner 验证与其选择契约保持一致。

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

`execution-budget.mjs` 只读取当前 `run_id` / `run_attempt` 的分页 job/step 计时。每个 job 累计真实执行的 step 区间（重叠部分仅算一次），不把 job `started_at` 到第一条 step 之间的 runner 排队或 step 间调度空档当作执行。CI 图按 `max(plan + max(static, postgres, system), dependency-review) + gate` 计算实际关键路径；matrix 各片取最长执行耗时，保留并行语义。gate 的本地计时在计时 API 请求前冻结，截止到核验步骤开始，不包含该次 GitHub API 等待及核验后的报告/runner post-cleanup。

`timing.mjs` 直接执行验证命令并记录本地耗时，不依赖 GitHub job/step 元数据才能启动。CI workflow 显式传入 180 秒命令上限；其他 workflow 按各自的命令或 job deadline 运行。最终 gate 另行核验执行预算，远端计时不可用时不得声称速度达标。

wrapper 同时等待 leader 和 stdio 关闭，因此 leader 退出 0、测试打印通过但 detached 后代持有 stdout 时仍受截止约束。每次顶层命令生成独立环境 token，嵌套 timing 命令继承同一 owner；只扫描并终止该 token 的进程与原进程组，不按进程名或端口清理。截止或取消先写失败证据，再 TERM，最多 2 秒后 KILL 并关闭残留管道；超时返回 124，取消与清理错误也保留非零结果。Linux runner 通过 `/proc` 查归属，macOS 本地通过 `ps`；进程环境只在内存中匹配，不写入日志。

system browser 结束后独立执行有界 `cleanup-e2e`，复用本 workspace 既有 fixture manifest 与 cleanup owner；每项成功清理后才移除 manifest，失败保留以供诊断。该清理最多 15 秒加 2 秒进程回收，不覆盖测试原失败，也不延长最终 180 秒预算。能力 job 的 10 分钟平台超时约束整个 job；命令按显式超时或默认 180 秒上限运行。失败或取消后仍尝试上传脱敏 system artifacts 与 machine-readable timing；平台强制结束 runner 时，远端 artifact 上传本身无法保证完成。

workflow 创建到门禁结束的实际等待时间用于验收反馈速度；合并门禁使用 180 秒执行预算。各 job 累计执行时间和系统环境数量随关键路径报告，供排障时参考。GitHub 计时元数据暂未补齐时有限重读，等待不计入执行预算；已测得超时立即阻断，不重试。读取持续失败、缺失 required lane/step 或 CI 图出现未知 job 均失败，不用缺失值、旧 attempt 或跳过 evidence 达成速度预算。修改 CI 图时同改此执行路径 owner 与边界测试。
