# RivalHub UI 系统

本文件只维护跨页面 presentation contract。具体 token 值以 `src/app/globals.css` 为准；domain IA、业务规则和 query 语义仍由对应 owner 负责。

## Product language

参赛者与管理员界面优先使用自然中文，直接表达当前目标、状态、未满足项和下一步。品牌、CS2 通用缩写及专有名词可保留英文；用户不应理解内部 enum/key 才能完成任务。专业赛事术语（如 Major、Stage 1、BO3）不等于实现术语：实体名、revision、snapshot、算法字段和序列化诊断只留在代码、审计或明确的技术详情中，不能成为正常操作流程的正文。

所有 domain、persistence 或 enum 值进入 UI 时，必须经过类型化的 presentation owner：

`domain / persistence / enum value` → `typed presentation owner` → `human-readable product text` → `UI`

presentation owner 对有限集合使用穷举映射（新增状态必须同时补齐用户文案）；对外部或历史数据中的未知值使用明确、安全的人类可读兜底，不得把原始 key 作为 fallback。UI 不直接渲染 `status`、`kind`、`type`、`source`、`mode`、`state` 或 `domain` 等机器语义字段，也不通过 `LABEL[value] ?? value` 或 `|| value` 绕过展示边界。预期业务错误同样由领域 owner 维护稳定的错误 key、结构化参数和用户文案；内部诊断与产品提示分离，`INTERNAL_ERROR` 对外始终只返回通用提示。

后台恢复与影响清单同样遵循这条边界：domain/service 只返回结构化事实，server action 只下发 presentation-safe projection；比赛托管 key、原始状态、阶段 key、确认游标和诊断字段留在服务端，不进入普通 operator UI。

中英混排按视觉层级处理：mono/uppercase tactical chrome 可以保留简短、约定俗成的英文（如 `TBD`、`BO3`、`STAGE2`）；导航、动作、状态和解释正文使用自然中文。同一视觉层的标签保持同一语言语义，不把生命周期结果、回顾或阵容等说明塞进 destination 名称。

账号入口稳定区分「我的参赛」（私有任务）、「个人主页」（公开资料）与「账号设置」。CS2 canonical position key 保持 `igl`、`awper`、`opener`、`closer`、`anchor`。

地图偏好与地图池编辑器用「当前地图池」「当前地图池熟练度」「当前地图池（默认候选）」描述当前轮换；选定赛事时使用「目标赛事图池熟练度」。普通参赛者和管理员文案不显示内部术语 `Active Duty`。

## Tokens and primitives

视觉 token 的唯一数值来源是 `src/app/globals.css`；Tailwind/shadcn 名称只做 bridge，不为单页建立第二套色板、圆角或 spacing scale。

稳定 shared contract：

| Primitive | Responsibility |
| --- | --- |
| `PageLayout` | 页面 gutter 与 `narrow/standard/wide/workbench` 宽度语义 |
| `PageHeader` / `Section` | 语义标题与页面阅读层级 |
| `Panel` | 同一业务区块的 surface；内容布局与外层几何分离 |
| `DialogContent/Body/Footer` | viewport、滚动、focus、操作区与尺寸 contract |
| `StatusBanner` / `StatusPill` / `Checklist` | 状态解释、紧凑状态与 readiness |
| `EmptyState` / `ErrorState` / `Skeleton` | empty/error/loading 的明确三态 |
| `InlineConfirm` | 高影响 mutation 的影响说明与二次确认 |

### Page geometry ownership

`PageLayout` 是 page width、horizontal gutter 和 base vertical padding 的唯一 owner。route page、loading、error、fallback 应复用同一个 route-level `PageLayout` variant；已经由父级 `PageLayout` 包裹的子页面只声明 section、grid、spacing、`min-w-0`、局部 overflow，以及真实阅读/表单所需的 inner `max-w-*`。

不要在页面级重新组合 `container`、`mx-auto`、`max-w-*`、`px-*`、`py-*`。局部表单或长文的 inner width 可以保留，但不能再次拥有整页 gutter。赛事导航条和 breadcrumb 等 full-bleed/navigation surface 内部的 alignment frame 是例外：它只对齐导航内容，不负责 page body 的宽度或垂直几何。

四种 PageLayout variant 按信息架构和交互密度选择：

