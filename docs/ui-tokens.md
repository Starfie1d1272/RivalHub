# 设计 Tokens

> 所有 token 已在 `src/app/globals.css` 中以 CSS 自定义属性定义，并在 `tailwind.config.ts` 中映射为 Tailwind class。

---

## 色板

### 背景（三层）

| Token | 值 | 用途 |
|---|---|---|
| `--bg-base` | `#0d0f14` | 页面底色（body 背景） |
| `--bg-elevated` | `#161b22` | 卡片、侧边栏、下拉菜单 |
| `--bg-overlay` | `#1e2530` | Modal、Tooltip、悬浮层 |

### 文字（三层）

| Token | 值 | 用途 |
|---|---|---|
| `--text-primary` | `#e6edf3` | 正文、标题 |
| `--text-secondary` | `#8b949e` | 辅助说明、元信息 |
| `--text-muted` | `#484f58` | 占位符、禁用态文字 |

### 分隔线

| Token | 值 | 用途 |
|---|---|---|
| `--border` | `#30363d` | 卡片边框、分割线、表格行线 |

### 赛季动态主题色

每个赛季通过 `seasons.theme_color` 配置独立主题色，在赛季 layout 中注入 `--season-primary` CSS 变量。业务组件统一使用 `var(--season-primary)`，无需关心具体颜色值。

示例主题色参考：

| 风格 | 值 | 适用场景 |
|---|---|---|
| 橙色 | `#f97316` | 选秀联赛等活力型赛事 |
| 红色 | `#ef4444` | 杯赛等竞技型赛事 |
| 蓝色 | `#3b82f6` | 休闲赛等友好型赛事 |
| 青色 | `#06b6d4` | 表演赛等娱乐型赛事 |

### 语义色

| 用途 | 值 |
|---|---|
| 成功（绿） | `#22c55e` |
| 警告（黄） | `#eab308` |
| 错误（红） | `#ef4444` |
| 信息（蓝） | `#3b82f6` |

---

## 字体

### 字体族

| 字体 | CSS 变量 | 用途 |
|---|---|---|
| Inter | `var(--font-inter)` | 英文、数字 |
| Noto Sans SC | `var(--font-noto-sans-sc)` | 中文 |

`font-family: var(--font-inter), var(--font-noto-sans-sc), sans-serif;`

### 字号阶梯

| 级别 | 尺寸 | 行高 | 使用场景 |
|---|---|---|---|
| `text-xs` | 12px | 1.5 | 时间戳、标签 |
| `text-sm` | 14px | 1.5 | 辅助文字、按钮 |
| `text-base` | 16px | 1.6 | 正文 |
| `text-lg` | 18px | 1.5 | 小标题 |
| `text-xl` | 20px | 1.4 | 卡片标题 |
| `text-2xl` | 24px | 1.3 | 页面副标题 |
| `text-3xl` | 30px | 1.3 | 页面主标题 |
| `text-4xl` | 36px | 1.2 | 英雄区大标题 |

### 字重

| 级别 | 值 | 使用场景 |
|---|---|---|
| `font-normal` | 400 | 正文、说明 |
| `font-medium` | 500 | 强调正文 |
| `font-semibold` | 600 | 按钮、小标题 |
| `font-bold` | 700 | 标题、数据展示 |

---

## 间距阶梯

使用 Tailwind 默认 4px 基准：`p-1=4px / p-2=8px / p-3=12px / p-4=16px / p-6=24px / p-8=32px`

| 用途 | 推荐间距 |
|---|---|
| 组件内边距（卡片） | `p-4`（16px）或 `p-6`（24px） |
| 按钮内边距 | `px-4 py-2` |
| 表单字段间距 | `space-y-4` |
| 段落间距 | `space-y-3` |
| 卡片网格 gap | `gap-4`（16px）或 `gap-6` |
| 页面容器 | `container mx-auto px-4` |
| 页面上下边距 | `py-8`（32px）或 `py-16` |

---

## 圆角

| Token | 值 | 用途 |
|---|---|---|
| `--radius` | `0.5rem`（8px） | 标准圆角（卡片、输入框）|
| `rounded-sm` | 6px | 小元素（badge、tag） |
| `rounded-md` | 6px（calc(--radius - 2px)） | 中等元素 |
| `rounded-lg` | 8px | 卡片、面板 |
| `rounded-full` | 9999px | 圆形按钮、头像 |

---

## 阴影

| 用途 | Tailwind class |
|---|---|
| 卡片默认 | 无阴影（靠 border 区分层次） |
| 卡片悬停 | `shadow-md`（按需添加） |
| Modal/Overlay | `shadow-xl` |
| Dropdown | `shadow-lg` |

---

## Avoid 列表

以下风格**禁止**使用：
- 霓虹发光效果（`text-shadow: 0 0 10px ...`）
- 渐变 Logo / 渐变标题文字（`bg-gradient-to-r` on text）
- 表情符号（emoji）出现在 UI 组件中
- 白色背景页面（全站深色基底）
- 圆角 > 16px（除 `rounded-full` 外）
- 高饱和度色块大面积背景
