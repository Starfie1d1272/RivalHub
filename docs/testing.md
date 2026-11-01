# RivalHub 测试策略

测试按风险提供证据。精简比例是参考，验收以独立风险保护、实际重复与维护成本为准，不用比例硬删测试。

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
| pure rule / formatter / component | 适用的 type/lint；有独立风险时使用聚焦 unit/component 或临时行为检查 |
| DB query / constraint / transaction / concurrency | real PostgreSQL integration |
| Auth / Storage / browser critical path | PostgreSQL（如涉及）+ Local Supabase/browser E2E |
| migration | PostgreSQL replay + migration risk/release compatibility |
| runtime observability | focused unit contract；涉及 provider/DB 时叠加对应真实层 |
| Mizar 机器接口 / 数据源权威 / 实时投递 | 真实 PostgreSQL ingest/public DTO/transaction/authority + 跨仓 Mizar adapter/parser 兼容 + 受迫 Local Supabase Realtime 正反例（viewer token、private channel、跨场隔离、写入拒绝） |
| release / production boundary | protected release evidence + smoke；真实运营事实只能由真实运营证明 |

App Router 的 Partial Prefetching、URL data Suspense boundary 和 instant navigation 要用 production build/start 检查；`next dev` 不执行 production automatic prefetch。浏览器 evidence 覆盖共享 App Shell、动态链接复用及公开搜索从可见到可编辑的过程，不用固定等待、retry 或延长 timeout 隐藏阻塞。

DB unique/FK、transaction、row lock、migration/backfill 不用 mock 代替。浏览器测试验证用户任务，不重复穷举 pure domain rule。

教育认证保留真实 PostgreSQL 的提交并发、事务失败补偿、审核权限与材料到期删除证据；Local Supabase provider contract 验证私有 Storage 的服务端读写、匿名/普通用户拒绝及短期签名访问。录取通知书提交→新窗口查看→审核的完整浏览器交互由改动时的定向人工验收覆盖，不保留独立常驻 E2E；上述数据库和 provider 检查不证明页面交互已验收。

## CI

PR CI 保留 `static`、`postgres`、`system` 三条 capability lane，按 L0–L4 风险分层运行最低且足够的 evidence：

- Draft 与 Ready PR 均使用同一个 Evidence Planner 根据 changed surface 计算所需的 affected capability 与 task。Draft PR 汇总为非 required 的 `draft-gate`，用于开发阶段快速反馈；Ready PR 产生 ruleset required 的 `ci-gate`，作为合并所需的代码正确性证据。Ready 状态不自动将测试深度升级为 FULL。
- 普通业务变更（L1 Static、L2 PostgreSQL）仅运行对应 affected tests，不再仅因涉及报名、队伍或页面重要性自动触发 Local Supabase / browser system flow。
- System（L3）仅在真实 Auth、Session、Storage provider 或 browser/provider glue 变更时进入 critical path。
- FULL（L4）不再是普通 Ready PR 或 `main` push 的默认行为，仅作为明确的收敛事件（CI/toolchain/harness/unknown/destructive 改动、手动 `workflow_dispatch` 或 nightly 定时收敛）。Release 直接消费 exact tag commit SHA 在 `main` 上的 canonical CI evidence，不在 production activation 后补跑第二套代码正确性 CI。
- `main` push 采用 changed-surface 规划 affected smoke，不默认重复执行 FULL。精确 planner 与 job 以 `.github/workflows/ci.yml`、`scripts/ci/plan.mjs` 为 authority，排障见 [`operations/ci.md`](./operations/ci.md)。

CI 只负责选择和阻断 evidence，不成为业务测试语义的第二 owner。全量 PostgreSQL 选择使用既有两片矩阵，包括 migration 要求全套 PG 但其它 capability 仍为 affected 的计划；显式小集合仍使用单片。两片保留全部文件且只执行一次，聚合门禁等待全部片并保留各自耗时证据，保留 180 秒实际执行关键路径预算。