- narrow：auth、single action、confirmation、长文阅读、单列长表单和小型纵向状态页；目标是阅读 measure 与任务聚焦。
- standard：entity/detail page 和中等复杂度 workflow；纵向内容为主，但需要正常的数据、卡片和指标横向空间。
- wide：directory、card grid、searchable/filterable list、standalone admin list、data browsing 和多区域 workspace。
- workbench：高密度 operator canvas 与 season-admin 多任务工作区；父级拥有最大可用页面宽度，子页面不再对整页重新加 max-w-*。

选择 variant 时先看页面的信息架构和交互密度，不按历史 max-w-* 机械套用。inner max-w-* 只服务真实的阅读或表单 measure；如果它包住整个 list、grid、operator workspace 或多区块 detail page，它实际上又在决定 page sizing，应回到 PageLayout 语义重新审查。

颜色不能单独承担 success/warning/danger；状态同时使用文字、图标或结构表达。10–11px mono 只用于 code、marker、ticker 和 compact metadata，不承担正文解释。

## Information hierarchy

页面顺序从当前任务与关键事实开始，再到历史和辅助操作。管理视图把可编辑事实、blocker/readiness、确认动作和危险操作分组，不把整个 domain 塞进一张万能 Card。

Major 赛前工作区按报名收口、资格方案、资格赛、正赛名单、正赛种子、开赛确认六阶段组织；顶部始终显示进度，默认只完整展开当前阶段，已完成阶段提供可展开摘要，未来阶段只提示前置条件。报名截止、最终名单调整截止和 Main Event 计划开始分别在报名收口、正赛名单和开赛确认阶段编辑，并受当前 lifecycle gate 约束；未来阶段不提前暴露编辑面，计划时间不代表实际开赛。Qualification 比赛在工作区只显示汇总和统一比赛管理入口。

报名期的系统参考、Qualification 预排名和最终种子共用一队一行的横向排名矩阵。固定排名、系统参考和队伍列，完整名单按主力、替补顺序横向展示，每人默认固定显示今、近、前、史四维，来源与 Rating 留在详情。矩阵只有横向滚动，提供 75%–125% 组件级缩放及概览密度。可编辑阶段的拖拽、上下微调和移至名次只改同一个本地顺序；保存排序与配置 Qualification、确认最终种子分别执行。直通/Play-in 切线和 profile 入场批次在矩阵内标示。

公开页面只消费 public DTO/read model。email、QQ、`studentId`、`authId`、教育证据、管理员范围和内部备注默认不进入 public HTML/Client props。

人物主标签必须消费 canonical identity formatter：公开 surface 使用 `displayName → official Steam personaName → perfectName → 未知用户`；内部/operator surface 使用 `displayName → official Steam personaName → perfectName → email local-part → 未知用户`。`users` 中不存在可进入 canonical resolver 的手填 Steam 昵称；官方 personaName 只来自按 Steam64 键控的服务端缓存投影。完整邮箱只有在账号、联系、核验、归并或 disambiguation 本身就是当前任务时，才作为明确标注的 detail 展示，不能冒充人物主标签。Major 实力参考的普通 UI 展示真实的历史、参考赛季、近期段位/星级、必要的可比 Rating 与来源；系统参考顺序、真实并列和最终种子使用语义化表达，内部排序/换算标量、rank ordinal 与并列组编号不进入普通 UI。

后台 operator surface 对已有 canonical `userId` 统一使用窄 `PlayerProfileLink`；联系方式只由有权限的 server read model 显式投影给 `AdminPlayerContact`，仅在后台提供查看、复制或打开，不进入 public Player DTO。selector、checkbox 或 voting 的 primary action 旁如需 profile access，使用独立 secondary affordance，不能把链接嵌入主操作。

长期 Team membership、Entry roster、EventRoster、MatchRoster 和 StageRun entrant 是不同事实；UI 必须使用对应业务名称，不能为了简化展示把一种状态冒充另一种。

内部模型和领域文档可以使用 long-lived Team / 长期 Team 来区分 CompetitionEntry；用户可见界面统一称为「队伍」。普通界面不得出现「长期 Team」「长期队伍」或「active 队伍」；涉及赛事上下文时使用「队伍」「本届赛事」「本届名单」或「赛事队伍」等业务名称。

