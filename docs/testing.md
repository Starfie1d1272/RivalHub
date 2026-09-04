# 测试与上线验收

## Verification evidence model

RivalHub 以最高已完成的验证层级描述能力证据：

```text
实现 → 自动化验证 → 完整环境演练 → 生产实战验证
```

| 体系 | 当前最高证据 | 范围 |
|---|---|---|
| Rivals · Spring | 生产实战验证 | 2026 NJU Rivals 完成个人报名、审核、队长投票、选秀、循环赛、双败淘汰、比赛管理、时间协商、BP/赛果、MVP、OCR 统计与赛季结束 |
| Major · Autumn | 自动化生命周期验证 | unit/integration、Local Supabase 和 browser fixture 覆盖 Entry 报名、资格、prestart、三段 Swiss、Playoffs、roster、recovery、discipline 与 post-event |

**2.0.0 之后的验证策略：**v2.0.0 已完成 production 恢复、17/17 migration 与 production smoke。后续变更仍按自动化、Local Supabase、适用的 browser/staging gate 和真实运营证据逐层验证；完整 32 队 staging lifecycle 可作为专项演练，但不是稳定版的强制 gate。

真实注册确认邮件与密码重置邮件的投递是 production canary 和持续运营观察项。记录送达、延迟、退信及供应商异常，在真实流量中持续核对；它们不回溯为 2.0.0 release blocker，也不以 API 成功响应替代真实收件证据。

## Repository checks

| 命令 | 用途 |
|---|---|
| `pnpm type-check` | Next route typegen + app/tests/scripts 三个独立 TypeScript project |
| `pnpm type-check:app` / `pnpm type-check:tests` / `pnpm type-check:scripts` | 分别校验 app、测试与 scripts 边界 |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest unit suite 与不依赖数据库的组件/领域测试 |
| `pnpm test:coverage` | V8 覆盖率诊断报告，不作为百分比 gate |
| `pnpm test:integration` | 通过 Local runner 运行真实 PostgreSQL / migration replay suite |
| `pnpm test:integration:pg17` | CI PostgreSQL 17 service lane：active Drizzle chain、seed/fixture、verify-db、template clone 与 integration suite |
| `pnpm test:e2e` | 准备并清理 Local browser fixture 后运行 Playwright |
| `pnpm check` | type-check + lint + db:check + test |
| `pnpm verify` | check + production build；build 不需要数据库或 fake DB URL |
| `pnpm verify:local` | 确保 Local ready，bootstrap/verify、verify、real-PG integration 与 browser E2E |
| `pnpm db:local:start-db` / `pnpm db:local:start-services` | 分别启动仅 PostgreSQL 或最小 Supabase 服务栈 |
| `pnpm db:local:bootstrap-db` / `pnpm db:local:bootstrap-services` | 分别完成数据库或服务栈的迁移与 fixture bootstrap |
| `pnpm db:local:verify-db` / `pnpm db:local:verify-supabase` | 分别验证 PostgreSQL contract 或 Auth/Storage/Data API；两者都执行完整 public access matrix |
| `pnpm db:check` | Drizzle active migration chain |
| `pnpm db:migration-risk` | active migration SQL 的 compatibility/locking risk classifier |
| `pnpm db:release-compat` | previous stable shipped app → next active migration 的 N/N+1 compatibility gate |
| `pnpm knip` | default module graph 的 dead-code/dependency/export hygiene |
| `pnpm knip --production` | shipped production graph 的 dead-code/dependency hygiene |
| `pnpm db:production:verify` | 严格只读校验明确确认的 production ledger、SQL SHA 与 terminal schema contract |
| `pnpm db:production:migrate` | 先 Local/production preflight，再唯一的 Drizzle 前向迁移与自动 production verify |
| `pnpm build` | production build |
| `pnpm build:local` | 注入 loopback Local Supabase 环境的 production build |

