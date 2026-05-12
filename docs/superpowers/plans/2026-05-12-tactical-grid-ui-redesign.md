# Tactical Grid UI 重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 RivalHub 前端迁移到 Tactical Grid 设计系统（Variant A），包括 CSS tokens、字体、12 个新 RivalHub 组件、shadcn 覆盖、Header/Footer 重设计、所有公开页面渐进迁移。

**Architecture:** 五层渐进迁移。Layer 1-2（tokens + 字体）一次性替换；Layer 3-4（RivalHub 组件 + shadcn 覆盖）并行创建；Layer 5（页面）按 P1→P7 逐阶段进行，每阶段 1 commit。所有新组件放在 `src/components/rivalhub/`，不污染现有 `src/components/ui/`。

**Tech Stack:** Next.js 15 App Router, Tailwind CSS v4 (CSS-first `@theme`), shadcn/ui, TypeScript strict, React 19

---

### Task 1: 切回 dev 分支

**Files:** None

- [ ] **Step 1: 切回 dev 分支**

```bash
git checkout dev
```

- [ ] **Step 2: 确认分支状态**

```bash
git branch --show-current
```

Expected: `dev`

---

### Task 2: Token 替换 — globals.css

**Files:**
- Modify: `src/app/globals.css`（完整重写）

- [ ] **Step 1: 替换 globals.css**

用以下内容完整替换 `src/app/globals.css`：

```css
@import "tailwindcss";

@theme {
  /* Surfaces */
  --color-bg: #0a0c10;
  --color-panel: #10131a;
  --color-panel-hi: #161a24;
  --color-panel-low: #0d1016;

  /* Borders */
  --color-border: #1f2530;
  --color-border-hi: #2c3340;

  /* Text */
  --color-fg: #e7ecf3;
  --color-fg-mid: #8e96a3;
  --color-fg-dim: #525a6a;

  /* Accent */
  --color-accent: #ff6b1a;
  --color-accent-soft: rgba(255, 107, 26, 0.12);
  --color-accent-edge: rgba(255, 107, 26, 0.34);
  --color-accent-fg: #0a0c10;

  /* Status */
  --color-ok: #4dd47a;
  --color-warn: #ffc44d;
  --color-danger: #ff5470;

  /* Typography */
  --font-sans: "Geist", "Noto Sans SC", system-ui, sans-serif;
  --font-display: "Geist", "Noto Sans SC", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;

  /* Letter spacing */
  --tracking-tight-2: -0.02em;
  --tracking-tight-1: -0.01em;
  --tracking-label: 0.12em;
  --tracking-ticker: 0.08em;
  --tracking-eyebrow: 0.18em;

  /* Radii */
  --radius-sm: 0px;
  --radius-md: 2px;
  --radius-lg: 3px;
  --radius: 3px;

  /* Background */
  --background-image-grid-hairline: linear-gradient(
      rgba(31, 37, 48, 0.4) 1px,
      transparent 1px
    ),
    linear-gradient(90deg, rgba(31, 37, 48, 0.4) 1px, transparent 1px);
  --background-size-grid: 32px 32px;

  /* Skeleton animation */
  --animate-skeleton-sweep: skeleton-sweep 1.4s ease-in-out infinite;
}

@keyframes skeleton-sweep {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

@layer base {
  :root {
    /* shadcn-compatible CSS variables */
    --background: 220 16% 6%;
    --foreground: 220 18% 93%;
    --card: 222 16% 9%;
    --card-foreground: 220 18% 93%;
    --popover: 222 16% 9%;
    --popover-foreground: 220 18% 93%;
    --primary: 21 100% 55%;
    --primary-foreground: 220 16% 6%;
    --secondary: 222 16% 12%;
    --secondary-foreground: 220 18% 93%;
    --muted: 222 16% 10%;
    --muted-foreground: 220 10% 60%;
    --accent: 21 100% 55%;
    --accent-foreground: 220 16% 6%;
    --destructive: 348 100% 66%;
    --destructive-foreground: 220 18% 93%;
    --border: 220 22% 16%;
    --input: 220 22% 16%;
    --ring: 21 100% 55%;
    --radius: 3px;
  }

  body {
    background-color: var(--color-bg);
    background-image: var(--background-image-grid-hairline);
    background-size: var(--background-size-grid);
    color: var(--color-fg);
    font-family: var(--font-sans);
    font-feature-settings: "cv11", "ss01";
  }
}

.skeleton {
  background: linear-gradient(
    90deg,
    hsl(var(--card)) 0%,
    hsl(var(--border)) 40%,
    hsl(var(--card)) 80%
  );
  background-size: 200% 100%;
  animation: var(--animate-skeleton-sweep);
}
```

- [ ] **Step 2: 全局搜索旧 CSS 变量引用并替换**

搜索并替换全项目中引用了旧 CSS 变量的地方：

```bash
# 搜索所有引用旧变量的文件
grep -rn "var(--bg-base)" src/ --include="*.tsx" --include="*.ts" --include="*.css"
grep -rn "var(--bg-elevated)" src/ --include="*.tsx" --include="*.ts" --include="*.css"
grep -rn "var(--bg-overlay)" src/ --include="*.tsx" --include="*.ts" --include="*.css"
grep -rn "var(--text-primary)" src/ --include="*.tsx" --include="*.ts" --include="*.css"
grep -rn "var(--text-secondary)" src/ --include="*.tsx" --include="*.ts" --include="*.css"
grep -rn "var(--text-muted)" src/ --include="*.tsx" --include="*.ts" --include="*.css"
grep -rn "var(--border-strong)" src/ --include="*.tsx" --include="*.ts" --include="*.css"
grep -rn "var(--season-primary)" src/ --include="*.tsx" --include="*.ts" --include="*.css"
```

