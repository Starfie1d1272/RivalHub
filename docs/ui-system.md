# RivalHub UI 系统

## 产品语言

参赛者与管理员界面使用自然中文，优先表达当前目标、状态、未满足项和下一步。工程术语保留在代码与技术文档中；产品入口按赛事、报名、赛程、名单、资格和赛务等业务语义命名。

不以语言本身判断文案质量：品牌名、CS2/赛事通用缩写，以及不承担业务判断的短英文 marker 可以保留。用户无需理解内部 key、enum 或领域实现词才能完成任务；状态、原因和 CTA 必须使用明确的 presentation 文案。账号入口统一区分「我的参赛」（私有参赛任务）、「个人主页」（公开资料）与「账号设置」。

CS2 canonical position names 保持英文：`igl`、`awper`、`opener`、`closer`、`anchor`。它们是数据值与产品标签的统一专有名词；说明文字可补充语境。

赛事创建先选择 Rivals、Major 或自定义赛事。标准赛事界面只展示业务规则与必要设置；自定义赛事使用结构化阶段、位置与图池编辑器。公开 `/privacy` 是隐私说明入口，设置导航只保留可操作的资料页面。

## Token ownership

视觉 token 的 source of truth 是 `src/app/globals.css` 的 `@theme` 与 `:root`。当前语义值直接定义在 `@theme`；shadcn/Tailwind 名称只是指向这些值的 bridge alias，不得重新引入一套 HSL 数值或单页色板。组件使用既有 token，不为单页创建平行色板。

| Token family | 用途 |
|---|---|
| `--color-bg` / `--color-panel*` / `--color-surface-*` | 页面、Panel 与浮层层级 |
| `--color-scrim` | Dialog 等 overlay 的页面遮罩 |
| `--color-border*` | 静态与交互边框 |
| `--color-fg*` | 正文、辅助信息、禁用信息 |
| `--color-accent*` / `--color-accent-b*` | 主操作与对阵实体 |
| `--color-ok*` / `--color-warn*` / `--color-danger*` / `--color-info*` | 语义状态 |
| `--font-sans` / `--font-display` / `--font-mono` | 正文、标题、标签/标识 |
| `--radius*` | 紧凑一致的控件与卡片圆角 |

组件 contract：

- `Panel.className` 只表达外层 surface 的几何、边框、宽度和交互；正文排版、间距与正文布局使用 `contentClassName`。`Panel` 不再接受数字 `pad`，避免同一组件存在两套 spacing API。
- `PageHeader` 输出语义页面标题，可组合 eyebrow、description、status 与 actions；`SectionHeader`/`Section` 用于区块标题与垂直节奏。`Marker` 只保留给紧凑 tactical marker，不承担页面 heading。
- `PageLayout` 统一页面 gutter，并提供 `narrow`、`standard`、`wide`、`workbench` 四种宽度变体；默认输出 `div`，不嵌套根布局已经提供的 `main`。密集赛务页面使用 `workbench`，其父级不得用窄的固定 `max-width` 截断子工作台。
- `DialogContent` 统一 viewport gutter、最大高度、surface、边框、focus 与 reduced-motion 基线，并用 `size="sm|md|lg|xl"` 管理宽度；长内容放入 `DialogBody`，操作放入 `DialogFooter`，不在消费者重复实现滚动容器或 max-width contract。
- `--color-scrim` 只用于页面遮罩；Dialog/AlertDialog surface 使用 `--color-surface-floating`，遮罩与浮层不得共用同一语义 token。
- `EmptyState`、`ErrorState`、`StatusBanner`、`Checklist`、`InlineConfirm` 和 `Spinner` 的解释/反馈文字使用 readable secondary text；10–11px mono 仅保留给 code、marker、ticker 和 compact metadata。

颜色表达语义时必须同时提供文字、图标或结构性反馈；accent 不替代 success、warning 或 danger。字体、字号和字重至少区分页面标题、区块标题、正文、辅助信息与数据值。

## Information hierarchy and layout

- 页面先呈现当前任务与最关键事实，再呈现历史和辅助操作。
- 管理视图把可编辑内容、资格/blocker、确认动作和危险操作分组。
- `Panel` 承载同一业务区块；`StatusBanner` 用于状态解释；`Checklist` 用于多项 readiness；`StatusPill` 用于紧凑状态；`EmptyState`、`ErrorState` 和 `Skeleton` 表达专门状态。
- 表格保持稳定列序、可扫描日期/状态和明确空态；窄屏提供卡片、摘要或可滚动替代布局。

## Dense data and overflow

Raw `<table>` 与 shadcn `Table` 继续由各自的 domain consumer 使用。本文件冻结跨页面的 presentation contract；Table implementation 以及 query、search、sort、filter 和 pagination 语义，仍由各自 owner 负责。

