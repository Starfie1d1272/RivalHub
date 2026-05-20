# 比赛模块深度补齐 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐比赛模块的 5 个关键缺失：BO1 地图记录、BP 选图录入与展示、Roster 名单管理后台、OCR 数据录入入口、比赛详情页增强。

**Architecture:** 沿现有分层结构 —— DB schema (Drizzle) → Server Actions → 客户端组件 → 页面集成。Phase 1 是数据链路基础，Phase 2/3/4 可并行开发，Phase 5 是最終展示层。

**Tech Stack:** Next.js 15 App Router + TypeScript strict + Drizzle ORM + Supabase Postgres + shadcn/ui + Tailwind CSS v4

---

## Phase 1 — BO1 地图记录

### Task 1.1: 扩展 MapByMapInput 支持 BO1

**Files:**
- Modify: `src/components/matches/MapByMapInput.tsx:13-30`
- Modify: `src/actions/matches/results.ts:193-215`

- [ ] **Step 1: 扩展 MapByMapInput props 接口**

把 `format` 类型从 `"bo3" | "bo5"` 扩展为 `"bo1" | "bo3" | "bo5"`。

```tsx
// src/components/matches/MapByMapInput.tsx line 24
// 修改:
format: "bo3" | "bo5";
// 为:
format: "bo1" | "bo3" | "bo5";
```

同时更新 `maxWins` 和 `maxMaps` 计算：

```tsx
// line 38-39 改为:
const maxWins = format === "bo1" ? 1 : format === "bo3" ? 2 : 3;
const maxMaps = format === "bo1" ? 1 : format === "bo3" ? 3 : 5;
```

- [ ] **Step 2: 移除 recordMapResult 对 BO1 的拒绝**

```typescript
// src/actions/matches/results.ts lines 213-215 - 删除这 3 行:
if (match.format === "bo1") {
  throw new AppError(ErrorCode.VALIDATION_FAILED, "BO1 请使用直接录入比分功能");
}
```

同时调整状态校验，允许 `in_progress` 和 `scheduled`（BO1 可能从 scheduled 直接录入第一张图）：

```typescript
// line 216-218 改为:
if (match.status !== "in_progress" && match.status !== "scheduled") {
  throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "比赛状态不允许录入地图结果");
}
```

- [ ] **Step 3: BO1 录入自动推进状态**

在 `recordMapResult` 中，BO1 录入前如果 status 是 `scheduled`，自动推进到 `in_progress`。在当前事务中加入：

```typescript
// 在 transaction 内部，insert matchMaps 之前:
if (match.format === "bo1" && match.status === "scheduled") {
  await tx.update(matches).set({ status: "in_progress", updatedAt: new Date() })
    .where(eq(matches.id, matchId));
}
```

BO1 的 `seriesFinished` 逻辑：`mapWinsA >= 1 || mapWinsB >= 1` 即系列赛结束。

- [ ] **Step 4: 更新 admin matches 页面的条件渲染**

```tsx
// src/app/admin/[seasonSlug]/matches/page.tsx line 342
// 修改:
{m.status === "in_progress" && m.format !== "bo1" ? (
// 为:
{m.status === "in_progress" ? (
```

让所有 format 的 in_progress 比赛都走 `MapByMapInput`，同时 `completedMaps` 查询去掉了 BO1 过滤：

```typescript
// line 54-56 改为不过滤 format:
const inProgressMatchIds = allMatches
  .filter((m) => m.status === "in_progress")
  .map((m) => m.id);
```

- [ ] **Step 5: 存量 BO1 比赛 detail 页降级显示**

在 `src/app/[seasonSlug]/matches/[matchId]/page.tsx` 的地图结果区域，当 `maps.length === 0` 且 match 已结束时，显示系列总分（已有 scoreA/scoreB）：

```tsx
{/* 单图结果 — 已有 maps 或已结束的 BO1 fallback */}
{maps.length > 0 ? (
  <section>...</section>  // 现有代码
) : isFinished && match.scoreA != null && match.scoreB != null && (
  <section className="space-y-3">
    <h2 className="text-lg font-semibold text-[var(--color-fg)]">比赛结果</h2>
    <Panel pad={16}>
      <p className="text-sm text-[var(--color-fg-mid)]">
        BO1 系列赛总分：{match.scoreA} : {match.scoreB}
      </p>
    </Panel>
  </section>
)}
```

- [ ] **Step 6: 类型检查 + Commit**

```bash
pnpm tsc --noEmit
git add src/components/matches/MapByMapInput.tsx src/actions/matches/results.ts src/app/admin/\*/matches/page.tsx src/app/\[seasonSlug\]/matches/\[matchId\]/page.tsx
git commit -m "feat: BO1 地图记录支持 — MapByMapInput 扩展 bo1，recordMapResult 解除 BO1 限制"
```