Expected: 多个文件匹配（header-client.tsx, header.tsx, footer.tsx, page.tsx 等）

- [ ] **Step 3: 执行旧变量替换**

在所有 `.tsx` / `.ts` / `.css` 文件中替换：
- `var(--bg-base)` → `var(--color-bg)`
- `var(--bg-elevated)` → `var(--color-panel)`
- `var(--bg-overlay)` → `var(--color-panel-hi)`
- `var(--text-primary)` → `var(--color-fg)`
- `var(--text-secondary)` → `var(--color-fg-mid)`
- `var(--text-muted)` → `var(--color-fg-dim)`
- `var(--border)` → `var(--color-border)`（仅 CSS 引用，TSX className 中 `border-[var(--border)]` 也一起改）
- `var(--border-strong)` → `var(--color-border-hi)`
- `var(--season-primary, #f97316)` → `var(--color-accent)`
- `var(--season-primary)` → `var(--color-accent)`

```bash
# 用 sed 批量替换
grep -rn "var(--bg-base)" src/ -l | xargs sed -i '' 's/var(--bg-base)/var(--color-bg)/g'
grep -rn "var(--bg-elevated)" src/ -l | xargs sed -i '' 's/var(--bg-elevated)/var(--color-panel)/g'
grep -rn "var(--bg-overlay)" src/ -l | xargs sed -i '' 's/var(--bg-overlay)/var(--color-panel-hi)/g'
grep -rn "var(--text-primary)" src/ -l | xargs sed -i '' 's/var(--text-primary)/var(--color-fg)/g'
grep -rn "var(--text-secondary)" src/ -l | xargs sed -i '' 's/var(--text-secondary)/var(--color-fg-mid)/g'
grep -rn "var(--text-muted)" src/ -l | xargs sed -i '' 's/var(--text-muted)/var(--color-fg-dim)/g'
grep -rn "var(--border-strong)" src/ -l | xargs sed -i '' 's/var(--border-strong)/var(--color-border-hi)/g'
grep -rn "var(--season-primary" src/ -l | xargs sed -i '' 's/var(--season-primary, #[^)]*)/var(--color-accent)/g'
grep -rn "var(--season-primary)" src/ -l | xargs sed -i '' 's/var(--season-primary)/var(--color-accent)/g'
```

- [ ] **Step 4: 删除旧 CSS 类引用**

搜索 `.card-elevated` 和 `.season-glow` 的使用：

```bash
grep -rn "card-elevated" src/ --include="*.tsx" --include="*.ts"
grep -rn "season-glow" src/ --include="*.tsx" --include="*.ts"
```

将引用了 `.card-elevated` 的元素中的 `card-elevated` className 替换为 `rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]`。

将引用了 `.season-glow` 的元素删除该 className，后续 P2 用新 Panel 组件替代。

- [ ] **Step 5: 类型检查**

```bash
pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css
git add -u  # 包含所有旧变量替换
git commit -m "feat: replace CSS tokens with Tactical Grid palette

- bg/panel/text/border color tokens mapped to Handoff §01 colors
- accent #ff6b1a replaces --season-primary
- Geist + JetBrains Mono fonts declared in @theme
- hairline grid background on body
- shadcn HSL variables remapped to new palette
- skeleton sweep animation replaces animate-pulse
- radius locked to 3px"
```

---

### Task 3: 字体加载 — layout.tsx

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: 替换字体 import 和加载**

将 `src/app/layout.tsx` 中的字体部分替换为：

```typescript
import type { Metadata } from "next";
import { Geist, JetBrains_Mono, Noto_Sans_SC } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Toaster } from "@/components/ui/sonner";
import { APP_BRAND } from "@/lib/branding";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

const notoSansSC = Noto_Sans_SC({
  variable: "--font-noto-sans-sc",
  weight: ["400", "500", "600", "700"],
  preload: false,
});

export const metadata: Metadata = {
  title: {
    template: APP_BRAND.titleTemplate,
    default: APP_BRAND.name,
  },
  description: APP_BRAND.description,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="dark">
      <body className={`${geist.variable} ${jetbrainsMono.variable} ${notoSansSC.variable} antialiased min-h-screen flex flex-col`}>
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
```

- [ ] **Step 2: 搜索并替换 `var(--font-inter)` 引用**

```bash
grep -rn "font-inter\|--font-inter" src/ --include="*.tsx" --include="*.ts" --include="*.css" | grep -v node_modules
```

如果存在引用，替换 `var(--font-inter)` → `var(--font-geist)`。

- [ ] **Step 3: Commit**

```bash
git add src/app/layout.tsx
git add -u
git commit -m "feat: switch fonts to Geist + JetBrains Mono via next/font/google"
```

---

### Task 4: 创建 RivalHub 基础组件

**Files:**
- Create: `src/components/rivalhub/panel.tsx`
- Create: `src/components/rivalhub/btn.tsx`
- Create: `src/components/rivalhub/stat.tsx`
- Create: `src/components/rivalhub/marker.tsx`
- Create: `src/components/rivalhub/field.tsx`
- Create: `src/components/rivalhub/index.ts`

- [ ] **Step 1: 创建 `src/components/rivalhub/panel.tsx`**

```typescript
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";

interface PanelProps {
  children: React.ReactNode;
  className?: string;
  hi?: boolean;
  label?: string;
  pad?: number;
}

export function Panel({ children, className, hi, label, pad = 16 }: PanelProps) {
  return (
    <Card
      className={cn(className)}
      style={{ background: hi ? "var(--color-panel-hi)" : "var(--color-panel)" }}
    >
      {label && (
        <CardHeader
          className="flex flex-row items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)]"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "var(--tracking-label)",
            color: "var(--color-fg-mid)",
            textTransform: "uppercase",
          }}
        >
          {label}
        </CardHeader>
      )}
      <div style={{ padding: pad }}>{children}</div>
    </Card>
  );
}
```

