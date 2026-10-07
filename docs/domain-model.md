# RivalHub 领域模型

本文件定义跨模块必须共同理解的实体、事实层级和不变量。字段、约束和迁移细节以 `src/db/schema/`、active migrations 与 tests 为准；流程见 [`workflows.md`](./workflows.md)。

## Identity and long-lived facts

### User and authorization

`users.id` 是自然人的 canonical identity，也是长期公开资料的根实体。Supabase Auth、邮箱与未来 provider identity 都是由 `user_identities` 绑定的 credential，而不是 person id；同一 active external identity 全局只属于一个 canonical user。全局角色只有 `user` 与 `super_admin`；具体赛事管理权由 `season_admin_grants` 单独表达。授权不是客户端状态，也不从历史报名或队伍身份推导。

比赛中的 Steam64 观察身份由 `user_gameplay_steam_ids` 单独拥有。`users.steam64` 是当前主身份；active gameplay alias 只记录经过审计的历史/比赛观察值，不改变登录、报名或当前资料。Demo consumer 必须经 gameplay Steam resolver 解析 primary 与 active alias；retired alias、跨用户冲突和脏数据都 fail closed。比赛确认产生的 alternate identity 必须关联来源 Demo、确认人和原因，并只能由来源赛事的 season admin 经 canonical identity owner 撤销。

credential linking 只证明并绑定新的 identity，不复制或移动赛事事实。两个已有 `users.id` 的归并必须先生成 fail-closed preflight：用户选择的保留账号资料和竞技资料原样不变，待归并账号的竞技资料直接删除；登录身份、已确认的 person facts 和不冲突的业务历史归到保留账号，临时状态关闭，历史 actor/provenance 继续保留原账号。只有 Steam 身份、Team 时间线/队长状态、不同参赛身份或同一地图两份正式比赛数据等无法无歧义处理的事实才阻止自助归并。成功归并后 loser 作为可追溯 alias 保留在 `user_merge_ledger`，不会被无痕删除。

登录在用户行锁内重新确认已验证凭据仍属于该 canonical user；锁前查询只用于发现候选。时间戳 fence 独立阻止旧 proof 和密码更新期间的会话颁发，不能替代凭据归属复核。备用邮箱撤销同时撤销相关 provider identity、会话及该邮箱未完成的绑定请求；旧 provider subject 不能借随后重新绑定的邮箱恢复权限。用户可以新发起显式绑定以恢复同一凭据，或绑定新的 provider subject。普通密码登录也允许首次同步账号，但已撤销的 provider subject 不得借此创建新账号或借重用邮箱登录另一账号。没有既有 owner 的新 provider subject 仍可走正常注册；撤销的是具体凭据绑定，不是永久封禁邮箱。

登录、撤销和绑定均先锁用户，再访问可变凭据；绑定涉及两个 owner 时与归并一样按用户 ID 排序取锁，再锁绑定请求。发现 owner 已变化或账号已归并时 fail closed，由新的请求重新解析。重复登录按 credential advisory lock 串行，重复绑定请求由一次性状态拒绝；active-only 唯一索引仍是冲突兜底，不承担撤销语义。