---

## Phase 2 — BP 管理员录入 + HLTV 风格展示

### Task 2.1: 新建 match_veto_steps 表

**Files:**
- Create: `src/db/schema/match-veto-steps.ts`
- Modify: `src/db/schema/index.ts`

- [ ] **Step 1: 创建 schema 文件**

```typescript
// src/db/schema/match-veto-steps.ts
import { pgTable, uuid, integer, text, timestamp, unique } from "drizzle-orm/pg-core";
import { matches } from "./matches";
import { teams } from "./teams";

export const matchVetoSteps = pgTable("match_veto_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  matchId: uuid("match_id").notNull().references(() => matches.id),
  stepOrder: integer("step_order").notNull(),       // 1-based
  actionType: text("action_type").notNull(),         // "ban" | "pick" | "decider"
  mapName: text("map_name").notNull(),
  teamId: uuid("team_id").references(() => teams.id), // 执行操作的队伍；decider 时为 null
  side: text("side"),                                 // "t" | "ct" | null — 选边结果，仅 side_pick/decider
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // 同一场比赛内 stepOrder 唯一
  uniqueStep: unique().on(t.matchId, t.stepOrder),
}));
```

- [ ] **Step 3: 更新 schema index**

在 `src/db/schema/index.ts` 末尾加一行：

```typescript
export * from "./match-veto-steps";
```

- [ ] **Step 4: 生成迁移文件**

```bash
pnpm db:generate
```

这会生成类似 `drizzle/XXXX_add_match_veto_steps.sql` 的迁移文件。预期 SQL：

```sql
CREATE TABLE "match_veto_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "match_id" uuid NOT NULL REFERENCES "matches"("id"),
  "step_order" integer NOT NULL,
  "action_type" text NOT NULL,
  "map_name" text NOT NULL,
  "team_id" uuid REFERENCES "teams"("id"),
  "side" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "match_veto_steps_match_id_step_order_unique" UNIQUE("match_id", "step_order")
);
```

> **不要执行 `pnpm db:push`。** 迁移文件生成后，和其他代码一起审核再推送到数据库。

### Task 2.2: 创建 BP 录入 Server Action

**Files:**
- Create: `src/actions/matches/veto.ts`
- Modify: `src/actions/matches/index.ts`

- [ ] **Step 1: 实现 saveVetoSteps action**

```typescript
// src/actions/matches/veto.ts
"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { matchVetoSteps, matchMaps, matches, auditLogs } from "@/db/schema";
import { ok, type ActionResult } from "@/types/action";
import { AppError, ErrorCode } from "@/lib/errors";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { getMatchOrThrow, actionError } from "@/lib/action-utils";
import { revalidateMatchPaths } from "@/lib/revalidation";
import { getWinThreshold } from "@/types/match";
import type { VetoActionType } from "@/types/match";

interface VetoStepInput {
  actionType: VetoActionType;   // "ban" | "pick" | "decider"
  mapName: string;
  teamId: string | null;        // 执行队伍，decider 传 null
  side?: "t" | "ct" | null;     // 选边结果
}

export async function saveVetoSteps(
  matchId: string,
  steps: VetoStepInput[],
): Promise<ActionResult<void>> {
  try {
    const match = await getMatchOrThrow(matchId);
    const session = await requireSeasonAdmin(match.seasonId);

    if (match.status !== "scheduled") {
      throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "仅 scheduled 状态的比赛可录入 BP");
    }

    // 校验 steps 非空
    if (steps.length === 0) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "BP 步骤不能为空");
    }

    await db.transaction(async (tx) => {
      // 删除旧记录（支持重新录入）
      await tx.delete(matchVetoSteps).where(eq(matchVetoSteps.matchId, matchId));

      // 写入 BP 步骤
      await tx.insert(matchVetoSteps).values(
        steps.map((s, i) => ({
          matchId,
          stepOrder: i + 1,
          actionType: s.actionType,
          mapName: s.mapName,
          teamId: s.teamId,
          side: s.side ?? null,
        })),
      );

      // 根据 BP 结果自动创建 match_maps 行
      // pick/decider 的图进入比赛地图列表，顺序按 pick 出现顺序，decider 排最后
      const playMaps = steps.filter((s) => s.actionType === "pick" || s.actionType === "decider");
      let mapOrder = 1;
      for (const s of playMaps) {
        // 清除旧 maps
        await tx.delete(matchMaps).where(eq(matchMaps.matchId, matchId));
      }
      for (const s of playMaps) {
        await tx.insert(matchMaps).values({
          matchId,
          mapOrder: mapOrder++,
          mapName: s.mapName,
          pickedByTeamId: s.actionType === "pick" ? s.teamId : null,
          teamAStartSide: s.side ?? null,
        });
      }

      await tx.insert(auditLogs).values({
        seasonId: match.seasonId,
        action: "match.save_veto",
        actorId: session.email,
        targetId: matchId,
        targetType: "match",
        meta: { format: match.format, stepCount: steps.length },
      });
    });

    const season = await db.query.seasons.findFirst({
      where: (t, { eq: e }) => e(t.id, match.seasonId),
    });
    if (season) revalidateMatchPaths(season.slug, matchId);

    return ok(undefined);
  } catch (e) {
    return actionError("saveVetoSteps", e);
  }
}
```