- [ ] **Step 2: 创建 `src/components/rivalhub/btn.tsx`**

```typescript
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  primary?: boolean;
  ghost?: boolean;
  danger?: boolean;
  full?: boolean;
  small?: boolean;
}

export function Btn({
  children,
  primary,
  ghost,
  danger,
  full,
  small,
  className,
  disabled,
  ...props
}: BtnProps) {
  let variant: "default" | "destructive" | "ghost" | "outline" = "outline";
  if (primary) variant = "default";
  if (ghost) variant = "ghost";
  if (danger) variant = "destructive";

  return (
    <Button
      variant={variant}
      size={small ? "sm" : "default"}
      disabled={disabled}
      className={cn(
        full && "w-full",
        "rounded-sm",
        "font-[family-name:var(--font-sans)]",
        className
      )}
      {...props}
    >
      {children}
    </Button>
  );
}
```

- [ ] **Step 3: 创建 `src/components/rivalhub/stat.tsx`**

```typescript
import { cn } from "@/lib/utils/cn";

interface StatProps {
  label: string;
  value: string | number;
  sub?: string | null;
  accent?: boolean;
}

export function Stat({ label, value, sub, accent }: StatProps) {
  return (
    <div
      className="p-3 border rounded-md min-w-0"
      style={{
        background: "var(--color-panel-low)",
        borderColor: "var(--color-border)",
        borderRadius: "var(--radius-md)",
      }}
    >
      <div
        className="mb-1.5 uppercase"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--color-fg-mid)",
          letterSpacing: "var(--tracking-label)",
        }}
      >
        {label}
      </div>
      <div
        className="font-bold leading-none"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 22,
          color: accent ? "var(--color-accent)" : "var(--color-fg)",
          letterSpacing: "var(--tracking-tight-2)",
        }}
      >
        {value}
      </div>
      {sub != null && (
        <div
          className="mt-1"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--color-fg-dim)",
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

interface MiniStatProps {
  label: string;
  value: string | number;
  accent?: boolean;
}

export function MiniStat({ label, value, accent }: MiniStatProps) {
  return (
    <div className="text-right leading-tight">
      <div
        className="uppercase"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          color: "var(--color-fg-dim)",
          letterSpacing: "var(--tracking-label)",
        }}
      >
        {label}
      </div>
      <div
        className="font-bold"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          color: accent ? "var(--color-accent)" : "var(--color-fg)",
        }}
      >
        {value}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 创建 `src/components/rivalhub/marker.tsx`**

```typescript
interface MarkerProps {
  children: React.ReactNode;
  num?: number;
  sub?: string;
  action?: React.ReactNode;
}

export function Marker({ children, num, sub, action }: MarkerProps) {
  return (
    <div className="flex items-end justify-between gap-3 mb-3.5">
      <div className="flex items-baseline gap-3 min-w-0">
        {num != null && (
          <div
            className="font-bold"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--color-accent)",
              letterSpacing: "var(--tracking-label)",
            }}
          >
            [ {String(num).padStart(2, "0")} ]
          </div>
        )}
        <div
          className="font-semibold"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 22,
            color: "var(--color-fg)",
            letterSpacing: "var(--tracking-tight-1)",
          }}
        >
          {children}
        </div>
        {sub && (
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--color-fg-dim)",
              letterSpacing: "var(--tracking-ticker)",
            }}
          >
            {sub}
          </div>
        )}
      </div>
      {action}
    </div>
  );
}
```

- [ ] **Step 5: 创建 `src/components/rivalhub/field.tsx`**

```typescript
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface FieldProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  mono?: boolean;
}

export function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  mono,
}: FieldProps) {
  return (
    <div>
      {label && (
        <Label
          className="block mb-1.5 font-bold uppercase"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--color-fg-mid)",
            letterSpacing: "var(--tracking-label)",
          }}
        >
          {label}
        </Label>
      )}
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={mono ? "font-[family-name:var(--font-mono)]" : ""}
      />
    </div>
  );
}
```

- [ ] **Step 6: 创建 `src/components/rivalhub/index.ts`**

```typescript
export { Panel } from "./panel";
export { Btn } from "./btn";
export { Stat, MiniStat } from "./stat";
export { Marker } from "./marker";
export { Field } from "./field";
```

- [ ] **Step 7: Commit**

```bash
git add src/components/rivalhub/
git commit -m "feat: add RivalHub base components (Panel, Btn, Stat, Marker, Field)"
```

---

### Task 5: 创建 RivalHub 状态组件

**Files:**
- Create: `src/components/rivalhub/status-banner.tsx`
- Create: `src/components/rivalhub/inline-confirm.tsx`
- Create: `src/components/rivalhub/empty-state.tsx`
- Create: `src/components/rivalhub/error-state.tsx`
- Create: `src/components/rivalhub/skeleton.tsx`
- Update: `src/components/rivalhub/index.ts`

- [ ] **Step 1: 创建 `src/components/rivalhub/status-banner.tsx`**

```typescript
import { cn } from "@/lib/utils/cn";

type Tone = "info" | "success" | "warn" | "error" | "live";

const TONE_CONFIG: Record<Tone, { color: string; glyph: string }> = {
  info:    { color: "var(--color-accent)", glyph: "●" },
  success: { color: "var(--color-ok)",     glyph: "✓" },
  warn:    { color: "var(--color-warn)",   glyph: "▲" },
  error:   { color: "var(--color-danger)", glyph: "✕" },
  live:    { color: "var(--color-danger)", glyph: "●" },
};