`pnpm test:integration` 与 `pnpm test:e2e` 都拒绝缺少或非 loopback 的 Local 数据库目标。前者运行 `tests/integration/db/**/*.test.ts`，后者通过 `pnpm dev:local` 启动应用，并在测试前后自动创建、清理 browser fixture；运行前先执行 `pnpm db:local:bootstrap`。CI 的 E2E 使用 runner 上已有的 system Chrome（`PLAYWRIGHT_CHANNEL=chrome`），不执行 `playwright install`；本地未安装 Playwright bundled browser 时可使用同一环境变量。

Knip 的 `knip.json` 只把 package scripts、CI/config entrypoints 与测试 shim 声明为 entry；末尾 `!` 是 Knip 的 production-entry 标记，不是 dead-code ignore。`supabase` 是唯一显式 dependency exception，因为 Local runner 通过 `node_modules/.bin/supabase` 动态调用 CLI；其余 files、dependencies、unlisted、unresolved 与 duplicate issue 均保持 error。`exports`/`types` warning 会完整输出，只有逐项确认属于稳定 schema、DTO 或测试/运行时公共 contract 时才保留。

Local PostgreSQL / migration evidence：

多个 worktree 共享同一个 Local Supabase project/端口时，scripts/db/local.ts 会对 bootstrap、migration、seed、verify、real-PG integration、browser E2E、reset 和 verify:local 持有跨 worktree 的 OS 临时目录锁；占用者结束后才继续，异常退出留下的锁会按 PID 存活状态回收。普通 type-check、unit test 与 build 不经过该锁。`auth-permissions.test.ts` 回放 active migration 的旧权限数据并检查成功 backfill 与 fail-closed；`invite-concurrency.test.ts` 直接调用生产 `claimAdminInviteInTx`，用真实 PostgreSQL 事务证明 invite 锁、claim ledger、maxUses、grant 与 audit 的并发收敛。

```bash
pnpm test:integration
pnpm test:integration -- tests/integration/db/major-start.test.ts
pnpm test:integration -- tests/integration/db/migrations/competitive-catalog.test.ts
pnpm test:e2e
pnpm verify:local
```

所有 real-PG 套件通过 `scripts/db/local.ts` 注入 loopback Local PostgreSQL。integration runner 先从 `template1` 创建基线库，使用现有 Drizzle runner、seed 和 verify 回放 active chain，再为每个 Vitest worker 创建独立 template clone；migration replay 的 scratch database 仍单独串行执行，不使用 testcontainers，也不以 mock 代替事务、约束或并发证据。Vitest 保持 `pool: forks` 与 `isolate: true`；需要缩小调试范围时直接使用 Vitest 文件或 `-t` pattern filter。

CI 的 `postgres` job 使用官方 `postgres:17` service container，不启动 Supabase CLI 或任何 Auth、Storage、Kong、PostgREST、Studio、Realtime 等服务；`scripts/db/prepare-pg17.ts` 只在 vanilla PostgreSQL 缺少时建立 `anon` 与 `authenticated` 两个 `NOLOGIN` 角色，并验证 `gen_random_uuid()`，不修改 active migrations。随后 `test:integration:pg17` 回放完整 active chain、seed、fixture、`verify-db`、worker clone 和完整 integration suite；其中 `database-access-boundary.test.ts` 回放 0034，验证 64 张 public base table 的 matrix、trusted server bracket CRUD 以及 anon/authenticated bracket SELECT/INSERT/UPDATE/DELETE 的 `42501` 拒绝。开发者的 `db:local:start-db` 仍保留为 Local Supabase 兼容入口，不是 CI migration authority。

