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

涉及 App Router 的 Partial Prefetching、URL data Suspense boundary 或 instant navigation 的具体问题，需要浏览器验证时使用 production build/start；`next dev` 不执行 production automatic prefetch。普通公开目录的搜索、筛选、导航和布局按改动需要人工检查，不设常驻浏览器门禁。

DB unique/FK、transaction、row lock、migration/backfill 不用 mock 代替。浏览器测试验证用户任务，不重复穷举 pure domain rule。

教育认证保留真实 PostgreSQL 的提交并发、事务失败补偿、审核权限与材料到期删除证据；Local Supabase provider contract 验证私有 Storage 的服务端读写、匿名/普通用户拒绝及短期签名访问。录取通知书提交→新窗口查看→审核的完整浏览器交互由改动时的定向人工验收覆盖，不保留独立常驻 E2E；上述数据库和 provider 检查不证明页面交互已验收。

## CI

PR 与 `main` CI 按 L0–L4 风险分层选择 `static`、`postgres`、`system`。Draft 与 Ready 采用同一份计划，分别产生 `draft-gate` 与 required `ci-gate`；发布消费 exact tag SHA 在 `main` 的 canonical CI。普通改动把适用的类型、格式、lint、架构和单测放在一个静态 runner。PostgreSQL 使用真实 PG17，受影响的小集合单跑，完整集合保留两片。System 分别按需选择 provider、浏览器路径和 production smoke；桌面与移动的 production smoke 共用一次 build/start，各用独立 fixture 和 browser context。工具链、未知可执行面、merge queue 和手动运行保留 FULL。

速度以 required checks 实际等待时间为先。合并门禁另行强制 180 秒执行关键路径预算，扣除 runner 排队和平台调度等待；各环境累计执行时间仅用于诊断。具体选择、失败与计时语义见 [CI 运维](./operations/ci.md)。

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

Vitest 的 domain Node、server Node 与 React jsdom project 继续分开定义。测试使用 React automatic JSX runtime。CI 在同一次 Vitest invocation 内查找变更源码在各 project 的消费者；直接修改的测试按 project 与文件路径运行，未发现指定测试时阻断。React/jsdom 异步交互使用 `userEvent.setup()` 和 awaited interaction；只有时间推进本身是被测 contract 时使用 fake timers。Vitest 和 Playwright 普通门禁都运行一次；需要诊断时可以针对单个测试显式重试。

System 失败时保存有界、脱敏的 Next 日志和允许的截图、报告及场景记录，不上传 trace archive。每条 stateful E2E 使用独立的 fixture profile 与 attempt namespace。真实 UI 操作与持久化结果证明交互成功；SSR 可见和页面 load 仅证明文档到达。

统计目录、队伍目录、组队大厅和赛事阵容的公开搜索、筛选与历史导航不保留独立常驻 E2E，也不因共享搜索组件变更自动触发 browser lane。邀请接收、报名权限和正式名单完整性继续由各自高风险 owner 验证。`--repeat-each=10`、容量压测与截图不进入普通 PR 或 FULL required gate。

核心浏览器通过 `pnpm test:e2e` 发现生命周期任务；production build/start smoke 使用 `pnpm test:e2e -- --config=playwright.production.config.ts`。容量、截图和视觉组合没有长期保留的独立 suite；需要时针对具体变化临时验证，并在 PR 记录命令、断言和结果。测试赛创建链路由 desktop project 拥有，同一用例内验证手机 viewport 的可达性。system 的 production smoke 检查真实 UI 登录、App Shell 导航、`aria-current` 和移动可达性；production 的 test-only auth route 仍关闭。

PostgreSQL harness 按稳定 `VITEST_POOL_ID` 为并发槽位分配独立数据库；不得用按文件递增的 worker ID 取模，无对应槽位必须失败。全库计数/覆盖率比较使用一致性 snapshot，fixture 写入不得依赖其他 suite 的状态。

## Spectator prediction acceptance

Pure tests retain integer pool conservation, the first-match deadline, and one upstream-choice invalidation/input-immutability oracle. Real PostgreSQL retains submission versions, server locks, idempotency, concurrent ALL IN, append-only records, official settlement/reversal/debt, account merge blockers and public-data isolation. Major runtime regression is required when shared pairing helpers change. Required browsers protect submission, independent draft restoration, real PNG download and point transactions through Local Supabase on mobile; shared flows are not repeated on desktop. Production App Shell navigation covers both viewports. Exhaustive profile/bracket/slot judgement and unrelated-playoff-branch matrices have no permanent oracle; changes to those rules need focused evidence, and ordinary browser success must not be described as replacing those assertions.

BET 六视图的匿名、未加入与已加入数据隔离及读取规则由真实 PostgreSQL 验证，不再保留开发模式的全矩阵浏览器重复回归。production smoke 保留 `open`、`mine`、`event` 三个不同公共缓存参数组合的匿名/已加入 cold、warm 与 tag invalidation API 快照，以及相应 RSC 成功响应，继续覆盖真实登录和领取积分交互。已登录但未加入，以及 `settled`、`leaderboard`、`records` 的 GET/RSC 运行态组合没有独立常驻浏览器证据；相关 transport 改动按需定向验证，不能用 PostgreSQL 或其余 production 用例声称等价覆盖。RSC 响应状态与类型检查不证明其载荷隐私，也不声称量化缓存命中或过期行为。