速度验收按实际执行关键路径计算：串行 planner 与 capability lane 的执行时间相加，并行 matrix、独立 dependency job 取最长路径，最后加上 gate 在核验前已执行的耗时。各 job 依据当前 run attempt 的实际 step 时间计算，包含 runner setup、checkout、安装、环境启动、测试及已完成的 cleanup，不使用可能早于 runner 分配的 job `started_at`；job 排队和 step 间的平台调度空档不计入。gate 在读取计时 API 前冻结本地执行耗时，API 等待不占预算；核验后的报告上传与 runner post-cleanup 不属于预算截止点。原 workflow 总 wall time 继续独立记录用于诊断。普通修改争取 60 秒，数据库、真实系统与 FULL 回归仍由门禁强制执行 180 秒实际执行上限；缺失必需 job/step 的计时数据、无效时间或未知图节点会阻断，不按零耗时放行。删行数、测试数下降或调低 timeout 都不能代替真实 CI 成功记录。system 的 provider、production smoke 与受影响 browser 分片并行，gate 等待所有分片；每个 runner 拥有独立服务，场景内部使用独立账号与赛事。LIVE、系列比分修正、会话撤销各自独立分片；会话撤销复用测试声明的 auth 服务层，其余动态发现的 spec 最多分成七片；LIVE 保留真实断流、恢复、跨场导航和换图。浏览器验证这些真实任务，不声称精确证明 stale/unavailable 的时间边界。

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

Vitest 的三个 project（domain Node、server Node、React jsdom）是独立 evidence owner。测试转换器显式使用 React automatic JSX runtime；应用 TypeScript 配置继续保留 JSX 供 Next.js 编译，测试不继承其 JSX preserve 行为。FULL static 的三个 unit project 共用一个 runner，分别执行并分别记录证据，任一 project 失败仍阻断；affected 保持独立选择；affected static 将每个 source 交给全部 Vitest project 的 `related` 查找跨层消费者，而变更的 test 文件以匹配实际扩展名的 project 和显式 test path 直接运行；显式清单为空或没有发现测试必须失败。source 的相关消费者为空可以通过，但不能伪装成执行了测试。混合 source/test 修改取证据并集，新增测试不得缩窄既有 PG 或共享 E2E harness 的验证范围。React/jsdom 的异步交互测试使用 `userEvent.setup()` 和 awaited interaction，并分别等待元素存在与可交互状态；只有时间推进本身是被测 contract 时才使用 fake timers。`unit-react-jsdom` 仅在 GitHub Actions 中配置一次 `retry`，本地默认保持 `0`；static matrix 在独立 React task 或 FULL unit-all task 后执行 `scripts/ci/assert-no-flaky.mjs`，所以 retry-pass 仍会使 static job 失败。project 的 wall time 由外层 timing wrapper 记录，`vitest-timing-reporter.ts` 继续作为唯一 evidence producer，除 test count、failure/flaky count 和按文件排序的 diagnostic duration 外，为每个 flaky test 写入 project、file、full test name 与 retry count，不解析 console 文本伪造失败信息，也不把并发文件 duration 总和伪装成 project wall time。

对疑似 flake 的本地诊断可以显式运行 `pnpm exec vitest run --project unit-react-jsdom --retry 1 path/to/related.spec.tsx`；`repeats` 只作为聚焦诊断或手动/nightly 入口，不进入普通 PR 的 planner、required path 或 flaky allowlist。

System failure/flaky 时 Playwright 生成 failure screenshot；artifact sanitizer 只保留限额内的 PNG/JPEG 与脱敏文本，不上传 trace archive。文件数、目录项/深度、单文件/累计输入输出字节及行长预算由 `scripts/ci/system-artifact-sanitizer.mjs` 统一声明；超限整文件或整行跳过，`sanitization-summary.json` 只记录固定原因计数，不包含被跳过原文或路径。Next 日志先读取有界尾部、丢弃可能不完整的首行并选取最近行，再脱敏；存在多行环境密钥且截尾/过滤可能破坏完整匹配时，整份候选日志不上传。正常的小报告与重试计数保留，成功 run 不上传大体积 artifacts。每条 stateful E2E 使用自己的 fixture profile 与 attempt namespace。认证 helper 的 predicate URL 断言仍会等待 document load；SSR可见与load不证明hydration，真实UI/持久化结果由后续断言验证。外部遥测/资源加载和dev编译仍可能影响浏览器耗时，不将一次CI成功视作稳定性证明。

