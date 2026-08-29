# RivalHub UI 系统

## 产品语言

面向参赛者和管理员的功能文案使用自然中文，先表达业务目的、状态与下一步。工程术语可以留在代码和工程文档中，但不要直接把 `Capability`、`Experimental`、`Advanced`、`StageRun`、`canonical`、`rule snapshot` 或 `executor` 当作产品功能标签。

CS2 canonical position names 保持英文：`igl`、`awper`、`opener`、`closer`、`anchor`。它们是数据值与产品标签的统一专有名词；解释文案可以补充语境，不建立自创中文映射。

## Tokens and typography

使用项目已有 Tailwind CSS v4 tokens 与 shadcn/ui primitives。颜色承载语义而非唯一信息：成功、警告、错误、信息与中性状态要有明确层级；字体、字号和字重应区分页面标题、区块标题、正文、辅助信息与数据值。

## Spacing and hierarchy

- 用一致的 spacing scale 组织页面、卡片、表单组与行动区。
- 一个视图优先呈现当前目标、关键状态、blocker 和下一步，再呈现辅助历史。
- 管理视图把高风险/不可逆操作与普通编辑分组，并在执行前说明影响。
- 表格优先可扫描：稳定列序、明确空态、可读日期与移动端替代布局。

## Forms and feedback

- 在字段附近提供可操作的验证反馈；服务端错误不得被客户端提示掩盖。
- 提交过程显示 pending、成功和失败状态，避免重复提交。
- 不完整数据应显示不可用/待补齐与具体 CTA，不能以空数组或伪造 `0:0` 掩盖事实。
- 对资格、名单和开赛 readiness，展示具体 blocker 与其 owner 的下一步。

## Responsive and accessibility

- 关键任务在窄屏可完成；宽表格提供可滚动或摘要布局。
- 保持可见焦点、键盘可达、正确 label、语义化 heading 与足够对比度。
- 图标按钮提供文字或 aria label；颜色状态附带文本/图形提示。
- Dialog、Toast 和动态更新需要可理解的焦点与读屏行为。

组件文件与页面快照会随产品演进；本文件维护系统性原则，而不是逐页面按钮清单。