PostgreSQL CI 在现有 service container 中按 `db:check → db:release-compat → test:integration:pg17` 执行；release workflow 在 production migrate 前再次执行 `db:release-compat`，不创建重复的 PostgreSQL/Supabase job。`tests/unit/db/release-compat.test.ts` 使用临时 git repository、stable/prerelease tags、previous source 与 candidate migration 覆盖 DROP/RENAME owner 依赖、production lineage 与 release/dev diverged topology、explicit stable tag 的 fail-closed 解析、annotation 不得绕过、ALTER TYPE/SET NOT NULL fail closed、additive/no-change pass 与可定位 evidence 输出。`tests/unit/db/migration-risk.test.ts` 同时覆盖 contract/locking annotation 的 category 匹配、缺失/错配拒绝和 file/line/category 输出。

## PR CI graph

```text
plan → static ─┐
             ├→ ci-gate
       postgres ┤
       system ──┘
```

`scripts/ci/plan.mjs` 根据 changed surface 选择 capability：文档-only 只运行 `plan + ci-gate`；代码域分别进入 `static`、`postgres` 或 `system`；rename/delete、未分类、toolchain、workflow、release、merge queue 和手动运行 fail closed 到 full。`ci-gate` 会区分预期 skipped 与 required failure/skipped/cancelled，只有 planner 明确声明的 capability 可以跳过。

`static` matrix 当前包含 type-check、lint、unit、build 与 `dead-code`；`dead-code` 在同一个 install 后按顺序运行 `pnpm knip` 和 `pnpm knip --production`。它是现有 static capability 的一个 task，不改变 #355 的 selective/full convergence graph。

只有 pull request 使用上述 selective graph；`push` 到 `dev` 或 `main`、`merge_group`、已发布 `release` 以及 `workflow_dispatch` 都将 `FORCE_FULL`，运行 `static + postgres + system + ci-gate` 的完整 convergence gate。

当前 planner contract 如下：

| changed surface | required evidence |
|---|---|
| `docs/**`、README 等文档 | none（只保留 `plan + ci-gate`） |
| pure domain、formatter、普通 presentation UI | static |
| 普通 `src/actions/**`、直接 DB 的 `src/lib/**` / server page、`src/db/**` | static + postgres |
| `src/actions/auth.ts`、`competition-entries.ts`、`major-prestart.ts`、`register.ts`；Auth/session boundary；`src/app/login/**`、确认/密码路由；直接使用 Supabase 的 action/lib/component | static + postgres + system（仅由实际 DB/Supabase 依赖或显式 critical path 增加） |
| `supabase/config.toml` | system |
| `drizzle/migrations/**` | postgres |
| `playwright.config.ts`、`tests/e2e/**`、CI/test harness、package/toolchain、其它 Supabase project 文件 | FULL |
| unknown、rename、delete、无法读取的 source | FULL |

普通 `src/app/**` 按显式 critical path 和 source 的 direct DB/Supabase import 进入对应 capability；`tests/unit/ci/plan.test.mjs` 对这些边界使用单文件 regression cases；`tests/unit/ci/gate.test.mjs` 同时证明 planner-declared skipped 可通过，而 required/unexpected skipped、failure、cancelled 会失败。

`system` 只维护一个 full profile：最小启动集合为 PostgreSQL、Auth、Storage、PostgREST、Kong，随后验证 Auth、Storage、Data API deny-by-default 与 Major Entry browser journey。Major Entry journey 本身验证真实 Auth → Team → CompetitionEntry → canonical page，不上传 Storage object；Storage 仍由同一 system job 的独立 service contract 证明，而不是被误当作 Entry E2E 的直接依赖。

E2E 中出现 `Error: The destination stream closed early` 时，按当前 Next/React server-renderer 路径的 response destination close / RSC teardown 诊断；只有同一 run 的 E2E 结果为 3 passed / 1 expected skip 且 fixture cleanup 成功时，才按已知 teardown noise 记录。若同时出现失败请求、测试失败或 cleanup 失败，按 runtime regression 处理并阻断交付。

## Verification contracts