interface StatusBannerProps {
  tone?: Tone;
  title: string;
  sub?: string;
  action?: React.ReactNode;
  onDismiss?: () => void;
}

export function StatusBanner({
  tone = "info",
  title,
  sub,
  action,
  onDismiss,
}: StatusBannerProps) {
  const config = TONE_CONFIG[tone];
  return (
    <div
      className="grid gap-3.5 items-center rounded-sm border px-4 py-2.5"
      style={{
        gridTemplateColumns: "auto 1fr auto auto",
        background: config.color + "10",
        borderColor: config.color + "55",
        borderLeft: `3px solid ${config.color}`,
      }}
    >
      <div
        className="flex items-center justify-center font-bold rounded-sm"
        style={{
          width: 22,
          height: 22,
          color: config.color,
          borderColor: config.color + "55",
          border: `1px solid ${config.color}55`,
          background: config.color + "1f",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
        }}
      >
        {config.glyph}
      </div>
      <div className="min-w-0">
        <div
          className="font-semibold"
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            color: "var(--color-fg)",
          }}
        >
          {title}
        </div>
        {sub && (
          <div
            className="mt-0.5"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--color-fg-mid)",
            }}
          >
            {sub}
          </div>
        )}
      </div>
      {action && <div>{action}</div>}
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="px-1"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--color-fg-dim)",
            fontFamily: "var(--font-mono)",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 创建 `src/components/rivalhub/inline-confirm.tsx`**

```typescript
import { Btn } from "./btn";

interface InlineConfirmProps {
  title: string;
  sub?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function InlineConfirm({
  title,
  sub,
  danger,
  onConfirm,
  onCancel,
}: InlineConfirmProps) {
  const c = danger ? "var(--color-danger)" : "var(--color-warn)";
  return (
    <div
      className="grid gap-3 items-center rounded-sm border px-4 py-3"
      style={{
        gridTemplateColumns: "1fr auto",
        background: c + "0d",
        borderColor: c + "55",
        borderLeft: `3px solid ${c}`,
      }}
    >
      <div>
        <div
          className="font-semibold"
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            color: "var(--color-fg)",
          }}
        >
          {title}
        </div>
        {sub && (
          <div
            className="mt-1"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--color-fg-mid)",
            }}
          >
            {sub}
          </div>
        )}
      </div>
      <div className="flex gap-1.5">
        <Btn ghost small onClick={onCancel}>
          取消
        </Btn>
        <Btn small danger={danger} primary={!danger} onClick={onConfirm}>
          {danger ? "确认删除" : "确认"}
        </Btn>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 创建 `src/components/rivalhub/empty-state.tsx`**

```typescript
interface EmptyStateProps {
  icon?: string;
  title: string;
  sub?: string;
  action?: React.ReactNode;
  accent?: boolean;
}

export function EmptyState({
  icon = "◇",
  title,
  sub,
  action,
  accent,
}: EmptyStateProps) {
  return (
    <div className="py-12 px-6 text-center">
      <div
        className="mx-auto mb-3.5 grid place-items-center"
        style={{
          width: 56,
          height: 56,
          borderColor: accent
            ? "var(--color-accent)" + "55"
            : "var(--color-border)",
          border: `1px solid ${accent ? "var(--color-accent)55" : "var(--color-border)"}`,
          background: accent
            ? "var(--color-accent)" + "10"
            : "var(--color-panel-low)",
          color: accent ? "var(--color-accent)" : "var(--color-fg-dim)",
          borderRadius: "var(--radius-md)",
          fontSize: 22,
        }}
      >
        {icon}
      </div>
      <div
        className="font-semibold"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 18,
          color: "var(--color-fg)",
          letterSpacing: "var(--tracking-tight-1)",
        }}
      >
        {title}
      </div>
      {sub && (
        <div
          className="mt-2 mx-auto max-w-[380px] leading-relaxed"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--color-fg-mid)",
            letterSpacing: "var(--tracking-ticker)",
          }}
        >
          {sub}
        </div>
      )}
      {action && <div className="mt-4.5">{action}</div>}
    </div>
  );
}
```

- [ ] **Step 4: 创建 `src/components/rivalhub/error-state.tsx`**

```typescript
import { Btn } from "./btn";

interface ErrorStateProps {
  code?: string;
  title?: string;
  sub?: string;
  onRetry?: () => void;
}

