# Architecture Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 精简重复展示常量、将入口层 Mock 数据替换为 DB 查询、补全 Header 用户区域与登录入口、添加赛季二级导航、统一 admin 鉴权，为 P8 选秀交接做好地基。

**Architecture:** 按层分 4 个独立 PR（分支），每个 PR 自闭环可独立部署。PR1 统一常量 → PR2 替换 Mock → PR3 Header 用户区域（依赖 PR2）→ PR4 赛季导航 + admin 鉴权（独立，最后合并）。不改业务逻辑，不改 DB schema，不改 Server Actions。

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Tailwind CSS v4, shadcn/ui, Drizzle ORM, Supabase

---

## 文件改动总览

### PR1 新增/修改
- **新建** `src/components/ui/status-dot.tsx` — 提取 StatusDot 组件
- **修改** `src/types/season.ts` — 导出 `CS2_POSITIONS`，新增 `SEASON_STATUS_TONE`
- **修改** `src/types/registration.ts` — `POSITION_LABELS` 改为 re-export
- **修改** `src/app/page.tsx` — 删除本地 `STATUS_CONFIG` / `StatusDot`
- **修改** `src/app/seasons/page.tsx` — 删除本地 `STATUS_CONFIG` / `StatusDot`
- **修改** `src/app/[seasonSlug]/page.tsx` — 删除本地 `STATUS_LABEL`
- **修改** `src/components/layout/header.tsx` — 删除本地 `STATUS_LABEL`
- **修改** `src/app/players/[userId]/page.tsx` — 删除本地 `POSITION_LABELS`
- **修改** `src/app/[seasonSlug]/teams/[teamId]/page.tsx` — 删除 `POSITION_LABELS` / `POSITION_ORDER`
- **修改** `src/app/[seasonSlug]/teams/page.tsx` — 删除 `POSITION_ORDER`
- **修改** `src/components/teams/TeamCard.tsx` — 删除本地 `POSITION_LABELS`
- **修改** `src/components/teams/TeamGrid.tsx` — 删除本地 `POSITION_LABELS`
- **修改** `src/components/matches/MatchStatusBadge.tsx` — 使用 `MATCH_STATUS_LABELS`
- **修改** `src/components/matches/MatchDetail.tsx` — 使用 `MATCH_STATUS_LABELS`
- **修改** `src/components/admin/RegistrationReviewList.tsx` — 使用 `REGISTRATION_STATUS_LABELS`

### PR2 修改
- **修改** `src/app/page.tsx` — RSC，从 DB 查询赛季
- **修改** `src/app/seasons/page.tsx` — RSC，从 DB 查询赛季
- **修改** `src/app/[seasonSlug]/page.tsx` — 删除 MOCK，DB 查询，capability 门控 quick links

### PR3 新增/修改
- **新建** `src/components/layout/header-client.tsx` — 原 Header 交互逻辑 + 用户区域
- **修改** `src/components/layout/header.tsx` — 改为 Server Component，查 DB + session

### PR4 新增/修改
- **新建** `src/components/layout/season-nav.tsx` — 赛季二级 tab 导航 Client Component
- **修改** `src/app/[seasonSlug]/layout.tsx` — 引入 SeasonNav
- **修改** `src/app/admin/layout.tsx` — 从空壳改为鉴权入口 + AdminNav
- **修改** `src/app/admin/page.tsx` — 移除冗余 checkAdminSession + AdminNav
- **修改** `src/app/admin/settings/page.tsx` — 移除冗余 checkAdminSession + AdminNav
- **修改** `src/app/admin/users/page.tsx` — 移除 AdminNav（保留 requireSuperAdmin）
- **修改** `src/app/admin/invites/page.tsx` — 移除 AdminNav（保留 requireSuperAdmin）
- **修改** `src/app/admin/[seasonSlug]/layout.tsx` — 移除 AdminNav（保留 requireSeasonAdmin）

---

## PR1：统一展示常量

> 分支名：`refactor/unify-display-constants`
> 从 `dev` 切出，完成后 PR 合回 `dev`

### Task 1.1：导出 CS2_POSITIONS，新增 SEASON_STATUS_TONE

**Files:**
- Modify: `src/types/season.ts`

- [ ] **修改 `src/types/season.ts`**，将 `CS2_POSITIONS` 改为导出，并在文件末尾新增 `SEASON_STATUS_TONE`：

```typescript
// 将原来的 const CS2_POSITIONS 改为 export const
export const CS2_POSITIONS = ["igl", "awper", "opener", "closer", "anchor"] as const;

// 在文件末尾 SEASON_STATUS_LABELS 下方新增：
export const SEASON_STATUS_TONE: Record<SeasonStatus, "live" | "soon" | "done"> = {
  draft:        "soon",
  registration: "live",
  voting:       "live",
  drafting:     "live",
  playing:      "live",
  finished:     "done",
  archived:     "done",
};
```

- [ ] **类型检查**

```bash
cd /Users/starfie1d/GitHub/RivalHub && pnpm tsc --noEmit 2>&1 | head -20
```

期望：无新增错误。

- [ ] **提交**

```bash
git add src/types/season.ts
git commit -m "refactor: export CS2_POSITIONS, add SEASON_STATUS_TONE to types/season"
```

---

### Task 1.2：提取 StatusDot 组件

**Files:**
- Create: `src/components/ui/status-dot.tsx`

- [ ] **新建 `src/components/ui/status-dot.tsx`**：

```typescript
import { SEASON_STATUS_TONE } from "@/types/season";
import type { SeasonStatus } from "@/types/season";

const TONE_COLOR = {
  live: "bg-emerald-400",
  soon: "bg-amber-400",
  done: "bg-zinc-500",
} as const;

export function StatusDot({ status }: { status: SeasonStatus }) {
  const tone = SEASON_STATUS_TONE[status];
  return (
    <span className="relative flex h-2 w-2">
      {tone === "live" && (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full ${TONE_COLOR[tone]} opacity-60`}
        />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${TONE_COLOR[tone]}`} />
    </span>
  );
}
```

- [ ] **类型检查**

```bash
cd /Users/starfie1d/GitHub/RivalHub && pnpm tsc --noEmit 2>&1 | head -20
```

- [ ] **提交**

```bash
git add src/components/ui/status-dot.tsx
git commit -m "refactor: extract StatusDot component to components/ui"
```

---