公开搜索的 required evidence 是一次真实 debounce/router/RSC 与历史恢复闭环。它不穷举共享输入组件的全部状态。`--repeat-each=10`、容量压测与截图不进入普通 PR 或 FULL required gate，也不得用 retry 隐藏失败。

核心浏览器通过 `pnpm test:e2e` 发现生命周期任务；production build/start smoke 使用 `pnpm test:e2e -- --config=playwright.production.config.ts`。容量、截图和视觉组合没有长期保留的独立 suite；需要时针对具体变化临时验证，并在 PR 记录命令、断言和结果。测试赛创建链路由 desktop project 拥有，同一用例内验证手机 viewport 的可达性。system 的 production smoke 检查真实 UI 登录、App Shell 导航、`aria-current` 和移动可达性；production 的 test-only auth route 仍关闭。

PostgreSQL harness 按稳定 `VITEST_POOL_ID` 为并发槽位分配独立数据库；不得用按文件递增的 worker ID 取模，无对应槽位必须失败。全库计数/覆盖率比较使用一致性 snapshot，fixture 写入不得依赖其他 suite 的状态。

## Spectator prediction acceptance

Pure tests retain integer pool conservation, the first-match deadline, and one upstream-choice invalidation/input-immutability oracle. Real PostgreSQL retains submission versions, server locks, idempotency, concurrent ALL IN, append-only records, official settlement/reversal/debt, account merge blockers and public-data isolation. Major runtime regression is required when shared pairing helpers change. Required browsers protect submission, independent draft restoration, real PNG download and point transactions through Local Supabase on mobile; shared flows are not repeated on desktop. Production App Shell navigation covers both viewports. Exhaustive profile/bracket/slot judgement and unrelated-playoff-branch matrices have no permanent oracle; changes to those rules need focused evidence, and ordinary browser success must not be described as replacing those assertions.

## Maintenance rules

- 新增长期测试必须说明用户/业务/安全承诺、具体失败风险、为何现有证据不足以及为何选择该层。临时验证可以留在 PR 证据中，不机械地为每个函数、组件或改动留下长期测试。
- 同一规则由最低足够真实的层拥有；跨层测试只保护拼装链路，不能复制规则矩阵。源码字符串、内部变量、DOM 层级、CSS class 与第三方库转发通常不是产品契约；权限边界静态规则、实际资产/provenance 和公开 DTO 则有独立价值。
- 数据库业务查询测试必须执行实际 query/service/Action owner，再检查持久化结果和拒绝后的事实不变；在测试内复制一份生产 SQL 不证明生产入口正确。纯数据库 CHECK/FK/RLS 的探针仍直接验证数据库契约。
- 合法产品变化先更新承诺再修改测试；重构不改变承诺却大量要求同步改断言时，先审查测试耦合。重复失败优先定位原因，不能以 skip、retry-pass、删负例换绿。
- `null`、失败、并发、权限和 recovery 等重要负路径必须由对应层证明。
- 清理测试时按独立承诺逐项处置，不能把静态扫描或全绿描述为逐断言审查完成。删除写法断言后若只剩固定文案或对象形状检查，继续评估整项删除；测试名称必须准确描述剩余保护。工作流安全门禁与应用/工具源码写法分开审查；前者保留，后者优先使用现有行为证据。
- 不在文档复制测试数、表数或 migration 数。
- 不能用“CI 绿”“已知 flaky”或视觉 demo 替代所需 evidence。
- canonical domain rule 尽量在其 owner 附近测试；跨层 E2E 只证明组合行为。

## Public match LIVE consumer evidence