export function ErrorState({
  code = "ERR_500",
  title = "出错了",
  sub,
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="py-10 px-6 text-center">
      <div
        className="inline-flex items-center gap-2 px-2.5 py-1 mb-3.5 rounded-sm border"
        style={{
          borderColor: "var(--color-danger)" + "55",
          background: "var(--color-danger)" + "10",
          color: "var(--color-danger)",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "var(--tracking-label)",
        }}
      >
        ● {code}
      </div>
      <div
        className="font-semibold"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 22,
          color: "var(--color-fg)",
          letterSpacing: "var(--tracking-tight-1)",
        }}
      >
        {title}
      </div>
      {sub && (
        <div
          className="mt-2 mx-auto max-w-[460px] leading-relaxed"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--color-fg-mid)",
            letterSpacing: "var(--tracking-ticker)",
          }}
        >
          {sub}
        </div>
      )}
      {onRetry && (
        <div className="mt-4.5 flex justify-center gap-2">
          <Btn primary onClick={onRetry}>
            ↻ 重试
          </Btn>
          <Btn ghost>查看日志</Btn>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: 创建 `src/components/rivalhub/skeleton.tsx`**

```typescript
interface RivalSkeletonProps {
  w?: string;
  h?: number;
  mt?: number;
  radius?: number;
}

export function RivalSkeleton({ w = "100%", h = 16, mt = 0, radius }: RivalSkeletonProps) {
  return (
    <div
      className="skeleton"
      style={{
        width: w,
        height: h,
        marginTop: mt,
        borderRadius: radius ?? "var(--radius-sm)",
      }}
    />
  );
}

export function SkeletonRow({ cols = [1, 2, 1, 1] }: { cols?: number[] }) {
  return (
    <div
      className="grid gap-3.5 px-4 py-3"
      style={{
        gridTemplateColumns: cols.map((c) => `${c}fr`).join(" "),
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      {cols.map((_, i) => (
        <RivalSkeleton key={i} h={14} />
      ))}
    </div>
  );
}

export function Spinner({
  size = 18,
  label,
}: {
  size?: number;
  label?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="inline-block rounded-full animate-spin"
        style={{
          width: size,
          height: size,
          border: `2px solid var(--color-border)`,
          borderTopColor: "var(--color-accent)",
        }}
      />
      {label && (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--color-fg-mid)",
            letterSpacing: "var(--tracking-label)",
          }}
        >
          {label}
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 6: 更新 `src/components/rivalhub/index.ts`**

在文件末尾追加：

```typescript
export { StatusBanner } from "./status-banner";
export { InlineConfirm } from "./inline-confirm";
export { EmptyState } from "./empty-state";
export { ErrorState } from "./error-state";
export { RivalSkeleton, SkeletonRow, Spinner } from "./skeleton";
```

- [ ] **Step 7: Commit**

```bash
git add src/components/rivalhub/
git commit -m "feat: add RivalHub state components (StatusBanner, InlineConfirm, EmptyState, ErrorState, Skeleton)"
```

---

### Task 6: 创建 RivalHub 业务组件

**Files:**
- Create: `src/components/rivalhub/team-badge.tsx`
- Create: `src/components/rivalhub/pos-chip.tsx`
- Create: `src/components/rivalhub/status-pill.tsx`
- Update: `src/components/rivalhub/index.ts`

- [ ] **Step 1: 创建 `src/components/rivalhub/team-badge.tsx`**

```typescript
interface TeamBadgeProps {
  team: { tag: string; color: string };
  size?: number;
}

export function TeamBadge({ team, size = 36 }: TeamBadgeProps) {
  return (
    <div
      className="relative grid place-items-center flex-shrink-0 font-bold"
      style={{
        width: size,
        height: size,
        background: team.color + "22",
        border: `1px solid ${team.color}55`,
        borderRadius: "var(--radius-sm)",
        fontFamily: "var(--font-mono)",
        fontSize: size * 0.36,
        color: team.color,
      }}
    >
      <span
        className="absolute inset-0"
        style={{
          borderRadius: "var(--radius-sm)",
          background: `linear-gradient(135deg, ${team.color}10 0%, transparent 50%)`,
        }}
      />
      <span className="relative">{team.tag}</span>
    </div>
  );
}
```

- [ ] **Step 2: 创建 `src/components/rivalhub/pos-chip.tsx`**

```typescript
interface PosChipProps {
  pos: string;
  small?: boolean;
}

export function PosChip({ pos, small }: PosChipProps) {
  return (
    <span
      className="inline-flex items-center font-bold rounded-sm border"
      style={{
        padding: small ? "1px 5px" : "2px 7px",
        fontFamily: "var(--font-mono)",
        fontSize: small ? 9 : 10,
        letterSpacing: "0.05em",
        color: "var(--color-accent)",
        borderColor: "var(--color-accent-edge)",
        background: "var(--color-accent-soft)",
      }}
    >
      {pos}
    </span>
  );
}
```

- [ ] **Step 3: 创建 `src/components/rivalhub/status-pill.tsx`**

```typescript
const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  live:      { color: "var(--color-danger)", label: "● LIVE" },
  finished:  { color: "var(--color-fg-dim)", label: "FT" },
  scheduled: { color: "var(--color-fg-mid)", label: "UPCOMING" },
  open:      { color: "var(--color-ok)",     label: "● OPEN" },
  voting:    { color: "var(--color-warn)",   label: "● VOTING" },
  drafting:  { color: "var(--color-accent)", label: "● DRAFTING" },
  playing:   { color: "var(--color-ok)",     label: "● PLAYING" },
};

interface StatusPillProps {
  status: string;
}

export function StatusPill({ status }: StatusPillProps) {
  const cfg = STATUS_CONFIG[status] ?? {
    color: "var(--color-fg-mid)",
    label: status,
  };
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 font-bold rounded-sm border"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        letterSpacing: "var(--tracking-label)",
        color: cfg.color,
        borderColor: cfg.color + "55",
        background: cfg.color + "12",
      }}
    >
      {cfg.label}
    </span>
  );
}
```

- [ ] **Step 4: 更新 `src/components/rivalhub/index.ts`**

在文件末尾追加：

```typescript
export { TeamBadge } from "./team-badge";
export { PosChip } from "./pos-chip";
export { StatusPill } from "./status-pill";
```

- [ ] **Step 5: Commit**

```bash
git add src/components/rivalhub/
git commit -m "feat: add RivalHub business components (TeamBadge, PosChip, StatusPill)"
```

---

### Task 7: Shadcn 组件覆盖

**Files:**
- Modify: `src/components/ui/button.tsx`
- Modify: `src/components/ui/card.tsx`
- Modify: `src/components/ui/badge.tsx`
- Modify: `src/components/ui/skeleton.tsx`
- Modify: `src/components/ui/input.tsx`

- [ ] **Step 1: 修改 `src/components/ui/button.tsx`**

将第 8 行的 `rounded-md` 改为 `rounded-sm`：

```typescript
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  // ... variants 保持不变
)
```

- [ ] **Step 2: 修改 `src/components/ui/card.tsx`**

在第 12 行中确保 Card 使用 `rounded-lg`（已是 `rounded-lg`，无需改动）。CardHeader padding 改为更紧凑的 `p-4`：

将第 26 行改为：
```typescript
className={cn("flex flex-col space-y-1.5 p-4", className)}
```

CardContent 第 63 行的 `p-6 pt-0` 改为 `p-4 pt-0`。

- [ ] **Step 3: 修改 `src/components/ui/badge.tsx`**

将第 7 行 `rounded-full` 改为 `rounded-sm`，新增 `mono` variant：

```typescript
const badgeVariants = cva(
  "inline-flex items-center rounded-sm border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
        mono: "font-[family-name:var(--font-mono)] uppercase tracking-[var(--tracking-label)] border-[var(--color-accent-edge)] text-[var(--color-accent)] bg-[var(--color-accent-soft)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)
```

- [ ] **Step 4: 修改 `src/components/ui/skeleton.tsx`**

将 `animate-pulse rounded-md bg-muted` 改为 `skeleton rounded-sm`：

```typescript
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("skeleton rounded-sm", className)}
      {...props}
    />
  )
}
```

- [ ] **Step 5: 修改 `src/components/ui/input.tsx`**

将第 11 行 `rounded-md` 改为 `rounded-sm`，`bg-background` 改为 `bg-[var(--color-panel-low)]`：

```typescript
className={cn(
  "flex h-10 w-full rounded-sm border border-input bg-[var(--color-panel-low)] px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
  className
)}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/button.tsx src/components/ui/card.tsx src/components/ui/badge.tsx src/components/ui/skeleton.tsx src/components/ui/input.tsx
git commit -m "feat: override shadcn components with Tactical Grid styling

