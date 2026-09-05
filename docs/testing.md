# RivalHub 测试策略

RivalHub 的测试不是为了追求一个统一的“覆盖率数字”，而是为不同风险提供对应层级的证据。一个改动需要跑到哪一层，取决于它改变了什么事实边界。

## Evidence model

```text
pure / component evidence
        ↓
real PostgreSQL evidence
        ↓
browser + Supabase service evidence
        ↓
staging rehearsal（需要时）
        ↓
production smoke / real operations
```

越靠下的层级越接近真实环境，但成本也越高。高层验证不能替代低层精确测试，低层测试也不能证明真实数据库、浏览器或部署链路。

## 各层证明什么

| 层级 | 主要证明 | 典型工具 |
| --- | --- | --- |
| Unit / component | pure rule、formatter、validator、状态推导、组件交互 | Vitest / Testing Library |
| Real PostgreSQL | migration、constraint、transaction、locking、并发和 DB-backed domain invariant | PostgreSQL 17 + Drizzle integration |
| System / browser | Auth、Storage、真实页面任务和 Server Action 组合是否协作 | Local Supabase + Playwright |
| Staging | 受保护远程数据库上的 migration / schema rehearsal | staging workflow |
| Production | exact release 是否可访问、真实运营链路是否成立 | release smoke + real operations |

## 如何选择证据

### 纯展示或 pure domain 变化

至少运行相关 unit/component test；涉及类型或通用代码时再运行 type-check/lint。

### 数据库读取、写入或约束变化

必须增加或运行 real PostgreSQL 证据。不要用 mock 证明 unique constraint、foreign key、transaction、row lock 或并发语义。

### Auth / Storage / 浏览器任务变化

在 unit / PostgreSQL 证据之外运行 system/browser evidence。浏览器测试验证用户任务，不重复穷举 pure rule。

### Runtime observability 变化

结构化事件、错误分类、脱敏、trace 属性和 provider fetch contract 使用 `tests/unit/lib/observability/` 的 unit evidence；server/runtime source 的 `no-console` 边界由 ESLint 维护，client-only fallback 由对应组件行为和 lint 文件边界维护。涉及 DB、Auth 或 provider 的接入仍按对应真实环境证据补跑。

### Migration 变化

除 real PostgreSQL replay 外，还需要执行 migration risk / release compatibility 检查。是否需要 staging rehearsal 取决于兼容性、锁、回填、远程状态和 release 风险。

### Production 行为或 release boundary 变化

自动化通过后仍需保留 release smoke；只有真实运营才能证明的能力，应明确标记为运营验证，而不是把 API 成功或测试环境结果描述为 production evidence。

## 常用入口

```bash
pnpm type-check
pnpm lint
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm check
pnpm verify
pnpm verify:local
```

需要单独调试数据库或浏览器环境时，见 [`operations/local-development.md`](./operations/local-development.md)。

## CI 与本地验证

PR CI 根据 changed surface 选择 static、PostgreSQL 与 system capabilities；`main` 等收敛事件运行完整 gate。CI 如何规划、如何复现以及各 job 的职责见 [`operations/ci.md`](./operations/ci.md)。

CI 是 evidence enforcement，不是业务测试语义的第二 owner。精确测试应该尽量靠近其 canonical domain owner，workflow 只负责选择、组合和阻断。

## Staging 的角色

Staging 是受保护的专项 rehearsal 环境，不是每个 PR 的必经步骤，也不是 production 的替代品。

适合 staging 的情况包括：

- migration 涉及明显兼容性或锁风险；
- 需要核对远程 ledger / schema 与预期是否一致；
- release 前需要验证真实远程数据库迁移链；
- 仅靠 local 无法证明的环境差异。

具体流程见 [`operations/staging.md`](./operations/staging.md)。

## Production evidence

正式发布只做最小、可重复、低破坏性的 smoke。真实邮件投递、实际报名、比赛运营等外部事实应在正常运营中持续观察；不要把 production 当作破坏性测试环境，也不要为了“补测试”在真实用户数据上制造异常状态。

## 测试维护原则

- 不在文档里复制测试数量、表数量或 migration 数量；这些数字会快速失效。
- 每条高价值 regression test 应保护一个明确的 contract，而不是只覆盖代码行。
- DB invariant 优先用真实 PostgreSQL 证明。
- UI projection 不能代替 canonical facts 的验证。
- 对已知环境噪声，只允许在同时存在明确成功证据时做窄范围识别；不能用“已知 flaky”掩盖真实失败。