### Task 1.3：统一赛季状态标签——删除 page.tsx / seasons/page.tsx 中的重复定义

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/seasons/page.tsx`

- [ ] **修改 `src/app/page.tsx`**：

1. 删除文件顶部的 `STATUS_CONFIG` 常量定义（约第 7-14 行）
2. 删除文件内的 `StatusDot` 函数定义（约第 37-50 行）
3. 在文件顶部 imports 区域新增：

```typescript
import { SEASON_STATUS_LABELS, SEASON_STATUS_TONE } from "@/types/season";
import { StatusDot } from "@/components/ui/status-dot";
```

4. 将 `FeaturedSeasonCard` 和 `CompactSeasonCard` 中的 `cfg.label` 替换为 `SEASON_STATUS_LABELS[season.status]`，`cfg.tone` 用法替换为直接传 `status` 给 `<StatusDot status={season.status} />`。

最终 `FeaturedSeasonCard` 内相关代码改为：

```tsx
<StatusDot status={season.status} />
<span className="text-[var(--text-secondary)] uppercase tracking-wider">
  {SEASON_STATUS_LABELS[season.status]}
</span>
```

`CompactSeasonCard` 内：

```tsx
<StatusDot status={season.status} />
<span className="text-[var(--text-secondary)]">{SEASON_STATUS_LABELS[season.status]}</span>
```

- [ ] **修改 `src/app/seasons/page.tsx`**：

1. 删除顶部 `STATUS_CONFIG` 常量定义
2. 删除 `StatusDot` 函数定义
3. 新增 imports：

```typescript
import { SEASON_STATUS_LABELS } from "@/types/season";
import { StatusDot } from "@/components/ui/status-dot";
```

4. 页面内替换 `cfg.label` → `SEASON_STATUS_LABELS[season.status]`，`<StatusDot tone={cfg.tone} />` → `<StatusDot status={season.status} />`

- [ ] **类型检查**

```bash
cd /Users/starfie1d/GitHub/RivalHub && pnpm tsc --noEmit 2>&1 | head -20
```

- [ ] **提交**

```bash
git add src/app/page.tsx src/app/seasons/page.tsx
git commit -m "refactor: use shared StatusDot and SEASON_STATUS_LABELS in home and seasons pages"
```

---

### Task 1.4：统一赛季状态标签——[seasonSlug]/page.tsx 和 header.tsx

**Files:**
- Modify: `src/app/[seasonSlug]/page.tsx`
- Modify: `src/components/layout/header.tsx`

- [ ] **修改 `src/app/[seasonSlug]/page.tsx`**：

1. 删除顶部 `STATUS_LABEL` 常量（约第 24-31 行）
2. 新增 import：

```typescript
import { SEASON_STATUS_LABELS } from "@/types/season";
```

3. 将模板内 `{STATUS_LABEL[season.status] ?? season.status}` 替换为 `{SEASON_STATUS_LABELS[season.status] ?? season.status}`

- [ ] **修改 `src/components/layout/header.tsx`**：

1. 删除顶部 `STATUS_LABEL` 常量（约第 15-22 行）
2. 新增 import：

```typescript
import { SEASON_STATUS_LABELS } from "@/types/season";
```

3. 将 `badge: STATUS_LABEL[s.status] ?? s.status` 替换为 `badge: SEASON_STATUS_LABELS[s.status as import("@/types/season").SeasonStatus] ?? s.status`

   实际上，因为 `header.tsx` 的 `mockSeasons` 里 `status` 类型已经是 `"registration" as const`，所以直接：

```typescript
badge: SEASON_STATUS_LABELS[s.status],
```

- [ ] **类型检查**

```bash
cd /Users/starfie1d/GitHub/RivalHub && pnpm tsc --noEmit 2>&1 | head -20
```

- [ ] **提交**

```bash
git add "src/app/[seasonSlug]/page.tsx" src/components/layout/header.tsx
git commit -m "refactor: use SEASON_STATUS_LABELS in season page and header"
```

---

### Task 1.5：统一位置标签——types/registration.ts 改为 re-export

**Files:**
- Modify: `src/types/registration.ts`

- [ ] **修改 `src/types/registration.ts`**：

将现有的 `POSITION_LABELS` 定义替换为 re-export：

```typescript
// 删除原有的：
// export const POSITION_LABELS: Record<Position, string> = { ... };

// 改为：
export { POSITION_LABELS } from "@/lib/validators/registration";
```

注意：`POSITION_LABELS` 从 `lib/validators/registration.ts` 导出的类型是 `typeof REGISTRATION_DEFAULTS.positions.labels`，包含 `{ cn, en, full }` 三个字段，不是纯 `string`。原来 `types/registration.ts` 里是简化的 `Record<Position, string>`（只有 full label 字符串）。

检查当前 `types/registration.ts` 的 `POSITION_LABELS` 是否被直接 import 使用：

```bash
grep -rn "from \"@/types/registration\"" /Users/starfie1d/GitHub/RivalHub/src --include="*.tsx" --include="*.ts" | grep "POSITION_LABELS"
```

如果有文件从 `@/types/registration` import `POSITION_LABELS`，将它们改为 `import { POSITION_LABELS } from "@/lib/validators/registration"` 即可（同一导出链）。

- [ ] **类型检查**

```bash
cd /Users/starfie1d/GitHub/RivalHub && pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **提交**

```bash
git add src/types/registration.ts
git commit -m "refactor: types/registration POSITION_LABELS now re-exports from validators"
```

---

### Task 1.6：统一位置标签——删除页面/组件中的局部重定义

**Files:**
- Modify: `src/app/players/[userId]/page.tsx`
- Modify: `src/app/[seasonSlug]/teams/[teamId]/page.tsx`
- Modify: `src/components/teams/TeamCard.tsx`
- Modify: `src/components/teams/TeamGrid.tsx`

**注意**：`lib/validators/registration.ts` 中的 `POSITION_LABELS` 结构是 `{ cn: string; en: string; full: string }`，而这些文件原来的简化版只是 `Record<string, string>`（英文缩写）。替换后读取方式要改为 `POSITION_LABELS[pos]?.en` 或 `POSITION_LABELS[pos]?.cn` 视上下文决定。

- [ ] **修改 `src/app/players/[userId]/page.tsx`**：

1. 删除本地 `POSITION_LABELS` 定义（约第 15-21 行）
2. 新增 import：

```typescript
import { POSITION_LABELS } from "@/lib/validators/registration";
```

3. 原来 `POSITION_LABELS[latestReg.primaryPosition] ?? latestReg.primaryPosition` 改为：

```typescript
POSITION_LABELS[latestReg.primaryPosition as keyof typeof POSITION_LABELS]?.cn ?? latestReg.primaryPosition
```

对文件中所有 `POSITION_LABELS[...]` 使用处做同样替换（共约 3 处）。

- [ ] **修改 `src/app/[seasonSlug]/teams/[teamId]/page.tsx`**：

1. 删除本地 `POSITION_LABELS` 定义和 `POSITION_ORDER` 定义（约第 13-21 行）
2. 新增 imports：

```typescript
import { POSITION_LABELS } from "@/lib/validators/registration";
import { CS2_POSITIONS } from "@/types/season";
```

