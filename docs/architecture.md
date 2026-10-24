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

Page、Server Action、Route Handler 和 Client Component 是 entrypoint/presentation 层，只调用 canonical `src/lib/` owner；`src/lib/` domain/library 代码不得反向依赖 `src/actions/`、`src/app/` 或 `src/components/`。Client graph 不能到达数据库、secret/provider owner 或 server-only observability facade。mutation 经 `use server` action boundary；BET/Pick’Em 的高频私有只读通过显式 DTO 的 GET transport 委托同一个 canonical reader，客户端薄封装只持请求参数、取消信号与响应类型，不导入 server workflow。

这条方向由 `pnpm architecture:check` 执行检查。检查器读取项目 tsconfig 并使用 TypeScript module resolver 解析 alias、relative 和 runtime dynamic import；Client→Server 泄漏只沿 runtime graph 检查，而 canonical third-party provider ownership 连 type-only edge 也 fail closed。DTO/serializer 的字段泄漏仍由对应 serializer tests 负责。

### Public data

```text
DB/internal facts
→ server-only query/domain logic
→ explicit public DTO/read model
→ public RSC payload / Client props
```

Public profile routes compose server-only read models; scope selection and derived metrics stay in the read model instead of the route entrypoint.

赛事阶段 read model 在 React Server Component 单次请求内，按赛事 ID 与模板复用 StageRun、正式比赛阶段和资格赛事实读取；每个调用仍使用自己的赛事 stagePlan 生成展示。此请求级复用由 `src/lib/seasons/public-stage.ts` 拥有，请求结束后失效，不产生跨用户或跨请求的业务状态缓存。

公开赛事、选手生涯、长期队伍与赛事队伍统计共同消费经过确认的每图统计投影。Demo 晋级 owner 在同一事务中保存版本化 `match_demo_stat_projections`，复用 DAK 的中间统计与组合规则；来源 import、Evidence revision、身份绑定和计算版本共同决定投影是否适用。原始 Evidence 保留用于审计、重检及显式回填；公开冷读只加载有效投影，不回退读取完整 payload。身份撤销或账号归并在原事务中将依赖旧归属的 import 标为待重检，避免已撤销的事实继续进入公开统计。Demo 提交、重检、补建与 gameplay identity 变更共用 `src/lib/identity/write-lock.ts` 的事务级排他 gate；先取 identity gate，再取地图 lineage、user/season 及业务行锁，持有到提交。管理员补身份再确认复用同一 gate，不做共享锁升级；公开读不取该锁。这样撤销必定先于确认校验，或在确认提交后扫描到并使其待重检。

公开页面默认不暴露 email、QQ、`studentId`、`authId`、管理员授权范围、教育证据或内部备注。不能把内部查询对象直接序列化给浏览器。

比赛详情先流式返回已完成可见性校验的对阵与比分，基础比分、高级选手统计、MVP、阵容生涯与赛前分析按真实依赖独立完成；默认高级统计仍自动加载，未到齐的权限不开放操作。赛程按共享冻结阶段目录解析 URL，只读取和序列化所选阶段，Play-in 复用输入时重新校验赛事、run 与 ownership。公开比赛/赛程每 15 秒在可见标签页读取单语句事实指纹，未变时不重建 RSC；地图、赛果、更正、名单与阶段变化触发 canonical 刷新，每两分钟完整同步辅助和全局资料。该指纹不是业务 revision、授权或共享缓存；每次 action 仍检查赛事可见性。赛程的独立池级读取并行，单事务内仍串行。公开目录使用 canonical 结果摘要并分组流式返回，历史每页最多 12 场赛事；公告历史每页 20 条完整正文，最新项独立有界读取。公开导航使用 app-level Partial Prefetching；`params` / `searchParams` 驱动的内容留在最小 Suspense 区域，使同一路由可以复用 URL 无关的 shell。首页公共投影、公共选手资料、已发布公告候选和赛事公开介绍复用部署平台已有的 remote cache，保留各自生命周期、DTO 与语义 tag；公告候选仅按公共 scope 缓存，分钟截止筛选在缓存外执行。展示身份与身份归并同时失效选手和首页投影；报名审核也立即失效首页。草稿赛事介绍仅在共享缓存外授权后直接读取；公开公告排除草稿赛事，发布、撤回、删除与名称/slug 修改由赛事 action 精确失效公告和介绍 tag；比赛/BP 与赛程更新不驱逐这两个缓存。删除与关闭后的失效先于外部存储清理，清理失败不保留旧公开内容。规则文件的纯本地缓存不变。公开统计和编译后的全站基准通过 `use cache: remote` 使用部署平台的共享运行时缓存；普通 `use cache` 的实例内存不能作为跨实例或长期保存保证。所有统计组合结果共享语义统计 tag；Demo、正式赛果、阵容、身份、参赛归属、公开状态和展示身份变更都使它失效。Server Action 使用 `updateTag()`，Route Handler、webhook 与 scheduler 使用 `revalidateTag(tag, { expire: 0 })`，撤回或归属更正不返回旧统计。队伍邀请的发送、拒绝、撤销只刷新邀请 UI，不失效统计；队伍资料、Logo 与成员/队长变更继续保守失效统计。公开玩家资料与招募列表通过独立竞技目录 tag 共享只读目录，目录 mutation 提交后立即失效；资格校验、管理页与发布冻结继续使用直接/事务内读取。公开赛事目录与 slug lookup 使用 remote cache，保留短生命周期和 draft 授权隔离。允许短时旧值的非统计 read model 才使用 `revalidateTag(tag, "max")`。