### Personal Workspace composition

`/my` 是登录用户的私有任务路由：`/my` 先展示需要本人处理的事项，再展示接下来、当前队伍、当前赛事、长期资料与历史；管理员审核中的事项不冒充用户任务。`/my/teams` 按无队伍、成员、队长三种身份组合内容：成员只读队伍身份和成员列表，队长才看到资料、招募、邀请、成员管理与解散操作。`/my/competitions` 以赛季和参与上下文组织报名、参赛确认、比赛与历史，不把长期 Team membership 解释为已确认参赛。

个人工作区使用真实导航链接和 `aria-current`，窄屏允许换行；父级 `PageLayout` 持有整页宽度与 gutter，子路由不重复创建页面壳。离开长期队伍的说明必须明确：该操作不会自动改写已经提交、审核通过或冻结的赛事名单。

### Public Team profile composition

公开队伍详情只有一个 canonical `TeamPublicProfile` composition owner。长期队伍路由 `/teams/[slug]` 只注入长期 Team read model；赛事队伍路由 `/[seasonSlug]/teams/[entryId]` 注入本届赛事的 public event context，并在 `entry.teamId` 存在时一并注入长期 Team read model。两条路由保持各自的事实 owner，不把一届赛事中的参赛队伍当作长期 Team。

存在赛事 context 时，队名、图标、名次/荣誉、赛事战绩、本届名单、正式地图表现与比赛链接展示本届事实；公开 Hero 不呈现报名审核、名单冻结等流程状态、解释文案或 seed。长期 Team 以简短入口承接当前成员、招募、赛事履历、名称/队长历史。没有长期 Team 的 event-native entry 复用同一 shell，省略长期 Team 入口。

标准 Major 的公开队伍列表、赛事队伍详情、`/[seasonSlug]/players` 和赛事首页摘要共享一个 server-only public participant read model。审核期由页面级文案说明候选队伍；正式参赛队集合完整后切换集合说明，名单仍在调整时使用「当前参赛名单」，冻结后使用「最终参赛名单」。详情页在赛事结束后将名单标题收敛为「本届名单」。官方 seed fact 仍由 Major read model 提供给依赖 seeding 的赛事上下文；公开队伍目录和 Team profile 不以 seed 标识队伍。这些页面只接收显式 public DTO，不在页面内重算生命周期或把报名名单冒充赛事名单。

`TeamPublicProfile` 的本届名单只展示 Player identity 与首发/替补标记；区分当前、已审核或最终名单时使用 public read model 提供的自然标题，不渲染流程状态 pill，也不从长期资料或 `seasonRegistrations` 补写本届位置。Major 选手目录同样只展示本届队伍、首发/替补、Player link 和已有的本届已验证统计。`CompetitionEntry`、`EventRoster`、revision、snapshot 等实现术语不进入正常公开文案。

公开队伍 Profile 的稳定信息层级固定为 section composition，而不是业务块 card wall。长期队伍按 **Hero → 当前成员/当前赛事 → Performance（All-time）→ 阵容地图参考（有内容时）→ Career → 队伍资料** 组织；赛事队伍按 **Hero → 本届名单 → Performance（本届）→ 阵容地图参考（有内容时）→ 本届比赛** 组织。Hero 展示队伍身份、已确认名次/荣誉和 Match W-L、Map W-L、Maps、Rating；赛事页不重复摆放 Record、名单人数、seed 或 Next match 摘要。一级 section 使用 eyebrow + 中文 heading + whitespace/divider 建立层级；Hero 可以保留连续 surface 与紧凑 headline strip，但 Career、Matches 等不得各自退化为独立大卡墙。

Team Performance 固定使用 **Overview / Rounds & Economy / Teamplay / Maps / Players / Weapons**。Long Team scope 固定 All-time，不增加赛事 selector；赛事队伍 scope 固定本届。Overview 与 Hero 必须互补而非机械复读；指标 family 使用 shared `MetricSection`、`MetricValue`、metric help contract，collection grain 使用 `StatsDataTable`。Players 的长期队伍语义是“实际代表 linked 赛事队伍出战时的表现”，不混入其它队伍样本。专业指标解释使用 shared tooltip；常驻正文表达页面事实，不解释聚合实现、来源步骤或开发 contract。