3. 原来 `POSITION_ORDER.indexOf(a.primaryPosition)` 改为 `CS2_POSITIONS.indexOf(a.primaryPosition as never)`
4. 原来 `POSITION_LABELS[p.primaryPosition] ?? p.primaryPosition` 改为 `POSITION_LABELS[p.primaryPosition as keyof typeof POSITION_LABELS]?.cn ?? p.primaryPosition`

- [ ] **修改 `src/components/teams/TeamCard.tsx`**：

1. 删除本地 `POSITION_LABELS` 定义
2. 新增 import：

```typescript
import { POSITION_LABELS } from "@/lib/validators/registration";
```

3. 将 `POSITION_LABELS[p.primaryPosition] ?? p.primaryPosition` 改为 `POSITION_LABELS[p.primaryPosition as keyof typeof POSITION_LABELS]?.cn ?? p.primaryPosition`

- [ ] **修改 `src/components/teams/TeamGrid.tsx`**：

1. 删除本地 `POSITION_LABELS` 定义
2. 新增 import：

```typescript
import { POSITION_LABELS } from "@/lib/validators/registration";
```

3. 将 `POSITION_LABELS[m.primaryPosition] ?? m.primaryPosition` 改为 `POSITION_LABELS[m.primaryPosition as keyof typeof POSITION_LABELS]?.cn ?? m.primaryPosition`

- [ ] **修改 `src/app/[seasonSlug]/teams/page.tsx`**：

1. 删除本地 `POSITION_ORDER` 定义（约第 11 行）
2. 新增 import：

```typescript
import { CS2_POSITIONS } from "@/types/season";
```

3. 将 `POSITION_ORDER.indexOf(...)` 改为 `CS2_POSITIONS.indexOf(... as never)`

- [ ] **类型检查**

```bash
cd /Users/starfie1d/GitHub/RivalHub && pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **提交**

```bash
git add "src/app/players/[userId]/page.tsx" "src/app/[seasonSlug]/teams/[teamId]/page.tsx" "src/app/[seasonSlug]/teams/page.tsx" src/components/teams/TeamCard.tsx src/components/teams/TeamGrid.tsx
git commit -m "refactor: remove local POSITION_LABELS/POSITION_ORDER, use shared constants"
```

---

### Task 1.7：统一 Match / Registration 状态标签

**Files:**
- Modify: `src/components/matches/MatchStatusBadge.tsx`
- Modify: `src/components/matches/MatchDetail.tsx`
- Modify: `src/components/admin/RegistrationReviewList.tsx`

**注意**：`MatchDetail.tsx` 中 `scheduled` 原标签是 `"未开始"`，而 `MATCH_STATUS_LABELS` 是 `"已排期"`。统一后会变更显示文案，这是预期行为（使用权威定义）。

- [ ] **修改 `src/components/matches/MatchStatusBadge.tsx`**：

1. 删除本地 `STATUS_LABELS` 定义（约第 12-18 行）
2. 在顶部新增 import（同时删除本地 `MatchStatus` 类型定义，改为从 types 导入）：

```typescript
import { MATCH_STATUS_LABELS } from "@/types/match";
import type { MatchStatus } from "@/types/match";
```

3. 将 `{STATUS_LABELS[status]}` 改为 `{MATCH_STATUS_LABELS[status]}`

- [ ] **修改 `src/components/matches/MatchDetail.tsx`**：

1. 删除本地 `STATUS_LABELS` 定义（约第 9-14 行）
2. 新增 import：

```typescript
import { MATCH_STATUS_LABELS } from "@/types/match";
```

3. 将 `STATUS_LABELS[match.status] ?? match.status` 改为 `MATCH_STATUS_LABELS[match.status as import("@/types/match").MatchStatus] ?? match.status`

- [ ] **修改 `src/components/admin/RegistrationReviewList.tsx`**：

1. 找到本地 `STATUS_LABELS` 定义（约第 50-57 行），删除
2. 新增 import：

```typescript
import { REGISTRATION_STATUS_LABELS } from "@/types/registration";
```

3. 将文件中所有 `STATUS_LABELS[...]` 替换为 `REGISTRATION_STATUS_LABELS[...]`（约 3 处）

- [ ] **类型检查**

```bash
cd /Users/starfie1d/GitHub/RivalHub && pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **提交**

```bash
git add src/components/matches/MatchStatusBadge.tsx src/components/matches/MatchDetail.tsx src/components/admin/RegistrationReviewList.tsx
git commit -m "refactor: use MATCH_STATUS_LABELS and REGISTRATION_STATUS_LABELS from types"
```

---

### Task 1.8：PR1 最终验证

- [ ] **完整类型检查**

```bash
cd /Users/starfie1d/GitHub/RivalHub && pnpm tsc --noEmit 2>&1
```

期望：0 错误。

- [ ] **Lint 检查**

```bash
cd /Users/starfie1d/GitHub/RivalHub && pnpm lint 2>&1 | tail -20
```

- [ ] **创建 PR**

```bash
gh pr create --base dev --head refactor/unify-display-constants \
  --title "refactor: unify display constants (status labels, position labels, StatusDot)" \
  --body "$(cat <<'EOF'
## Summary
- 新增 `SEASON_STATUS_TONE` 和导出 `CS2_POSITIONS` 到 `types/season.ts`
- 提取 `StatusDot` 到 `components/ui/status-dot.tsx`，删除 4 处重复定义
- `POSITION_LABELS` 统一由 `lib/validators/registration` 导出，删除 6 处局部重定义
- `MATCH_STATUS_LABELS` / `REGISTRATION_STATUS_LABELS` 从 types 统一消费，删除 3 处重复

## Test plan
- [ ] `pnpm tsc --noEmit` 无错误
- [ ] `pnpm lint` 无新增警告
- [ ] 本地 `pnpm dev` 首页/赛季页/teams 页面状态标签和位置标签显示正常
EOF
)"
```

---

## PR2：Mock 数据替换为 DB 查询

> 分支名：`refactor/replace-mock-with-db`
> 从合并 PR1 后的 `dev` 切出

### Task 2.1：首页接入 DB

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **改造 `src/app/page.tsx`** 为 RSC，从 DB 查询赛季：

将文件完整替换为以下内容（保留原有 `FeaturedSeasonCard` / `CompactSeasonCard` 组件结构，仅改数据来源）：

