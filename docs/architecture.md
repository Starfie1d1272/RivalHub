# RivalHub 技术架构

本文件只描述跨模块稳定边界。领域事实见 [`domain-model.md`](./domain-model.md)，生命周期见 [`workflows.md`](./workflows.md)，精确实现以 code/schema/tests 为准。

## System shape

RivalHub 使用 Next.js App Router、TypeScript、Drizzle/PostgreSQL 与 Supabase。页面默认是 Server Components；first-party mutation 通常通过 Server Actions，协议型 HTTP integration 可使用 Route Handler，但都必须委托同一个 canonical domain operation。

```text
Browser
  └─ Next.js App Router
       ├─ Server Components ───────────────┐
       ├─ Server Actions / Route Handlers ─┼─ canonical domain owner
       └─ Client islands                   │     ├─ Drizzle → PostgreSQL
                                           │     └─ Supabase Auth / Storage
                                           └─ explicit public projection
```

客户端负责交互，不拥有持久化业务规则。数据库、secret、privileged SDK、复杂事务、资格、赛制和恢复逻辑保持 server-only。

## Application boundaries

### Entrypoint vs domain owner

Entrypoint 负责不可信输入、鉴权、transport result 和 revalidation；可复用的规则或 transaction workflow 进入明确的 canonical owner。相同 transition、derived fact、validation 或 formatter 不在 page/action/component 中复制第二份。

预期业务结果统一使用 `ActionResult<T>`；unexpected runtime failure 进入 canonical observability，而不是把 exception 当业务状态。

### Stable dependency direction

跨领域依赖沿着稳定的业务方向收敛：

```text
Identity / Catalog
        ↓
Competition Definition
        ↓
Participation
        ↓
Tournament Runtime
        ↓
Match / Official Result
        ↓
History / Analytics / Spectator
```

Page、Server Action、Route Handler 和 Client Component 是 entrypoint/presentation 层，只调用 canonical `src/lib/` owner；`src/lib/` domain/library 代码不得反向依赖 `src/actions/`、`src/app/` 或 `src/components/`。Client graph 只能通过 `use server` action boundary 进入 server workflow，不能到达数据库、secret/provider owner 或 server-only observability facade。

这条方向由 `pnpm architecture:check` 执行检查。检查器读取项目 tsconfig 并使用 TypeScript module resolver 解析 alias、relative 和 runtime dynamic import；Client→Server 泄漏只沿 runtime graph 检查，而 canonical third-party provider ownership 连 type-only edge 也 fail closed。DTO/serializer 的字段泄漏仍由对应 serializer tests 负责。

### Public data

```text
DB/internal facts
→ server-only query/domain logic
→ explicit public DTO/read model
→ public RSC payload / Client props
```

Public profile routes compose server-only read models; scope selection and derived metrics stay in the read model instead of the route entrypoint.

公开赛事、选手生涯、长期队伍与赛事队伍统计共同消费经过确认的每图统计投影。Demo 晋级 owner 在同一事务中保存版本化 `match_demo_stat_projections`，复用 DAK 的中间统计与组合规则；来源 import、Evidence revision、身份绑定和计算版本共同决定投影是否适用。原始 Evidence 保留用于审计、重检及显式回填；公开冷读只加载有效投影，不回退读取完整 payload。身份撤销或账号归并在原事务中将依赖旧归属的 import 标为待重检，避免已撤销的事实继续进入公开统计。Demo 提交、重检、补建与 gameplay identity 变更共用 `src/lib/identity/write-lock.ts` 的事务级排他 gate；先取 identity gate，再取地图 lineage、user/season 及业务行锁，持有到提交。管理员补身份再确认复用同一 gate，不做共享锁升级；公开读不取该锁。这样撤销必定先于确认校验，或在确认提交后扫描到并使其待重检。

公开页面默认不暴露 email、QQ、`studentId`、`authId`、管理员授权范围、教育证据或内部备注。不能把内部查询对象直接序列化给浏览器。

公开导航使用 app-level Partial Prefetching；`params` / `searchParams` 驱动的内容留在最小 Suspense 区域，使同一路由可以复用 URL 无关的 shell。公开统计和编译后的全站基准通过 `use cache: remote` 使用部署平台的共享运行时缓存；普通 `use cache` 的实例内存不能作为跨实例或长期保存保证。所有统计组合结果共享语义统计 tag；Demo、正式赛果、阵容、身份、参赛归属、公开状态和展示身份变更都使它失效。Server Action 使用 `updateTag()`，Route Handler、webhook 与 scheduler 使用 `revalidateTag(tag, { expire: 0 })`，撤回或归属更正不返回旧统计。队伍邀请的发送、拒绝、撤销只刷新邀请 UI，不失效统计；队伍资料、Logo 与成员/队长变更继续保守失效统计。公开玩家资料与招募列表通过独立竞技目录 tag 共享只读目录，目录 mutation 提交后立即失效；资格校验、管理页与发布冻结继续使用直接/事务内读取。公开赛事目录与 slug lookup 使用 remote cache，保留短生命周期和 draft 授权隔离。允许短时旧值的非统计 read model 才使用 `revalidateTag(tag, "max")`。