应用登录凭据的生命周期由 `application_sessions` 与 `application_session_controls` 表达，前者是可撤销的注册记录，后者是跨请求颁发 fence 和密码更新状态；在线心跳 `user_sessions` 不提供认证。账号归并保留撤销边界、撤销双方登录，旧会话不 reparent。详见 [鉴权与权限](auth-and-permissions.md#session)。

### Player-declared profile

`users.gameplay_style` 与 `users.competition_history` 是 canonical user-owned long-lived profile，回答选手当前公开声明的打法/风格与比赛经历。设置页可以随时维护这两个字段，公开 Player Profile 只通过显式 `PublicPlayer` DTO 消费它们；空值保持 unknown，不从某届赛事推断当前资料。

`season_registrations.gameplay_style` 与 `season_registrations.competition_history` 是单届 Rivals 报名时的 immutable historical snapshot。新 solo 报名从长期资料取得初始值，提交时由同一个 registration transaction 同步更新长期资料并写入当届 snapshot；后续编辑长期资料不会回写任何历史报名。

首次迁移只对没有长期值的用户，从 approved registration 按 `seasons.created_at DESC`、registration `created_at DESC`、registration `id DESC` 选择同一条 deterministic snapshot 初始化，已有长期字段不覆盖，也不跨两届拼接字段。

### Education

`institutions` 是唯一高校目录，`institution_email_domains` 是唯一学校邮箱 registry，`education_verifications` 是长期教育资格事实。学校邮箱快速认证消费 canonical user 的任一 verified email credential 的精确 active domain mapping，且只有 active、auto-verify、`credentialType=student` 的 mapping 能即时产生固定的 `enrolled` 事实；不从 `.edu.cn`、DNS/MX 或官网主域推断学校身份。CHSI 报告和录取通知书图片都走现有人工审核 owner，后者只产生 `enrolled` 的 `manual_other` pending claim。

录取通知书属于临时敏感证据：文件只保存在 server-only 管理的 private Storage 中，数据库只保存无 PII 的 object key；审核完成满七天后由既有教育 evidence cleanup owner 删除对象，再清空 key，认证结果和审核历史保留。`evidenceCode` 与 `evidenceObjectKey` 的形状由数据库约束共同保护。赛事资格只消费已验证教育事实和当届冻结规则；legacy `studentId` 不构成 Major eligibility。

### Competitive profile

竞技资料分四层：

```text
CompetitivePlatform
├─ Rank ladder
├─ PlatformSeason chronology
└─ CompetitiveRankFact (user fact)
```

- platform 拥有稳定 key 和 rank ladder；season 只表达时间目录，不拥有另一份段位顺序。
- 当前竞技平台身份、ladder 与 canonical Rating 属于产品定义的内置 domain；新增平台、改变段位体系或重新定义 canonical Rating 需要显式产品/迁移变更，不能由管理员临时创建另一套语义。
- `rank`、`stars`、`rating` 是不同事实：rank 是稳定段位身份，stars 是星段位内部精确值，rating 是平台定义的 performance rating。
- `saveCompetitiveProfileInTx()` 是竞技资料保存 owner：catalog/ladder 校验后，同一事务将明确达成赛季的 historical peak 与 season peak 规范化为一致的 rank/stars/Rating；缺失行自动补齐，已有差异必须明确修正两条记录。逐赛季更高的段位/星数自动提升历史最高并更新达成赛季；Rating 不参与高低判断，同等最高保留已有达成赛季，新最高相同则按 catalog chronology 最早赛季确定。不确定达成赛季保持独立，不推断日期。保存与安全修复共用 user row lock，audit 与事实原子提交，不改 frozen event facts。
- 缺失事实保持 unknown；不能为了展示或资格判断制造默认段位、默认星数或 `0`。
- 跨平台比较使用版本化 `ConversionPolicy`。mapping 与 `sourceNote`、`rationale`、`changeSummary` 属于平台级可审计事实；`internalNote` 只属于 super admin 运营面，不进入赛事设置或冻结快照。
- `ConversionPolicy` 由独立 lifecycle owner 管理：已有策略 clone 成 draft，draft 保存和 approve 共用 mapping validator，approved 版本可原子切换 current，只有非 current 的 approved 版本可以 retired；每个 mutation 都保留 `audit_logs`。
- 需要竞技资格的赛事在实际报名开放时冻结本届需要的 season/ladder/evidence/conversion context。赛事只保存 policy identity/version 与当届 conversion snapshot；全局 current、provenance 或 policy retire 不得重解释该届或历史 StageRun。没有 stable policy id 的 legacy mapping 不伪造全局 policy 引用。

未定级仍按最近已定级记录或历史最高低一档估算；若目标档使用星数，代表星数取该档的有限上界（完美钻石 49、黄金 24、青铜 9），无星档保留 null。估算及来源标记保留，不能回写为真实申报事实。

Major 综合实力在 canonical conversion/source selection/未定级估算后计算：Perfect D–A++ 为 0–9，S 使用连续的 `12 + stars/3`，H/R/P 仍为 50/30/20，team reference 仅取五名 primary 的算术均值。显示映射到最近官方段位点，midpoint 向较高点取整；新 seed snapshot 明确记录 strength axis，已有 legacy snapshot 继续保留原数值与推荐顺序，不将旧 ordinal 误当新 axis 显示。

CS2 地图同样区分稳定地图目录、当前轮换、长期用户熟练度与赛事自身图池。具体当前地图集合属于代码/config，不在本文件复制。

## Season and capabilities

`seasons` 是赛事容器；业务能力来自 persisted capability/config，而不是展示字段 `kind`。内置 Rivals/Major 模板提供初始固定语义，自定义赛事使用同一 capability model。

重要边界：

- `seasons.logoUrl` 是单一 nullable event mark；历史赛事默认 null。赛事管理员经公开信息/设置中的图片上传入口维护它，复用 `season-public-assets` 的 Storage owner（JPEG/PNG/WebP、1 MiB），不接受手填 Storage URL。公共赛事页、赛事目录与首页复用同一字段；Mizar Match/Schedule provider revision 覆盖该公开事实，缺失 Logo 不阻断比赛。
- `competitionTemplate` 表达模板身份；`kind` 只用于展示/历史。
- `stagePlan` 是定义态，不是已启动赛事的运行时真相。
- 发布与实际报名开放是不同事实；`registrationOpensAt` 是运营计划时间，`registrationOpenedAt` 是实际 transition fact，需要冻结的报名/竞技上下文在实际开放时形成。按计划补开时保留原计划时间；无计划的明确立即开放同时初始化两者；未来计划的提前开放必须是明确的 force-open 语义并将有效计划时间改为当前时间。
- 系统不存在持久化的“全局当前赛事”；首页 featured season 和后台生命周期分组都是 presentation projection。
- 社区奖是否存在由独立 capability 表达，不从 `season.status` 推导。

Season 配置的 owner 不按 `kind` 分支：`src/types/season.ts` 只定义 canonical contract；新赛事的当前默认值来自 `src/lib/competition/templates.ts`；读取 nullable/partial 历史 JSON 时才经过 `src/lib/seasons/compatibility.ts`。CS2 稳定地图目录与当前轮换由 `src/lib/config/cs2-maps.ts` 拥有，位置目录由 `src/lib/config/cs2-positions.ts` 拥有，Season 状态标签与公开报名排期 projection 由 `src/lib/seasons/presentation.ts` 拥有，地图展示与偏好 projection 由 `src/lib/maps.ts` 拥有。compatibility fallback 是冻结历史语义，不反向定义当前产品默认值。

## Team → CompetitionEntry → roster facts

这是 RivalHub 最重要的身份分层：

```text
Long-lived Team
      │ optional source
      ▼
CompetitionEntry
      ▼
Roster Revision
      ▼ approve / materialize
EventRoster
      ▼ per match
MatchRoster
```

### Long-lived Team

`teams` 与 membership/captain/name history 表达跨赛事持续存在的队伍关系。Team 不属于任何 Season，换人或改名不能修改历史赛事事实。

Recruitment 是 Team/Player 的当前意向，不是 membership、invitation 或 CompetitionEntry；正式入队仍由 Team invitation/membership owner 完成。组队大厅选择赛事 E 时，兼容的招募包括明确目标 E 和“不限赛事”（`targetSeasonId = null`）；该选择只限定当前浏览与匹配上下文，不改写招募事实。选手地图偏好在所选赛事下按该赛事图池投影；未选赛事时按招募目标赛事或当前地图池投影。

### CompetitionEntry

`competition_entries` 是一届赛事中的唯一参赛方身份，从报名延续到比赛和历史。Major 通常由长期 Team 创建；Rivals 选秀队可以 `teamId = null`，因此不需要凭空创建长期 Team。

人员事实严格分层：

| 事实 | 含义 |
| --- | --- |
| Team membership | 当前/历史长期队伍归属 |
| Entry participant | 本人是否确认参加这一届赛事 |
| Roster revision | 可编辑、可审核、可补正的报名名单 |
| EventRoster | 本届已确认/冻结的正式赛事名单 |
| MatchRoster | 本场实际出场阵容 |

这些 owner 不能互相替代。尤其 MatchRoster 必须来自本届 EventRoster，而不是回读可变 Team membership 或报名草稿。

EventRoster 的当前成员供后续比赛选择；一旦某个成员行被 MatchRoster 引用，它就成为历史比赛事实。名单获批更新时保留该行并标记为非当前，再写入新版本；没有历史引用的旧成员行可以删除。已有 MatchRoster 始终指向原成员行，不随当前 EventRoster 改写。

Entry qualification 由 canonical qualification owner 计算。只有明确标记为可解除的政策 finding 才能形成 restriction override；资料缺失、身份、确认状态等硬 blocker 不能被管理员“强行通过”。override 绑定当前 roster revision，新 revision 不继承旧解除。

## Rivals-specific facts

Rivals 的个人报名仍由 `season_registrations` 表达；投票由 `captain_votes` 表达，选秀状态与 pick 分别由 `draft_state` / `draft_picks` 表达。选秀形成的赛事队伍最终仍落到 CompetitionEntry/roster facts，因此比赛和历史不依赖一套平行 Team runtime。

## Match facts

`matches` 拥有独立比赛身份、执行状态、赛制与系列赛结果；赛事关联是可选的组织上下文。赛事比赛保留 `seasonId`、双方 CompetitionEntry 与 stage，按原有赛事政策运行；无赛事比赛使用本场 `executionContext` 的双方名称、标志和地图池，不创建虚假的赛事、参赛报名或选手。关联字段必须完整存在或全部为空，由数据库约束保护；赛事比赛禁止同时携带 executionContext，独立比赛必须拥有该快照。独立比赛未结束时总比分和 resultDisposition 均为空，结束时必须明确 recorded、pending 或 omitted，并保持比分与结论一致；赛事历史行不要求补写独立比赛的结论字段。独立比赛的名称、图池在创建时写入本场快照，当前没有修改该快照的入口；赛事比赛仍沿用赛事配置与 BP 计划的既有权威来源，不用本次重构重解释历史规则。独立转播的 `${match.id}:a/b` 标识在同场内稳定，只是本场方位身份，消费端不得将其当作 CompetitionEntry 外键。

测试赛是具有赛事上下文、用途固定为演练的 Match。`testConfig` 非空表示测试，保存创建时七图图池及双方指定 BP 操作账号；赛事、双方、图池、资格快照和测试用途不可改，且不得关联 QualificationRun、StageRun 或 bracket node。它使用真实 CompetitionEntry / EventRoster / MatchRoster 和现有名单资格、冻结、BP、解说及机器授权流程；创建时复用已批准名单同步 owner；Major 测试赛从本届规则与当前名单冻结本场资格快照，不依赖 QualificationRun 或 StageRun。管理员可指定现有 BP 账号，默认队长；名单仍由队长通过原流程选择。测试标记不构成另一套执行状态机。

测试赛结束采用 recorded / pending / omitted 及同一补录、更正约束。正式发现入口、赛事推进、奖项候选、竞猜事实及平台/队伍/选手累计统计排除测试；本场详情和已授权 Mizar / DAK 读取保留地图、真实数据和赛后证据。公共详情不要求登录，链接可转发；后台与双方队长/操作人的个人入口列出测试，公开赛事列表不列出并设置 noindex。它是未公开列出的比赛，不是保密资料。

`match_maps` 保存地图计划及实际回合比分。比赛执行核心不以名单、BP 或遥测为启动前提；赛事适配层仍在开赛事务中校验和冻结本届合法阵容。未知实际出场人员保持未知，不从预报名名单或空数据制造十人事实。

执行结束与结果处置分开：无赛事比赛可以记录系列赛结果、待补结果（`pending`），或明确不提交（`omitted`）；后两者比分为空，不能解释为 0:0 或弃赛。首次结束固定 `completedAt`，结果补录或更正只更新 `updatedAt`。结束命令只接受首次结束或相同结论的幂等重试；待补总比分和结束后的实际单图分别通过补录命令进入同一结果约束。总比分可以没有单图，但不能与已知单图胜负、图序或提前结束相冲突。已有结论变化必须提交更正原因和所核对的版本；必要的已有单图修正与结论在一个事务中校验、写入，并审计前后事实。正式赛事仍由既有地图结果或弃赛流程提交结果、推进阶段；通用无结果结束入口拒绝正式赛事比赛。结果持久化由比赛 owner 负责，资格赛、Major 与淘汰赛推进由赛事适配层负责。

BP、时间协商、实际阵容、玩家统计和赛后资料拥有各自明确事实。每场只能有一个待回应的时间提议；接受、超时、截止自动确认和管理员指定保留不同的排期来源。官方转播时段是独立的可选运营容量事实；排期提议可短暂占用名额，但转播名额不是自由约定比赛时间的前置条件。后台列表、standings、工作台摘要都只是这些事实的 projection，不成为新的结果或 roster owner。
RivalHub ↔ Mizar 是单向机器接口，不是数据共享。赛事管理员在浏览器授权页为 Mizar 创建赛事级 installation credential；installation 保存授权用户 identity，界面操作者名称读取该用户当前 `display_name`，机器身份只由 installation ID 表达。Mizar 只能经 server-only provider 读取该赛事的 Tournament Context 与赛程窗口，得到的是明确的 provider DTO，而不是 Drizzle 行、后台私有 read model、凭据或内部诊断。`match_live_sessions` 表达单场单活跃数据源与递增 authority revision：换机接管、新 program generation、新 map epoch 或管理员人工接管都会解除当前地图的自动赛果授权，被替换的数据源即使凭据仍然有效也必须 fail closed。Mizar 的可靠事件只是候选；正式地图与系列赛结果仍由 canonical result owner 在事务内写入，`series_ended` 不能在没有正式地图结果时推进系列赛。公开实时画面只经 RivalHub 校验、投射为有硬上限的 public payload 并通过私有 Supabase Realtime Broadcast 投递，不写入 PostgreSQL；观众只持有单场、短寿命、receive-only 的 viewer token。

赛事比赛的默认首发只来自当前合法 EventRoster 明确标记的五名主力；队伍提交的合法首发覆盖默认值。`participant`、`admin_select` 与 `system_default` 均先作为 `submitted` 的有效名单保留各自来源；开赛 transition 在同一事务内重新校验当前 EventRoster、人数、资格和限制，并将有效名单确认为不可再修改的历史 MatchRoster，不依赖管理员另行确认。临近开赛的管理员调整必须记录真实操作人与事故事实。`matches` 的 `startedAt` 记录实际进入 `in_progress` 的时间，不从排期或 BP 完成时间推断。

Demo Evidence 的不可变 payload 与 `match_demo_imports` workflow projection 由 Demo integration owner 管理。正常提交和存量 `/3` recheck 共享同一套 server-owned target、Steam identity、正式比分、QA、回合、summary、effective MatchRoster 和 evidence revision 校验；一张地图具备正式比分与完成时间后即可接收该图 Demo，整场系列赛仍可进行；已完成地图的 evidence revision 不因系列赛进入完成、弃权或取消状态而失效。participant payload 中的客户端 identity resolution 不是事实来源。通过校验的 source round facts、`match_player_stats` 与版本化 `match_demo_stat_projections` 由同一晋级 owner 在确认事务内物化，并按 Demo lineage 保留 supersede/content conflict；管理员确认只补足 gameplay identity 后触发同一存量 recheck，不另起一套验证或直接改写 payload。身份关联与已确认 Demo 的归属构成同一并发边界：所有确认/补建和 primary/alias/账号归并写入先取得 identity transaction gate，再持有各自业务行锁；撤销不能遗漏正在提交的确认结果。

DAK events 目录的 series disposition 直接投影 `matches.isForfeit`，不从比分或地图数量猜测。
`rivalhub-dak-events/1` 的已发布客户端使用 strict schema，因此只有
`GET /api/integrations/dak/events?seriesDisposition=1` 才返回 optional boolean `isForfeit`；
默认响应保持旧字段集，继续经设备 scope 鉴权并使用 `Cache-Control: no-store`。
新版 DAK 接受旧服务端缺字段的响应并保留“未知”，两仓无需绑定部署顺序。
完成的弃权场次可以没有 BP、地图或 Demo，但已实际打出的地图与 evidence 不因弃权被移除。

`match_player_stats` 是字段级混合的赛后投影。地图正式结束后，管理员可用 OCR 或手填确认 Rating、RWS、WE 与可用的基础记分板字段；身份关联在服务端按本场有效 MatchRoster 校验，存量无本场阵容的比赛才回退当前 EventRoster。管理员清除计分板输入时删除仅由 OCR 持有的行，并只清空 DAK 行的 Rating、RWS、WE，保留 DAK gameplay、import 关联和确认事实。DAK 确认后接管 K/D/A、ADR、HS、FK、MK、残局等 gameplay facts 并提供高级统计；DAK 晋级不得清除已有 Rating、RWS、WE。LIVE 遥测只服务当前地图的临时画面，不作为赛后比分或选手统计。公开整场汇总只累计已有正式结果且具有确认数据的地图；进行中的系列赛也可展示已完成地图的累计值。

结果更正不能绕开赛事运行时。Major StageRun 更正通过 managed recovery owner 处理；Qualification 胜者更正仅在尚未产生正赛 entrants 且所有后续 Qualification 比赛仍为 scheduled 时允许，后续轮在同一事务中作废并审计后由 Qualification projection 重算。后续比赛已开始/结束或正赛 entrants 已产生时，必须转入赛事事故裁决。

## Major prestart and runtime

Major 从“报名通过”到“正式开赛”还需要单独的赛前事实：

```text
approved CompetitionEntry candidates
→ Qualification candidate set / saved preliminary order
→ Qualification-derived final entrant set
→ EventRoster reconciliation
→ freeze entrants + rosters
→ immutable SeedRecommendationSnapshot
→ human final seeds
→ start StageRun
```

已批准 Entry 只是候选；Qualification 的预排名保存在独立 run entrant 中，正式 entrant set、EventRoster、系统种子建议和管理员最终 seed 都是不同事实。报名截止与最终名单锁定不同：报名截止/Qualification 期间临时关闭自助名单调整，Qualification 完成后仅最终 entrant 可在最终截止前重新调整。`major_prestart_states.main_event_planned_start_at` 是可审计的运营计划，不是实际 StageRun 开始。系统建议 snapshot 冻结其输入与 provenance，不能因之后查看排序或人工调整而重算；最终 seed 由独立 seed owner 保存。

`major_stage_runs` 是已启动阶段的运行时身份并冻结该阶段需要的规则、entrant 和 eligibility context；`major_stage_entrants` 是阶段参与者真相。后续推进依赖 StageRun + 已完成比赛，而不是 UI standings。

Managed Major 的唯一 profile owner 从保存的 StagePlan 识别 Major-24 或 Major-32；默认模板继续使用 Major-32。报名阶段只有在未创建 Qualification run、正赛 entrants/seeds/StageRun 且未锁定赛前事实时，才能通过受控 owner 更新 profile。开赛时 StagePlan 随 StageRun 冻结，阶段转换、种子批次、开赛预览和最终名次都从该 frozen plan 派生，不从 mutable Season 配置或展示文字推断。

Qualification 的 season-scoped 预排名草稿由 `competition_qualification_drafts` 保存完整 order、format、目标容量、operator/time/version；audit 保存每次差异。草稿不创建 run 或比赛。最终确认必须消费最新已保存版本，并验证候选集合与容量未变化。确认后候选、赛制和预排名均不可直接修改；首轮生成前只能显式 reset 返回草稿。

Qualification 是独立于 Major StagePlan 的预赛运行事实：`competition_qualification_runs` 冻结赛制配置、容量关系、资格 policy 与生命周期，`competition_qualification_entrants` 冻结候选集合和预排名；带 `qualification_run_id` 的 `play-in` Match 保持 manual ownership，不关联 Major StageRun、managed key 或 bracket node。Play-in 首发从当前已批准 revision 同步的 confirmed/frozen EventRoster 读取资格快照：同步时采用 run 的 frozen policy，冻结竞技事实和对应 Entry/revision 的 override；比赛 gate 不重新解释可变个人档案。更新批准名单后显式同步新的 revision，旧事实不可跨 revision 生效。缺少快照的旧 run fail closed，首轮前须重置配置。

正赛候选由冻结的直通队和已完成 Qualification 的晋级队共同派生，不能由管理员替换或补足。Swiss core 只从 canonical 比赛事实投影 W/L、对手、BU、状态与排名；轮次是否完整、是否必须同战绩配对以及是否允许 bye 由 Major 或 Qualification policy 验证，不由通用 projection 固定。Short Swiss 的 Qualification policy 是 2 胜晋级、2 负淘汰，最多三轮。

通用阶段的 identity 是 `(seasonId, StageConfig.key)`，name 只负责展示。provider bracket state 按 `(competition_id, stage_key)` 隔离；participant 的 RivalHub identity 必须来自 `rivalhubEntryId`，不能从名称或 participant 数组位置反推。`matches` 的 provider node 唯一性也按 `(season_id, stage, bracket_node_id)` 约束，允许不同阶段复用 provider numeric node。

Major Swiss 的 public/admin read model 只从 `major_stage_entrants`、`matches(ownership = major_stage)` 与 `major_stage_runs.finalized_round` 投影。Qualification Swiss read model 只从该 run 的冻结 entrants 与关联的 Qualification-owned matches 投影；无效或不完整的 round facts 不生成 standings。

历史 snapshot 保留当时事实，即使 live profile、目录或政策后来变化也不重解释。

## Discipline, results and awards

这些领域故意分离：

- `disciplinary_cases`：个人/赛事纪律事实；
- match correction / adjudication：比赛或赛后裁决；
- `major_final_results`：正式最终结果；
- `tournament_honors`：官方荣誉；
- `community_awards`：独立的社区奖流程。

处罚不会自动改写比分、placement 或 honor；冠军/荣誉撤销也不会隐式递补另一名获奖者。任何连锁影响必须由显式 adjudication 产生可审计事实。

`audit_logs` 记录“谁改变了什么业务事实”，不是领域状态本身，也不是 runtime observability。历史 action 与当前 action 共用 presentation registry，已退休 action 仅供读取，不重新开放为 producer write type；读取不改写历史 fact 或 target。用户名称是 canonical profile 的实时展示，DAK Studio、发布流程与系统 actor 保留机器身份语义。高影响 meta 只通过 action allowlist 提取用户引用，在已授权的服务端批量解析为人名；未知/已删除对象使用自然语言 fallback，原始 ID、凭证、证据、内部原因和 raw JSON 不进入默认列表。

## Spectator prediction facts

A prediction program freezes per-event Pick’Em slot and challenge policy. A contest freezes a concrete StageRun identity, its entrant set and a deadline; neither simulated entrants nor a mutable team roster can redefine that identity. Pick rows are append-only versions with separate draft/submitted intent. The latest accepted complete submission is effective; later drafts do not replace it. Judgement history follows accepted official stage facts and can be invalidated by correction or stage cancellation.

Prediction worldlines are transient browser state, not stored domain facts. The official Major/Qualification runtime remains the source of each fresh simulation. The typed Play-in context uses Qualification identities and never fabricates a MajorStageRun or Main Event seed set. Pick’Em is the formal Main Event submission domain, with independent drafts, submissions, judgement and Coin.

BET accounts belong to one event and one canonical user, independently of Pick’Em membership. `bet_*` financial facts are server-only and append-only. Balances and settled profit are ledger projections; frozen market subjects identify events, Major/Qualification matches or individual maps. Stable market keys include the frozen subject identity; options and half-point lines cannot change after creation. Stakes reference their option with a composite market/option foreign key and may only append to the same option. Settlement revisions reverse the previous payout before applying current confirmed official facts. Debt remains when incorrect credits have been spent. Admission excludes current confirmed/frozen roster members only from markets involving their own entries; administrator status alone is not a restriction. Initial points require explicit join. Canonical Major StageRuns recover missing stage milestones regardless of BET activation order; only accounts whose database joinedAt precedes the immutable openedAt receive each stage grant once. Play-in and past stages never grant catch-up points. Leaderboards require current settled participation, rank by ledger net profit with competition ties, and order ties by settled count, joinedAt and accountId. Grants do not affect profit. Public rankings contain only public identity and aggregates; private account history reads only the authenticated viewer's ledger, with public-safe refund/correction descriptions. Account merges with a losing BET account are blocked. Legacy prediction financial facts remain for compatibility, without being consumed by new BET entrypoints.

Challenge coins are derived Pick’Em achievements, separate from player `tournament_honors` and BET balances. Pick’Em submissions, correctness and coin upgrades never mint BET points.

## Intentional snapshots

以下重复是有意的历史冻结，不应为了“去重”删除：

| Mutable/live fact | Event/runtime snapshot |
| --- | --- |
| Team membership | CompetitionEntry / EventRoster |
| editable roster revision | approved/frozen EventRoster |
| live education/competitive profile | event/StageRun eligibility facts |
| current ConversionPolicy/catalog | event frozen competitive context |
| current seed inputs | immutable seed recommendation snapshot |
| current result | correction/adjudication history |

原则：**live profile 回答“现在是什么”，snapshot 回答“当时按什么运行”。**

## Core invariants

| Invariant | Canonical owner |
| --- | --- |
| Auth identity / email uniqueness | Auth sync + DB constraints |
| season-scoped admin authority | `season_admin_grants` + server guards |
| 一用户同赛事只能有一个 active Entry commitment | DB claim constraint + transaction owner |
| affiliation / competitive qualification | `src/lib/qualification/` |
| Team membership 与赛事 roster 分离 | teams / CompetitionEntry / roster owners |
| Entry roster change 不静默改写 frozen EventRoster | CompetitionEntry + Major prestart owners |
| 赛事比赛阵容只能消费本届合法 EventRoster | match-roster owner + DB invariant |
| Major runtime 按 frozen StageRun facts 推进 | `src/lib/major/` |
| official series score 与 map score 语义分离 | match result owner |
| public business tables 默认 server-only | generated database access matrix + migrations |
| privileged mutation 保留 audit | domain transaction + `audit_logs` |

当新增需求似乎需要第二份状态字段、第二套 evaluator 或从 presentation 反推业务事实时，应先检查是否已经违反上述 ownership。

## Tournament statistics

`src/lib/stats/` owns the server-only shared statistics read model for both platform and event scopes. Platform selection batches public events (including archived history), matches and maps once. Players aggregate by canonical userId across rename/transfers; only explicit CompetitionEntry.teamId links merge teams, while event-native entries remain distinct. Map/match counts use their canonical identities; two team contributions never double the corpus. Within-match identity collapse fails closed. Scoreboard Rating/RWS/WE and ADR/HS retain the canonical SQL/in-memory metric owners and weights. Confirmation materializes versioned per-map DAK sufficient statistics alongside the existing source-round and player-scoreboard projections. The immutable Evidence artifact remains the audit/recheck/rebuild source and is never loaded by public statistics, player careers, or Team profiles. Current selection first chooses the latest non-superseded import in the active semantic profile, then requires confirmation, the effective MatchRoster/result revision, matching projection provenance and current gameplay identity bindings. Missing or invalid projections reduce detailed coverage without a raw-payload fallback. Identity retirement and account merge mark dependent confirmed imports for review across all affected events before cached attribution can be reused.

The `@cs2dak/tournament` reducer owns collection, merge and finalization; its dependency patch and upstream removal condition are recorded in `patches/README.md`. RivalHub supplies canonical user/CompetitionEntry keys and labels. Additive counters, denominators, side slices, weapon/player attribution and map/match identity preserve the existing metrics. Scoreboard SQL retains per-map Rating/RWS/WE averages, round-weighted ADR and kill-weighted HS; Team Rating weights valid player-map Rating samples. Zero opportunities remain null. The attribute benchmark retains one player-event observation per eligible event, compiles shared distributions/ranking scores once, and never silently changes to a deduplicated career population.

Player careers start from canonical users and effective starter appearances in finished public matches. Long Team careers follow historical linked CompetitionEntries, not the current roster's lifetime statistics; opponent identities remain isolated when players transfer. All-time is the default corpus, with Event, Stage, Format, Map and Team scopes. Team record/history/map previews reuse the same official match/map facts and count only completed maps. Current members contribute separate scouting context. Veto steps independently supply selection counts and distinguish recorded, missing and not-applicable samples. Registration position is not a tournament role fact. Cache boundaries, public/draft isolation and invalidation are defined in [architecture](architecture.md); rebuild and egress acceptance are defined in [statistics operations](operations/statistics-projections.md).

投影同时保存紧凑逐图纪录候选与回合定位，不保存 playerRounds 或完整 sourceFacts。Records 保留真实值并列、所有发生和保持者；ADR 用 canonical damage/rounds 比较。装备纪录只消费已核对 exporter 的 freeze-end 值且全员已知；未知版本或 null 降低其覆盖。Insights 的 probability 与 amountPerUnit 输入类型隔离，复用指标事实、统一 qualification/benchmark 与独立规则版本；概率观察使用独立样本线 max(4, ceil(P75×50%))，不改变排行榜的25%资格线；High要求P≥75%且比其它排行榜合格对象的累计比例高至少5个百分点，显示精度可区分，不使用统计区间背书。Opening两项同时High时组合展示，但共享分母不能推断两个分子的回合交集。flash 只用逐图累计量做固定基线 leave-one-map-out。组合输入必须拥有相同事实覆盖，展示过滤不重建比较总体。

统计表格与 Overview situation highlights 共享 `src/lib/stats/ranking.ts` 的样本资格投影；门槛按当前可比较指标的样本分布计算，空指标不参与基线。表格保留 limited-sample 行，Overview 只从 qualified population 选最佳，不另设固定样本门槛。

### Shared Match phase contract

`src/lib/matches/presentation-phase.ts` owns `MatchPhaseFacts`, `MatchPresentationPhase` and the pure `projectMatchPresentationPhase` function. Inputs are canonical lifecycle timestamps/status, Veto progress, ordered official map completion facts, and a validated current gameplay observation. The phase is never persisted. Public in-progress series progress is a read-only projection of confirmed Map results through `computeSeriesScoreAfterMap`. `matches.scoreA/scoreB` continue to store final series scores only; a displayed inter-map 1:0 must not be persisted into those fields. `in_progress` alone does not prove gameplay; completed series take precedence over an unused decider or late observation.

Public and admin server read models explicitly adapt their own authorized facts to this small contract. Public DTOs may expose the derived phase, but never import/serialize the admin workbench DTO, source authority, review reasons, credentials or private operational records. Admin task, source mode/health and review reasons remain independent admin projections. Freshness comes from live/source evidence, never the age of a low-frequency reliable event.
