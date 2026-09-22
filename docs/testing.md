# RivalHub 测试策略

测试按风险提供证据，不追求单一覆盖率数字。

```text
unit/component
    ↓
real PostgreSQL
    ↓
browser + Local Supabase
    ↓
staging rehearsal（需要时）
    ↓
production smoke / real operation
```

越靠下越接近真实环境，但不能替代上层的精确 contract test；反过来，unit mock 也不能证明数据库、浏览器或部署语义。

## Evidence matrix

| 变化 | 最低证据 |
| --- | --- |
| pure rule / formatter / component | unit/component + 适用的 type/lint |
| DB query / constraint / transaction / concurrency | real PostgreSQL integration |
| Auth / Storage / browser critical path | PostgreSQL（如涉及）+ Local Supabase/browser E2E |
| migration | PostgreSQL replay + migration risk/release compatibility |
| runtime observability | focused unit contract；涉及 provider/DB 时叠加对应真实层 |
| release / production boundary | protected release evidence + smoke；真实运营事实只能由真实运营证明 |

DB unique/FK、transaction、row lock、migration/backfill 不用 mock 代替。浏览器测试验证用户任务，不重复穷举 pure domain rule。

## CI

PR CI 保留 `static`、`postgres`、`system` 三条 capability lane，按 L0–L4 风险分层运行最低且足够的 evidence：

- Draft 与 Ready PR 均使用同一个 Evidence Planner 根据 changed surface 计算所需的 affected capability 与 task。Draft PR 汇总为非 required 的 `draft-gate`，用于开发阶段快速反馈；Ready PR 产生 ruleset required 的 `ci-gate`，作为合并所需的代码正确性证据。Ready 状态不自动将测试深度升级为 FULL。
- 普通业务变更（L1 Static、L2 PostgreSQL）仅运行对应 affected tests，不再仅因涉及报名、队伍或页面重要性自动触发 Local Supabase / browser system flow。
- System（L3）仅在真实 Auth、Session、Storage provider 或 browser/provider glue 变更时进入 critical path。
- FULL（L4）不再是普通 Ready PR 或 `main` push 的默认行为，仅作为明确的收敛事件（CI/toolchain/harness/unknown/destructive 改动、手动 `workflow_dispatch` 或 nightly 定时收敛）。Release 直接消费 exact tag commit SHA 在 `main` 上的 canonical CI evidence，不在 production activation 后补跑第二套代码正确性 CI。
- `main` push 采用 changed-surface 规划 affected smoke，不默认重复执行 FULL。精确 planner 与 job 以 `.github/workflows/ci.yml`、`scripts/ci/plan.mjs` 为 authority，排障见 [`operations/ci.md`](./operations/ci.md)。

CI 只负责选择和阻断 evidence，不成为业务测试语义的第二 owner。

## Staging and production

Staging 是受保护的远程 migration/schema rehearsal，不是每个 PR 的必经环境。仅当存在远程状态、锁、兼容性或 local 无法证明的风险时使用，见 [`operations/staging.md`](./operations/staging.md)。

Production 只做最小、可重复、低破坏 smoke。邮件投递、真实报名、比赛运营等外部事实应在真实运营中验证，不能把测试环境成功描述成 production evidence。

## 本地迭代命令

```bash
pnpm type-check:app       # src/app、server action 或 route 改动
pnpm type-check:tests     # 测试改动
pnpm type-check:scripts   # scripts 改动
pnpm exec eslint path/to/changed-file.ts
pnpm exec vitest run --project unit-domain-node path/to/related.spec.ts
pnpm exec vitest run --project unit-server-node path/to/related.spec.ts
pnpm exec vitest run --project unit-react-jsdom path/to/related.spec.tsx
```

以上命令按 changed surface 选择，不要求每次迭代运行全仓库检查。`pnpm check` 与 `pnpm verify` 是可选的 broad host-only gate，不会启动或连接本地 Docker、Supabase 或 PostgreSQL container；它们也不是每次 push 的默认要求。真实 PostgreSQL / Supabase / browser evidence 由 CI 承担；需要人工复现时使用 `pnpm verify:services`，并明确设置 `RIVALHUB_ALLOW_LOCAL_CONTAINERS=1`。

环境启动和单层复现见 [`operations/local-development.md`](./operations/local-development.md)。

Vitest 的三个 project（domain Node、server Node、React jsdom）是独立 evidence owner。FULL static 会并行执行三个 project；Draft affected static 将 source 交给 Vitest `related`，而变更的 test 文件与 architecture/E2E 等 repository contract 以显式 test path 直接运行。React/jsdom 的异步交互测试使用 `userEvent.setup()` 和 awaited interaction，并分别等待元素存在与可交互状态；只有时间推进本身是被测 contract 时才使用 fake timers。`unit-react-jsdom` 仅在 GitHub Actions 中配置一次 `retry`，本地默认保持 `0`；static matrix 在该 project 测试后执行 `scripts/ci/assert-no-flaky.mjs`，所以 retry-pass 仍会使 static job 失败。project 的 wall time 由外层 timing wrapper 记录，`vitest-timing-reporter.ts` 继续作为唯一 evidence producer，除 test count、failure/flaky count 和按文件排序的 diagnostic duration 外，为每个 flaky test 写入 project、file、full test name 与 retry count，不解析 console 文本伪造失败信息，也不把并发文件 duration 总和伪装成 project wall time。

对疑似 flake 的本地诊断可以显式运行 `pnpm exec vitest run --project unit-react-jsdom --retry 1 path/to/related.spec.tsx`；`repeats` 只作为聚焦诊断或手动/nightly 入口，不进入普通 PR 的 planner、required path 或 flaky allowlist。

System failure/flaky 时 Playwright 生成 failure screenshot；artifact sanitizer 仅从 test-results 保留小型 PNG/JPEG，trace archive 与所有文本继续脱敏，成功 run 不上传大体积 artifacts。每条 stateful E2E 使用自己的 fixture profile 与 attempt namespace。

Public event participant search 的 mobile-chrome 回归必须证明真实 debounce/router/server re-render 竞态已消除：CI 在 affected system lane 中聚焦运行 `tests/e2e/flows/public-event-experience.spec.ts` 10 次，使用 `PLAYWRIGHT_RETRIES=0`、`--repeat-each=10`，并要求 `flaky=0`；这是该 contract 的 authoritative evidence。修复应收敛在 `ListSearchField` / list-query owner，不得通过增加 timeout、`waitForTimeout`、重复 fill/click 或关闭 `failOnFlakyTests` 掩盖竞态；其它 `ListSearchField` consumer 仍需通过共享组件单测。
## Spectator prediction acceptance

Pure tests exercise full Major simulation, upstream invalidation, exact slot judgement, bracket dependencies and integer pool conservation. PostgreSQL tests exercise submission versions, server locks, idempotency, concurrent ALL IN, append-only records, official settlement/reversal/debt, account merge blockers and public-data isolation. Major runtime regression is required when shared pairing helpers change. Browser acceptance uses real Local Supabase login, keyboard/click/drag slot assignment, local projection and undo, playoff dependencies, independent draft/submission state, PNG download and point transactions on desktop and mobile.

## Maintenance rules

- regression test 保护明确 contract，而不是只覆盖代码行。
- `null`、失败、并发、权限和 recovery 等重要负路径必须由对应层证明。
- 不在文档复制测试数、表数或 migration 数。
- 不能用“CI 绿”“已知 flaky”或视觉 demo 替代所需 evidence。
- canonical domain rule 尽量在其 owner 附近测试；跨层 E2E 只证明组合行为。