session、authorization、admin 与 draft facts 不进入共享 public cache；统计缓存外读取 fresh public membership；平台/单届聚合的 key 包含规范化 scope、有效公开赛事集合以及投影/规则版本。撤回公开状态或新增公开赛事改变 membership key；域 mutation 仍通过同一个 semantic tag 立即失效全部统计、benchmark、Records 和 Insights。单次 repeatable-read 聚合再次限定公开范围，实体文本搜索不进入共享缓存 key。Records分页仅在共享aggregate后的最大值并列集合切片，不用页码生成完整聚合缓存变体；全并列集合留服务器。公共 DTO 只发送当前 tab 的聚合摘要和有界纪录页，不发送历史逐图 payload 或 internal provenance。授权草稿读取绕过共享缓存，request boundary 由 `cookies()` / `headers()` 提供。公开身份页面将个人操作与共享统计分开，统计依赖暂时不可用时保留基础资料并明确显示不可用，不把失败解释为零样本，也不绕过远程缓存重新放大源站读取。需要保持 production build 与 runtime 数据源隔离、由首次 runtime request 填充的 public cache，可在最小 Suspense leaf 使用 `io()`；它不会把真实 request / prefetch 推迟到完整 navigation。`connection()` 只用于确实要求真实用户 navigation 的语义。

### Persistence

- `src/db/schema/` 表达当前应用 schema；`drizzle/migrations/` 是唯一 active migration chain。
- `pnpm db:push` 被阻止；远程 schema write 只能走受保护的 staging/release path。
- 应用代码通过 server-only DB facade 取得 Drizzle client；CLI/runtime exception 使用显式共享 runtime boundary。Pool query 仅对明确建立连接前的失败自动重试一次；连接中断导致结果不明时记录告警并向调用方抛错，不依据 SQL 首词重放，后续恢复由 command 的幂等/状态回读契约负责。显式事务不自动重跑。
- Pool-level `DB` 可以并行执行互相独立的查询；单个 transaction 的 `TxDb` 共用一个 `pg.Client`，查询必须逐个 `await`，或合并为单条 SQL，不能在同一事务上用 `Promise.all` / `Promise.allSettled` 重叠执行。需要同时支持 pool 与 transaction 的 read model 必须暴露明确分开的 pool / `InTx` 执行入口，不能只依赖 TypeScript 结构类型收窄来区分执行器。
- 需要历史复现、审计或恢复的 snapshot 是领域事实，不因与 live data 重复而去重。

## Competition architecture

赛事由 capability 驱动，而不是按 `seasons.kind` 写业务分支。报名模式、投票/选秀、社区奖、阶段计划、名单与资格规则都来自 persisted capability/config；`competitionTemplate` 只负责内置模板身份与固定语义。

当前两个内置体系共享账号、Team、CompetitionEntry、Match、审计和数据基础设施：

| 体系 | 参与模型 | 专属运行时 |
| --- | --- | --- |
| Rivals | 个人报名后形成赛事原生 CompetitionEntry | 投票、选秀、循环赛/双败流程 |
| Major | 长期 Team 创建 CompetitionEntry | Qualification、赛前冻结、managed StageRun、Swiss/Playoffs、恢复与赛后事实 |

具体赛制属于赛事政策和 stage/runtime owner，不在架构文档复制当前轮次、人数或 BO 数字。

Season capability 的代码 ownership 固定为：`src/types/season.ts` 只表达 canonical data contract；`src/lib/competition/templates.ts` 只拥有当前内置赛事默认值；`src/lib/config/cs2-maps.ts` 拥有稳定地图目录与当前 Active Duty 轮换，`src/lib/config/cs2-positions.ts` 拥有位置目录；`src/lib/seasons/compatibility.ts` 只把 legacy/partial persisted shape 投影为 canonical shape；`src/lib/seasons/presentation.ts` 拥有 Season status、报名排期、player type 和 stage type 展示标签；`src/lib/maps.ts` 拥有地图展示与偏好 projection。current template 不依赖 historical compatibility fallback，frozen event facts 也不因 current preset/catalog 变化被重新解释。