Maps tab 只展示队伍自身正式地图表现。阵容成员历史正式地图经验和自报地图熟练度位于其后的独立「阵容地图参考」区，按 coverage progressive disclosure：有队伍正式地图样本时折叠两类参考；没有队伍样本且历史经验覆盖全 roster 时展开历史经验、折叠自报；历史经验只覆盖部分 roster 时两类都展开；没有历史经验时有内容的自报偏好作为主要参考。没有任何参考数据时省略该 section。Pick/Ban/Decider 只来自 canonical veto 记录，不从 Demo 推断。

玩家身份浏览/卡片界面统一使用 `PlayerAvatar`：公开页面只消费已持久化的头像 URL，缺失或加载失败时显示姓名首字母；页面不在渲染路径请求 Steam，也不各自实现平行回退逻辑。公开 Player identity DTO 必须提供 `avatarUrl: string | null`，以区分“没有持久化头像”和“投影遗漏字段”；高密度比赛表格或运营者表格可以文字优先，但必须作为明确例外登记，不能因漏接头像而默默退化。

### Public event browsing

首页保留赛事 Hero、状态侧栏与快捷入口，登录者的报名阻塞事项使用 readiness owner 的个人投影。赛事目录按生命周期分组；已结束赛事以正式冠军、决赛、排名与荣誉组织历史入口。冠军和名次来自明确赛果/荣誉事实，撤销荣誉不自动递补。选手目录标题固定为「选手」，队伍与选手搜索使用共享列表工具及 URL 查询参数。

队伍地图画像区分三类事实：赛事队伍自身本届正式地图表现（长期队伍为自身正式历史）、当前阵容成员历史正式赛事地图经验、成员自报地图熟练度。正式地图表现属于 Performance → Maps；后两类在 Performance 后进入「阵容地图参考」。队伍 W/L 只归属于实际参赛队伍；成员经验供 scouting 参考，不能转换为当前队伍 W/L 或合成地图强度分。公开文案陈述统计事实，不常驻解释数据聚合和来源实现。

赛程的阶段与对阵上下文在队伍筛选时保持完整，通过高亮定位相关比赛；历史赛事默认展示结果。未知比分显示破折号，比赛状态统一复用中央 presentation：显式管理员开赛后的 `in_progress` 展示「进行中」，结束展示「已结束」，取消展示「已取消」；排期和直播地址不能自行推导实时 LIVE 状态。Match Detail 赛前依次提供阵容、带真实样本数的地图胜/选/禁对照、双方近期赛果和次级历史交锋，不在比赛页重复六维能力图或手动两人对比；只有相关队长、BP 负责人或管理员看到「你的赛务」，排期与首发编辑使用聚焦弹窗。赛后每张已有正式比分的地图显示确认的静态 Scoreboard，整场汇总随已完成且有确认数据的地图累计，详细指标按整场/单图范围复用 Stats Center；没有当前 Demo detail 时省略详细指标。基础 Scoreboard 固定为 Player、Rating、K、D、A、ADR、HS%、FK、MK、CL、WE，两队共用固定列宽、数值右对齐，窄屏局部横向滚动；公开页面不挂载后台录入或确认控件。积分预测只展示社区投入占比、参与人数、截止状态与本人投入，不将积分池占比称为胜率。MatchRoster 仅在赛事具备 registration-position capability 时辅助展示「报名位置」，不把报名位置解释为本场位置；其它赛事不查询或显示该字段。赛前及比赛期存在有效直播资源时，在 Hero 附近提供「进入直播间」入口及解说信息；结束后隐藏直播入口，录像/VOD 作为历史资料置于页面后部。

Major Play-in 管理使用正赛规模、候选与直通/晋级数等紧凑统计；配置确认前展示完整预排名与「路径」，每轮生成前展示队名和冻结预排名种子对阵，赛制定义通过 tooltip 提供。首页阶段 tracker 只标记 Main Event；Play-in 独立面板按 configured、in progress、completed 展示赛程待生成、当前 Round、晋级队数与正赛名单确认状态。Play-in 期间 REGISTER 完成、Main Event 阶段待开始且不设置当前 Main Event 阶段。赛程页把 PLAY-IN tab 与 Main Event 阶段分隔；Short Swiss summary 展示 Play-in 人数到晋级席位、赛制和当前轮次/结束状态；standings 按当前排名排序，Seed、P1…Pn 标签保持冻结预排名，列头使用 Seed / Team / W-L / BU ? / Status，并仅显示 R1–R3。