- [ ] **Step 2: 注册到 actions index**

在 `src/actions/matches/index.ts` 末尾加：

```typescript
export { saveVetoSteps } from "./veto";
```

### Task 2.3: 创建 BP 录入 Dialog 组件（后台）

**Files:**
- Create: `src/components/matches/VetoInputDialog.tsx`

- [ ] **Step 1: 实现 VetoInputDialog**

```tsx
"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { saveVetoSteps } from "@/actions/matches";
import { mapLabel } from "@/lib/maps";
import type { VetoActionType } from "@/types/match";
import { VETO_STEP_COUNT } from "@/types/match";

interface VetoInputDialogProps {
  matchId: string;
  format: "bo1" | "bo3" | "bo5";
  teamAName: string;
  teamBName: string;
  teamAId: string;
  teamBId: string;
  mapPool: string[];
}

interface StepDraft {
  actionType: VetoActionType | "";
  mapName: string;
  teamId: string;  // teamAId | teamBId | ""
  side: "t" | "ct" | "";
}

function buildTemplate(format: "bo1" | "bo3" | "bo5", teamAId: string, teamBId: string): StepDraft[] {
  if (format === "bo1") return [
    // §5.3 BO1: A ban×2, B ban×3, A ban×1 → leftover (B picks side, stored on decider)
    { actionType: "ban", mapName: "", teamId: teamAId, side: "" },
    { actionType: "ban", mapName: "", teamId: teamAId, side: "" },
    { actionType: "ban", mapName: "", teamId: teamBId, side: "" },
    { actionType: "ban", mapName: "", teamId: teamBId, side: "" },
    { actionType: "ban", mapName: "", teamId: teamBId, side: "" },
    { actionType: "ban", mapName: "", teamId: teamAId, side: "" },
    { actionType: "decider", mapName: "", teamId: "", side: "" },  // leftover, B picks side
  ];
  if (format === "bo3") return [
    // §5.3 BO3: A ban, B ban, A pick, B pick, B ban, A ban → leftover
    { actionType: "ban", mapName: "", teamId: teamAId, side: "" },
    { actionType: "ban", mapName: "", teamId: teamBId, side: "" },
    { actionType: "pick", mapName: "", teamId: teamAId, side: "" },
    { actionType: "pick", mapName: "", teamId: teamBId, side: "" },
    { actionType: "ban", mapName: "", teamId: teamBId, side: "" },
    { actionType: "ban", mapName: "", teamId: teamAId, side: "" },
    { actionType: "decider", mapName: "", teamId: "", side: "" }, // leftover
  ];
  // BO5: §5.3 A ban×2 (winners advantage), B pick, A pick, B pick, A pick → leftover
  return [
    { actionType: "ban", mapName: "", teamId: teamAId, side: "" },
    { actionType: "ban", mapName: "", teamId: teamAId, side: "" },
    { actionType: "pick", mapName: "", teamId: teamBId, side: "" },
    { actionType: "pick", mapName: "", teamId: teamAId, side: "" },
    { actionType: "pick", mapName: "", teamId: teamBId, side: "" },
    { actionType: "pick", mapName: "", teamId: teamAId, side: "" },
    { actionType: "decider", mapName: "", teamId: "", side: "" }, // leftover, knife round
  ];
}

export function VetoInputDialog({
  matchId, format, teamAName, teamBName, teamAId, teamBId, mapPool,
}: VetoInputDialogProps) {
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState<StepDraft[]>(() =>
    buildTemplate(format, teamAId, teamBId));
  const [isPending, startTransition] = useTransition();

  const usedMaps = new Set(steps.map((s) => s.mapName).filter(Boolean));
  const availableMaps = mapPool.filter((m) => !usedMaps.has(m));

  function updateStep(idx: number, field: keyof StepDraft, value: string) {
    setSteps((prev) => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  }

  function handleSave() {
    const incomplete = steps.some((s) => !s.mapName || !s.actionType);
    if (incomplete) { toast.error("请完成所有 BP 步骤"); return; }

    startTransition(async () => {
      const result = await saveVetoSteps(matchId, steps.map((s) => ({
        actionType: s.actionType as VetoActionType,
        mapName: s.mapName,
        teamId: s.teamId || null,
        side: s.side || null,
      })));
      if (result.success) {
        toast.success("BP 已保存");
        setOpen(false);
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">录入 BP</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>BP 录入 — {format.toUpperCase()}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-4">
          {steps.map((step, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <span className="text-xs text-[var(--color-fg-dim)] w-6">{idx + 1}</span>
              <span className="text-xs font-medium w-16">
                {step.actionType === "ban" ? "Ban" : step.actionType === "pick" ? "Pick" : "Decider"}
              </span>
              <Select value={step.teamId || "__none__"} onValueChange={(v) => updateStep(idx, "teamId", v === "__none__" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs w-28">
                  <SelectValue placeholder="队伍" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={teamAId} className="text-xs">{teamAName}</SelectItem>
                  <SelectItem value={teamBId} className="text-xs">{teamBName}</SelectItem>
                  {step.actionType === "decider" && <SelectItem value="__none__" className="text-xs">—</SelectItem>}
                </SelectContent>
              </Select>
              <Select value={step.mapName} onValueChange={(v) => updateStep(idx, "mapName", v)}>
                <SelectTrigger className="h-8 text-xs flex-1">
                  <SelectValue placeholder="地图" />
                </SelectTrigger>
                <SelectContent>
                  {[...(step.mapName ? [step.mapName] : []), ...availableMaps].map((m) => (
                    <SelectItem key={m} value={m} className="text-xs">{mapLabel(m)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(step.actionType === "pick" || step.actionType === "decider") && (
                <Select value={step.side || "__none__"} onValueChange={(v) => updateStep(idx, "side", v === "__none__" ? "" : v)}>
                  <SelectTrigger className="h-8 text-xs w-20">
                    <SelectValue placeholder="选边" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__" className="text-xs">—</SelectItem>
                    <SelectItem value="t" className="text-xs">T 先</SelectItem>
                    <SelectItem value="ct" className="text-xs">CT 先</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          ))}
          <Button onClick={handleSave} disabled={isPending} size="sm" className="w-full">
            确认保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```
