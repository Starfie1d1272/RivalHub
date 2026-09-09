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

PR CI 根据 changed surface 选择 `static`、`postgres`、`system` capability；`main`、merge queue、release 等收敛事件运行完整 gate。精确 planner 与 job 以 `.github/workflows/ci.yml`、`scripts/ci/plan.mjs` 为 authority，排障见 [`operations/ci.md`](./operations/ci.md)。

CI 只负责选择和阻断 evidence，不成为业务测试语义的第二 owner。

## Staging and production

Staging 是受保护的远程 migration/schema rehearsal，不是每个 PR 的必经环境。仅当存在远程状态、锁、兼容性或 local 无法证明的风险时使用，见 [`operations/staging.md`](./operations/staging.md)。

Production 只做最小、可重复、低破坏 smoke。邮件投递、真实报名、比赛运营等外部事实应在真实运营中验证，不能把测试环境成功描述成 production evidence。

## Common commands

```bash
pnpm type-check
pnpm lint
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm check
pnpm verify
```

`pnpm check` 与 `pnpm verify` 是默认 host-only gate，不会启动或连接本地 Docker、Supabase 或 PostgreSQL container。真实 PostgreSQL / Supabase / browser evidence 由 CI 承担；需要人工复现时使用 `pnpm verify:services`，并明确设置 `RIVALHUB_ALLOW_LOCAL_CONTAINERS=1`。

环境启动和单层复现见 [`operations/local-development.md`](./operations/local-development.md)。

## Maintenance rules

- regression test 保护明确 contract，而不是只覆盖代码行。
- `null`、失败、并发、权限和 recovery 等重要负路径必须由对应层证明。
- 不在文档复制测试数、表数或 migration 数。
- 不能用“CI 绿”“已知 flaky”或视觉 demo 替代所需 evidence。
- canonical domain rule 尽量在其 owner 附近测试；跨层 E2E 只证明组合行为。