社区奖公开页面以进行中、已结奖、未颁/取消及个人提交组织浏览。申报与证据表单由 CTA 打开，复用既有 action workflow；候选人与获奖者保持赛事相关人员语义，仅在获奖者确认具有本届选手公开身份时链接选手主页，非选手相关人员展示公开姓名，公开 DTO 与管理审核字段保持分离。

### Public Match live composition

公开比赛用 shared Match phase projection 区分 BP、等待正式对局、对局和图间；freshness 与直播资源独立。详情页 Hero 在赛前、对局与图间保留弱化的 VS，只有赛后显示最终系列赛比分；进行中「地图胜场」放在地图区，通过地图上下文与可访问说明明确当前图比分。地图卡与实时数据区共用单份 viewer state，CT/T 换边后按 canonical 队伍 A/B 映射比分。BP 当前进度先于其它赛前内容。完整禁选记录在进行中展开，BP 完成后与地图序列一起固定在顶部（含 POST），过程默认折叠；行首使用轻量彩色文字 BAN / PICK / DECIDER / SIDE，正文使用 removed / picked / was left over / chose … on，选边说明收进共享问号提示。BP 后固定为地图序列/BP 结果、直播播放器、比赛数据，三个阶段复用同一布局；没有直播入口显示紧凑缺省文案。桌面比赛数据为左侧基础数据、右侧共享雷达；两队紧凑表格的总高度与雷达面板齐平，回合记录放在整行下方。窄屏纵向排列、表格局部滚动。赛程和比赛详情使用 wide 布局。只有当前有可展示的实时画面时才默认折叠阵容与赛前资料，短暂 stale 保持布局，等待、图间和 unavailable 展开；用户主动展开的选择在恢复实时后保留，已有正式地图结果继续显示（包括健康 GSI 可靠事件自动采纳的结果，不要求重复人工确认）；未产生结果时不重复展示待进行的地图详情。

实时基础表以名称为高密度 identity，不重复头像，展示当前边、存活、HP、Armor、Money、K/D/A、ADR；选手表与雷达 marker 使用同一数字编号，按 source identity 稳定排序，不随昵称或 CT/T 换边改变；不展示武器、弹药、装备值、kill feed 或来源诊断。共享雷达展示真实协议已有的玩家、C4、楼层、投掷物、烟雾及火焰，缺失本地增强不补造。接收后不超过三秒为 fresh，三至十秒明确显示「实时数据暂时中断」并冻结时钟/雷达；超过十秒或尚无合法帧时隐藏动态画面，保留 canonical 比赛内容。C4 常态携带不占状态栏，仅显示掉落、安放、拆除等状态。图间不沿用上一图动态画面，地图/比赛切换重置视觉历史。外部赛程列表的进行中卡片在窄屏将队名上下排列、比分置于右侧，保留队名阅读宽度；只在可见且处于 gameplay 的比赛行订阅同一 private viewer，比赛行在桌面统一高度和列宽，以「(A 地图胜场) 本图回合比分 (B 地图胜场)」紧凑显示，地图名仅为次级文字，不重复标注「实时」；BP/等待显示 canonical 阶段；图间保持「(地图胜场) 上一图回合比分 (地图胜场)」，不增加结束/等待文案，地图名称与比分范围由可访问说明补充，失鲜标注中断，unavailable 移除实时比分，赛后只展示最终结果。

### Public player profile

MVP 已结算卡保留 Rating、K/D/A、ADR 主指标，次级使用 HS%、FK、MK、CL、RWS、WE 标签。已提交胜者具备有效统计投影时，通过现有公开统计缓存读取整场 KAST、Trade/100r、Util/r、FA/100r 与回合样本，复用 Stats Center 的口径、格式与说明；单图/其他选手标签不会改变 MVP 范围。缺少投影时保留基础表现，不从原始 Demo Evidence 重建，也不从最高 Rating 推导胜者。完整数据链接定位本场该选手的整场面板。专业标签复用简短英文，指标解释使用共享问号提示，MVP 问号附在标签右侧且不参与居中宽度计算，支持悬停、键盘与触屏；表格内不重复“本图回合”等说明。

