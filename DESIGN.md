---
name: RivalHub
description: 以深色面板与清晰的赛况层级组织公开赛事和办赛操作。
colors:
  primary: "#ff6b1a"
  primary-foreground: "#0a0c10"
  primary-soft: "rgba(255, 107, 26, 0.12)"
  accent-b: "#3aa1ff"
  bg: "#0a0c10"
  panel: "#10131a"
  panel-low: "#0d1016"
  panel-hi: "#161a24"
  scrim: "rgba(3, 6, 10, 0.84)"
  border: "#1f2530"
  border-hi: "#2c3340"
  border-control: "#64738a"
  fg: "#e7ecf3"
  fg-mid: "#8e96a3"
  fg-essential: "#b8c0cc"
  fg-dim: "#525a6a"
  ok: "#4dd47a"
  warn: "#ffc44d"
  danger: "#ff5470"
  danger-fg: "{colors.bg}"
  info: "#4a9eff"
typography:
  event-display:
    fontFamily: 'Geist, "Geist Fallback", "Noto Sans SC Variable", "Noto Sans SC Fallback", system-ui, sans-serif'
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: "-0.025em"
  page-title:
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: "2.25rem"
    letterSpacing: "-0.025em"
  section-title:
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: "1.75rem"
  body:
    fontFamily: 'Geist, "Geist Fallback", "Noto Sans SC Variable", "Noto Sans SC Fallback", system-ui, sans-serif'
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  control:
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: "1.25rem"
  nav-label:
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: "1rem"
  nav-current:
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: "1rem"
  panel-label:
    fontFamily: '"JetBrains Mono", "JetBrains Mono Fallback", ui-monospace, monospace'
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0.12em"
  dense-metadata:
    fontFamily: '"JetBrains Mono", "JetBrains Mono Fallback", ui-monospace, monospace'
    fontSize: "10px"
    fontWeight: 600
    letterSpacing: "0.12em"
  badge-mono:
    fontFamily: '"JetBrains Mono", "JetBrains Mono Fallback", ui-monospace, monospace'
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: "1rem"
    letterSpacing: "0.12em"
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  display: "12px"
spacing:
  unit: "0.25rem"
  gutter: "1rem"
  gutter-sm: "1.5rem"
  gutter-lg: "2rem"
  section-gap: "0.75rem"
  panel-padding: "1rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.control}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 1rem"
    height: "2.5rem"
  button-secondary:
    backgroundColor: "{colors.panel-hi}"
    textColor: "{colors.fg}"
    typography: "{typography.control}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 1rem"
    height: "2.5rem"
  button-outline:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.fg}"
    typography: "{typography.control}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 1rem"
    height: "2.5rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.fg}"
    typography: "{typography.control}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 1rem"
    height: "2.5rem"
  button-destructive:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.danger-fg}"
    typography: "{typography.control}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 1rem"
    height: "2.5rem"
  button-link:
    textColor: "{colors.primary}"
    typography: "{typography.control}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 1rem"
    height: "2.5rem"
  input:
    backgroundColor: "{colors.panel-low}"
    textColor: "{colors.fg}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 0.75rem"
    height: "2.5rem"
  badge-mono:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary}"
    typography: "{typography.badge-mono}"
    rounded: "{rounded.sm}"
    padding: "0.125rem 0.625rem"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.fg}"
    rounded: "{rounded.sm}"
  nav-link:
    textColor: "{colors.fg-mid}"
    typography: "{typography.nav-label}"
    rounded: "{rounded.sm}"
    padding: "0.375rem 0.75rem"
  nav-current:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.fg}"
    typography: "{typography.nav-current}"
    rounded: "{rounded.sm}"
    padding: "0.375rem 0.75rem"
---

# Design System: RivalHub

## Overview

**Creative North Star: "赛事控制台"**

公开页让观众快速找到赛况与对阵，赛事主视觉用大标题和主色建立焦点。

数据和赛务工作区用安静的背景、紧凑的文字层级和对齐的数字支撑连续阅读与操作。

**Key Characteristics**

- 深色背景上用面板明度和细边框划分内容。
- 主色标示操作与焦点，对阵色区分双方，赛况与状态保留文字标记。
- 标题与正文使用无衬线字，比分、阶段标签和紧凑指标用等宽字。

本文是当前设计的提取快照。运行时数值由根样式与组件拥有，跨页面交互约定由 UI 系统维护。[根样式](src/app/globals.css) · [UI 系统](docs/ui-system.md)

## Colors

### Primary

`primary` 是橙色主色，用于主操作、选中边与聚焦。填色按钮搭配 `primary-foreground`，淡主色底沿用 `primary-soft`。赛事保留原始选色；在当前深色面板上，使用同色相的可读主色、配对前景和焦点色。赛事内的菜单、对话框和帮助浮层沿用本届语义色，浮层背景仍用中性面板。[赛事主题](src/lib/utils/color.ts)

### Secondary

`accent-b` 是蓝色对阵色，用于区分另一方。信息状态使用单独的 `info`。

### Neutral

`bg` 是背景色。常规内容用 `panel`，内嵌字段和指标用 `panel-low`，浮层与高亮表面用 `panel-hi`。静态分隔用 `border`，输入和选择使用 `border-control`；聚焦使用独立焦点色。危险填色与 `danger-fg` 配对。

