# Layout Consistency & Token Cleanup 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一赛季子页面的垂直间距系统，修复赛季首页 3 个布局 bug，并清理 V2 Design Audit v2 审计文档中的全部剩余项目（P2 代码卫生 + P3 一致性增强），共 ~3h。

**Architecture:** 纯 CSS/JSX/组件层面的修正，不涉及数据或业务逻辑变更。4 页面补 `space-y-*`、1 token 配置清理、4 组件修 token/圆角、3 组件 shadcn Card→Panel 统一、1 组件筛选改用 Btn、1 页面拆分组件。

**Tech Stack:** Next.js + Tailwind CSS v4 + design tokens (`globals.css` / `ui-tokens.md`)

---

## 修改文件清单

| 文件 | 操作 | 类别 |
|---|---|---|
| `src/app/[seasonSlug]/page.tsx` | 修改 | 布局 |
| `src/app/[seasonSlug]/draft/page.tsx` | 修改 | 布局 |
| `src/app/[seasonSlug]/captains/page.tsx` | 修改 | 布局 |
| `src/app/[seasonSlug]/register/page.tsx` | 修改 | 布局 |
| `tailwind.config.ts` | 修改 | Token |
| `src/components/teams/TeamCard.tsx` | 修改 | Token |
| `src/components/matches/StandingsTable.tsx` | 修改 | Token |
| `src/components/matches/MapByMapInput.tsx` | 修改 | Token |
| `src/components/matches/StatsLeaderboard.tsx` | 修改 | Token + Card→Panel + Btn |
| `src/components/matches/MatchMvpVote.tsx` | 修改 | 圆角 + Card→Panel |
| `src/components/captains/CaptainVotingPanel.tsx` | 修改 | Card→Panel |
| **新建** `src/components/matches/AdminMatchRow.tsx` | 创建 | 组件拆分 |
| `src/app/admin/[seasonSlug]/matches/page.tsx` | 修改 | 组件拆分 |

---

### Task 1: 赛季首页 — `space-y-8` + STANDINGS 用 Panel 包裹

**文件:** `src/app/[seasonSlug]/page.tsx`

- [ ] **Step 1: 父容器加 `space-y-8`**

将第 207 行:
```tsx
<div className="container mx-auto px-4 py-10">
```
改为:
```tsx
<div className="container mx-auto px-4 py-10 space-y-8">
```

- [ ] **Step 2: 右侧 STANDINGS 用 Panel 包裹**

将第 301-327 行:
```tsx
{/* Right: 积分榜 TOP 4 */}
{standings.length > 0 && (
  <div>
    <div className="flex items-center justify-between mb-3">
      <h3
        className="font-semibold text-sm"
        style={{
          fontFamily: "var(--font-sans)",
          color: "var(--color-fg)",
        }}
      >
        STANDINGS · TOP 4
      </h3>
    </div>
    <StandingsTable
      standings={standings.slice(0, 4)}
      seasonSlug={seasonSlug}
      isFinal={false}
    />
    <div className="mt-3">
      <Btn full ghost asChild>
        <Link href={`/${seasonSlug}/matches`} className="w-full">
          查看完整排名 →
        </Link>
      </Btn>
    </div>
  </div>
)}
```

改为:
```tsx
{/* Right: 积分榜 TOP 4 */}
{standings.length > 0 && (
  <Panel label="STANDINGS · TOP 4">
    <StandingsTable
      standings={standings.slice(0, 4)}
      seasonSlug={seasonSlug}
      isFinal={false}
    />
    <div className="mt-3">
      <Btn full ghost asChild>
        <Link href={`/${seasonSlug}/matches`} className="w-full">
          查看完整排名 →
        </Link>
      </Btn>
    </div>
  </Panel>
)}
```

- [ ] **Step 3: 移除 Stat 四格的 `mt-6`**

将第 356 行:
```tsx
<div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
```
改为:
```tsx
<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
```

- [ ] **Step 4: 验证**

运行: `pnpm build`

---

### Task 2: Draft 页面 — 加 `space-y-8`