`/players/[userId]` 是选手的长期资料页，维持 PageLayout standard，保留当前身份、活动、找队状态、报名时资料、公开竞技档案、自报地图熟练度和选手自述。Performance 默认使用 All-time；Event 和 Map 是可分享、刷新可恢复的 URL scope，默认值从 URL 省略，切换 Event 时只在所选赛事不包含当前 Map 时清除 Map。Side（Overall / T / CT）留在指标 workspace 内。系列赛 W/L 与 MVP 随 Event scope 变化，不随 Map scope 变化；Map 只筛选地图、回合和选手表现。指标沿用赛事 Player detail 的 Overview、Opening、Teamplay、Utility、Clutch、Maps、Weapons 家族、MetricValue、样本与 tooltip 语义。Player detail 以 full-width metric section 和紧凑数据行组织，不用等高卡片墙填充指标；Opening 与 Teamplay 分离，地图与武器按列表/表格 grain 展示，不把赛事 Players 宽表直接嵌入 standard 页面。Radar 仅显示所选单届赛事的赛事内标准化结果，不合并不同赛事的分数。赛事履历展示当届队伍、正式战绩、已确认名次和有效官方荣誉，并链接到赛事队伍页与选手统计；用户文案使用「队伍 / Team」，不泄漏 `CompetitionEntry` 等内部术语。

### Public information and feedback entry

公开页面使用一个固定的「信息与反馈」入口。入口里的最新公告、重要提醒和赛事公开信息由 server-side public read model 提供；客户端只负责本地确认状态、Dialog 展开和反馈表单交互，不自行推导公告范围、赛事内容或权限。重要提醒的确认记录只保存在当前浏览器的 `localStorage`，公告更新后以新的 `updatedAt` 重新提示；管理员页面不显示该入口。

反馈表单只提交明确的反馈类型、正文、当前同站 pathname、可选赛事上下文和版本标识。服务端负责正文规范化、honeypot、匿名频率限制、已登录用户冷却、重复正文去重与最终持久化；公开 DTO 不包含 fingerprint、secret、cookie、完整 URL 或内部运行时日志。赛事规则与交流群加入链接只接受同站路径或显式 HTTP(S) 地址，公开联系方式另外允许显式 `mailto:`；展示层对历史脏数据仍 fail closed。

## Dense data

表格和高密度列表遵守：

- 稳定列序和可扫描 identity/status/date；密度来自分组与行距，不靠不可读字号。
- 数字使用稳定对齐和 `tabular-nums`；`null/unknown` 与数值 `0` 明确区分。
- 二维 overflow 由最近的局部容器拥有，普通页面不产生 document-level 横向滚动。
- `StatsDataTable` 可显式标记 bounded identity column；sticky identity 内容在该列内截断，numeric columns 保持 `whitespace-nowrap` 与 `tabular-nums`。
- 移动端首屏必须读到 primary identity + primary metric/action；必要时提供摘要/卡片，而不是只把桌面表格横向塞入。
- `ScrollHint` 只表达局部横向内容是否仍可滚动，不拥有 domain navigation。

## List and query interaction

高价值审核队列和 discovery list 共享薄的 interaction primitives：

```text
ListToolbar
ListSearchField
ResultSummary
ClearFilters
PaginationControls
useListQueryParams
```

shared layer 只拥有 presentation / URL mechanics：

- search/filter/sort/page 可分享、刷新恢复、back/forward 正确；
- 改变 search/filter/sort 时重置 `page=1`，翻页保留其它 query；
- 默认值从 URL 省略，非法 query 由 domain parser deterministic fallback；
- search 可保留本地输入与 debounce，查询结果仍以 server/domain owner 为 authority；
- toolbar 在窄屏正常换行，control 有 label，非默认筛选可一键清除；
- result summary、loading、dataset empty、no match 和 server error 不互相伪装。

shared layer **不拥有** allowed query、validation、SQL `WHERE/ORDER BY`、qualification、stats、relevance 或其它业务排序。Review queue 可以定义 actionable-first，discovery list 可以定义 domain relevance；不建立万能 DataTable 或中央业务 query engine。