session、authorization、admin 与 draft facts 不进入共享 public cache；统计缓存外读取 fresh public membership；平台/单届聚合的 key 包含规范化 scope、有效公开赛事集合以及投影/规则版本。撤回公开状态或新增公开赛事改变 membership key；域 mutation 仍通过同一个 semantic tag 立即失效全部统计、benchmark、Records 和 Insights。单次 repeatable-read 聚合再次限定公开范围，实体文本搜索不进入共享缓存 key。Records分页仅在共享aggregate后的最大值并列集合切片，不用页码生成完整聚合缓存变体；全并列集合留服务器。统计 reader 按当前 tab 选择投影和计算：非纪录视图不读取纪录候选，Insights 只在概览构造；DAK 的 opaque performance accumulator 在需要时保持完整。公共 DTO 使用按 tab 区分的显式结构，概览在完整人口上确定样本门槛和排名后只发送 top 5、地图与情境摘要；纪录仍是有界页，全并列集合留服务端。不发送历史逐图 payload 或 internal provenance。统计中心的 Client shell 按当前 tab 动态加载视图组件，保留服务端预渲染；视图拆分不改变统计读取与授权边界。授权草稿读取绕过共享缓存，request boundary 由 `cookies()` / `headers()` 提供。公开身份页面将个人操作与共享统计分开，统计依赖暂时不可用时保留基础资料并明确显示不可用，不把失败解释为零样本，也不绕过远程缓存重新放大源站读取。依赖错误在统计缓存内部按原始 cause 分类，并通过固定、无业务数据的 digest 保留 production Flight 边界后的可降级语义；缓存外才转换为模块不可用，缓存内部仍抛错，不保存成功的空统计。程序错误继续传播。需要保持 production build 与 runtime 数据源隔离、由首次 runtime request 填充的 public cache，可在最小 Suspense leaf 使用 `io()`；它不会把真实 request / prefetch 推迟到完整 navigation。`connection()` 只用于确实要求真实用户 navigation 的语义。

### Persistence

- `src/db/schema/` 表达当前应用 schema；`drizzle/migrations/` 是唯一 active migration chain。
- `pnpm db:push` 被阻止；远程 schema write 只能走受保护的 staging/release path。
- 常驻 Node 与 Vercel serverless 使用各自有界的应用连接池；连接获取覆盖普通查询与显式事务，慢获取/失败保留耗时、入队前池计数及复用/建连/排队状态。事务内读取优先合并 SQL，避免跨区往返长期占用连接。
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

