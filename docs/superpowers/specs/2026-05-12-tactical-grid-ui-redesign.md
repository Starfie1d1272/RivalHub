# Tactical Grid UI 重构设计

Date: 2026-05-12 | Variant: A (Tactical Grid) | 迁移策略: 分层渐进 (tokens → 组件 → 页面)

## 目标

将 RivalHub 前端从当前 ad-hoc 暗色主题迁移到 Tactical Grid 设计系统（源于 `RivalHub Handoff.html` + `variants.jsx` 的 Variant A），达成全站统一的设计语言、字体层级和组件模式。

## 设计文件

- 设计规格: `RivalHub Handoff.html` — tokens、组件映射、Tailwind 配置、工程清单
- 原型代码: `components.jsx` / `states.jsx` / `screens-1~7.jsx` — 各页面布局与组件实现
- 变体定义: `variants.jsx` → `variantA_TacticalGrid()`

## 不在 scope

- Variant B (Neon Brutalism) / Variant C (Broadcast Studio) — 仅实现 Variant A
- 移动端响应式 — 当前设计稿只有桌面端
- 功能逻辑改动 — 本次重构只碰 UI 层（样式 + 组件结构），不改变 Server Action、数据流、路由逻辑
- Recharts 主题 — P6（Player 页面）阶段再做 `chartTheme.ts`

---

## 第 1 层：CSS Tokens

修改文件: `src/app/globals.css`

### 颜色 Palette

所有颜色定义为 Tailwind v4 `@theme` 块中的 `--color-*`，替换当前 `:root` 变量：

| Token | 值 | 用途 |
|---|---|---|
| `--color-bg` | `#0a0c10` | 页面背景 |
| `--color-panel` | `#10131a` | 卡片 / 默认面板 |
| `--color-panel-hi` | `#161a24` | 高亮面板 / header |
| `--color-panel-low` | `#0d1016` | 输入框 / hover 底色 |
| `--color-border` | `#1f2530` | 分割线 / 结构边框 |
| `--color-border-hi` | `#2c3340` | focus / hover 边框 |
| `--color-fg` | `#e7ecf3` | 主文字 |
| `--color-fg-mid` | `#8e96a3` | 辅助文字 |
| `--color-fg-dim` | `#525a6a` | 标签 / 元数据 |
| `--color-accent` | `#ff6b1a` | 主强调色 / CTA |
| `--color-accent-soft` | `rgba(255,107,26,0.12)` | accent 背景 |
| `--color-accent-edge` | `rgba(255,107,26,0.34)` | accent 边框 |
| `--color-accent-fg` | `#0a0c10` | accent 上的文字 |
| `--color-ok` | `#4dd47a` | 成功 / 胜利 |
| `--color-warn` | `#ffc44d` | 等待中 / 截止临近 |
| `--color-danger` | `#ff5470` | 错误 / 失败 / LIVE 点 |

### Shadcn HSL 兼容变量

在 `@layer base` 中保留 shadcn CSS 变量，值映射到新 palette：