`mizar-live-real-derived.json` retains the source Mizar commit and sanitized capture provenance. It was produced from Mizar's `real-live-rich` program and matching `dense-utility` radar fixture through `projectLiveSnapshotV1`. RivalHub's retained browser uses production ingest/public projection with that fixture; the capture does not prove that an NJU match was played.

`tests/e2e/flows/public-match-live.spec.ts` uses disposable Local Supabase facts and the existing private viewer endpoint. Its dedicated producer only rewrites local match/context IDs and delivery timestamps; it sends captured player/radar data at 1 Hz. Chromium checks private delivery, live scores, stale clock freezing, unavailable fallback, recovery, reload with a qualified previous table, new-frame replacement, cross-match navigation, icon failure and map changes. Retained deterministic tests protect new authoritative proof, context/map/source/login/schema matching, revoked-scope clearing and private token renewal/disposal. PostgreSQL protects source revision, identity/lineup/epoch fencing, completed-map rejection and scoped token admission. Cross-repo adapter/parser checks and the forced Local Supabase provider contract remain required for their affected surfaces. Exact age matrices, every delivery-reducer transition, cache storage-denial/two-match bounds and the detailed receiver-sharing lifecycle no longer have permanent deterministic oracles; the browser journey does not replace those assertions. These checks do not certify a production deployment, real operator handover or sustained capacity.


### 比赛领域命令的 production 检查根

独立比赛创建命令尚无产品调用入口，`knip.json` 保留 `src/lib/matches/creation.ts` 显式生产检查根，使 production 模式继续检查其依赖；不为通过检查添加无授权的路由或虚假调用，接入产品调用后再移除该显式根。结束/补录/更正命令已由管理员测试赛工作台经 `TestMatchConclusion` → `concludeTestMatch` 调用 `src/lib/matches/unassociated-result.ts`，随产品引用图纳入 production 检查，无需显式根。命令行为由真实数据库集成回归验证。

浏览器使用原 `/favicon.ico` 探测Next进程可用，不证明根布局或业务路由已编译。LIVE 在实际比赛页导航时先验证 document 状态并监听页面编译/运行异常，失败直接报告 HTTP 状态或异常及服务端诊断附件，不等待观众令牌超时。首页本身由 production smoke 验证。production 与 LIVE runner 仅启动 Auth、SQL（LIVE 另含 Realtime），provider 与上传路径仍启用 Storage/PostgREST。

依赖缓存使用包含 lockfile、workspace 和 runtime manifest 的稳定键；命中后不 prune/re-upload。缓存 miss 仍执行 frozen-lockfile 安装，不跳过依赖校验。


LIVE 浏览器只保留一条匿名本地公开赛的真实 Broadcast、断流恢复、详情→赛程列表→详情→刷新、跨场导航与换图链路；真实 Link 往返检查同场只有一次 channel join 且继续写入更晚合法帧，保护五秒 receiver 复用的 proof。正式赛/测试赛及赛事阶段的 token 准入矩阵由 `tests/integration/db/test-matches.test.ts` 调用真实 `issueLiveViewerToken` 查询 PostgreSQL 承接；provider contract 使用报名阶段已启动的官方 Play-in 本地事实，证明 viewer 查询、有效上传、真实 private Broadcast 及跨场/写入隔离；通常 playing 准入由 PostgreSQL 矩阵继续覆盖。

CI 使用固定 Supabase CLI 版本提供的官方 slim 镜像（对应相同上游服务版本），Kong 使用其官方 Docker Hub 上游镜像。CLI 镜像预拉取耗尽内部重试且明确返回 registry 限流时，启动入口最多再恢复两次并复用已下载镜像层；其它错误直接失败，所有尝试仍受原180秒实际执行截止约束。生产烟测按视口、BET读取按视图分片，覆盖集合保持完整且各执行一次。每次新建数据库、重放迁移并执行健康检查与 provider contract；不保存数据库或 Docker image tar 缓存。大镜像 tar 的远端加载实测比正常拉取更慢，已移除。