```typescript
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { notIn } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { APP_BRAND } from "@/lib/branding";
import { SEASON_STATUS_LABELS } from "@/types/season";
import { StatusDot } from "@/components/ui/status-dot";
import type { Season } from "@/db/schema/seasons";
import type { SeasonStatus } from "@/types/season";

export default async function HomePage() {
  const allSeasons = await db
    .select()
    .from(seasons)
    .orderBy(seasons.createdAt);

  const activeSeasons = allSeasons.filter(
    (s) => s.status !== "archived" && s.status !== "draft"
  );
  const featured = activeSeasons[0] as Season | undefined;
  const others = activeSeasons.slice(1) as Season[];

  return (
    <div className="container mx-auto px-4 py-16 sm:py-24">
      {/* Hero */}
      <div className="max-w-3xl mb-16">
        <div className="inline-flex items-center gap-2 px-3 py-1 mb-6 rounded-full border border-[var(--border)] bg-[var(--bg-elevated)]/50 text-xs text-[var(--text-secondary)]">
          <span>开源 · 多赛事 · 数据驱动</span>
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold text-[var(--text-primary)] mb-4 leading-tight">
          {APP_BRAND.name}
          <span className="block text-[var(--text-secondary)] text-2xl sm:text-3xl font-medium mt-2">
            电竞社群赛事管理平台
          </span>
        </h1>
        <p className="text-[var(--text-secondary)] text-base sm:text-lg max-w-xl leading-relaxed">
          {APP_BRAND.description}
        </p>
      </div>

      {featured ? (
        <section>
          <div className="flex items-baseline justify-between mb-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">当前赛季</h2>
            <span className="text-sm text-[var(--text-muted)] tabular">
              共 {activeSeasons.length} 个进行中
            </span>
          </div>
          <FeaturedSeasonCard season={featured} />
          {others.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
              {others.map((s) => (
                <CompactSeasonCard key={s.id} season={s} />
              ))}
            </div>
          )}
        </section>
      ) : (
        <div className="text-center text-[var(--text-secondary)] py-16">
          <p className="text-lg mb-2">暂无进行中的赛季</p>
          <Link href="/seasons" className="text-sm underline hover:text-[var(--text-primary)]">
            查看历史赛季
          </Link>
        </div>
      )}
    </div>
  );
}

function FeaturedSeasonCard({ season }: { season: Season }) {
  return (
    <Link
      href={`/${season.slug}` as never}
      className="group block card-elevated rounded-xl border border-[var(--border)] overflow-hidden"
    >
      <div className="h-1 w-full" style={{ backgroundColor: season.themeColor ?? "#f97316" }} />
      <div className="p-6 sm:p-8 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-6 items-center">
        <div>
          <div className="flex items-center gap-2 mb-3 text-xs">
            <StatusDot status={season.status as SeasonStatus} />
            <span className="text-[var(--text-secondary)] uppercase tracking-wider">
              {SEASON_STATUS_LABELS[season.status as SeasonStatus]}
            </span>
            <span className="text-[var(--text-muted)]">·</span>
            <span className="text-[var(--text-muted)]">{season.kind}</span>
          </div>
          <h3 className="text-2xl sm:text-3xl font-bold text-[var(--text-primary)] mb-2">
            {season.name}
          </h3>
        </div>
        <div
          className="hidden sm:flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold text-[var(--text-primary)] border transition-colors"
          style={{
            backgroundColor: `${season.themeColor ?? "#f97316"}1a`,
            borderColor: `${season.themeColor ?? "#f97316"}40`,
          }}
        >
          进入赛季
          <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
        </div>
      </div>
    </Link>
  );
}

function CompactSeasonCard({ season }: { season: Season }) {
  return (
    <Link
      href={`/${season.slug}` as never}
      className="block card-elevated rounded-lg border border-[var(--border)] overflow-hidden"
    >
      <div className="h-0.5 w-full" style={{ backgroundColor: season.themeColor ?? "#f97316" }} />
      <div className="p-5">
        <div className="flex items-center gap-2 mb-2 text-xs">
          <StatusDot status={season.status as SeasonStatus} />
          <span className="text-[var(--text-secondary)]">
            {SEASON_STATUS_LABELS[season.status as SeasonStatus]}
          </span>
        </div>
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">{season.name}</h3>
        <p className="text-sm text-[var(--text-muted)]">{season.kind}</p>
      </div>
    </Link>
  );
}
```

- [ ] **类型检查**

```bash
cd /Users/starfie1d/GitHub/RivalHub && pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **提交**

```bash
git add src/app/page.tsx
git commit -m "refactor: home page now queries DB instead of mock data"
```

---

### Task 2.2：历史赛季页接入 DB

**Files:**
- Modify: `src/app/seasons/page.tsx`

- [ ] **改造 `src/app/seasons/page.tsx`** 为 RSC，从 DB 查询所有赛季：

```typescript
import Link from "next/link";
import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { SEASON_STATUS_LABELS } from "@/types/season";
import { StatusDot } from "@/components/ui/status-dot";
import type { SeasonStatus } from "@/types/season";

export const metadata: Metadata = { title: "所有赛季" };