**文件:** `src/app/[seasonSlug]/draft/page.tsx`

- [ ] **Step 1: 三处父容器加 `space-y-8`**

第 34 行（未启用选秀）:
```tsx
<main className="container mx-auto max-w-5xl px-4 py-10">
```
改为:
```tsx
<main className="container mx-auto max-w-5xl px-4 py-10 space-y-8">
```

第 49 行（未到选秀阶段）同理。

第 100 行（选秀进行中）:
```tsx
<main className="container mx-auto max-w-7xl px-4 py-10">
```
改为:
```tsx
<main className="container mx-auto max-w-7xl px-4 py-10 space-y-8">
```

- [ ] **Step 2: 预览态父容器也加**

第 66 行（选秀预览态）:
```tsx
<main className="container mx-auto max-w-7xl px-4 py-10">
```
改为:
```tsx
<main className="container mx-auto max-w-7xl px-4 py-10 space-y-8">
```

- [ ] **Step 3: 移除 `mt-4`**

第 111 行:
```tsx
<div className="mt-4">
```
改为:
```tsx
<div>
```

- [ ] **Step 4: 验证**

运行: `pnpm build`

---

### Task 3: Captains 页面 — 加 `space-y-8`

**文件:** `src/app/[seasonSlug]/captains/page.tsx`

- [ ] **Step 1: 父容器加 `space-y-8`**

第 60 行:
```tsx
<main className="container mx-auto max-w-6xl px-4 py-10">
```
改为:
```tsx
<main className="container mx-auto max-w-6xl px-4 py-10 space-y-8">
```

- [ ] **Step 2: 移除 `mb-6`**

第 72 行:
```tsx
<div className="mb-6 rounded-sm border ...">
```
改为:
```tsx
<div className="rounded-sm border ...">
```

- [ ] **Step 3: 验证**

运行: `pnpm build`

---

### Task 4: Register 页面 — 加 `space-y-6`

**文件:** `src/app/[seasonSlug]/register/page.tsx`

- [ ] **Step 1: 父容器加 `space-y-6`**

第 125 行:
```tsx
<div className="container mx-auto px-4 py-10 max-w-2xl">
```
改为:
```tsx
<div className="container mx-auto px-4 py-10 max-w-2xl space-y-6">
```

- [ ] **Step 2: 移除所有 `mb-6`**

第 134 行 `mb-6` → 移除
第 145 行 `mb-6` → 移除
第 191 行 `mb-6` → 移除

标题区 `mb-8`（第 126 行）保留。

- [ ] **Step 3: 验证**

运行: `pnpm build`

---

### Task 5: `tailwind.config.ts` — 删除 6 个无效 token 映射

**文件:** `tailwind.config.ts`

确认: `grep -rn 'bg-base\|bg-elevated\|bg-overlay\|text-primary\|text-secondary\|text-muted' --include='*.tsx' --include='*.ts' --include='*.css' src/` → 无引用

- [ ] **Step 1: 删除整个 `colors` 块**

将第 15-25 行:
```ts
colors: {
  // Design tokens — see docs/ui-tokens.md for full specification
  // Background layers
  "bg-base": "var(--bg-base)",
  "bg-elevated": "var(--bg-elevated)",
  "bg-overlay": "var(--bg-overlay)",
  // Text layers
  "text-primary": "var(--text-primary)",
  "text-secondary": "var(--text-secondary)",
  "text-muted": "var(--text-muted)",
},
```

改为注释:
```ts
// Design tokens are defined in globals.css via @theme block — no additional color mappings needed.
```

- [ ] **Step 2: 验证**

运行: `pnpm build`

---

### Task 6: `TeamCard.tsx` — 修复未定义 token

**文件:** `src/components/teams/TeamCard.tsx` 第 34 行

- [ ] **Step 1: 替换 token**

将:
```tsx
bg-[var(--color-bg-subtle)]
```
改为:
```tsx
bg-[var(--color-panel-low)]
```

- [ ] **Step 2: 验证**

