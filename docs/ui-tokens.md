# 设计 Tokens

> 所有 token 在 `src/app/globals.css` 的 `@theme` 块中定义，Tailwind v4 自动将 `--color-*` 映射为 class（如 `text-[var(--color-accent)]`）。

---

## 色板

### 背景（三层）

| Token | 值 | 用途 |
|---|---|---|
| `--color-bg` | `#0a0c10` | 页面底色（body 背景） |
| `--color-panel` | `#10131a` | 卡片、Panel 默认背景 |
| `--color-panel-hi` | `#161a24` | 高亮 Panel（hover、当前步骤） |
| `--color-panel-low` | `#0d1016` | 沉降背景（表头等） |

### 边框（两层）

| Token | 值 | 用途 |
|---|---|---|
| `--color-border` | `#1f2530` | 默认边框 |
| `--color-border-hi` | `#2c3340` | hover 高亮边框 |

### 文字（三层）

| Token | 值 | 用途 |
|---|---|---|
| `--color-fg` | `#e7ecf3` | 正文、标题 |
| `--color-fg-mid` | `#8e96a3` | 辅助说明、元信息 |
| `--color-fg-dim` | `#525a6a` | 占位符、禁用态、标签 |

### 强调色（Accent）

| Token | 值 | 用途 |
|---|---|---|
| `--color-accent` | `#ff6b1a` | 主 CTA、当前状态、高亮 |
| `--color-accent-soft` | `rgba(255,107,26,0.12)` | 浅底色背景 |
| `--color-accent-edge` | `rgba(255,107,26,0.34)` | 边框高亮 |
| `--color-accent-fg` | `#0a0c10` | accent 背景上的文字色 |

### 语义色

| Token | 值 | 用途 |
|---|---|---|
| `--color-ok` | `#4dd47a` | 成功、完成、胜利 |
| `--color-warn` | `#ffc44d` | 警告、进行中、待定 |
| `--color-danger` | `#ff5470` | 错误、禁止、失败 |
| `--color-info` | `#4a9eff` | 信息型辅助标注（地图标签、决胜图、系统操作） |
| `--color-info-soft` | `rgba(74,158,255,0.12)` | info 浅底色 |
| `--color-info-edge` | `rgba(74,158,255,0.34)` | info 边框 |

> `--color-info` 不替换 accent/ok/warn/danger 的语义，仅用于非 CTA 的辅助标注。

---

## 字体

### 字体族

| 字体 | CSS 变量 | 用途 |
|---|---|---|
| Geist | `var(--font-geist)` | 英文、数字（主字体） |
| Noto Sans SC | `var(--font-noto-sans-sc)` | 中文 |
| JetBrains Mono | `"JetBrains Mono"` | 标签、eyebrow、monospace 数值 |

`--font-sans: var(--font-geist), var(--font-noto-sans-sc), system-ui, sans-serif;`

### 字间距

| Token | 值 | 用途 |
|---|---|---|
| `--tracking-tight-2` | `-0.02em` | 大标题 |
| `--tracking-tight-1` | `-0.01em` | 中标题 |
| `--tracking-label` | `0.12em` | mono 标签、表头 |
| `--tracking-ticker` | `0.08em` | 状态 ticker |
| `--tracking-eyebrow` | `0.18em` | eyebrow 标签 |

---

## 圆角

| Token | 值 | 用途 |
|---|---|---|
| `--radius` | `3px` | 全局标准圆角（卡片、输入框） |
| `--radius-sm` | `0px` | 无圆角（标签 pill） |
| `--radius-md` | `2px` | 小元素 |
| `--radius-lg` | `3px` | 卡片、Panel |

---

## 网格背景

页面底层有 32×32px 格线纹理：

```css
background-image: linear-gradient(rgba(31,37,48,0.4) 1px, transparent 1px),
                  linear-gradient(90deg, rgba(31,37,48,0.4) 1px, transparent 1px);
background-size: 32px 32px;
```

---

## Avoid 列表

以下风格**禁止**使用：
- 霓虹发光效果（`text-shadow: 0 0 10px ...`）
- 渐变 Logo / 渐变标题文字（`bg-gradient-to-r` on text）
- 表情符号（emoji）出现在 UI 组件中
- 白色背景页面（全站深色基底）
- 圆角 > 3px（除特殊情况外，勿用 `rounded-md` 以上）
- 高饱和度色块大面积背景