- rounded-sm on button, badge, input
- skeleton uses sweep animation
- badge gains mono variant
- card padding compacted
- input bg uses panel-low"
```

---

### Task 8: Header/Footer 重设计

**Files:**
- Modify: `src/components/layout/header-client.tsx`
- Modify: `src/components/layout/footer.tsx`

- [ ] **Step 1: 重写 Header — Logo 区域**

修改 `src/components/layout/header-client.tsx`：

将 Logo link 替换为带 accent 方块 + 文字的 Tactical Grid logo：

```typescript
{/* Logo */}
<Link
  href="/"
  className="flex items-center gap-2.5 font-bold text-base text-[var(--color-fg)] hover:text-[var(--color-fg)] transition-colors"
  style={{
    fontFamily: "var(--font-display)",
    fontWeight: 700,
    letterSpacing: "var(--tracking-tight-1)",
  }}
>
  <span
    className="grid place-items-center font-extrabold text-base rounded-sm"
    style={{
      width: 28,
      height: 28,
      background: "var(--color-accent)",
      color: "var(--color-accent-fg)",
      fontFamily: "var(--font-mono)",
    }}
  >
    R
  </span>
  RIVALHUB
</Link>
```

- [ ] **Step 2: 重写 Header — 导航区域**

将导航链接改为 mono 字体 + 更紧凑的间距：

```typescript
<nav className="hidden sm:flex items-center justify-center gap-0.5 flex-wrap">
  {navLinks.map((link) => (
    <Link
      key={link.href}
      href={link.href as never}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors",
        link.active
          ? "bg-[var(--color-panel)] border border-[var(--color-border)] border-b-[var(--color-accent)] text-[var(--color-fg)] font-semibold"
          : "text-[var(--color-fg-mid)] border border-transparent hover:text-[var(--color-fg)] font-medium",
        "rounded-sm"
      )}
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {link.label}
      <span
        className="text-xs px-1.5 py-0.5 rounded-sm"
        style={{
          background: "var(--color-panel-low)",
          color: "var(--color-fg-dim)",
        }}
      >
        {link.badge}
      </span>
    </Link>
  ))}
  <Link
    href="/seasons"
    className={cn(
      "px-3 py-1.5 text-xs rounded-sm transition-colors border border-transparent",
      pathname === "/seasons"
        ? "bg-[var(--color-panel)] border-[var(--color-border)] text-[var(--color-fg)] font-semibold"
        : "text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] font-medium"
    )}
    style={{ fontFamily: "var(--font-sans)" }}
  >
    历史赛季
  </Link>
</nav>
```

- [ ] **Step 3: 重写 Header — 用户区域**

登录按钮改为 mono 字体：

```typescript
<Link
  href="/login"
  className="px-2 py-1 rounded-sm text-xs font-bold text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] border border-[var(--color-border)] transition-colors"
  style={{
    fontFamily: "var(--font-mono)",
    letterSpacing: "var(--tracking-label)",
  }}
>
  LOGIN
</Link>
```

- [ ] **Step 4: 重写 Header — 在线人数**

在登录按钮旁添加在线人数指示：

```typescript
<div
  className="hidden sm:block"
  style={{
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    color: "var(--color-fg-mid)",
  }}
>
  <span style={{ color: "var(--color-accent)" }}>●</span> 1,247 online
</div>
```

- [ ] **Step 5: 重写 Header — 整体样式**

Header 容器：

```typescript
<header
  className="sticky top-0 z-50 border-b backdrop-blur"
  style={{
    padding: "12px 28px",
    background: "var(--color-panel-low)" + "e6",
    borderColor: "var(--color-border)",
    display: "grid",
    gridTemplateColumns: "auto 1fr auto",
    gap: 24,
    alignItems: "center",
  }}