Match runtime 由 `src/lib/match-rosters/` 的阵容与开赛 transition、`src/lib/matches/` 的排期/覆盖名额/官方结果共同组成。地图结果只有一个 canonical owner，人工录入与后续经过校验的可靠数据源调用同一入口；`matches.startedAt` 是进入 `in_progress` 的 BP/赛务时间事实；`gameplayStartedAt` 与 `match_maps.startedAt` 分别永久记录实际对局与单图开始，可靠开图和人工确认共用 canonical owner，不从排期或 BP 完成时间推断。 RivalHub ↔ Mizar 的机器接口由 `src/lib/mizar/` 拥有：赛事管理员授权一次赛事级 installation credential 后，Mizar 只能经 server-only provider 读取该赛事的 Tournament Context 与赛程窗口，不能直连赛事数据库。Mizar 的可靠事件与实时画面都必须先通过 installation、比赛、authority revision、session、generation、map epoch、序列、身份与首发证据校验；可靠事件只是候选，官方地图结果仍由唯一 canonical result owner 在事务内写入，实时画面只作为短暂投递，不进入 PostgreSQL 历史。 LIVE 接收采用有界未解析入口等待、按凭据与比赛轮转的进程准入、比赛级 try-advisory transaction gate 与短锁等待预算；解析后的帧不排队，拒绝即丢弃。发送仍位于 installation / match / source authority 行锁内，只有未订阅 channel 的清理在事务结束后执行。名单差异不等于参赛资格：机器请求可显式允许十个唯一现场账号建立来源；只有新鲜、明确 roster-only 的 matched/degraded 证据、已确认的 CT/T 队伍及本场当前地图才允许公开实时展示。此分支复用 source 的 lineup review_required 状态，关闭自动赛果，仅绑定 session 的展示地图，不修改固定首发、正式开局/地图结果、统计或竞猜结算；临时账号使用现场身份，公开关联按正式 Steam64 精确核对。此待核实状态贯穿同一来源会话及 generation/epoch 变化，matched 事件不能重新开启自动裁定；仅在观察到本图结束并推进 epoch 后展示紧邻计划图，不跳图且不补写正式比分。没有此显式证据的旧协议、错误比赛/地图、来源变化与不完整/重复名单继续拒绝。近期 cursor 元数据仅用于有界节流/丢弃，不替代授权或跨实例事实；不明投递不重试，下一份 heartbeat 恢复。LIVE 响应的 `accepted` 表达应用接受；拒收可附带有限 `reason`：`capacity`、`frame_expired`、`contended`、`delivery_dropped` 表达可丢帧，`broadcast_unavailable` 表达广播失败。旧客户端可忽略附加字段，新客户端对无原因的旧响应只能报告未知拒收；此结果不承担可靠事件 ACK。广播诊断仅保留请求阶段、HTTP 状态（若有）、耗时、有限分类以及经 canonical redaction 有界提取的异常名称与 cause 链错误 code；在 SDK 包装前保留传输元数据，不保存错误 message/stack。取消响应体且不保存载荷、凭据或上游错误正文，不为诊断延长事务。测量、并发不变量及容量预算见 [`LIVE 接收容量`](operations/live-capacity.md)。

公开浏览器 consumer 在 `src/lib/mizar/live-viewer.ts` 管理单场连接、续期、退订与前后台恢复，经 Auth adapter 创建独立 receive-only client；`live-viewer-subscriptions.ts` 在同一浏览器模块内按 matchId 共享仍运行的匿名公开 receiver，最后一个 consumer 离开后最多保留 5 秒，快速重进时直接观察仍在接收的状态，保留原 monotonic 收帧时间，不刷新 freshness。连接停止即删除 receiver 状态，不保存 token、Auth 身份或 live watermark；独立 `live-previous-view.ts` 仅在同一标签页 sessionStorage 保存最多两场匿名公开计分表，按原服务端收帧时间最多使用 30 秒。现有 no-store viewer 查询提供当前公开资格、真实 gameplay/map start 和 opaque context revision；刷新后必须先取得相同比赛、地图、来源及登录分区的 fresh proof，未知或失效即清除。回显只标为「上次画面 / 连接中」，没有时钟、雷达或实时身份链接，不进入事件 reducer；合法新帧优先。此公开 receiver 不持有登录身份或后台私有数据；连接状态区分正在连接、订阅后等待新帧与无法订阅，失败后有界自动恢复，重连保留拒绝旧帧的 watermark；详情页地图卡与实时区共用一份连接，赛程页先批量加载 public phase/context，再仅为视口内 gameplay 比赛行订阅，移出视口或离开页面仅释放 consumer，不删除共享 previous-view proof；provider 的 `eligible` 独立于视口 `enabled`，明确不符合比赛 phase 时才清除对应记录。5 秒内无人复用即退订；delivery reducer 用 monotonic 接收时间判定 freshness，按 authority/generation/epoch/sequence 和新 heartbeat 时间拒绝旧投递。共享 Radar 只消费 `fromPublicRadar`，Mizar 继续唯一拥有坐标与楼层标定，CSS 和地图/图标由精确锁定的 npm 包随安装复制到版本化 public 路径。