正文使用 `fg`，次要描述用 `fg-mid`。关键次级信息使用 `fg-essential`，最弱的 `fg-dim` 留给装饰或禁用提示。绿、黄、红分别承载成功、警告和危险，配合文字、图标或结构表达状态。[配色与状态约定](docs/ui-system.md#tokens-and-primitives)

## Typography

源码为标题和正文配置 Geist 与 Noto Sans SC，等宽字为 JetBrains Mono。字体变量在根作用域定义，标题和正文先使用 Geist，中文使用本地 Noto Sans SC。[字体配置](src/app/layout.tsx) · [根样式](src/app/globals.css)

- 赛事主标题随视口在 34–70 px 之间伸缩（`clamp(34px, 4.7vw, 70px)`）。普通页标题从窄屏 24 px 切换到 30 px，区块标题用 18 px。[赛事主视觉](src/components/home/HomeHero.tsx) · [共享页头](src/components/rivalhub/PageHeader.tsx)
- 正文基准 16 px。紧凑描述与操作用 14 px，短导航和状态可用 12 px，11 px 等宽字用于面板标签，10 px 等宽字限于紧凑编号与阶段元数据。草稿回执、错误、按钮与资格说明使用各自的正文或控件字号。
- 比分和密集表格对齐数值，使用等宽数字；中文操作指引保持自然断行，专业短标签可以保留英文。[密集数据](docs/ui-system.md#dense-data) · [产品语言](docs/ui-system.md#product-language)

## Layout

`PageLayout` 统一页面宽度、左右留白与顶部、底部间距。四种宽度分别为聚焦任务 48 rem、常规详情 64 rem、赛事与目录 1440 px、数据与操作工作区 1760 px。页面左右留白随断点从 16 px 增至 24 px 和 32 px，纵向基础间距 32 px。[页面容器](src/components/rivalhub/Layout.tsx)

窄屏将页头和操作组上下排列。长队名和操作可换行，宽表在自己的容器内横向滚动，保持页面和主要任务可达。顶栏在 40 rem 以下切换为可展开菜单。[顶栏](src/components/layout/HeaderClient.tsx) · [响应式与无障碍约定](docs/ui-system.md#responsive-and-accessibility)

## Elevation & Depth

主要层级由面板明度和边框建立。常规卡片只有轻微阴影，可交互面板悬停时上移 2 px 并增强边框。菜单与对话框用更明显的阴影和较亮的浮层面，对话框叠加深色遮罩。低透明网格与径向色晕用于赛事展示面，分析、表单和操作区保留纯色表面。[内容面板](src/components/rivalhub/Panel.tsx) · [对话框](src/components/ui/dialog.tsx) · [根样式](src/app/globals.css)

## Shapes

按钮、字段、状态标记和普通面板以 4 px 小圆角为主。移动端导航和部分指标块用 8 px，赛事主视觉用 12 px。阶段指示器与普通状态标记共用小圆角。全圆形用于状态点、徽记与头像；比分、地图序号和赛事主视觉按展示角色独立定尺寸。[根样式](src/app/globals.css) · [指标块](src/components/rivalhub/Stat.tsx)

## Components

- **按钮** 默认 40 px 高，主操作实色填充，次级操作用较亮面板、描边、透明底或文字按钮。危险动作使用对应语义色。焦点用 2 px 环与 2 px 偏移，待处理和禁用态有不同透明度。[Button](src/components/ui/button.tsx)
- **字段** 输入框用内嵌底色和单像素边框。文字在窄屏保持 16 px，48 rem 起为 14 px。字段说明和错误靠近对应控件，提交状态保留可辨的文字反馈。[Input](src/components/ui/input.tsx) · [表单约定](docs/ui-system.md#forms-and-mutations)
- **标签与状态** 等宽 Badge 使用淡主色底、同色描边和紧凑字距。StatusPill 使用对应状态色的淡底与边框，文字直述状态。[Badge](src/components/ui/badge.tsx) · [StatusPill](src/components/rivalhub/StatusPill.tsx)
- **内容面板** 单像素边框组织同一业务区块，内容默认留白 16 px。可选标题栏用等宽字与底部分隔线，对阵面板可使用 3 px 顶边标识队伍。[Panel](src/components/rivalhub/Panel.tsx)
- **导航** 桌面顶栏的当前入口用亮文字、面板底和主色下边。移动菜单用可换行的纵向链接，通过背景和字重标示当前位置。[HeaderNavigation](src/components/layout/HeaderNavigation.tsx)
- **赛事编号** 展示区块可以用括号中的橙色等宽编号引导视线，标题和可选英文短标签依次降低强调度。普通页面区块沿用语义标题组件。[Marker](src/components/rivalhub/Marker.tsx) · [SectionHeader](src/components/rivalhub/PageHeader.tsx)

## Do's and Don'ts

### Do

- **Do** 从共享组件选择页面宽度、控件和状态样式。新增赛事主色时同时使用该主题对应的按钮前景和焦点色。
- **Do** 保持键盘焦点可见，并为状态提供颜色以外的可读信息。交互动效随 `prefers-reduced-motion` 降低。

### Don't

- **Don't** 用 10–11 px 等宽标签或装饰弱色承载正文、操作指引和关键状态。
- **Don't** 给数据、表单和赛务工作区铺赛事展示面的网格或色晕。