运行: `pnpm build`

---

### Task 7: 替换 `var(--primary)` → `var(--color-accent)`（3 个文件）

**涉及文件:**
- `src/components/matches/StandingsTable.tsx` (行 33, 43)
- `src/components/matches/MapByMapInput.tsx` (行 89)
- `src/components/matches/StatsLeaderboard.tsx` (行 159, 176)

- [ ] **Step 1: StandingsTable.tsx 第 33 行**

```tsx
// before
bg-[var(--primary)]/10 text-[var(--primary)]
// after
bg-[var(--color-accent)]/10 text-[var(--color-accent)]
```

- [ ] **Step 2: StandingsTable.tsx 第 43 行**

```tsx
// before
hover:text-[var(--primary)]
// after
hover:text-[var(--color-accent)]
```

- [ ] **Step 3: MapByMapInput.tsx 第 89 行**

```tsx
// before
text-[var(--primary)]
// after
text-[var(--color-accent)]
```

- [ ] **Step 4: StatsLeaderboard.tsx 第 159 行**

```tsx
// before
className="hover:text-[var(--primary)] transition-colors"
// after
className="hover:text-[var(--color-accent)] transition-colors"
```

- [ ] **Step 5: StatsLeaderboard.tsx 第 176 行**

```tsx
// before
className="hover:text-[var(--primary)] transition-colors"
// after
className="hover:text-[var(--color-accent)] transition-colors"
```

- [ ] **Step 6: 验证**

运行: `pnpm build`

---

### Task 8: `MatchMvpVote.tsx` — 圆角修复

**文件:** `src/components/matches/MatchMvpVote.tsx` 第 151 行

- [ ] **Step 1: `rounded-lg` → `rounded-sm`**

```tsx
// before
const base = "rounded-lg p-4 text-left transition-colors";
// after
const base = "rounded-sm p-4 text-left transition-colors";
```

- [ ] **Step 2: 验证**

运行: `pnpm build`

---

### Task 9: `StatsLeaderboard.tsx` — 筛选按钮改用 `Btn` 组件

**文件:** `src/components/matches/StatsLeaderboard.tsx`

当前排序 Tab（第 76-87 行）和位置筛选（第 93-105 行）使用裸 `<a>` + 手动 className 拼接。改为 `Btn` + `asChild`。

- [ ] **Step 1: 添加 import**

```tsx
import { Btn } from "@/components/rivalhub";
```

- [ ] **Step 2: 排序 Tab 改用 Btn**

将第 76-87 行:
```tsx
{SORT_OPTIONS.map(({ key, label }) => (
  <a
    key={key}
    href={`/${seasonSlug}/stats?sort=${key}${position ? `&position=${position}` : ""}`}
    className={`inline-block font-mono text-[10px] px-2.5 py-1 uppercase tracking-wider rounded transition-colors ${
      sort === key
        ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
        : "border border-[var(--color-border)] text-[var(--color-fg-mid)] hover:text-[var(--color-fg)]"
    }`}
  >
    {label}
  </a>
))}
```

改为:
```tsx
{SORT_OPTIONS.map(({ key, label }) => (
  <Btn key={key} small ghost={sort !== key} asChild>
    <a href={`/${seasonSlug}/stats?sort=${key}${position ? `&position=${position}` : ""}`}>
      {label}
    </a>
  </Btn>
))}
```

- [ ] **Step 3: 位置筛选同理**

将第 93-105 行改为相同模式。

- [ ] **Step 4: 验证**

运行: `pnpm build`

---

### Task 10: 统一 3 个组件 shadcn Card → rivalhub Panel

**涉及文件:**
- `src/components/matches/MatchMvpVote.tsx`
- `src/components/captains/CaptainVotingPanel.tsx`
- `src/components/matches/StatsLeaderboard.tsx`

#### MatchMvpVote.tsx

- [ ] **第 91 行** — 投票截止结果卡片