通用 Stage 的 logical identity 是 `(seasonId, StageConfig.key)`；`StageConfig.name` 只用于展示。`brackets-manager` 只能经 `src/lib/bracket/` adapter 使用，每个 provider-backed Stage 独立拥有 `(competition_id, stage_key)` 状态，provider stage name 和 numeric participant id 不得扩散成领域 contract。参与者必须携带稳定的 `rivalhubEntryId`，比赛解析只消费该 metadata。

Major Swiss 不经过通用 provider adapter：它由 `majorStageEntrants`、official managed matches 和 StageRun 的 `finalizedRound` 投影，配对与晋级继续由 `src/lib/major/swiss.ts` / runtime owner 决定。Qualification 使用独立 run 与 Qualification-owned manual matches；它不属于 Season StagePlan 或 Major StageRun。`src/lib/swiss/` 只投影 canonical 赛果、W/L、对手、BU、状态和排名，并提供配对 building blocks；每种赛事自己的 policy 验证完整轮次、战绩组限制、轮次上限与 bye/floater 语义。

## Spectator predictions

`src/lib/predictions/` composes a public Prediction/Pick’Em read model with discriminated Major and Qualification contexts. Major simulation reuses the canonical Swiss, seeding and playoff rules; Play-in simulation is owned by `src/lib/competition-qualification/` and reuses Short Swiss pairing/projection and shared official-history validation. Prediction choices live only in browser memory and never write official matches or scenarios. Baselines expose only stage rules, entrant identities, display fields and official results; frozen eligibility/roster facts remain private. The Pick’Em transport excludes Bet balances, markets and ledgers. Official seed confirmation and phase transitions synchronously publish policy-derived Pick’Em windows; the durable official-fact outbox reconciles corrections. Public reads never create windows. A window may precede its StageRun and binds it only when the official entrant set matches. `src/lib/bet/` independently owns the BET catalog, read model, admission and append-only financial facts in `bet_*` tables. It does not require a Pick’Em program; the shared scheduler runner consumes separate durable Bet work.

BET 公共积分池、参与人数和免费预测支持率由 `src/lib/bet/public-stats-read.ts` 输出显式聚合 DTO，经 `use cache: remote` 按赛事、比赛及规范化视图范围跨用户复用，服务端硬过期为 15 秒；不构造无消费者的匿名完整面板。普通视图的 15 秒轮询与缓存年龄会叠加，不能承诺外部变化在 15 秒内显示。缓存填充独立读取公共统计，首次读取增加工作量，收益取决于同一窗口的复用次数。缓存不含 voter、个人选择、账户或原始赛事事实，草稿绕过共享缓存。每次请求先直接核对当前赛事及草稿管理员权限，再取会话和公开聚合；GET `/api/bet/[seasonId]` 与 `/api/predictions/[seasonId]` 使用严格 scope/view 参数、`private, no-store` 与 `Vary: Cookie`，不接受客户端 viewer 身份。事务内以同一 read-only repeatable-read executor 读取必要事实、私有状态与数据库时钟，提交后纯投影；只读语句有独立预算。客户端 HTTP 读有时限、abort 和 scope/sequence 保护；abort 不证明服务端查询或事务回滚。BET 普通视图按可见性轮询，记录/排行榜使用各自读取入口而不轮询整板；免费选择成功只刷新该场免费面板。记录以 `(created_at,id)` 游标继续翻页，保留旧 page URL。records/ranking 不读取完整盘口/BP，赛事盘、个人投入和结算盘先限定 market 集合；冻结历史不因当前官方比赛删除而丢失。

私人余额、下注、排名、永久封盘、资格与记录不进入共同缓存。免费预测个人读取包含 canonical viewer 的归并来源，沿用直接选择优先规则；公共支持率绑定对阵、run、赛制、地图池与有效状态，事实更正时回退重算。竞猜/free action 提交后失效本届 BET tag，赛事与统计 tag 继续覆盖赛果更正和身份归并。财务或选择回执已确认后，失效/刷新失败单独报告；投入传输结果未知时保留原 payload/requestId，只读核对该 viewer 的原始 stake receipt，缺失仍是未确认，不自动生成新 key 重扣。