## Runtime truth

定义态、报名态和运行态不能互相覆盖：

```text
Season capability/config
        ↓ open/freeze
CompetitionEntry / EventRoster
        ↓ start
StageRun + frozen rule/eligibility facts
        ↓ matches
official Match / Map facts
        ↓ finalize
FinalResult / adjudication / honor
```

Major runtime 的阶段参与者和已完成比赛是推进依据；standings、后台摘要和其它 UI projection 只是 read model。比赛更正如果影响下游配对，必须经过受控 recovery，而不是直接改 projection。

Match runtime 由 `src/lib/match-rosters/` 的阵容与开赛 transition、`src/lib/matches/` 的排期/覆盖名额/官方结果共同组成。地图结果只有一个 canonical owner，人工录入与后续经过校验的可靠数据源调用同一入口；`matches.startedAt` 是进入 `in_progress` 的 BP/赛务时间事实；`gameplayStartedAt` 与 `match_maps.startedAt` 分别永久记录实际对局与单图开始，可靠开图和人工确认共用 canonical owner，不从排期或 BP 完成时间推断。 RivalHub ↔ Mizar 的机器接口由 `src/lib/mizar/` 拥有：赛事管理员授权一次赛事级 installation credential 后，Mizar 只能经 server-only provider 读取该赛事的 Tournament Context 与赛程窗口，不能直连赛事数据库。Mizar 的可靠事件与实时画面都必须先通过 installation、比赛、authority revision、session、generation、map epoch、序列、身份与首发证据校验；可靠事件只是候选，官方地图结果仍由唯一 canonical result owner 在事务内写入，实时画面只作为短暂投递，不进入 PostgreSQL 历史。 LIVE 接收采用有界未解析入口等待、按凭据与比赛轮转的进程准入、比赛级 try-advisory transaction gate 与短锁等待预算；解析后的帧不排队，拒绝即丢弃。发送仍位于 installation / match / source authority 行锁内，只有未订阅 channel 的清理在事务结束后执行。近期 cursor 元数据仅用于有界节流/丢弃，不替代授权或跨实例事实；不明投递不重试，下一份 heartbeat 恢复。LIVE 响应的 `accepted` 表达应用接受；拒收可附带有限 `reason`：`capacity`、`frame_expired`、`contended`、`delivery_dropped` 表达可丢帧，`broadcast_unavailable` 表达广播失败。旧客户端可忽略附加字段，新客户端对无原因的旧响应只能报告未知拒收；此结果不承担可靠事件 ACK。广播诊断仅保留请求阶段、HTTP 状态（若有）、耗时和有限分类，取消响应体且不保存载荷、凭据或上游错误正文。测量、并发不变量及容量预算见 [`LIVE 接收容量`](operations/live-capacity.md)。

公开浏览器 consumer 在 `src/lib/mizar/live-viewer.ts` 管理单场连接、续期、退订与前后台恢复，经 Auth adapter 创建独立 receive-only client；连接状态区分正在连接、订阅后等待新帧与无法订阅，失败后有界自动恢复，重连保留拒绝旧帧的 watermark；详情页地图卡与实时区共用一份连接，赛程页先批量加载 public phase/context，再仅为视口内 gameplay 比赛行订阅，移出视口或离开页面即退订；delivery reducer 用 monotonic 接收时间判定 freshness，按 authority/generation/epoch/sequence 和新 heartbeat 时间拒绝旧投递。共享 Radar 只消费 `fromPublicRadar`，Mizar 继续唯一拥有坐标与楼层标定，CSS 和地图/图标由精确锁定的 npm 包随安装复制到版本化 public 路径。

通用 Stage 的 logical identity 是 `(seasonId, StageConfig.key)`；`StageConfig.name` 只用于展示。`brackets-manager` 只能经 `src/lib/bracket/` adapter 使用，每个 provider-backed Stage 独立拥有 `(competition_id, stage_key)` 状态，provider stage name 和 numeric participant id 不得扩散成领域 contract。参与者必须携带稳定的 `rivalhubEntryId`，比赛解析只消费该 metadata。

Major Swiss 不经过通用 provider adapter：它由 `majorStageEntrants`、official managed matches 和 StageRun 的 `finalizedRound` 投影，配对与晋级继续由 `src/lib/major/swiss.ts` / runtime owner 决定。Qualification 使用独立 run 与 Qualification-owned manual matches；它不属于 Season StagePlan 或 Major StageRun。`src/lib/swiss/` 只投影 canonical 赛果、W/L、对手、BU、状态和排名，并提供配对 building blocks；每种赛事自己的 policy 验证完整轮次、战绩组限制、轮次上限与 bye/floater 语义。