export default async function SeasonsPage() {
  const allSeasons = await db
    .select()
    .from(seasons)
    .orderBy(desc(seasons.createdAt));

  return (
    <div className="container mx-auto px-4 py-12 sm:py-16">
      <div className="mb-10">
        <h1 className="text-3xl sm:text-4xl font-bold text-[var(--text-primary)] mb-2">所有赛季</h1>
        <p className="text-[var(--text-secondary)]">
          共 <span className="tabular text-[var(--text-primary)]">{allSeasons.length}</span> 个赛季归档
        </p>
      </div>

      {allSeasons.length === 0 ? (
        <p className="text-[var(--text-muted)] text-center py-16">暂无赛季记录</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {allSeasons.map((season) => (
            <Link
              key={season.id}
              href={`/${season.slug}` as never}
              className="card-elevated block rounded-lg border border-[var(--border)] overflow-hidden"
            >
              <div className="h-1 w-full" style={{ backgroundColor: season.themeColor ?? "#f97316" }} />
              <div className="p-5">
                <div className="flex items-center gap-2 mb-3 text-xs">
                  <StatusDot status={season.status as SeasonStatus} />
                  <span className="text-[var(--text-secondary)]">
                    {SEASON_STATUS_LABELS[season.status as SeasonStatus]}
                  </span>
                  <span className="text-[var(--text-muted)]">·</span>
                  <span className="text-[var(--text-muted)]">{season.kind}</span>
                </div>
                <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">{season.name}</h3>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **类型检查**

```bash
cd /Users/starfie1d/GitHub/RivalHub && pnpm tsc --noEmit 2>&1 | head -20
```

- [ ] **提交**

```bash
git add src/app/seasons/page.tsx
git commit -m "refactor: seasons page now queries DB instead of mock data"
```

---

### Task 2.3：赛季首页接入 DB + capability 门控 quick links

**Files:**
- Modify: `src/app/[seasonSlug]/page.tsx`

- [ ] **改造 `src/app/[seasonSlug]/page.tsx`**：

```typescript
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { UserPlus, Vote, Users, Swords, Shuffle } from "lucide-react";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { SEASON_STATUS_LABELS } from "@/types/season";
import type { SeasonStatus } from "@/types/season";

interface SeasonPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export default async function SeasonPage({ params }: SeasonPageProps) {
  const { seasonSlug } = await params;

  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  if (!season) notFound();

  const quickLinks = [
    {
      href: `/${seasonSlug}/register`,
      label: "立即报名",
      description: "提交报名信息",
      icon: UserPlus,
      show: true,
    },
    {
      href: `/${seasonSlug}/captains`,
      label: "队长投票",
      description: "为心仪队长投票",
      icon: Vote,
      show: season.hasCaptainVoting,
    },
    {
      href: `/${seasonSlug}/draft`,
      label: "选秀直播间",
      description: "实时观看选秀进度",
      icon: Shuffle,
      show: season.hasDraft,
    },
    {
      href: `/${seasonSlug}/teams`,
      label: "队伍阵容",
      description: "查看各队选手分布",
      icon: Users,
      show: true,
    },
    {
      href: `/${seasonSlug}/matches`,
      label: "赛程对决",
      description: "Bracket + 战报",
      icon: Swords,
      show: season.qualifierFormat !== null || season.playoffFormat !== null,
    },
  ].filter((l) => l.show);

  return (
    <div className="container mx-auto px-4 py-10">
      <div className="season-glow relative mb-12 pt-6">
        <div className="flex items-center gap-3 mb-4 text-xs uppercase tracking-wider">
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border"
            style={{
              backgroundColor: `rgba(var(--season-primary-rgb), 0.12)`,
              borderColor: `rgba(var(--season-primary-rgb), 0.4)`,
              color: "var(--season-primary)",
            }}
          >
            {SEASON_STATUS_LABELS[season.status as SeasonStatus] ?? season.status}
          </span>
          <span className="text-[var(--text-muted)]">{season.kind}</span>
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold text-[var(--text-primary)] mb-4 leading-tight">
          {season.name}
        </h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {quickLinks.map(({ href, label, description, icon: Icon }) => (
          <Link
            key={href}
            href={href as never}
            className="card-elevated group flex flex-col gap-2 p-5 rounded-lg border border-[var(--border)]"
          >
            <div
              className="inline-flex items-center justify-center w-10 h-10 rounded-md mb-1 transition-colors"
              style={{
                backgroundColor: `rgba(var(--season-primary-rgb), 0.1)`,
                color: "var(--season-primary)",
              }}
            >
              <Icon size={18} />
            </div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">{label}</h3>
            <p className="text-xs text-[var(--text-muted)]">{description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **类型检查**

```bash
cd /Users/starfie1d/GitHub/RivalHub && pnpm tsc --noEmit 2>&1 | head -20
```

- [ ] **提交**

```bash
git add "src/app/[seasonSlug]/page.tsx"
git commit -m "refactor: season home page queries DB, quick links respect capability flags"
```

---

### Task 2.4：PR2 最终验证

- [ ] **完整类型检查和 lint**

```bash
cd /Users/starfie1d/GitHub/RivalHub && pnpm tsc --noEmit && pnpm lint 2>&1 | tail -10
```

- [ ] **创建 PR**

```bash
gh pr create --base dev --head refactor/replace-mock-with-db \
  --title "refactor: replace mock season data with DB queries" \
  --body "$(cat <<'EOF'
## Summary
- 首页 `/` 从 DB 查询活跃赛季，替代硬编码 mock 数组
- 历史赛季页 `/seasons` 从 DB 查询所有赛季
- 赛季首页 `/[seasonSlug]` 从 DB 查询，quick links 根据 season capability 动态显示/隐藏

## Test plan
- [ ] `pnpm tsc --noEmit` 无错误
- [ ] 本地访问 `/`，显示数据库中的赛季（需本地 DB 有数据）
- [ ] 访问 `/[slug]`，无 `hasDraft` 的赛季不显示"选秀直播间"入口
EOF
)"
```

---

## PR3：Header 用户区域 + 登录入口

> 分支名：`feat/header-user-area`
> 从合并 PR2 后的 `dev` 切出

### Task 3.1：安装 DropdownMenu shadcn 组件

**Files:**
- Create: `src/components/ui/dropdown-menu.tsx`（由 shadcn 生成）

- [ ] **安装组件**

```bash
cd /Users/starfie1d/GitHub/RivalHub && pnpm dlx shadcn@latest add dropdown-menu
```

期望：在 `src/components/ui/` 生成 `dropdown-menu.tsx`。

- [ ] **提交**

```bash
git add src/components/ui/dropdown-menu.tsx
git commit -m "chore: add shadcn dropdown-menu component"
```

---

### Task 3.2：新建 HeaderClient

**Files:**
- Create: `src/components/layout/header-client.tsx`

- [ ] **新建 `src/components/layout/header-client.tsx`**：

```typescript
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Menu, X, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { APP_BRAND } from "@/lib/branding";
import { cn } from "@/lib/utils/cn";
import { SEASON_STATUS_LABELS } from "@/types/season";
import { logoutUser } from "@/actions/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SeasonStatus } from "@/types/season";

interface SeasonNav {
  slug: string;
  name: string;
  status: SeasonStatus;
}

interface SessionInfo {
  email: string;
  role: "user" | "season_admin" | "super_admin";
}

interface HeaderClientProps {
  seasons: SeasonNav[];
  session: SessionInfo | null;
}

export function HeaderClient({ seasons, session }: HeaderClientProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const navLinks = seasons.map((s) => ({
    href: `/${s.slug}`,
    label: s.name,
    badge: SEASON_STATUS_LABELS[s.status],
    active: pathname.startsWith(`/${s.slug}`),
  }));

  function handleLogout() {
    startTransition(async () => {
      await logoutUser();
      toast.success("已退出登录");
      router.push("/");
    });
  }

  const isAdmin = session && session.role !== "user";
  const initials = session?.email?.slice(0, 2).toUpperCase() ?? "??";

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--bg-elevated)]/95 backdrop-blur">
      <div className="container mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link
          href="/"
          className="font-bold text-lg text-[var(--text-primary)] hover:text-white transition-colors"
        >
          {APP_BRAND.name}
        </Link>

        {/* Desktop nav */}
        <nav className="hidden sm:flex items-center gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href as never}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors",
                link.active
                  ? "bg-[var(--bg-overlay)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-overlay)]"
              )}
            >
              {link.label}
              <span className="text-xs px-1.5 py-0.5 rounded-sm bg-[var(--bg-base)] text-[var(--text-muted)]">
                {link.badge}
              </span>
            </Link>
          ))}
          <Link
            href="/seasons"
            className={cn(
              "px-3 py-1.5 rounded-md text-sm transition-colors",
              pathname === "/seasons"
                ? "bg-[var(--bg-overlay)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-overlay)]"
            )}
          >
            历史赛季
          </Link>
        </nav>

        {/* User area (desktop) */}
        <div className="hidden sm:flex items-center gap-2">
          {!session ? (
            <Link
              href="/login"
              className="px-3 py-1.5 rounded-md text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-overlay)] transition-colors"
            >
              登录
            </Link>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-1.5 px-2 py-1 rounded-md text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-overlay)] transition-colors">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--bg-overlay)] text-xs font-medium text-[var(--text-primary)]">
                    {initials}
                  </span>
                  <ChevronDown size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <div className="px-2 py-1.5 text-xs text-[var(--text-muted)] truncate">
                  {session.email}
                </div>
                <DropdownMenuSeparator />
                {isAdmin && (
                  <DropdownMenuItem asChild>
                    <Link href="/admin">管理后台</Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem asChild>
                  <Link href="/invite">使用邀请码</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={isPending}
                  onClick={handleLogout}
                  className="text-red-400 focus:text-red-400"
                >
                  {isPending ? "退出中…" : "退出登录"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          className="sm:hidden p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          onClick={() => setMobileOpen((o) => !o)}
          aria-label="菜单"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="sm:hidden border-t border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-3 flex flex-col gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href as never}
              onClick={() => setMobileOpen(false)}
              className="flex items-center justify-between px-3 py-2 rounded-md text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-overlay)]"
            >
              {link.label}
              <span className="text-xs text-[var(--text-muted)]">{link.badge}</span>
            </Link>
          ))}
          <Link
            href="/seasons"
            onClick={() => setMobileOpen(false)}
            className="px-3 py-2 rounded-md text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-overlay)]"
          >
            历史赛季
          </Link>
          <div className="border-t border-[var(--border)] mt-2 pt-2">
            {!session ? (
              <Link
                href="/login"
                onClick={() => setMobileOpen(false)}
                className="block px-3 py-2 rounded-md text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-overlay)]"
              >
                登录
              </Link>
            ) : (
              <>
                <p className="px-3 py-1 text-xs text-[var(--text-muted)] truncate">{session.email}</p>
                {isAdmin && (
                  <Link
                    href="/admin"
                    onClick={() => setMobileOpen(false)}
                    className="block px-3 py-2 rounded-md text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-overlay)]"
                  >
                    管理后台
                  </Link>
                )}
                <Link
                  href="/invite"
                  onClick={() => setMobileOpen(false)}
                  className="block px-3 py-2 rounded-md text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-overlay)]"
                >
                  使用邀请码
                </Link>
                <button
                  onClick={() => { setMobileOpen(false); handleLogout(); }}
                  disabled={isPending}
                  className="block w-full text-left px-3 py-2 rounded-md text-sm text-red-400 hover:bg-[var(--bg-overlay)] disabled:opacity-50"
                >
                  {isPending ? "退出中…" : "退出登录"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
```

- [ ] **类型检查**

```bash
cd /Users/starfie1d/GitHub/RivalHub && pnpm tsc --noEmit 2>&1 | head -20
```

- [ ] **提交**

```bash
git add src/components/layout/header-client.tsx
git commit -m "feat: add HeaderClient with user area, login/logout, admin entry"
```

---

### Task 3.3：改造 header.tsx 为 Server Component

**Files:**
- Modify: `src/components/layout/header.tsx`

- [ ] **完整替换 `src/components/layout/header.tsx`**：

```typescript
import { notIn } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { getUserSession } from "@/lib/auth/session";
import { HeaderClient } from "@/components/layout/header-client";
import type { SeasonStatus } from "@/types/season";

export async function Header() {
  const [visibleSeasons, session] = await Promise.all([
    db
      .select({ slug: seasons.slug, name: seasons.name, status: seasons.status })
      .from(seasons)
      .orderBy(seasons.createdAt),
    getUserSession(),
  ]);

  const publicSeasons = visibleSeasons
    .filter((s) => s.status !== "archived" && s.status !== "draft")
    .map((s) => ({ ...s, status: s.status as SeasonStatus }));

  const sessionInfo = session
    ? { email: session.email, role: session.role }
    : null;

  return <HeaderClient seasons={publicSeasons} session={sessionInfo} />;
}
```

- [ ] **类型检查**

```bash
cd /Users/starfie1d/GitHub/RivalHub && pnpm tsc --noEmit 2>&1 | head -20
```

- [ ] **提交**

```bash
git add src/components/layout/header.tsx
git commit -m "refactor: Header becomes Server Component, queries DB and session"
```

---

### Task 3.4：PR3 最终验证

- [ ] **完整类型检查和 lint**

```bash
cd /Users/starfie1d/GitHub/RivalHub && pnpm tsc --noEmit && pnpm lint 2>&1 | tail -10
```

- [ ] **创建 PR**

```bash
gh pr create --base dev --head feat/header-user-area \
  --title "feat: header user area with login/logout and admin entry" \
  --body "$(cat <<'EOF'
## Summary
- Header 拆为 Server Component (`header.tsx`) + Client Component (`header-client.tsx`)
- Server Component 从 DB 查询公开赛季列表，调用 `getUserSession()` 获取登录状态
- 未登录显示「登录」按钮，已登录显示头像缩写 + 下拉菜单
- 管理员下拉菜单额外显示「管理后台」入口
- 非管理员下拉菜单有「使用邀请码」入口
- Mobile menu 同步添加用户区域

## Test plan
- [ ] `pnpm tsc --noEmit` 无错误
- [ ] 未登录时 Header 右侧显示「登录」按钮，点击跳转 `/login`
- [ ] 登录后显示邮箱缩写头像，下拉有「使用邀请码」和「退出登录」
- [ ] 管理员登录后下拉额外显示「管理后台」
- [ ] 退出登录后跳回首页
- [ ] Mobile 端汉堡菜单展开后也有登录/用户区域
EOF
)"
```

---

## PR4：赛季二级导航 + admin 鉴权统一

> 分支名：`feat/season-nav-admin-auth`
> 从 `dev` 切出（可与 PR2/PR3 并行开发，最后合并）

### Task 4.1：新建 SeasonNav Client Component

**Files:**
- Create: `src/components/layout/season-nav.tsx`

- [ ] **新建 `src/components/layout/season-nav.tsx`**：

```typescript
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

interface SeasonNavProps {
  slug: string;
  hasCaptainVoting: boolean;
  hasDraft: boolean;
  hasMatches: boolean;
}

export function SeasonNav({ slug, hasCaptainVoting, hasDraft, hasMatches }: SeasonNavProps) {
  const pathname = usePathname();

  const tabs = [
    { label: "首页", href: `/${slug}`, exact: true },
    { label: "报名", href: `/${slug}/register`, exact: false },
    ...(hasCaptainVoting ? [{ label: "队长投票", href: `/${slug}/captains`, exact: false }] : []),
    ...(hasDraft ? [{ label: "选秀", href: `/${slug}/draft`, exact: false }] : []),
    { label: "队伍", href: `/${slug}/teams`, exact: false },
    ...(hasMatches ? [{ label: "赛程", href: `/${slug}/matches`, exact: false }] : []),
  ];

  return (
    <nav className="border-b border-[var(--border)] bg-[var(--bg-elevated)]/60">
      <div className="container mx-auto px-4">
        <div className="flex items-end gap-0 overflow-x-auto scrollbar-none">
          {tabs.map((tab) => {
            const isActive = tab.exact
              ? pathname === tab.href
              : pathname === tab.href || pathname.startsWith(tab.href + "/");
            return (
              <Link
                key={tab.href}
                href={tab.href as never}
                className={cn(
                  "relative shrink-0 px-4 py-3 text-sm transition-colors whitespace-nowrap",
                  isActive
                    ? "text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                )}
              >
                {tab.label}
                {isActive && (
                  <span
                    className="absolute bottom-0 left-0 right-0 h-0.5"
                    style={{ backgroundColor: "var(--season-primary)" }}
                  />
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
```

- [ ] **类型检查**

```bash
cd /Users/starfie1d/GitHub/RivalHub && pnpm tsc --noEmit 2>&1 | head -20
```

- [ ] **提交**

```bash
git add src/components/layout/season-nav.tsx
git commit -m "feat: add SeasonNav capability-driven tab navigation component"
```

---

### Task 4.2：在 [seasonSlug]/layout.tsx 引入 SeasonNav

**Files:**
- Modify: `src/app/[seasonSlug]/layout.tsx`

- [ ] **完整替换 `src/app/[seasonSlug]/layout.tsx`**：

```typescript
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { Breadcrumb } from "@/components/layout/breadcrumb";
import { SeasonNav } from "@/components/layout/season-nav";
import { hexToRgbString } from "@/lib/utils/color";

interface SeasonLayoutProps {
  children: React.ReactNode;
  params: Promise<{ seasonSlug: string }>;
}

export async function generateMetadata({ params }: SeasonLayoutProps): Promise<Metadata> {
  const { seasonSlug } = await params;
  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  return {
    title: season?.name ?? seasonSlug,
  };
}

export default async function SeasonLayout({ children, params }: SeasonLayoutProps) {
  const { seasonSlug } = await params;

  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });

  if (!season) notFound();

  const themeColor = season.themeColor ?? "#f97316";
  const hasMatches = season.qualifierFormat !== null || season.playoffFormat !== null;

  return (
    <div
      data-season={seasonSlug}
      style={{
        "--season-primary": themeColor,
        "--season-primary-rgb": hexToRgbString(themeColor),
      } as React.CSSProperties}
    >
      <div className="container mx-auto px-4 pt-6 pb-2">
        <Breadcrumb
          items={[
            { label: "首页", href: "/" },
            { label: season.name },
          ]}
        />
      </div>
      <SeasonNav
        slug={seasonSlug}
        hasCaptainVoting={season.hasCaptainVoting}
        hasDraft={season.hasDraft}
        hasMatches={hasMatches}
      />
      {children}
    </div>
  );
}
```

- [ ] **类型检查**

```bash
cd /Users/starfie1d/GitHub/RivalHub && pnpm tsc --noEmit 2>&1 | head -20
```

- [ ] **提交**

```bash
git add "src/app/[seasonSlug]/layout.tsx"
git commit -m "feat: add SeasonNav to season layout with capability-driven tabs"
```

---

### Task 4.3：admin layout 统一鉴权

**Files:**
- Modify: `src/app/admin/layout.tsx`

- [ ] **完整替换 `src/app/admin/layout.tsx`**：

```typescript
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { checkAdminSession } from "@/lib/auth/session";
import { AdminNav } from "@/components/admin/AdminNav";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await checkAdminSession();
  if (!admin) redirect("/admin/login");

  return (
    <div className="min-h-screen">
      <AdminNav email={admin.email} />
      {children}
    </div>
  );
}
```

- [ ] **类型检查**

```bash
cd /Users/starfie1d/GitHub/RivalHub && pnpm tsc --noEmit 2>&1 | head -20
```

- [ ] **提交**

```bash
git add src/app/admin/layout.tsx
git commit -m "refactor: admin layout handles auth and AdminNav centrally"
```

---

### Task 4.4：清理 admin 子页面冗余鉴权和 AdminNav

**Files:**
- Modify: `src/app/admin/page.tsx`
- Modify: `src/app/admin/settings/page.tsx`
- Modify: `src/app/admin/users/page.tsx`
- Modify: `src/app/admin/invites/page.tsx`
- Modify: `src/app/admin/[seasonSlug]/layout.tsx`

- [ ] **修改 `src/app/admin/page.tsx`**：

1. 删除 `import { checkAdminSession }` 行
2. 删除 `import { AdminNav }` 行
3. 删除函数体内 `const admin = await checkAdminSession();` 和 `if (!admin) redirect("/admin/login");`
4. 删除 `<div className="min-h-screen">` 外层 wrapper 和 `<AdminNav email={admin.email} />`
5. 将查询赛季的权限判断改为：在 layout 已保证是管理员的前提下，函数签名不再需要 admin 变量做权限判断，但仍需知道 role 和 adminSeasonIds 来过滤赛季。因此保留 `checkAdminSession()` 调用但仅用于数据，不做 redirect（layout 已保护）：

```typescript
export default async function AdminDashboardPage() {
  const admin = await checkAdminSession();
  // layout 已保证 admin 非 null，此处直接用
  if (!admin) return null;

  // ...其余查询逻辑和渲染不变，但去掉 <AdminNav> 和 min-h-screen wrapper
}
```

返回的 JSX 从：
```tsx
<div className="min-h-screen">
  <AdminNav email={admin.email} />
  <div className="container ...">
    ...
  </div>
</div>
```
改为：
```tsx
<div className="container mx-auto px-4 py-8 max-w-2xl">
  ...
</div>
```

- [ ] **修改 `src/app/admin/settings/page.tsx`**：

同上原则：
1. 删除 `import { AdminNav }` 
2. 删除 `if (!admin) redirect(...)` 
3. 移除 `<div className="min-h-screen">` wrapper 和 `<AdminNav />` 渲染

- [ ] **修改 `src/app/admin/users/page.tsx`**：

1. 删除 `import { AdminNav }` 行
2. 移除 `<div className="min-h-screen">` wrapper 和 `<AdminNav email={admin.email} />` 渲染（保留 `requireSuperAdmin` 权限检查）

- [ ] **修改 `src/app/admin/invites/page.tsx`**：

同上：删除 `AdminNav` import 和渲染，保留 `requireSuperAdmin`。

- [ ] **修改 `src/app/admin/[seasonSlug]/layout.tsx`**：

1. 删除 `import { AdminNav }` 行
2. 在返回 JSX 中移除 `<div className="min-h-screen">` wrapper 和 `<AdminNav email={admin.email} />`
3. 改为直接返回 `children`：

```typescript
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { requireSeasonAdmin } from "@/lib/auth/session";

export default async function AdminSeasonLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ seasonSlug: string }>;
}) {
  const { seasonSlug } = await params;
  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
    columns: { id: true },
  });
  if (!season) notFound();

  try {
    await requireSeasonAdmin(season.id);
  } catch {
    redirect("/admin/login");
  }

  return <>{children}</>;
}
```

- [ ] **类型检查**

```bash
cd /Users/starfie1d/GitHub/RivalHub && pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **提交**

```bash
git add src/app/admin/page.tsx src/app/admin/settings/page.tsx src/app/admin/users/page.tsx src/app/admin/invites/page.tsx "src/app/admin/[seasonSlug]/layout.tsx"
git commit -m "refactor: remove redundant AdminNav and auth boilerplate from admin pages"
```

---

### Task 4.5：PR4 最终验证

- [ ] **完整类型检查和 lint**

```bash
cd /Users/starfie1d/GitHub/RivalHub && pnpm tsc --noEmit && pnpm lint 2>&1 | tail -10
```

- [ ] **验证 admin/login 页面不受 layout 保护**（`/admin/login` 应该在 layout 保护范围之外）

检查：`src/app/admin/login/page.tsx` 是 `/admin/login` 路由，会经过 `src/app/admin/layout.tsx`——这意味着未登录访问 `/admin/login` 会被 layout redirect 到 `/admin/login`，形成无限循环！

**修复**：在 `src/app/admin/layout.tsx` 中排除 login 路由：

```typescript
import { redirect, usePathname } from "next/navigation";
```

注意：Server Component 不能用 `usePathname`。改为通过检查 headers 获取路径：

```typescript
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { checkAdminSession } from "@/lib/auth/session";
import { AdminNav } from "@/components/admin/AdminNav";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const headersList = await headers();
  const pathname = headersList.get("x-pathname") ?? "";

  // login 页面不需要鉴权保护
  if (pathname.startsWith("/admin/login")) {
    return <>{children}</>;
  }

  const admin = await checkAdminSession();
  if (!admin) redirect("/admin/login");

  return (
    <div className="min-h-screen">
      <AdminNav email={admin.email} />
      {children}
    </div>
  );
}
```

但是 `x-pathname` header 需要在 middleware 里设置。由于本项目没有 middleware，更简单的方案是：**将 `admin/login` 路由移出 `admin/layout.tsx` 的作用域**。

Next.js App Router 中，`src/app/admin/layout.tsx` 会包裹 `/admin/**` 下的所有路由，包括 `/admin/login`。解决方案是使用 Route Groups，将 login 页面放到 `(auth)` group 中：

将 `src/app/admin/login/page.tsx` 移动到 `src/app/admin/(auth)/login/page.tsx`，并在 `src/app/admin/(auth)/layout.tsx` 中不做鉴权：

```typescript
// src/app/admin/(auth)/layout.tsx
import type { ReactNode } from "react";
export default function AdminAuthLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
```

同时 `src/app/admin/layout.tsx` 保持如上写法（不含 login 排除逻辑）。

执行：

```bash
mkdir -p /Users/starfie1d/GitHub/RivalHub/src/app/admin/\(auth\)
cp /Users/starfie1d/GitHub/RivalHub/src/app/admin/login/page.tsx /Users/starfie1d/GitHub/RivalHub/src/app/admin/\(auth\)/login/page.tsx
```

然后新建 `src/app/admin/(auth)/layout.tsx`：

```typescript
import type { ReactNode } from "react";
export default function AdminAuthLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
```

删除原 `src/app/admin/login/page.tsx`：

```bash
rm /Users/starfie1d/GitHub/RivalHub/src/app/admin/login/page.tsx
# 检查原目录是否为空
rmdir /Users/starfie1d/GitHub/RivalHub/src/app/admin/login 2>/dev/null || true
```

恢复 `src/app/admin/layout.tsx` 为简洁版（不含 pathname 检查）：

```typescript
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { checkAdminSession } from "@/lib/auth/session";
import { AdminNav } from "@/components/admin/AdminNav";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await checkAdminSession();
  if (!admin) redirect("/admin/login");

  return (
    <div className="min-h-screen">
      <AdminNav email={admin.email} />
      {children}
    </div>
  );
}
```

- [ ] **类型检查**

```bash
cd /Users/starfie1d/GitHub/RivalHub && pnpm tsc --noEmit 2>&1 | head -20
```

- [ ] **提交**

```bash
git add src/app/admin/layout.tsx "src/app/admin/(auth)/"
git commit -m "refactor: move admin/login to route group to avoid layout auth loop"
```

- [ ] **创建 PR**

```bash
gh pr create --base dev --head feat/season-nav-admin-auth \
  --title "feat: season tab nav + unified admin auth layout" \
  --body "$(cat <<'EOF'
## Summary
- 新增 `SeasonNav` Client Component，赛季内页面有 capability-driven tab 导航
- `[seasonSlug]/layout.tsx` 引入 `SeasonNav`，active tab 用 `--season-primary` 颜色下划线高亮
- `admin/layout.tsx` 统一鉴权 + `AdminNav` 渲染，子页面移除重复代码
- `admin/login` 移入 `(auth)` route group，避免被 layout 鉴权拦截

## Test plan
- [ ] `pnpm tsc --noEmit` 无错误
- [ ] 访问 `/[slug]/register`，顶部出现 tab 导航，当前 tab 高亮
- [ ] 无 `hasDraft` 的赛季 tab 导航中没有「选秀」tab
- [ ] 未登录访问 `/admin` 跳转到 `/admin/login`
- [ ] `/admin/login` 页面可正常访问（不被 layout 拦截）
- [ ] 登录后访问后台各页面，`AdminNav` 只渲染一次
EOF
)"
```

---

## 自检清单

- [x] **Spec coverage**：PR1（常量统一）、PR2（Mock 替换）、PR3（Header 用户区域）、PR4（赛季导航 + admin 鉴权）均有对应任务
- [x] **Placeholder scan**：无 TBD/TODO，所有步骤含完整代码
- [x] **Type consistency**：`SeasonNav` props 类型、`HeaderClient` props 类型、`StatusDot` props 类型在定义和使用处一致
- [x] **admin/login 无限循环问题**：已在 Task 4.5 识别并给出修复方案（route group）
- [x] **POSITION_LABELS 格式变化**：已在 Task 1.6 说明需从 `.cn` / `.en` 取值