```tsx
// before
<Card className="p-6 space-y-5 border-[var(--color-border)]">
// after (Panel pad 默认 16，用 24 匹配原 p-6)
<Panel pad={24} className="space-y-5">
```
闭合 `</Card>` → `</Panel>`

- [ ] **第 158 行** — 投票中容器

```tsx
// before
<Card className="p-5 space-y-4 border-[var(--color-border)]">
// after
<Panel pad={20} className="space-y-4">
```
闭合 `</Card>` → `</Panel>`

- [ ] **移除 `import { Card }`**，确保已有 `import { Panel }`

#### CaptainVotingPanel.tsx

- [ ] **第 217 行** — 桌面端 "我的投票" aside

```tsx
// before
<Card className="p-4">
// after
<Panel pad={16}>
```
闭合 `</Card>` → `</Panel>`

- [ ] **第 283 行** — 空候选人状态

```tsx
// before
<Card className="p-8 text-center text-sm text-[var(--color-fg-mid)]">
// after
<Panel pad={32} className="text-center text-sm text-[var(--color-fg-mid)]">
```
闭合 `</Card>` → `</Panel>`

- [ ] **第 298 行** — 候选人卡片

```tsx
// before
<Card key={candidate.id} className="p-4">
// after
<Panel key={candidate.id} pad={16}>
```
闭合 `</Card>` → `</Panel>`

- [ ] **移除 `import { Card }`**，添加 `import { Panel } from "@/components/rivalhub"`（当前已从 `@/components/ui/card` import Card）

#### StatsLeaderboard.tsx

- [ ] **第 63 行** — 空状态

```tsx
// before
<Card className="p-8 text-center text-[var(--color-fg-mid)]">
// after
<Panel pad={32} className="text-center text-[var(--color-fg-mid)]">
```
闭合 `</Card>` → `</Panel>`

- [ ] **第 109 行** — 表格外壳

```tsx
// before
<Card className="p-0 overflow-hidden">
// after
<Panel pad={0} className="overflow-hidden">
```
闭合 `</Card>` → `</Panel>`

- [ ] **移除 `import { Card }` from `@/components/ui/card`**，添加 `import { Panel }`

- [ ] **验证**

运行: `pnpm build`

---

### Task 11: Admin matches 页面 — 提取 `AdminMatchRow` 组件

**文件:**
- 创建: `src/components/matches/AdminMatchRow.tsx`
- 修改: `src/app/admin/[seasonSlug]/matches/page.tsx`

当前 admin matches 页面中，排位赛和正赛的 match row 渲染逻辑几乎完全相同（第 394-480 行和 501-607 行），各约 90 行。提取为 `AdminMatchRow` 组件。

- [ ] **Step 1: 创建 `src/components/matches/AdminMatchRow.tsx`**