## Forms and mutations

- 使用既有 labeled controls；字段级 validation 靠近字段，服务端错误保留给用户。
- pending/success/failure 状态明确，避免重复 mutation。
- 长期 profile、赛事报名和单场 roster 等不同事实不混成同一表单。
- 文件上传客户端提示、服务端再次验证；敏感材料只呈现任务最小信息。教育认证 fallback 是学信网材料不可得时的新生兜底，使用 canonical 高校 selector、单张非空 JPG/PNG/WebP 图片（最大 5 MiB），界面必须直接说明必要页面、遮挡身份证号/考生号/条形码或二维码、审核完成七天后自动删除且不会公开展示；不得让用户理解或操作 Storage key、signed URL 或内部 evidence enum。
- qualification、seed、lineup、start 等关键判断展示最新服务端事实，不让乐观 UI 成为最终结论。

高影响操作（比分更正、纪律、裁决/荣誉撤销、归档、名单冻结、开赛等）使用 `InlineConfirm` 或等价明确确认，并继续由服务端授权、审计和 fail-closed validation 保护；浏览器原生 `confirm()` 不替代任务语义。

Super-admin 系统状态页的 scheduler health 只展示 job label、primary freshness、endpoint/fallback/manual/业务推进时间和“正常/已降级”状态；不展示 secret、raw error 或 provider response。“立即运行一次”是故障恢复 mutation，必须是可键盘到达的真实 button、可见 focus，并使用 `InlineConfirm` 解释可能推进业务状态后再调用受保护 Server Action。

## Responsive and accessibility

- 320–390px 下关键任务仍可完整完成，按钮不依赖单行空间，长标识不撑破页面。
- 所有操作可键盘到达并有可见 `:focus-visible`；图标按钮提供明确 accessible name。
- heading、label、状态与动态更新可被辅助技术理解；颜色不是唯一信息通道。
- Dialog/Toast 保持合理 focus management；动效支持 `prefers-reduced-motion`。
- 桌面布局可以更密，但不能为了密度牺牲正文、状态和 primary metric 可读性。

## Spectator prediction interaction

Desktop prediction pages use the workbench layout with a locally scrollable full tournament board with a Pick’Em dock that is collapsed by default. The board offers compact two-row progression cards, horizontal matchups and a responsive round list; changing layout never changes simulation choices. Mobile switches between simulation and pick tasks. Swiss rounds are grouped by current win/loss record with qualification/elimination exits; playoffs expose quarterfinal, semifinal and final connections. The board is available before all choices are made. A deterministic seed-based preview fills unknown winners, labels them explicitly and does not count as a user choice or an importable complete pick.

Choosing a winner recomputes the local projection immediately. Upstream edits invalidate affected descendants, support undo, and preserve independent submitted picks. Swiss Pick’Em uses logo slots and an always-visible team pool: click a slot and team in either order, use keyboard activation, or drag between visible teams/slots. Relocating a team clears its old slot. Playoff picks clear only affected descendants. Ordinary edits require no dialog; destructive reset, draft replacement and point investment keep explicit confirmation.

Official results, assumptions and system previews use accessible source labels, a shared legend and distinct solid/dashed borders. Match cards keep team identity and scores primary; source and best-of details are available on hover and to assistive technology. Only available official results display scores; hypothetical results never invent scores. Draft save, PNG export, snapshot share and formal submission remain distinct actions. Export keeps the same slot/bracket semantics and derives its status from a fresh server submission; unmatched local edits export as a draft. Pool shares are labelled community investment shares, never win probabilities. Pools offer open/mine/all filters and preset stakes; explanatory rules appear once per page. Refreshing loads only the active task, skips hidden tabs and never overlaps scheduled requests or overwrites local choices.

## Visual regression

Visual regression 只锁定少量 deterministic reference；功能 E2E 继续验证真实任务。baseline 使用固定 viewport、关闭动画/caret，并尽量排除实时人数、动态时间和其它非确定内容。只有 presentation contract 有预期变化时更新 baseline。

新增 UI pattern 前先确认现有 primitive 是否已经拥有该职责；如果新模式确实跨页面稳定，再收口 shared contract，而不是在每个 consumer 各写一份样式和交互。
