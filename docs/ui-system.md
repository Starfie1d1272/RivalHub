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
| `--color-bg` / `--color-panel*` | 页面与 Panel 层级 |
| `--color-border*` | 静态与交互边框 |
| `--color-fg*` | 正文、辅助信息、禁用信息 |
| `--color-accent*` / `--color-accent-b*` | 主操作与对阵实体 |
| `--color-ok*` / `--color-warn*` / `--color-danger*` / `--color-info*` | 语义状态 |
| `--font-sans` / `--font-display` / `--font-mono` | 正文、标题、标签/标识 |
| `--radius*` | 紧凑一致的控件与卡片圆角 |

组件 contract：

- `Panel.className` 只表达外层 surface 的几何、边框、宽度和交互；正文排版、间距与正文布局使用 `contentClassName`。`Panel` 不再接受数字 `pad`，避免同一组件存在两套 spacing API。
- `PageHeader` 输出语义页面标题，可组合 eyebrow、description、status 与 actions；`SectionHeader`/`Section` 用于区块标题与垂直节奏。`Marker` 只保留给紧凑 tactical marker，不承担页面 heading。
- `PageLayout` 统一页面 gutter，并提供 `narrow`、`standard`、`wide`、`workbench` 四种宽度变体。密集赛务页面使用 `workbench`，其父级不得用窄的固定 `max-width` 截断子工作台。
- `DialogContent` 统一 viewport gutter、最大高度、surface、边框、focus 与 reduced-motion 基线；长内容放入 `DialogBody`，操作放入 `DialogFooter`，不在消费者重复实现滚动容器。

颜色表达语义时必须同时提供文字、图标或结构性反馈；accent 不替代 success、warning 或 danger。字体、字号和字重至少区分页面标题、区块标题、正文、辅助信息与数据值。

## Information hierarchy and layout

- 页面先呈现当前任务与最关键事实，再呈现历史和辅助操作。
- 管理视图把可编辑内容、资格/blocker、确认动作和危险操作分组。
- `Panel` 承载同一业务区块；`StatusBanner` 用于状态解释；`Checklist` 用于多项 readiness；`StatusPill` 用于紧凑状态；`EmptyState`、`ErrorState` 和 `Skeleton` 表达专门状态。
- 表格保持稳定列序、可扫描日期/状态和明确空态；窄屏提供卡片、摘要或可滚动替代布局。

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