```tsx
import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { Separator } from "@/components/ui/separator";
import { Panel, StatusPill } from "@/components/rivalhub";
import { MatchStatusBadge } from "@/components/matches/MatchStatusBadge";
import { ScoreInput } from "@/components/matches/ScoreInput";
import { MapByMapInput } from "@/components/matches/MapByMapInput";
import { ScheduledAtInput } from "@/components/matches/ScheduledAtInput";
import { VetoInputDialog } from "@/components/matches/VetoInputDialog";
import { AdminRosterDialog } from "@/components/matches/AdminRosterDialog";
import { StatsOCRPanel } from "@/components/matches/StatsOCRPanel";
import { DeleteMatchButton } from "@/components/matches/DeleteMatchButton";
import { MATCH_FORMAT_LABELS } from "@/types/match";
import type { matchMaps, matchRosters, matchRosterPlayers } from "@/db/schema";

interface TeamMemberData {
  id: string;
  teamId: string;
  steamName: string;
  displayName: string | null;
  perfectName: string | null;
  primaryPosition: string;
}

interface RosterData {
  starters: string[];
  substitutes: string[];
  status: string | null;
}

interface AdminMatchRowProps {
  match: {
    id: string;
    status: string;
    format: string;
    scoreA: number | null;
    scoreB: number | null;
    scheduledAt: Date | null;
    completionDeadline: Date | null;
    teamAId: string;
    teamBId: string;
    bracketNodeId: string | null;
  };
  teamAName: string;
  teamBName: string;
  seasonSlug: string;
  mapPool: string[];
  isPlayoff?: boolean;
  teamAMembers: TeamMemberData[];
  teamBMembers: TeamMemberData[];
  teamARoster: RosterData | null;
  teamBRoster: RosterData | null;
  completedMaps: {
    mapOrder: number;
    mapName: string;
    scoreA: number;
    scoreB: number;
    pickedByTeamId: string | null;
    teamAStartSide: "t" | "ct" | null;
  }[];
  finishedMaps: { id: string; mapName: string }[];
}

export function AdminMatchRow({
  match,
  teamAName,
  teamBName,
  seasonSlug,
  mapPool,
  isPlayoff = false,
  teamAMembers,
  teamBMembers,
  teamARoster,
  teamBRoster,
  completedMaps,
  finishedMaps,
}: AdminMatchRowProps) {
  return (
    <Panel
      pad={16}
      className={cn(
        "space-y-3",
        match.status === "in_progress" && "border-l-[3px] border-[var(--color-accent)]"
      )}
    >
      {/* Header: team names + score + badges */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="font-semibold">{teamAName}</span>
          <span className="text-[var(--color-fg-mid)]">
            {match.status === "finished"
              ? `${match.scoreA ?? 0} : ${match.scoreB ?? 0}`
              : "vs"}
          </span>
          <span className="font-semibold">{teamBName}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={MATCH_FORMAT_LABELS[match.format as keyof typeof MATCH_FORMAT_LABELS]} />
          <MatchStatusBadge
            status={match.status as "scheduled" | "in_progress" | "finished" | "cancelled"}
          />
        </div>
      </div>

      {/* Operations */}
      {match.status !== "cancelled" && (
        <details open={match.status === "in_progress" ? true : undefined}>
          <summary className="cursor-pointer select-none list-none text-[11px] font-mono text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] py-1 transition-colors">
            {match.status === "finished" ? "▸ 数据录入" : "▸ 操作"}
          </summary>
          <div className="space-y-3 pt-2">
            <Separator />
            {match.status !== "finished" && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <AdminRosterDialog
                    matchId={match.id}
                    teamAName={teamAName}
                    teamBName={teamBName}
                    teamAId={match.teamAId}
                    teamBId={match.teamBId}
                    teamAMembers={teamAMembers}
                    teamBMembers={teamBMembers}
                    teamARoster={teamARoster}
                    teamBRoster={teamBRoster}
                  />
                  {(match.status === "scheduled" || match.status === "in_progress") && (
                    <VetoInputDialog
                      matchId={match.id}
                      format={match.format as "bo1" | "bo3" | "bo5"}
                      teamAName={teamAName}
                      teamBName={teamBName}
                      teamAId={match.teamAId}
                      teamBId={match.teamBId}
                      mapPool={mapPool}
                    />
                  )}
                </div>
                <ScheduledAtInput
                  matchId={match.id}
                  currentScheduledAt={match.scheduledAt}
                  currentCompletionDeadline={match.completionDeadline}
                />
                {isPlayoff && match.status === "in_progress" ? (
                  <MapByMapInput
                    matchId={match.id}
                    format={match.format as "bo1" | "bo3" | "bo5"}
                    teamAName={teamAName}
                    teamBName={teamBName}
                    teamAId={match.teamAId}
                    teamBId={match.teamBId}
                    completedMaps={completedMaps}
                    mapPool={mapPool}
                  />
                ) : (
                  <ScoreInput
                    matchId={match.id}
                    teamAName={teamAName}
                    teamBName={teamBName}
                    currentStatus={match.status as "scheduled" | "in_progress" | "finished" | "cancelled"}
                    format={match.format as "bo1" | "bo3" | "bo5"}
                  />
                )}
              </>
            )}
            {match.status === "finished" &&
              finishedMaps.map((map) => (
                <div key={map.id}>
                  <StatsOCRPanel mapId={map.id} mapName={map.mapName} />
                </div>
              ))}
          </div>
        </details>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/${seasonSlug}/matches/${match.id}`}
          className="text-xs text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] transition-colors"
          target="_blank"
        >
          查看公开页 ↗
        </Link>
        {match.bracketNodeId == null && <DeleteMatchButton matchId={match.id} />}
      </div>
    </Panel>
  );
}
```

- [ ] **Step 2: 修改 `page.tsx` — 添加 import**

```tsx
import { AdminMatchRow } from "@/components/matches/AdminMatchRow";
```

- [ ] **Step 3: 替换排位赛 match 列表**

将第 390-481 行（`{qualifierMatches.map(...)}` 内部的 JSX）替换为 `<AdminMatchRow>` 调用。

排位赛每个 match 的调用:
```tsx
<AdminMatchRow
  key={m.id}
  match={m}
  teamAName={teamAName}
  teamBName={teamBName}
  seasonSlug={seasonSlug}
  mapPool={mapPool}
  teamAMembers={teamMembersByTeam.get(m.teamAId) ?? []}
  teamBMembers={teamMembersByTeam.get(m.teamBId) ?? []}
  teamARoster={rosterByMatch.get(m.id)?.get(m.teamAId) ?? null}
  teamBRoster={rosterByMatch.get(m.id)?.get(m.teamBId) ?? null}
  completedMaps={(mapsByMatchId.get(m.id) ?? []).map((r) => ({
    mapOrder: r.mapOrder,
    mapName: r.mapName,
    scoreA: r.scoreA ?? 0,
    scoreB: r.scoreB ?? 0,
    pickedByTeamId: r.pickedByTeamId,
    teamAStartSide: r.teamAStartSide as "t" | "ct" | null,
  }))}
  finishedMaps={(mapsByMatch.get(m.id) ?? []).map((r) => ({
    id: r.id,
    mapName: r.mapName,
  }))}