## Maintenance rules

- 新增长期测试必须说明用户/业务/安全承诺、具体失败风险、为何现有证据不足以及为何选择该层。临时验证可以留在 PR 证据中，不机械地为每个函数、组件或改动留下长期测试。
- 同一规则由最低足够真实的层拥有；跨层测试只保护拼装链路，不能复制规则矩阵。源码字符串、内部变量、DOM 层级、CSS class 与第三方库转发通常不是产品契约；权限边界静态规则、实际资产/provenance 和公开 DTO 则有独立价值。
- 数据库业务查询测试必须执行实际 query/service/Action owner，再检查持久化结果和拒绝后的事实不变；在测试内复制一份生产 SQL 不证明生产入口正确。纯数据库 CHECK/FK/RLS 的探针仍直接验证数据库契约。
- 合法产品变化先更新承诺再修改测试；重构不改变承诺却大量要求同步改断言时，先审查测试耦合。重复失败优先定位原因，不能以 skip、retry-pass、删负例换绿。
- `null`、失败、并发、权限和 recovery 等重要负路径必须由对应层证明。
- 清理测试时按独立承诺逐项处置，同时删除仅被退役 suite 使用的脚本、fixture、快照、配置引用与 CI 分片，不能只停止执行并留下死测试。不能把静态扫描或全绿描述为逐断言审查完成。删除写法断言后若只剩固定文案或对象形状检查，继续评估整项删除；测试名称必须准确描述剩余保护。工作流安全门禁与应用/工具源码写法分开审查；前者保留，后者优先使用现有行为证据。
- 不在文档复制测试数、表数或 migration 数。
- 不能用“CI 绿”“已知 flaky”或视觉 demo 替代所需 evidence。
- canonical domain rule 尽量在其 owner 附近测试；跨层 E2E 只证明组合行为。

## Public match LIVE consumer evidence

`mizar-live-real-derived.json` retains the source Mizar commit and sanitized capture provenance. It was produced from Mizar's `real-live-rich` program and matching `dense-utility` radar fixture through `projectLiveSnapshotV1`. The fixture is available for targeted LIVE verification through production ingest/public projection; the capture does not prove that an NJU match was played.

公开比赛 LIVE 不保留独立常驻浏览器 E2E。相关交互改动按需人工验收真实 Broadcast、实时比分、断流与恢复、详情与赛程导航、刷新后的上次画面、跨场隔离及换图；数据库或 provider 检查不替代这份 UI 验收。既有确定性测试继续保护 authoritative proof、context/map/source/login/schema 匹配、撤销 scope 清理，以及私有 token 的更新与释放。PostgreSQL 继续保护 source revision、identity/lineup/epoch fencing、已结束地图拒绝与 scoped token admission；跨仓 adapter/parser 和受迫 Local Supabase provider contract 继续按受影响 surface 执行。精确 age matrix、全部 delivery-reducer transition、storage-denial/two-match bound 和详细 receiver-sharing lifecycle 没有常驻确定性 oracle；这些证据不认证生产部署、真实赛务交接或持续容量。


### 比赛领域命令的 production 检查根

独立比赛创建命令尚无产品调用入口，`knip.json` 保留 `src/lib/matches/creation.ts` 显式生产检查根，使 production 模式继续检查其依赖；不为通过检查添加无授权的路由或虚假调用，接入产品调用后再移除该显式根。结束/补录/更正命令已由管理员测试赛工作台经 `TestMatchConclusion` → `concludeTestMatch` 调用 `src/lib/matches/unassociated-result.ts`，随产品引用图纳入 production 检查，无需显式根。命令行为由真实数据库集成回归验证。

浏览器使用原 `/favicon.ico` 探测 Next 进程可用，不证明根布局或业务路由已编译。首页本身由 production smoke 验证。production runner 仅启动 Auth、SQL，provider 与上传路径仍启用 Storage/PostgREST；LIVE provider evidence 继续启用 Realtime。

依赖缓存使用包含 lockfile、workspace 和 runtime manifest 的稳定键；命中后不 prune/re-upload。缓存 miss 仍执行 frozen-lockfile 安装，不跳过依赖校验。


正式赛/测试赛及赛事阶段的 token 准入矩阵由 `tests/integration/db/test-matches.test.ts` 调用真实 `issueLiveViewerToken` 查询 PostgreSQL 承接；provider contract 使用报名阶段已启动的官方 Play-in 本地事实，证明 viewer 查询、有效上传、真实 private Broadcast 及跨场/写入隔离；通常 playing 准入由 PostgreSQL 矩阵继续覆盖。

CI 使用固定 Supabase CLI 版本提供的官方 slim 镜像（对应相同上游服务版本），Kong 使用其官方 Docker Hub 上游镜像。CLI 镜像预拉取耗尽内部重试且明确返回 registry 限流时，启动入口最多再恢复两次并复用已下载镜像层；其它错误直接失败，所有尝试仍受原180秒实际执行截止约束。生产烟测按视口分片。每次新建数据库、重放迁移并执行健康检查与 provider contract；不保存数据库或 Docker image tar 缓存。大镜像 tar 的远端加载实测比正常拉取更慢，已移除。
