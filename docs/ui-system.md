# RivalHub UI 系统

本文件只维护跨页面 presentation contract。具体 token 值以 `src/app/globals.css` 为准；domain IA、业务规则和 query 语义仍由对应 owner 负责。

## Product language

参赛者与管理员界面优先使用自然中文，直接表达当前目标、状态、未满足项和下一步。品牌、CS2 通用缩写及专有名词可保留英文；用户不应理解内部 enum/key 才能完成任务。专业赛事术语（如 Major、Stage 1、BO3）不等于实现术语：实体名、revision、snapshot、算法字段和序列化诊断只留在代码、审计或明确的技术详情中，不能成为正常操作流程的正文。

账号入口稳定区分「我的参赛」（私有任务）、「个人主页」（公开资料）与「账号设置」。CS2 canonical position key 保持 `igl`、`awper`、`opener`、`closer`、`anchor`。

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

颜色不能单独承担 success/warning/danger；状态同时使用文字、图标或结构表达。10–11px mono 只用于 code、marker、ticker 和 compact metadata，不承担正文解释。

## Information hierarchy

页面顺序从当前任务与关键事实开始，再到历史和辅助操作。管理视图把可编辑事实、blocker/readiness、确认动作和危险操作分组，不把整个 domain 塞进一张万能 Card。

公开页面只消费 public DTO/read model。email、QQ、`studentId`、`authId`、教育证据、管理员范围和内部备注默认不进入 public HTML/Client props。

长期 Team membership、Entry roster、EventRoster、MatchRoster 和 StageRun entrant 是不同事实；UI 必须使用对应业务名称，不能为了简化展示把一种状态冒充另一种。

### Public Team profile composition

公开队伍详情只有一个 canonical `TeamPublicProfile` composition owner。长期队伍路由 `/teams/[slug]` 只注入长期 Team read model；赛事队伍路由 `/[seasonSlug]/teams/[entryId]` 注入本届赛事的 public event context，并在 `entry.teamId` 存在时一并注入长期 Team read model。两条路由保持各自的事实 owner，不把一届赛事中的参赛队伍当作长期 Team。

存在赛事 context 时，队名、图标、参赛名单、赛事战绩、比赛链接、参赛状态和种子优先展示本届赛事事实；长期当前成员、招募、赛事履历、名称/队长历史仍明确标记为长期 Team facts。没有长期 Team 的 event-native entry 复用同一 shell，仅隐藏不存在的长期 Team sections。

标准 Major 的公开队伍列表、赛事队伍详情、`/[seasonSlug]/players` 和赛事首页摘要共享一个 server-only public participant read model。审核期只显示「已通过报名审核的队伍」及「已审核报名名单」；正式参赛队集合完整后切换为「正式参赛队」，冻结前显示「当前参赛名单」，冻结后显示「最终参赛名单」。官方种子只有在赛委会确认且完整覆盖全部正式参赛队时显示，否则保持「种子待确认」。这些页面只接收显式 public DTO，不在页面内重算生命周期或把报名名单冒充赛事名单。

`TeamPublicProfile` 的本届参赛名单只展示 Player identity、首发/代表标记、公开参赛状态和 roster 状态，不从长期资料或 `seasonRegistrations` 补写本届位置；Major 选手目录同样只展示本届队伍、首发/替补、Player link 和已有的本届已验证统计。`CompetitionEntry`、`EventRoster`、revision、snapshot 等实现术语不进入正常公开文案。

玩家身份浏览/卡片界面统一使用 `PlayerAvatar`：公开页面只消费已持久化的头像 URL，缺失或加载失败时显示姓名首字母；页面不在渲染路径请求 Steam，也不各自实现平行回退逻辑。高密度比赛表格保持文字优先。

## Dense data

表格和高密度列表遵守：

- 稳定列序和可扫描 identity/status/date；密度来自分组与行距，不靠不可读字号。
- 数字使用稳定对齐和 `tabular-nums`；`null/unknown` 与数值 `0` 明确区分。
- 二维 overflow 由最近的局部容器拥有，普通页面不产生 document-level 横向滚动。
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

## Visual regression

Visual regression 只锁定少量 deterministic reference；功能 E2E 继续验证真实任务。baseline 使用固定 viewport、关闭动画/caret，并尽量排除实时人数、动态时间和其它非确定内容。只有 presentation contract 有预期变化时更新 baseline。

新增 UI pattern 前先确认现有 primitive 是否已经拥有该职责；如果新模式确实跨页面稳定，再收口 shared contract，而不是在每个 consumer 各写一份样式和交互。