/>
```

- [ ] **Step 4: 替换正赛 match 列表**

同理替换第 496-608 行，额外传 `isPlayoff`:
```tsx
<AdminMatchRow
  key={m.id}
  match={m}
  teamAName={teamAName}
  teamBName={teamBName}
  seasonSlug={seasonSlug}
  mapPool={mapPool}
  isPlayoff
  teamAMembers={teamMembersByTeam.get(m.teamAId) ?? []}
  teamBMembers={teamMembersByTeam.get(m.teamBId) ?? []}
  teamARoster={rosterByMatch.get(m.id)?.get(m.teamAId) ?? null}
  teamBRoster={rosterByMatch.get(m.id)?.get(m.teamBId) ?? null}
  completedMaps={(mapsByMatchId.get(m.id) ?? []).map((r) => ({
    mapOrder: r.mapOrder,
    mapName: r.mapName,
    scoreA: r.scoreA ?? 0,
    scoreB: r.scoreB ?? 0,
    pickedByTeamId: r.pickedByTeamId,
    teamAStartSide: r.teamAStartSide as "t" | "ct" | null,
  }))}
  finishedMaps={(mapsByMatch.get(m.id) ?? []).map((r) => ({
    id: r.id,
    mapName: r.mapName,
  }))}
/>
```

- [ ] **Step 5: 清理 page.tsx 中不再需要的 import**

移除 `Separator`、`cn`、`StatusPill`（如果不再直接使用）。

- [ ] **Step 6: 验证**

运行: `pnpm type-check && pnpm build`

---

## 验证检查清单

全部 Task 完成后:

- [ ] `pnpm type-check` — TypeScript 编译无错误
- [ ] `pnpm build` — 生产构建成功
- [ ] `pnpm test` — 现有测试全部通过
- [ ] `git diff --stat` — 确认修改了预期的 12 个文件 + 1 个新文件

---

## 回滚方案

所有修改均为 CSS class / token 引用 / 组件外壳替换，不涉及数据或业务逻辑。如需回滚: `git checkout -- <files>` 或 `git revert`。