### Task 2.4: 创建 VetoView 展示组件（HLTV 纵向风格）

**Files:**
- Create: `src/components/matches/VetoView.tsx`

- [ ] **Step 1: 实现 VetoView**

```tsx
import { db } from "@/db/client";
import { matchVetoSteps } from "@/db/schema/match-veto-steps";
import { eq } from "drizzle-orm";
import { mapLabel } from "@/lib/maps";

interface VetoViewProps {
  matchId: string;
  teamAName: string;
  teamBName: string;
  teamAId: string;
  teamBId: string;
}

const ACTION_COLORS: Record<string, string> = {
  ban: "var(--color-red, #ef4444)",
  pick: "var(--color-green, #22c55e)",
  decider: "var(--color-yellow, #eab308)",
};

const ACTION_LABELS: Record<string, string> = {
  ban: "removed",
  pick: "picked",
  decider: "was left over",
};

async function getVetoSteps(matchId: string) {
  return db.query.matchVetoSteps.findMany({
    where: eq(matchVetoSteps.matchId, matchId),
    orderBy: (t, { asc }) => [asc(t.stepOrder)],
  });
}

export async function VetoView({ matchId, teamAName, teamBName, teamAId, teamBId }: VetoViewProps) {
  const steps = await getVetoSteps(matchId);
  if (steps.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-[var(--color-fg)]">BP 流程</h2>
      <div className="rounded-lg bg-[var(--color-panel)] border border-[var(--color-border)] p-4">
        <ol className="space-y-1.5">
          {steps.map((s) => {
            const teamName = s.teamId === teamAId ? teamAName
              : s.teamId === teamBId ? teamBName : null;
            const color = ACTION_COLORS[s.actionType] ?? "var(--color-fg)";
            const verb = ACTION_LABELS[s.actionType] ?? s.actionType;

            return (
              <li key={s.stepOrder} className="text-sm flex items-baseline gap-2">
                <span className="text-[var(--color-fg-dim)] w-5 text-right shrink-0">
                  {s.stepOrder}.
                </span>
                {teamName ? (
                  <>
                    <span className="font-medium text-[var(--color-fg)]">{teamName}</span>
                    <span style={{ color }}>{verb}</span>
                    <span className="font-medium text-[var(--color-fg)]">{mapLabel(s.mapName)}</span>
                  </>
                ) : (
                  <>
                    <span className="font-medium text-[var(--color-fg)]">{mapLabel(s.mapName)}</span>
                    <span style={{ color }}>{verb}</span>
                  </>
                )}
                {s.side && (
                  <span className="text-[var(--color-fg-dim)] text-xs">
                    ({s.side === "t" ? "T 先" : "CT 先"})
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
```