单元测试覆盖 capability、状态和 action input boundary，包括 persisted template identity、custom definition validator（executor registry 与 groupCount 晋级计算）、qualification batch/single parity 与竞技上下文冻结/解冻；`tests/unit/db/access-matrix.test.ts` 同时锁定 64 张 public base table 的完整分类、0034 RLS/revoke 迁移、文档生成一致性、未分类表/意外 grant/publication/policy 缺失的 fail-closed 行为，以及浏览器仅保留 Auth、选秀/投票继续 polling 的 contract。真实 PostgreSQL 集成测试覆盖 access matrix terminal replay、trusted server bracket CRUD 和 anon/authenticated CRUD deny；本地集成测试还覆盖 Major Entry registration（含跨 Entry aggregate invariant）、0017 migration replay、长期 participant profile、browser fixture、prestart（含 prestart↔CompetitionEntry coherence guard）、StageRun lifecycle（含开赛前名单一致性 fail-closed 与开赛时按冻结规则重验竞技资料）、roster safety、result recovery、discipline、post-event、“我的”资料/Team/CompetitionEntry/qualification/sanction 组合 read model、Team 邀请过期生命周期，以及 season governance（空赛季删除/撤回 guard、竞技冻结生命周期、队长交接并发语义、行锁终态转换与原子审计）。所有入口都运行在 CompetitionEntry/event-roster schema 上。历史 Golden Major rehearsal 保存在 [`archive/rehearsals/`](./archive/rehearsals/)，不是当前策略的替代品。

## Test layers

```text
Vitest unit
        ↓
Vitest real-PG / migration replay
        ↓
Playwright browser E2E
        ↓
RC production smoke
        ↓
real registrations progressive validation
```

每一层回答不同问题：Vitest 验证 pure rules 与 action boundary；Local Supabase 验证真实 Postgres/Auth/Storage 合作；Playwright 验证浏览器任务；RC production 只承载最小 smoke，后续真实报名以渐进方式验证运营事实。完整 staging lifecycle 可补充验证，但不替代这些分层证据。

## 完整 staging lifecycle（专项演练，非稳定 RC 强制 gate）

如需进行完整 staging lifecycle，可在独立 staging DB 按以下流程专项演练：

```text
管理员创建 Major → 发布 → 用户注册 → 邮箱确认 → participant profile
→ education verification → competitive profile → 长期 Team → 创建
CompetitionEntry → roster revision → member invite / confirmation
→ designated starters → submit → review
→ return → edit → resubmit → approve → prestart
→ entrants → final rosters → seeds → lock/start → Stage 1 → Stage 2
→ Stage 3 → Playoffs → champion → result correction → discipline
→ post-event → archive
```

完整 destructive lifecycle 只在独立 staging DB 执行，结束后 reset staging DB。它用于专项运营演练；2.0 RC 的稳定 gate 是 automated/local integration → RC production smoke → real registrations progressive validation。production 仅进行真实赛事所需 smoke，不承担模拟清理工作。

## Change-level validation

文档或小改动至少运行相关 checker；运行时、schema 或 workflow 改动应增加相应单测/本地集成验证。提交前检查 diff、未跟踪文件、敏感信息和生成产物；不要以 PR 文字或视觉 demo 代替实际验证。

## Strategy guardrails

测试层回答不同的运行时问题，不以堆数量替代证据。当前策略不设置全仓 coverage percentage gate，不把更多 Playwright journey 或 property-based testing 作为每个变更的默认要求；后者只在未来针对明确 combinatorial blind spot 的 pilot 中评估。`test:coverage` 继续是诊断工具，real-PG/migration replay 继续证明真实事务、约束与并发语义。

部署配置与 workflow 的静态 contract 由 `tests/unit/release/runtime-contract.test.ts` 覆盖：它检查 Vercel region、`main` 单 branch deployment gate、protected staging workflow 的 trigger/target/cleanup，以及 Cron matrix 的独立执行、retry、timeout 和 failure propagation。该测试不会连接 staging/production 数据库，也不会调用真实 Cron endpoint；staging remote rehearsal 只能由合并后的 GitHub `staging` Environment workflow 在人工需要时触发。