## Spectator predictions

`src/lib/predictions/` composes a public Prediction/Pick’Em read model with discriminated Major and Qualification contexts. Major simulation reuses the canonical Swiss, seeding and playoff rules; Play-in simulation is owned by `src/lib/competition-qualification/` and reuses Short Swiss pairing/projection and shared official-history validation. Prediction choices live only in browser memory and never write official matches or scenarios. Baselines expose only stage rules, entrant identities, display fields and official results; frozen eligibility/roster facts remain private. The Pick’Em transport excludes Bet balances, markets and ledgers. Official seed confirmation and phase transitions synchronously publish policy-derived Pick’Em windows; the durable official-fact outbox reconciles corrections. Public reads never create windows. A window may precede its StageRun and binds it only when the official entrant set matches. `src/lib/bet/` independently owns the BET catalog, read model, admission and append-only financial facts in `bet_*` tables. It does not require a Pick’Em program; the shared scheduler runner consumes separate durable Bet work.

Prediction mutations serialize by canonical user → season lifecycle guard → relevant official match rows → prediction outbox → event program. Settlement workers read official facts without taking tournament row locks. Lightweight triggers enqueue durable work in the same transaction as official edits and permanently close affected windows; settlement failures leave retryable work and do not execute inside official result transactions. The protected reconciliation endpoint runs through the shared scheduler registry/execution/health owner; its worker and authorized mutations consume the same reconciliation owner. Spectator reads run in read-only repeatable-read transactions and never reconcile or acquire program/outbox row locks. Simulation, pools and records select their own projections: simulation reads only the current spectator’s picks, pools aggregate stakes in PostgreSQL, and achievement/leaderboard work is reserved for the records view. Deadline expiry is projected as closed immediately while durable locking and settlement remain worker/mutation responsibilities. Partial worker failure is reported to scheduler health, and no parser or Demo submission can directly settle a market. Browser clocks are presentation only.

## Security and operations

- Supabase Auth 管理邮箱凭据；应用 session 只保存身份，当前角色和 season grants 每次从数据库读取。
- 业务表默认 server-only；Data API/RLS terminal contract 见生成式 [`security/database-access-matrix.md`](./security/database-access-matrix.md)。新增 direct browser Data API 或 Realtime surface 必须同时定义最小 GRANT/RLS、consumer、一致性语义和正反例测试。
- 管理 mutation 产生 `audit_logs` 业务审计；runtime logs/traces 由 `src/lib/observability/` 独立拥有。
- 业务关键 scheduler 由 shared registry、Supabase primary dispatch、现有 Cron endpoint runner 和有界 health projection 组成；数据库 dispatch 只负责唤醒，不复制 domain transition。GitHub watchdog、participant opening recovery 和 super-admin break-glass 都复用同一 execution/domain owner。
- local / preview / staging / production 的写权限严格分离，见 [`deployment.md`](./deployment.md)。
- 时间持久化使用 UTC；产品展示按约定时区转换。

## Stable code areas

这里只维护长期边界，不列逐文件 inventory：

| 领域 | 主要区域 |
| --- | --- |
| Auth / permissions | `src/lib/auth/`, auth actions/routes |
| Season contract / templates / compatibility | `src/types/season.ts`, `src/lib/competition/templates.ts`, `src/lib/seasons/compatibility.ts`, `src/lib/seasons/presentation.ts` |
| CS2 map / position catalogs | `src/lib/config/cs2-maps.ts`, `src/lib/config/cs2-positions.ts`, `src/lib/maps.ts` |
| Identity / education / competitive | `src/lib/identity/`, `src/lib/competitive/`, `src/lib/qualification/` |
| Teams / CompetitionEntry / recruitment | `src/lib/teams/`, `src/lib/competition-entries/`, `src/lib/recruitment/` |
| Admin platform operations read model | `src/lib/admin/platform-operations/` |
| Rivals voting / draft | `src/lib/captains/`, `src/lib/draft/`, corresponding actions |
| Major prestart / runtime | `src/lib/major/` |
| Spectator predictions / points | `src/lib/predictions/` |
| Match / roster / result | `src/lib/matches/`, `src/lib/match-rosters/`, match actions |
| Discipline / post-event / awards | corresponding `src/lib/` domain owners |
| Scheduler / background recovery | `src/lib/scheduler/`, `src/lib/seasons/registration-recovery.ts`, protected `scripts/db/scheduler.ts` |
| Persistence / migration | `src/db/schema/`, `drizzle/migrations/` |

需要具体 owner 时先 repository search，再沿 tests 和 callers 确认；不要把本表扩成实时文件清单。