### Task 2.5: 后台赛程页集成 VetoInputDialog + 比赛详情页集成 VetoView

**Files:**
- Modify: `src/app/admin/[seasonSlug]/matches/page.tsx`
- Modify: `src/app/[seasonSlug]/matches/[matchId]/page.tsx`

- [ ] **Step 1: 后台赛程页添加 VetoInputDialog**

在 `src/app/admin/[seasonSlug]/matches/page.tsx` 中：

1. import `VetoInputDialog`：
```typescript
import { VetoInputDialog } from "@/components/matches/VetoInputDialog";
```

2. 在每个 scheduled 比赛的 `ScoreInput` 上方添加 BP 录入按钮（与 `ScheduledAtInput` 同级）：

```tsx
{/* 在 Separator 之后，ScheduledAtInput 之前 */}
{m.status === "scheduled" && (
  <VetoInputDialog
    matchId={m.id}
    format={m.format as "bo1" | "bo3" | "bo5"}
    teamAName={teamAName}
    teamBName={teamBName}
    teamAId={m.teamAId}
    teamBId={m.teamBId}
    mapPool={mapPool}
  />
)}
```

这段加在排位赛和正赛两个 Tab 面板中的 `ScheduledAtInput` 附近。

- [ ] **Step 2: 公开比赛详情页集成 VetoView**

在 `src/app/[seasonSlug]/matches/[matchId]/page.tsx` 中：

1. import `VetoView`：
```typescript
import { VetoView } from "@/components/matches/VetoView";
```

2. 在地图结果区域之前加入（约 line 340）：

```tsx
{/* BP 流程 */}
<VetoView
  matchId={match.id}
  teamAName={teamA?.name ?? "队伍 A"}
  teamBName={teamB?.name ?? "队伍 B"}
  teamAId={match.teamAId}
  teamBId={match.teamBId}
/>
```

- [ ] **Step 3: 类型检查 + Commit**

```bash
pnpm tsc --noEmit
git add src/db/schema/match-veto-steps.ts src/db/schema/index.ts src/actions/matches/veto.ts src/actions/matches/index.ts src/components/matches/VetoInputDialog.tsx src/components/matches/VetoView.tsx src/app/admin/\*/matches/page.tsx src/app/\[seasonSlug\]/matches/\[matchId\]/page.tsx
git commit -m "feat: BP 选图流程 — veto_steps 表、管理员录入 Dialog、HLTV 纵向展示组件"
```

---

## Phase 3 — Roster 名单管理完善

### Task 3.1: 创建 updateMatchRoster action

**Files:**
- Modify: `src/actions/matches/roster.ts`
- Modify: `src/actions/matches/index.ts`

- [ ] **Step 1: 实现 updateMatchRoster**

在 `src/actions/matches/roster.ts` 末尾添加：

```typescript
/**
 * 管理员强制修改比赛名单（覆盖已提交名单）。
 */
export async function updateMatchRoster(
  matchId: string,
  teamId: string,
  starterIds: string[],
  substituteIds: string[] = [],
): Promise<ActionResult<{ rosterId: string }>> {
  try {
    const match = await getMatchOrThrow(matchId);
    const session = await requireSeasonAdmin(match.seasonId);

    if (starterIds.length !== 5) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "必须选择 5 名首发");
    }
    if (substituteIds.length > 2) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "替补不能超过 2 人");
    }

    const allIds = [...starterIds, ...substituteIds];
    const memberRows = await db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, teamId));
    const memberIdSet = new Set(memberRows.map((r) => r.id));
    for (const id of allIds) {
      if (!memberIdSet.has(id)) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, "队员不属于本队");
      }
    }

    const rosterId = await db.transaction(async (tx) => {
      const existing = await tx.query.matchRosters.findFirst({
        where: and(eq(matchRosters.matchId, matchId), eq(matchRosters.teamId, teamId)),
      });

      let rosterId: string;
      if (existing) {
        rosterId = existing.id;
        await tx.update(matchRosters).set({
          status: "submitted", submittedBy: session.userId,
          lockedAt: new Date(), updatedAt: new Date(),
        }).where(eq(matchRosters.id, existing.id));
        await tx.delete(matchRosterPlayers).where(eq(matchRosterPlayers.rosterId, existing.id));
      } else {
        const [row] = await tx.insert(matchRosters).values({
          matchId, teamId, submittedBy: session.userId,
        }).returning({ id: matchRosters.id });
        rosterId = row.id;
      }

      await tx.insert(matchRosterPlayers).values([
        ...starterIds.map((id) => ({ rosterId, teamMemberId: id, isStarter: true })),
        ...substituteIds.map((id) => ({ rosterId, teamMemberId: id, isStarter: false })),
      ]);
      return rosterId;
    });

    await db.insert(auditLogs).values({
      seasonId: match.seasonId,
      action: "match.admin_update_roster",
      actorId: session.email,
      targetId: rosterId,
      targetType: "match_roster",
      meta: { matchId, teamId, starters: starterIds.length, substitutes: substituteIds.length },
    });

    return ok({ rosterId });
  } catch (e) {
    return actionError("updateMatchRoster", e);
  }
}
```