- 表头与数据行保持清楚层级；密度来自稳定分组与行距，不靠不可读的小字号。
- 数字列默认使用 `tabular-nums`，需要比较大小时优先右对齐或其它稳定对齐方式。
- `null`、`unknown` 与未提供数据使用明确的 `—` 或对应状态；missing 与数值 `0` 保持可区分。
- 横向二维数据由最近的局部容器拥有 `overflow-x-auto`，页面与 document 的宽度保持在自身 layout contract 内。
- identity / label 列保持可扫描；sticky column 只有在真实任务明显受益时才使用。
- 移动端若 primary metric 会因横滚而首屏不可读，应额外提供摘要、卡片或主指标呈现；具体页面转换由对应页面与列表 owner 负责。

`ScrollHint` 的责任是表达局部容器仍有可横向滚动内容：无 overflow 时不显示提示，滚动到一侧时只显示另一侧，滚动中间时显示两侧。它保留 `pointer-events-none` 与 `fromColor` 语义；domain navigation 由业务组件负责，页面级 overflow 由 page layout contract 负责。

## Loading, empty and error states

每个数据区显式处理三态：

| 状态 | 要求 |
|---|---|
| Loading | 使用与最终内容尺寸接近的 `Skeleton`，不制造跳动布局 |
| Empty | 说明当前没有什么、为何为空，以及可执行时的下一步 CTA |
| Error | 保留页面上下文，显示可理解错误与重试/下一步；Toast 不替代页面内错误状态 |

资格、名单、预启动和赛前检查的不可用状态必须显示具体 blocker 与其 owner 的下一步，不能以空数组、默认值或伪造比分掩盖事实。

## Forms and feedback

- 使用既有 shadcn/ui control 与 label；字段级校验贴近字段，服务端错误必须保留给用户。
- 提交过程显示 pending、成功和失败，避免重复 mutation。
- 表单按任务分组；长期 profile、赛事报名与单场 roster 不混成同一编辑面。
- 文件上传在客户端提示格式/大小，在服务端再次校验；敏感材料只展示任务所需的最小信息。
- 对成员确认、资格、种子、首发和开赛，UI 展示最新服务端判断，不以本地乐观状态替代最终结论。

## Data and privacy presentation

公开页面只使用 public DTO/read model。email、QQ、`studentId`、`authId`、管理员范围、教育证据、内部备注和审核材料默认不显示。长 email、Steam64、Perfect ID 等标识在窄屏使用 `break-all`、截断加复制操作或独立 mono 行，避免横向溢出。

比赛阵容、报名预定主力、正式 team membership 与 StageRun entrant 是不同层次的事实；界面必须使用对应业务名称，不把一种状态显示成另一种。

## Dangerous actions

比分更正、纪律处理、裁决/荣誉撤销、归档、名单确认和开赛等高影响操作使用 `InlineConfirm` 或等效的明确确认：说明影响、指出不可逆或后续边界，并保留服务器端授权、审计和 fail-closed validation。浏览器原生确认框不能替代该任务语义。

## Responsive behavior

| 断点 | 优先级 |
|---|---|
| 320–390px | 单列任务流；操作按钮不依赖同一行空间；状态与长标识不溢出 |
| 640px (`sm`) | 表单与信息卡开始使用紧凑双列 |
| 768px (`md`) | 表格可切换为卡片/分段；资料和导航可双列 |
| 1024px+ | 管理审核可并列展示资格摘要与名单；保持文本解释而非只靠密集表格 |

关键用户任务必须在窄屏完成，不能把桌面表格作为唯一入口。

## Accessibility

- 所有操作可键盘到达并具有可见焦点；图标按钮提供可见文本或 aria label。
- heading 层级、label、状态文本和对比度必须可被辅助技术理解。
- Dialog、Toast 和动态更新保留合理焦点管理与读屏提示。
- 颜色、形状与文本共同表达比赛、资格和错误状态。
- `:focus-visible` 使用全局可见 focus ring；动效必须允许 `prefers-reduced-motion: reduce` 关闭或压缩。

本文件维护跨页面的 UI contract。组件实现和页面组合可演进，但新增模式应先复用现有 token 与 shared component 语义。

## Visual regression governance

Visual regression 只锁定少量 deterministic reference，功能 E2E 继续验证真实用户任务。reference 应来自真实页面 consumer，并满足以下条件：

- 以目标 heading 或页面内容可见作为 readiness；
- 优先截图页面主内容区域，把动态导航、在线人数、实时赛事时间和随机内容排除在 baseline 外；
- 使用固定 viewport、既有 Playwright project，并在截图时关闭动画与 caret；
- baseline 命名包含页面与状态语义；只有预期的 presentation contract 变化才更新 baseline。
- 当前没有稳定可复用的 admin/dense browser fixture，因此暂不建立 dense screenshot baseline；待首个稳定 fixture 建立后按本 contract 补入。

页面应保持自身 layout contract；普通内容不产生页面级横向溢出，二维数据只在局部容器内滚动。本文件定义跨页面 presentation，页面 IA、domain rule 与列表 query/sort/filter semantics 由对应 owner 负责。