- `--background: 220 16% 6%` (#0a0c10)
- `--foreground: 220 18% 93%` (#e7ecf3)
- `--card: 222 16% 9%` (#10131a)
- `--primary: 21 100% 55%` (#ff6b1a)
- `--destructive: 348 100% 66%` (#ff5470)
- `--border: 220 22% 16%` (#1f2530)
- `--ring: 21 100% 55%`
- `--radius: 3px`

### 字体

```
--font-sans: 'Geist', 'Noto Sans SC', system-ui, sans-serif
--font-display: 'Geist', 'Noto Sans SC', system-ui, sans-serif
--font-mono: 'JetBrains Mono', ui-monospace, monospace
```

### Letter Spacing

```
--tracking-tight-2: -0.02em    (display xl)
--tracking-tight-1: -0.01em    (display md)
--tracking-label: 0.12em       (mono labels, uppercase)
--tracking-ticker: 0.08em      (ticker / live text)
--tracking-eyebrow: 0.18em     (section eyebrow)
```

### 圆角

```
--radius-sm: 0px     (chips, buttons, badges)
--radius-md: 2px     (stat tiles, avatars)
--radius-lg: 3px     (cards, panels)
--radius: 3px        (shadcn 默认半径)
```

### Body 样式

- `background-color: var(--color-bg)`
- Hairline grid: `background-image: linear-gradient(rgba(31,37,48,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(31,37,48,0.4) 1px, transparent 1px)`
- `background-size: 32px 32px`
- 删除现有 `.card-elevated`、`.season-glow` 类（由新组件替代）

### Skeleton 动画

替换 shadcn 默认 `animate-pulse`：

```css
@keyframes skeleton-sweep {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.skeleton {
  background: linear-gradient(90deg, hsl(var(--card)) 0%, hsl(var(--border)) 40%, hsl(var(--card)) 80%);
  background-size: 200% 100%;
  animation: skeleton-sweep 1.4s ease-in-out infinite;
}
```

### 删除项

- `--bg-base` / `--bg-elevated` / `--bg-overlay`（替换为 `bg` / `panel` / `panel-hi`）
- `--text-primary` / `--text-secondary` / `--text-muted`（替换为 `fg` / `fg-mid` / `fg-dim`）
- `--border-strong`（替换为 `border-hi`）
- `--season-primary` / `--season-primary-rgb`（替换为 `accent`）

---

## 第 2 层：字体与 Layout

修改文件: `src/app/layout.tsx`

- `Inter` → `Geist`（`next/font/google`，subsets: latin）
- 新增 `JetBrains_Mono`（variable: `--font-mono`）
- `Noto_Sans_SC` 保留，weight: 400/500/600/700
- `<body>` className 添加 `--font-mono` variable
- 全局搜索替换 `var(--font-inter)` → `var(--font-geist)`（若存在）

---

## 第 3 层：RivalHub 组件库

目录: `src/components/rivalhub/`（12 个组件，3 批）

### 第一批：基础组件

| 组件 | 实现 |
|---|---|
| **Panel** | 包装 shadcn `<Card>`，统一 header (mono label + border-bottom) + body padding |
| **Btn** | 包装 shadcn `<Button>`，覆盖 variant 为 accent/ghost/danger |
| **Stat** | 纯 div + Tailwind，label(mono) + value + sub |
| **MiniStat** | 紧凑版 Stat，右对齐，用于表格列 |
| **Marker** | eyebrow(mono accent) + title(display) + sub(mono)，section header |
| **Field** | `<Label>`(mono tracking) + `<Input>` 组合 |

### 第二批：状态组件

| 组件 | 实现 |
|---|---|
| **StatusBanner** | `<Alert>` + `border-l-[3px]`，5 种 tone |
| **InlineConfirm** | Alert + 两个 Button，inline 非 modal |
| **EmptyState** | Card + Button 拼装 |
| **ErrorState** | EmptyState + 错误码标签 + 重试按钮 |
| **Skeleton** | 替换 shadcn，用 sweep 动画 |

### 第三批：业务组件

| 组件 | 实现 |
|---|---|
| **TeamBadge** | 基于 shadcn `<Avatar>`，rounded-sm + team.color |
| **PosChip** | 基于 shadcn `<Badge>`，mono + accent 配色 |
| **StatusPill** | 基于 shadcn `<Badge>`，5 种状态 variant |

---

## 第 4 层：Shadcn 组件覆盖

修改现有 `components/ui/*.tsx`，不改结构只改类名：

| 文件 | 改动 |
|---|---|
| `button.tsx` | rounded-sm, primary → accent colors |
| `card.tsx` | rounded-lg (3px) |
| `badge.tsx` | rounded-sm, 新增 mono variant |
| `skeleton.tsx` | animate-pulse → skeleton-sweep |
| `input.tsx` | rounded-sm, bg-panel-low |
| `alert.tsx` | 支持 `border-l-[3px]` |

其余组件（dialog、dropdown-menu、select、table、tabs、separator、sonner、textarea、label）由 CSS 变量驱动自动适配，无需修改。

---

## 第 5 层：页面渐进迁移

每完成一个阶段提交一次。先打通"看"再打通"操作"。

| 阶段 | 路由 | 设计稿 | 内容 |
|---|---|---|---|
| **P1** | `/`, `/login`, `/invite` | screens-1.jsx LandingScreen, screens-7.jsx LoginScreen/InviteScreen | Landing hero + nav tiles + 登录/邀请表单 |
| **P2** | `/[seasonSlug]`, `/[seasonSlug]/register`, `/[seasonSlug]/captains` | screens-1/2.jsx | 赛季 home + 报名表单 + 投票面板 |
| **P3** | `/[seasonSlug]/draft` | screens-3.jsx | 选秀直播间 (命令栏 + 队网格 + 选手池) |
| **P4** | `/[seasonSlug]/teams`, `/teams/[id]` | screens-4.jsx | 队伍列表 + 队伍详情 |
| **P5** | `/[seasonSlug]/matches`, `/matches/[id]` | screens-5.jsx | 赛程 bracket + 记分板 |
| **P6** | `/[seasonSlug]/stats`, `/players/[id]` | screens-6/7.jsx | 数据排行 + 选手主页 (含 Recharts) |
| **P7** | `/admin/**` | screens-6.jsx AdminScreen | 管理后台 |

### 每阶段 pattern

1. 对比设计稿 (`screens-N.jsx`) 和当前页面
2. 用 `components/rivalhub/` 新组件重写 JSX 结构
3. 保留 Server Component 数据获取逻辑不变
4. 类型检查通过 (`pnpm tsc --noEmit`)
5. Git commit（一个阶段一个 commit）

---

## 实施顺序

```
Layer 1 (tokens) ──► Layer 2 (fonts) ──► Layer 3 (rivalhub/ components)
       │                                          │
       └── Layer 4 (shadcn overrides) ────────────┘
                          │
                          ▼
              Layer 5 (页面: P1 → P2 → ... → P7)
```

Layer 1-4 是一次性基础铺设（1-2 个 commit），Layer 5 是 7 个阶段逐页迁移（每阶段 1 commit）。

## Branch

在 `dev` 分支上操作（已切回）。

## 引用

- 设计 Handoff: `RivalHub Handoff.html` §01–§09
- 原型组件: `components.jsx` / `states.jsx`
- 变体 tokens: `variants.jsx` → `variantA_TacticalGrid()`
- 页面设计: `screens-1.jsx` – `screens-7.jsx`
