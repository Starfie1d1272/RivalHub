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
| Mizar 机器接口 / 数据源权威 / 实时投递 | protocol + provider DTO contract unit + 真实 PostgreSQL transaction/authority + 跨仓 Mizar adapter/parser 兼容 + 受迫 Local Supabase Realtime 正反例（viewer token、private channel、跨场隔离、写入拒绝） |
| release / production boundary | protected release evidence + smoke；真实运营事实只能由真实运营证明 |

App Router 的 Partial Prefetching、URL data Suspense boundary 和 instant navigation 要用 production build/start 检查；`next dev` 不执行 production automatic prefetch。浏览器 evidence 覆盖共享 App Shell、动态链接复用及公开搜索从可见到可编辑的过程，不用固定等待、retry 或延长 timeout 隐藏阻塞。

DB unique/FK、transaction、row lock、migration/backfill 不用 mock 代替。浏览器测试验证用户任务，不重复穷举 pure domain rule。

## CI

PR CI 保留 `static`、`postgres`、`system` 三条 capability lane，按 L0–L4 风险分层运行最低且足够的 evidence：

- Draft 与 Ready PR 均使用同一个 Evidence Planner 根据 changed surface 计算所需的 affected capability 与 task。Draft PR 汇总为非 required 的 `draft-gate`，用于开发阶段快速反馈；Ready PR 产生 ruleset required 的 `ci-gate`，作为合并所需的代码正确性证据。Ready 状态不自动将测试深度升级为 FULL。
- 普通业务变更（L1 Static、L2 PostgreSQL）仅运行对应 affected tests，不再仅因涉及报名、队伍或页面重要性自动触发 Local Supabase / browser system flow。
- System（L3）仅在真实 Auth、Session、Storage provider 或 browser/provider glue 变更时进入 critical path。
- FULL（L4）不再是普通 Ready PR 或 `main` push 的默认行为，仅作为明确的收敛事件（CI/toolchain/harness/unknown/destructive 改动、手动 `workflow_dispatch` 或 nightly 定时收敛）。Release 直接消费 exact tag commit SHA 在 `main` 上的 canonical CI evidence，不在 production activation 后补跑第二套代码正确性 CI。
- `main` push 采用 changed-surface 规划 affected smoke，不默认重复执行 FULL。精确 planner 与 job 以 `.github/workflows/ci.yml`、`scripts/ci/plan.mjs` 为 authority，排障见 [`operations/ci.md`](./operations/ci.md)。

CI 只负责选择和阻断 evidence，不成为业务测试语义的第二 owner。

速度验收按 workflow 开始到全部必需门禁完成的 wall time 计算，包含排队、planner、安装、环境启动与 cleanup：普通修改争取 60 秒，数据库、真实系统与 FULL 回归以 180 秒为上限目标。删行数、测试数下降或调低 timeout 都不能代替真实 CI 成功记录。system 的 provider、production smoke 与受影响 browser 分片并行，gate 等待所有分片；每个 runner 拥有独立服务，场景内部使用独立账号与赛事。

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

Vitest 的三个 project（domain Node、server Node、React jsdom）是独立 evidence owner。测试转换器显式使用 React automatic JSX runtime；应用 TypeScript 配置继续保留 JSX 供 Next.js 编译，测试不继承其 JSX preserve 行为。FULL static 会并行执行三个 project；affected static 将每个 source 交给全部 Vitest project 的 `related` 查找跨层消费者，而变更的 test 文件与产品语言契约 以匹配实际扩展名的 project 和显式 test path 直接运行；显式清单为空或没有发现测试必须失败。source 的相关消费者为空可以通过，但不能伪装成执行了测试。混合 source/test 修改取证据并集，新增测试不得缩窄既有 PG 或共享 E2E harness 的验证范围。React/jsdom 的异步交互测试使用 `userEvent.setup()` 和 awaited interaction，并分别等待元素存在与可交互状态；只有时间推进本身是被测 contract 时才使用 fake timers。`unit-react-jsdom` 仅在 GitHub Actions 中配置一次 `retry`，本地默认保持 `0`；static matrix 在该 project 测试后执行 `scripts/ci/assert-no-flaky.mjs`，所以 retry-pass 仍会使 static job 失败。project 的 wall time 由外层 timing wrapper 记录，`vitest-timing-reporter.ts` 继续作为唯一 evidence producer，除 test count、failure/flaky count 和按文件排序的 diagnostic duration 外，为每个 flaky test 写入 project、file、full test name 与 retry count，不解析 console 文本伪造失败信息，也不把并发文件 duration 总和伪装成 project wall time。

对疑似 flake 的本地诊断可以显式运行 `pnpm exec vitest run --project unit-react-jsdom --retry 1 path/to/related.spec.tsx`；`repeats` 只作为聚焦诊断或手动/nightly 入口，不进入普通 PR 的 planner、required path 或 flaky allowlist。

System failure/flaky 时 Playwright 生成 failure screenshot；artifact sanitizer 仅从 test-results 保留小型 PNG/JPEG，trace archive 与所有文本继续脱敏，成功 run 不上传大体积 artifacts。每条 stateful E2E 使用自己的 fixture profile 与 attempt namespace。

公开搜索的 required evidence 是一次真实 debounce/router/RSC 与历史恢复闭环；`ListSearchField` 的输入规则由共享组件测试保护。`--repeat-each=10`、容量压测与截图不进入普通 PR 或 FULL required gate，显式实验也不得用 retry 隐藏失败。