- [ ] **Step 2: 导出新 action**

在 `src/actions/matches/index.ts` 中把 `updateMatchRoster` 加入导出：

```typescript
export { submitMatchRoster, unlockMatchRoster, getMatchRoster, updateMatchRoster } from "./roster";
```

### Task 3.2: 后台赛程页添加 Roster 管理 Dialog

**Files:**
- Create: `src/components/matches/AdminRosterDialog.tsx`
- Modify: `src/app/admin/[seasonSlug]/matches/page.tsx`

- [ ] **Step 1: 创建 AdminRosterDialog**

```tsx
"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { updateMatchRoster } from "@/actions/matches";
import { getDisplayName } from "@/lib/utils/display-name";

interface TeamMember {
  id: string;
  steamName: string;
  displayName: string | null;
  perfectName: string | null;
  primaryPosition: string;
}

interface RosterData {
  starters: string[];   // teamMemberIds
  substitutes: string[];
  status: string | null;  // "submitted" | "unlocked" | null
}

interface AdminRosterDialogProps {
  matchId: string;
  teamAName: string;
  teamBName: string;
  teamAId: string;
  teamBId: string;
  teamAMembers: TeamMember[];  // from parent: allTeamMembers.filter by teamA
  teamBMembers: TeamMember[];
  teamARoster: RosterData | null;
  teamBRoster: RosterData | null;
}

function RosterTeamSection({
  teamName,
  members,
  existingRoster,
  onSave,
  isPending,
}: {
  teamName: string;
  members: TeamMember[];
  existingRoster: RosterData | null;
  onSave: (starters: string[], subs: string[]) => void;
  isPending: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => {
    if (existingRoster) return new Set([...existingRoster.starters, ...existingRoster.substitutes]);
    return new Set();
  });
  const [starterOrder, setStarterOrder] = useState<string[]>(existingRoster?.starters ?? []);

  function toggle(memberId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) {
        next.delete(memberId);
        setStarterOrder((s) => s.filter((id) => id !== memberId));
      } else {
        if (next.size >= 7) { toast.error("每队最多 7 人（5 首发 + 2 替补）"); return prev; }
        next.add(memberId);
      }
      return next;
    });
  }

  function moveUp(memberId: string) {
    setStarterOrder((prev) => {
      const idx = prev.indexOf(memberId);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  }

  function moveDown(memberId: string) {
    setStarterOrder((prev) => {
      const idx = prev.indexOf(memberId);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  }

  function handleSaveTeam() {
    const starters = starterOrder.slice(0, 5);
    if (starters.length < 5) { toast.error("需要选择 5 名首发"); return; }
    const allSelected = Array.from(selected);
    const subs = allSelected.filter((id) => !starters.includes(id)).slice(0, 2);
    onSave(starters, subs);
  }

  const starters = starterOrder.slice(0, 5);
  const subs = Array.from(selected).filter((id) => !starters.includes(id)).slice(0, 2);

  return (
    <div className="space-y-3">
      <h4 className="font-medium text-sm">{teamName}</h4>
      {existingRoster?.status === "submitted" && (
        <p className="text-xs text-yellow-600">已提交（保存将覆盖）</p>
      )}
      <div className="space-y-2">
        {members.map((m) => {
          const checked = selected.has(m.id);
          const isStarter = starters.includes(m.id);
          const starterIdx = starters.indexOf(m.id);
          return (
            <div key={m.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={checked} onCheckedChange={() => toggle(m.id)} />
              <span className="flex-1">{getDisplayName(m)} — {m.primaryPosition}</span>
              {isStarter && (
                <>
                  <span className="text-xs text-[var(--primary)] font-medium">
                    首发 {starterIdx + 1}
                  </span>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0"
                    onClick={() => moveUp(m.id)} disabled={starterIdx === 0}>▲</Button>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0"
                    onClick={() => moveDown(m.id)} disabled={starterIdx >= starters.length - 1}>▼</Button>
                </>
              )}
              {!isStarter && checked && (
                <span className="text-xs text-[var(--color-fg-dim)]">替补</span>
              )}
            </div>
          );
        })}
      </div>
      <Button size="sm" onClick={handleSaveTeam} disabled={isPending}>
        保存 {teamName} 名单
      </Button>
    </div>
  );
}

export function AdminRosterDialog({
  matchId, teamAName, teamBName, teamAId, teamBId, teamAMembers, teamBMembers, teamARoster, teamBRoster,
}: AdminRosterDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSave(teamId: string, starters: string[], subs: string[]) {
    startTransition(async () => {
      const result = await updateMatchRoster(matchId, teamId, starters, subs);
      if (result.success) {
        toast.success("名单已更新");
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">参赛名单</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>参赛名单管理</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 mt-4">
          <RosterTeamSection
            teamName={teamAName}
            members={teamAMembers}
            existingRoster={teamARoster}
            onSave={(starters, subs) => handleSave(teamAId, starters, subs)}
            isPending={isPending}
          />
          <RosterTeamSection
            teamName={teamBName}
            members={teamBMembers}
            existingRoster={teamBRoster}
            onSave={(starters, subs) => handleSave(teamBId, starters, subs)}
            isPending={isPending}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: 后台赛程页集成 AdminRosterDialog**

在每个比赛 Panel 中添加「名单」按钮（与 BP 录入同级）。需从父组件传入队员列表和现有名单数据：

```tsx
<AdminRosterDialog
  matchId={m.id}
  teamAName={teamAName}
  teamBName={teamBName}
  teamAId={m.teamAId}
  teamBId={m.teamBId}
  teamAMembers={allTeamMembers.filter((t) => t.teamId === m.teamAId)}
  teamBMembers={allTeamMembers.filter((t) => t.teamId === m.teamBId)}
  teamARoster={teamARosters.get(m.id)?.get(m.teamAId) ?? null}
  teamBRoster={teamBRosters.get(m.id)?.get(m.teamBId) ?? null}