Prediction mutations serialize by canonical user → season lifecycle guard → relevant official match rows → prediction outbox → event program. Join/save synchronously publish/void windows, bind official entrants and latch permanent deadlines; the first account, initial credit and accepted pick remain atomic. A rejected first save leaves no account/credit. Receipt replay still checks identity, lifecycle and content before returning. Stage rewards, judgements and legacy pool settlement belong to the durable worker; failed completion rolls back both ledger and dirty consumption. Legacy points spending continues to reconcile before balance admission. Settlement workers read official facts without taking tournament row locks, batch market inputs and append ledger rows in the same transaction, and keep account/source idempotency. Official triggers atomically enqueue work and close affected windows. Public reads never create windows, reconcile or acquire program/outbox locks.

The public Prediction/Pick’Em projection excludes legacy financial fields and does not compute a preview simulation that its transport discards. Simulation remains the client interaction model; official results alone drive windows and awards. Tasks read only the viewer, while the achievement leaderboard reads the full submitted population before top100 plus the viewer's own rank; others' drafts, Qualification display context and unused score payloads are excluded from summary reads. Latest judgement and revision count retain correction history. The read snapshot captures database time; browser clocks remain presentation only. Prediction render failures use the telemetry owner's private fingerprint projection and an explicit retry boundary; primary-ready is recorded beside actual hydrated BET/Pick’Em content, not fallbacks.

BET 排行榜由 `src/lib/free-predictions/ranking.ts` 在同一个 read-only repeatable-read 事务载入一次全赛事投票及金融人口，页面 header 复用该快照的当前 wallet/rank。事务后生成收益、命中数和准确率投影，各自复制并赋值 rank/group，保留完整人口资格门槛、并列及筛选后排名语义；单榜 action 复用该 owner。

## Security and operations

- Supabase Auth 管理邮箱凭据；应用 session 只保存身份，当前角色和 season grants 每次从数据库读取。
- 业务表默认 server-only；Data API/RLS terminal contract 见生成式 [`security/database-access-matrix.md`](./security/database-access-matrix.md)。新增 direct browser Data API 或 Realtime surface 必须同时定义最小 GRANT/RLS、consumer、一致性语义和正反例测试。
- 管理 mutation 产生 `audit_logs` 业务审计；runtime logs/traces 由 `src/lib/observability/` 独立拥有。审计列表与详情共用服务端安全投影，只展示 action allowlist 中的字段，不返回 raw meta、设备凭据或内部标识。详情入口重新验证全局/本届管理员身份，并将赛事范围纳入查询；全局列表标注赛事。机器来源通过对应赛事的 Mizar installation 或 DAK pairing 解析，授权身份与设备执行身份分开显示，不推断当次设备操作人；已删除、历史或未支持目标使用明确状态。
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

## 指标读取边界

页面和组件消费领域 read model，不直接定义数据库 count/sum/avg/min/max 聚合；`ARCH_PAGE_AGGREGATE` 检查聚合导入及 SQL 模板。相同含义的指标只有一个 owner：正式赛事完成/总场数归 `matches/read-official`，已审核参赛队数归 `competition-entries/counts`，参赛人数的单赛事入口复用批量入口的注册方式规则。选秀形成队伍数、审核通过数、Major 正赛名单人数等不同含义必须保留明确的领域范围，不能用同名函数掩盖差异。UI 搜索结果数量、编辑中选择数及图形宽度属于展示状态，不替代领域事实。

公开赛程的瑞士轮 read model 可复用当前请求已读取的比赛与展示比分，投影前仍按赛事、阶段、StageRun 和 `major_stage` ownership 筛选；管理入口独立读取时沿用相同范围。比赛详情双方名单通过 `match-rosters/read-model` 单语句读取，保留原始名单状态、来源和首发/替补字段；单队 action 复用该 owner。双方赛前地图统计共享地图与 BP 批量读取，每队独立保留历史比赛集合以及 pick/ban 分母。公开统计在 read-only repeatable-read 事务内完成事实与排行榜读取；事务结束后计算结果、分析、纪录与洞察摘要；选手详情、生涯、队伍、地图、阵容和 benchmark 也在快照提交后聚合，复用同一快照内已校验的完整有效名单，避免纯计算继续占用连接。

测试赛保留共用执行流程与显式测试入口；公开正式列表、统计及其地图/BP筛选目录均从正式比赛范围读取。不得把当前晋级名单当成赛事历史范围。
