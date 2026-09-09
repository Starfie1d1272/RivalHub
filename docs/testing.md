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

PR CI 保留 `static`、`postgres`、`system` 三条 capability lane，并按 Draft → Ready 分为两个阶段：

1. Draft PR 的每次 push 使用 Evidence Planner 根据 changed surface 选择 affected Vitest project、changed-file lint、明确的 PostgreSQL integration spec 和 semantic Playwright flow，并汇总为非 required 的 `draft-gate`。它用于快速反馈；unknown、rename/delete、toolchain、workflow 或 harness surface 仍 fail closed 到 FULL。
2. PR 标记为 Ready for review 时，`ready_for_review` 必须触发一次 FULL matrix，不再使用 affected heuristic，并产生 ruleset required 的 `ci-gate`。Ready PR 后续每次 push 也运行该 commit 的 FULL matrix。

只有最新 commit 的 FULL CI 与 required checks 全部成功，才能作为 merge evidence；新 push 会使之前 commit 的 FULL evidence 失效。`main`、merge queue、release 和手动运行同样强制 FULL。精确 planner 与 job 以 `.github/workflows/ci.yml`、`scripts/ci/plan.mjs` 为 authority，排障见 [`operations/ci.md`](./operations/ci.md)。

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

Vitest 的三个 project（domain Node、server Node、React jsdom）是独立 evidence owner。FULL static 会并行执行三个 project；Draft affected static 将 source 交给 Vitest `related`，而变更的 test 文件与 architecture/E2E 等 repository contract 以显式 test path 直接运行。project 的 wall time 由外层 timing wrapper 记录，reporter 只记录 test count、failure/flaky count 和按文件排序的 diagnostic duration，不把并发文件 duration 总和伪装成 project wall time。

System failure/flaky 时 Playwright 生成 failure screenshot；artifact sanitizer 仅从 test-results 保留小型 PNG/JPEG，trace archive 与所有文本继续脱敏，成功 run 不上传大体积 artifacts。每条 stateful E2E 使用自己的 fixture profile 与 attempt namespace。

## Maintenance rules

- regression test 保护明确 contract，而不是只覆盖代码行。
- `null`、失败、并发、权限和 recovery 等重要负路径必须由对应层证明。
- 不在文档复制测试数、表数或 migration 数。
- 不能用“CI 绿”“已知 flaky”或视觉 demo 替代所需 evidence。
- canonical domain rule 尽量在其 owner 附近测试；跨层 E2E 只证明组合行为。