/>
```
> `allTeamMembers` 和 rosters 数据需在父组件（admin matches page）中查询。

- [ ] **Step 3: 类型检查 + Commit**

```bash
pnpm tsc --noEmit
git add src/actions/matches/roster.ts src/actions/matches/index.ts src/components/matches/AdminRosterDialog.tsx src/app/admin/\*/matches/page.tsx
git commit -m "feat: 管理员名单管理 — updateMatchRoster action + AdminRosterDialog"
```

---

## Phase 4 — OCR 数据录入优化

### Task 4.1: 比赛详情页对 admin 显示 StatsOCRPanel

**Files:**
- Modify: `src/app/[seasonSlug]/matches/[matchId]/page.tsx`

- [ ] **Step 1: 在比赛详情页集成 StatsOCRPanel**

在 `src/app/[seasonSlug]/matches/[matchId]/page.tsx` 中：

1. import `StatsOCRPanel`：
```typescript
import { StatsOCRPanel } from "@/components/matches/StatsOCRPanel";
```

2. 在每张地图下方，对 admin 显示 OCR 入口：

```tsx
{/* 在地图结果的 map 遍历内部，PlayerStatsTable 之前 */}
{isFinished && isSeasonAdmin && (
  <StatsOCRPanel mapId={map.id} mapName={map.mapName} />
)}
```

即每张已完成的比赛地图下，admin 可以看到 OCR 录入面板。这放在 `PlayerStatsTable` 相邻位置。

- [ ] **Step 2: 类型检查 + Commit**

```bash
pnpm tsc --noEmit
git add src/app/\[seasonSlug\]/matches/\[matchId\]/page.tsx
git commit -m "feat: 比赛详情页 admin 可见 OCR 录入入口（每张图下）"
```

---

## Phase 5 — 比赛详情页增强

### Task 5.1: 分图 Tab 切换展示

**Files:**
- Modify: `src/app/[seasonSlug]/matches/[matchId]/page.tsx`
- Create: `src/components/matches/MapTabs.tsx`（可选——内联或独立组件）

- [ ] **Step 1: 在地图结果区域用 Tab 结构重构**

在 `src/app/[seasonSlug]/matches/[matchId]/page.tsx` 的地图结果区域（约 line 340），将当前纵向列表替换为 Tab 结构：

```tsx
{/* 地图结果 — 有 maps 时用 Tab 切换，无 maps 时 fallback */}
{maps.length > 0 ? (
  <section className="space-y-3">
    <h2 className="text-lg font-semibold text-[var(--color-fg)]">地图结果</h2>
    <Tabs defaultValue={maps[0].id}>
      <TabsList>
        {maps.map((map) => (
          <TabsTrigger key={map.id} value={map.id} className="text-xs">
            {mapLabel(map.mapName)}
          </TabsTrigger>
        ))}
      </TabsList>
      {maps.map((map) => (
        <TabsContent key={map.id} value={map.id}>
          <Panel pad={16} className="space-y-3">
            {/* 地图 info bar */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="text-xs text-[var(--color-fg-mid)] w-5">#{map.mapOrder}</span>
                <span className="font-medium text-[var(--color-fg)]">{mapLabel(map.mapName)}</span>
                {map.pickedByTeamId === match.teamAId && (
                  <PosChip pos={`${teamA?.name} Pick`} />
                )}
                {map.pickedByTeamId === match.teamBId && (
                  <PosChip pos={`${teamB?.name} Pick`} />
                )}
                {map.pickedByTeamId === null && (
                  <PosChip pos="决胜图" />
                )}
              </div>
              <div className="flex items-center gap-3 text-sm">
                {map.teamAStartSide && (
                  <span className="text-[var(--color-fg-mid)]">
                    {teamA?.name} {SIDE_LABELS[map.teamAStartSide]}先
                  </span>
                )}
                {map.scoreA !== null && map.scoreB !== null && (
                  <span className="font-mono font-bold text-[var(--color-fg)]">
                    {map.scoreA}&nbsp;:&nbsp;{map.scoreB}
                  </span>
                )}
              </div>
            </div>
            {/* 玩家数据 / OCR */}
            {isFinished && <PlayerStatsTable matchId={match.id} mapId={map.id} />}
            {!isFinished && map.scoreA == null && (
              <p className="text-xs text-[var(--color-fg-dim)] py-2">比赛未开始</p>
            )}
            {isFinished && isSeasonAdmin && (
              <StatsOCRPanel mapId={map.id} mapName={map.mapName} />
            )}
          </Panel>
        </TabsContent>
      ))}
    </Tabs>
  </section>
) : isFinished && match.scoreA != null && match.scoreB != null ? (
  // Phase 1 的 BO1 fallback
  <section className="space-y-3">
    <h2 className="text-lg font-semibold text-[var(--color-fg)]">比赛结果</h2>
    <Panel pad={16}>
      <p className="text-sm text-[var(--color-fg)]">
        BO1 系列赛总分：{match.scoreA} : {match.scoreB}
      </p>
    </Panel>
  </section>
) : (
  /* 未开始但有 maps：显示地图结构（无比分） */
  maps.length > 0 && (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-[var(--color-fg)]">比赛地图</h2>
      <div className="space-y-2">
        {maps.map((map) => (
          <Panel key={map.id} pad={12}>
            <div className="flex items-center gap-3">
              <span className="text-xs text-[var(--color-fg-mid)]">#{map.mapOrder}</span>
              <span className="font-medium text-[var(--color-fg)]">{mapLabel(map.mapName)}</span>
              <span className="text-xs text-[var(--color-fg-dim)]">待进行</span>
            </div>
          </Panel>
        ))}
      </div>
    </section>
  )
)}
```

- [ ] **Step 2: 确保 Tabs 组件已 import**

确认 `src/app/[seasonSlug]/matches/[matchId]/page.tsx` 顶部有：

```typescript
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
```

- [ ] **Step 3: 类型检查 + Commit**

```bash
pnpm tsc --noEmit
git add src/app/\[seasonSlug\]/matches/\[matchId\]/page.tsx
git commit -m "feat: 比赛详情页分图 Tab 切换 + 地图结构预展示 + BO1 fallback"
```

### Task 5.2: 清理 orphaned MatchDetail 组件

**Files:**
- Check: `src/components/matches/MatchDetail.tsx`
- Remove if unused: `src/components/matches/MatchDetail.tsx`

- [ ] **Step 1: 确认 MatchDetail 是否被引用**

```bash
grep -r "MatchDetail" src/ --include="*.tsx" --include="*.ts"
```

如果只在 `MatchDetail.tsx` 自身定义中出现（无其他 import），则删除。

```bash
# 如果确认无引用:
git rm src/components/matches/MatchDetail.tsx
```

- [ ] **Step 2: Commit**

```bash
git commit -m "chore: 移除 orphaned MatchDetail 组件（已被内联 server component 替代）"
```

### Task 5.3: 全链路验证

- [ ] **Step 1: 类型检查**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 2: 运行测试**

```bash
pnpm test
```

- [ ] **Step 3: 构建检查**

```bash
pnpm build
```

- [ ] **Step 4: Commit 最终调整**

```bash
git add -A
git commit -m "chore: 比赛模块补齐 — 类型检查 + 测试通过"
```

---

## 依赖关系

```
Phase 1 (BO1 地图记录)
    ├── Phase 2 (BP 录入+展示，独立但建议 Phase 1 之后)
    ├── Phase 4 (OCR 入口，依赖 Phase 1 的 BO1 map 创建)
    │       └── Phase 5 (详情页 tab 切换，依赖 Phase 1/2/4)
Phase 3 (Roster 管理，完全独立)
```

建议执行顺序：**1 → 2 → 4 → 5**，Phase 3 可在任何时间点插入。