独立验收入口（先按 local-development 启动最小本地环境）：

```bash
pnpm test:e2e -- --config=playwright.acceptance.config.ts
pnpm test:e2e -- --config=playwright.production.config.ts
pnpm test:integration:pg17 -- --config=vitest.experiments.config.ts
pnpm test:e2e -- --project=mobile-chrome --repeat-each=10 flows/public-event-experience.spec.ts
```

普通 Playwright config 只发现关键生命周期，project 根据实际保护职责分配用例，不先发现再运行时 skip。测试赛创建链路由 desktop project 拥有，同一用例内验证手机 viewport 的可达性。视觉、截图和状态组合验收由 acceptance config 显式发现；容量实验使用独立 Vitest config，共享真实 PostgreSQL/HTTP harness，日常 PG config 保留超时、锁竞争、公平轮转、故障恢复与权威 fencing 正确性。system 同时运行精简 production build/start smoke：真实 UI 登录、App Shell 导航、`aria-current` 和移动可达性。production 的 test-only auth route 仍关闭。

PostgreSQL harness 按稳定 `VITEST_POOL_ID` 为并发槽位分配独立数据库；不得用按文件递增的 worker ID 取模，无对应槽位必须失败。全库计数/覆盖率比较使用一致性 snapshot，fixture 写入不得依赖其他 suite 的状态。

## Spectator prediction acceptance

Pure tests exercise full Major simulation, upstream invalidation, exact slot judgement, bracket dependencies and integer pool conservation. PostgreSQL tests exercise submission versions, server locks, idempotency, concurrent ALL IN, append-only records, official settlement/reversal/debt, account merge blockers and public-data isolation. Major runtime regression is required when shared pairing helpers change. Required browsers protect submission, independent draft restoration, real PNG download and point transactions through Local Supabase on desktop and mobile. Visual state combinations use the explicit acceptance entry; they do not repeat the pairing or settlement rule matrix.

## Maintenance rules

- 新增测试必须说明用户/业务/安全承诺、具体失败风险、为何现有证据不足以及为何选择该层。没有独立保护价值就不新增；不机械地为每个函数、组件或改动添加测试。
- 同一规则由最低足够真实的层拥有；跨层测试只保护拼装链路，不能复制规则矩阵。源码字符串、内部变量、DOM 层级、CSS class 与第三方库转发通常不是产品契约；权限边界静态规则、实际资产/provenance 和公开 DTO 则有独立价值。
- 数据库业务查询测试必须执行实际 query/service/Action owner，再检查持久化结果和拒绝后的事实不变；在测试内复制一份生产 SQL 不证明生产入口正确。纯数据库 CHECK/FK/RLS 的探针仍直接验证数据库契约。
- 合法产品变化先更新承诺再修改测试；重构不改变承诺却大量要求同步改断言时，先审查测试耦合。重复失败优先定位原因，不能以 skip、retry-pass、删负例换绿。
- `null`、失败、并发、权限和 recovery 等重要负路径必须由对应层证明。
- 清理测试时按独立承诺逐项处置，不能把静态扫描或全绿描述为逐断言审查完成。删除写法断言后若只剩固定文案或对象形状检查，继续评估整项删除；测试名称必须准确描述剩余保护。工作流安全门禁与应用/工具源码写法分开审查；前者保留，后者优先使用现有行为证据。
- 不在文档复制测试数、表数或 migration 数。
- 不能用“CI 绿”“已知 flaky”或视觉 demo 替代所需 evidence。
- canonical domain rule 尽量在其 owner 附近测试；跨层 E2E 只证明组合行为。

## Public match LIVE consumer evidence

`mizar-live-real-derived.json` retains the source Mizar commit and sanitized capture provenance. It was produced from Mizar's `real-live-rich` program and matching `dense-utility` radar fixture through `projectLiveSnapshotV1`; RivalHub tests must still run its wire parser, `projectPublicLive`, delivery reducer and the published `fromPublicRadar` adapter. The professional capture is a fixture, not evidence that an NJU match was played.

`tests/e2e/flows/public-match-live.spec.ts` uses disposable Local Supabase facts, the existing private viewer endpoint and production ingest/public projection. Its dedicated producer only rewrites local match/context IDs and delivery timestamps; it sends the captured player/radar data at 1 Hz. The Chromium scenario checks private channel delivery, shared live scores, stale clock freezing, unavailable fallback, resumed delivery, cross-match navigation, icon failure and map changes. State/phase matrices and exact age boundaries belong to deterministic component/reducer tests; multi-viewport screenshots belong to opt-in acceptance. It never publishes to a hosted Supabase project. Token expiry, rejected replay and foreground cleanup are deterministic lifecycle tests; exact age boundaries and authority/map resets are reducer tests. These checks do not certify a production deployment, real operator handover or sustained multi-viewer capacity.


### 无产品入口的比赛领域命令

独立比赛创建与结束/补录/更正命令是本轮明确交付的内部领域入口，线上授权与约战 UI 尚未接入。`knip.json` 将 `src/lib/matches/creation.ts`、`src/lib/matches/unassociated-result.ts` 声明为生产领域检查根，使 production 模式继续检查它们的依赖；不为通过检查添加无授权的路由或虚假调用。命令行为由真实数据库集成回归验证，后续接入产品调用后移除这两条显式根。