>
```

移除旧的 `container mx-auto px-4 h-14 flex items-center` className，改用 inline styles。

注：Header 改动较多，建议逐次修改 `header-client.tsx` 的关键区域（Logo、Nav、User），Mobile menu 部分同步更新变量引用。

- [ ] **Step 6: 重写 Footer**

修改 `src/components/layout/footer.tsx`，移除现有内容，改为：

```typescript
export function Footer() {
  return (
    <footer
      className="flex justify-between items-center"
      style={{
        padding: "20px 28px",
        borderTop: "1px solid var(--color-border)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: "var(--color-fg-dim)",
        letterSpacing: "var(--tracking-ticker)",
      }}
    >
      <div>RIVALHUB · OPEN SOURCE ESPORTS TOURNAMENT PLATFORM</div>
      <div className="flex gap-3.5">
        <span>GITHUB ↗</span>
        <span>RULES</span>
        <span>PRIVACY</span>
        <span style={{ color: "var(--color-accent)" }}>v4.0-A</span>
      </div>
    </footer>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/header-client.tsx src/components/layout/footer.tsx
git commit -m "feat: redesign Header and Footer with Tactical Grid style

- Logo: accent square + Geist display text
- Nav: mono font, active state with accent bottom border
- User area: mono login button + online indicator
- Footer: mono text with accent version badge"
```

---

### Task 9: P1 — Landing + Login + Invite 页面迁移

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/login/page.tsx`
- Read for context: `src/components/auth/LoginForm.tsx`

- [ ] **Step 1: 重写 Landing page (`src/app/page.tsx`)**

完整重写，使用新组件 Hero + nav tiles + LIVE 面板模式。保留 Server Component 数据获取逻辑。

```typescript
export const dynamic = "force-dynamic";

import Link from "next/link";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { APP_BRAND } from "@/lib/branding";
import { SEASON_STATUS_LABELS } from "@/types/season";
import { StatusPill } from "@/components/rivalhub";
import { Panel } from "@/components/rivalhub/panel";
import { Btn } from "@/components/rivalhub/btn";
import { Marker } from "@/components/rivalhub/marker";
import type { Season } from "@/db/schema/seasons";

export default async function HomePage() {
  const allSeasons = await db
    .select()
    .from(seasons)
    .orderBy(seasons.createdAt);

  const activeSeasons = allSeasons.filter(
    (s) => s.status !== "archived" && s.status !== "draft"
  );
  const featured = activeSeasons[0];
  const others = activeSeasons.slice(1);

  return (
    <div className="mx-auto px-9 py-8 max-w-[1240px] grid gap-7">
      {/* Hero */}
      <div className="grid gap-6" style={{ gridTemplateColumns: "1.6fr 1fr" }}>
        <Panel className="overflow-hidden relative" pad={0}>
          <div className="p-7 relative z-10">
            <div
              className="mb-3 font-bold"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--color-accent)",
                letterSpacing: "var(--tracking-eyebrow)",
              }}
            >
              [ RIVALHUB / S4 — SPRING 2026 ]
            </div>
            <h1
              className="font-semibold leading-[0.95] m-0"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 56,
                letterSpacing: "var(--tracking-tight-2)",
                color: "var(--color-fg)",
              }}
            >
              {APP_BRAND.name}
              <br />
              <span style={{ color: "var(--color-accent)" }}>SPRING SPLIT</span>
            </h1>
            <div
              className="mt-3.5 max-w-[520px] leading-relaxed"
              style={{ color: "var(--color-fg-mid)", fontSize: 14 }}
            >
              {APP_BRAND.description}
            </div>
            <div className="flex gap-2.5 mt-5.5 flex-wrap">
              {featured && (
                <Btn primary>
                  <Link href={`/${featured.slug}`}>进入赛季 →</Link>
                </Btn>
              )}
              {featured && featured.registrationMode === "solo" && (
                <Btn>
                  <Link href={`/${featured.slug}/register`}>报名参赛</Link>
                </Btn>
              )}
              <Btn ghost>
                <Link href="/seasons">查看所有赛季</Link>
              </Btn>
            </div>
          </div>
          <div
            aria-hidden
            className="absolute inset-0 opacity-50"
            style={{
              background: `
                radial-gradient(circle at 90% 10%, var(--color-accent)22 0, transparent 40%),
                repeating-linear-gradient(0deg, transparent 0 32px, var(--color-border)40 32px 33px)
              `,
            }}
          />
        </Panel>

        {/* LIVE Panel */}
        <Panel label="CURRENT SEASON">
          {featured ? (
            <div className="grid gap-3.5">
              <div>
                <div
                  className="uppercase"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--color-fg-dim)",
                    letterSpacing: "var(--tracking-label)",
                  }}
                >
                  {SEASON_STATUS_LABELS[featured.status]}
                </div>
                <div
                  className="mt-1 font-semibold"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 20,
                    color: "var(--color-fg)",
                  }}
                >
                  {featured.name}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill status={featured.status} />
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--color-fg-mid)",
                  }}
                >
                  {featured.kind}
                </span>
              </div>
              <Btn full>
                <Link href={`/${featured.slug}`} className="w-full">
                  进入赛季 →
                </Link>
              </Btn>
            </div>
          ) : (
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: "var(--color-fg-mid)",
                textAlign: "center",
                padding: "24px 0",
              }}
            >
              暂无进行中的赛季
            </div>
          )}
        </Panel>
      </div>

      {/* Nav tiles */}
      {featured && (
        <div>
          <Marker num={1} sub="NAVIGATION">
            入口
          </Marker>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            {[
              { href: `/${featured.slug}/register`, label: "报名参赛", mono: "REGISTER", meta: "个人报名" },
              { href: `/${featured.slug}/captains`, label: "队长投票", mono: "CAPTAINS", meta: "实时票数" },
              { href: `/${featured.slug}/draft`, label: "选秀直播间", mono: "DRAFT ROOM", meta: "● LIVE" },
              { href: `/${featured.slug}/teams`, label: "战队阵容", mono: "TEAMS", meta: "8 支战队" },
              { href: `/${featured.slug}/matches`, label: "赛程", mono: "MATCHES", meta: "Bracket · 赛果" },
              { href: `/${featured.slug}/stats`, label: "数据排行", mono: "STATS", meta: "Rating · ADR" },
              { href: "/seasons", label: "历史赛季", mono: "ARCHIVE", meta: "浏览回顾" },
              { href: "/login", label: "登录后台", mono: "LOGIN", meta: "管理员 · 队长" },
            ].map((tile) => (
              <Link key={tile.href} href={tile.href as never} className="group">
                <Panel className="transition-colors hover:border-[var(--color-border-hi)]">
                  <div
                    className="flex items-center gap-2 mb-1.5"
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      color: "var(--color-fg-dim)",
                      letterSpacing: "var(--tracking-label)",
                    }}
                  >
                    {tile.mono}
                  </div>
                  <div
                    className="font-semibold"
                    style={{
                      fontFamily: "var(--font-sans)",
                      fontSize: 14,
                      color: "var(--color-fg)",
                    }}
                  >
                    {tile.label}
                  </div>
                </Panel>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Other seasons */}
      {others.length > 0 && (
        <div>
          <Marker num={2} sub="MORE">
            其他赛季
          </Marker>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            {others.map((s) => (
              <Link key={s.id} href={`/${s.slug}` as never}>
                <Panel className="transition-colors hover:border-[var(--color-border-hi)]">
                  <div className="flex items-center gap-2 mb-2">
                    <StatusPill status={s.status} />
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        color: "var(--color-fg-dim)",
                      }}
                    >
                      {s.kind}
                    </span>
                  </div>
                  <div
                    className="font-semibold"
                    style={{
                      fontFamily: "var(--font-sans)",
                      fontSize: 16,
                      color: "var(--color-fg)",
                    }}
                  >
                    {s.name}
                  </div>
                </Panel>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

注：由于 Landing page 大改，删除 `FeaturedSeasonCard` 和 `CompactSeasonCard` 子组件，全部用 RivalHub `Panel` + `StatusPill` 替代。

- [ ] **Step 2: 更新 Login 页面 (`src/app/login/page.tsx`)**

保持已有结构和 Server Action，将 LoginForm 的容器改为 `Panel`，表单控制用 `Field` 组件。

先检查 `src/app/login/page.tsx` 和 `src/components/auth/LoginForm.tsx` 的当前导入。

```bash
# 检查文件内容
cat src/app/login/page.tsx
cat src/components/auth/LoginForm.tsx
```

然后按需将 LoginForm 内的 input/label 替换为 `Field` 组件，外层用 `Panel` 包裹。

- [ ] **Step 3: 类型检查**

```bash
pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx src/app/login/page.tsx src/components/auth/LoginForm.tsx
git commit -m "feat: P1 landing + login page Tactical Grid redesign

- Landing: Hero with accent split title + nav tiles grid
- Login: Field component for form controls
- Removes FeaturedSeasonCard/CompactSeasonCard helpers"
```

---

### Task 10–16: P2–P7 页面迁移（框架）

每阶段遵循相同 pattern：对比设计稿 → 替换容器为 Panel → 用新组件拼装 → 类型检查通过 → commit。

**P2** (`/[seasonSlug]`, `/[seasonSlug]/register`, `/[seasonSlug]/captains`)
- Season home: Marker + Stats grid + 入口面板
- Register: Field 表单控件
- Captains: Panel + Bar 进度条

**P3** (`/[seasonSlug]/draft` + captain)
- 命令栏 (4 列 Panel: LIVE 状态 / 当前选择 / 倒计时 / 轮次)
- 8 队 grid (TeamBadge)
- 选手池表格 (PosChip + MiniStat)

**P4** (`/[seasonSlug]/teams`, `/teams/[id]`)
- 队伍 grid (TeamBadge + Stat)
- 队伍详情 (TeamBadge + roster table)

**P5** (`/[seasonSlug]/matches`, `/matches/[id]`)
- Bracket 视图 (Card + StatusPill)
- 记分板 (table + MiniStat)

**P6** (`/[seasonSlug]/stats`, `/players/[id]`)
- 排行榜 (table + MiniStat)
- 选手主页 (Stat grid + recharts)

**P7** (`/admin/**`)
- Admin 面板 + 用户列表

每个阶段的 commit message 格式：`feat: P{N} {页面名} Tactical Grid redesign`

---

### Task 17: 清理 CSS 变量引用

- [ ] **Step 1: 最终检查 — 确认无残留旧变量**

```bash
grep -rn "var(--bg-base)\|var(--bg-elevated)\|var(--bg-overlay)\|var(--text-primary)\|var(--text-muted)\|var(--border-strong)\|var(--season-primary" src/ --include="*.tsx" --include="*.ts" --include="*.css" | grep -v node_modules | grep -v ".next"
```

Expected: 无匹配 (no results)

- [ ] **Step 2: 最终检查 — `.card-elevated` 和 `.season-glow` 残留**

```bash
grep -rn "card-elevated\|season-glow" src/ --include="*.tsx" --include="*.ts" --include="*.css" | grep -v node_modules
```

Expected: 无匹配 (no results)

- [ ] **Step 3: 全量类型检查 + build 验证**

```bash
pnpm tsc --noEmit
pnpm build 2>&1 | tail -20
```

- [ ] **Step 4: 最终 commit**

```bash
git add -u
git commit -m "chore: remove all old CSS variable references"
```
