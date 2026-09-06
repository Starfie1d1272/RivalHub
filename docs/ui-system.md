# RivalHub UI 系统

本文件只维护跨页面 presentation contract。具体 token 值以 `src/app/globals.css` 为准；domain IA、业务规则和 query 语义仍由对应 owner 负责。

## Product language

参赛者与管理员界面优先使用自然中文，直接表达当前目标、状态、未满足项和下一步。品牌、CS2 通用缩写及专有名词可保留英文；用户不应理解内部 enum/key 才能完成任务。

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

颜色不能单独承担 success/warning/danger；状态同时使用文字、图标或结构表达。10–11px mono 只用于 code、marker、ticker 和 compact metadata，不承担正文解释。

## Information hierarchy

页面顺序从当前任务与关键事实开始，再到历史和辅助操作。管理视图把可编辑事实、blocker/readiness、确认动作和危险操作分组，不把整个 domain 塞进一张万能 Card。

公开页面只消费 public DTO/read model。email、QQ、`studentId`、`authId`、教育证据、管理员范围和内部备注默认不进入 public HTML/Client props。

长期 Team membership、Entry roster、EventRoster、MatchRoster 和 StageRun entrant 是不同事实；UI 必须使用对应业务名称，不能为了简化展示把一种状态冒充另一种。

## Dense data

表格和高密度列表遵守：

- 稳定列序和可扫描 identity/status/date；密度来自分组与行距，不靠不可读字号。
- 数字使用稳定对齐和 `tabular-nums`；`null/unknown` 与数值 `0` 明确区分。
- 二维 overflow 由最近的局部容器拥有，普通页面不产生 document-level 横向滚动。
- 移动端首屏必须读到 primary identity + primary metric/action；必要时提供摘要/卡片，而不是只把桌面表格横向塞入。
- `ScrollHint` 只表达局部横向内容是否仍可滚动，不拥有 domain navigation。

## List and query interaction

RivalHub 2.6 后，高价值审核队列和 discovery list 共享薄的 interaction primitives：

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
- 文件上传客户端提示、服务端再次验证；敏感材料只呈现任务最小信息。
- qualification、seed、lineup、start 等关键判断展示最新服务端事实，不让乐观 UI 成为最终结论。

高影响操作（比分更正、纪律、裁决/荣誉撤销、归档、名单冻结、开赛等）使用 `InlineConfirm` 或等价明确确认，并继续由服务端授权、审计和 fail-closed validation 保护；浏览器原生 `confirm()` 不替代任务语义。

## Responsive and accessibility

- 320–390px 下关键任务仍可完整完成，按钮不依赖单行空间，长标识不撑破页面。
- 所有操作可键盘到达并有可见 `:focus-visible`；图标按钮提供明确 accessible name。
- heading、label、状态与动态更新可被辅助技术理解；颜色不是唯一信息通道。
- Dialog/Toast 保持合理 focus management；动效支持 `prefers-reduced-motion`。
- 桌面布局可以更密，但不能为了密度牺牲正文、状态和 primary metric 可读性。

## Visual regression

Visual regression 只锁定少量 deterministic reference；功能 E2E 继续验证真实任务。baseline 使用固定 viewport、关闭动画/caret，并尽量排除实时人数、动态时间和其它非确定内容。只有 presentation contract 有预期变化时更新 baseline。

新增 UI pattern 前先确认现有 primitive 是否已经拥有该职责；如果新模式确实跨页面稳定，再收口 shared contract，而不是在每个 consumer 各写一份样式和交互。
