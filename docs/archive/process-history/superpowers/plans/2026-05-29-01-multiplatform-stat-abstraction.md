# Plan 1 · 多平台 Stat 抽象与排序/MVP 解耦 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **共享契约定义见** `2026-05-29-demo-analytics-index.md`(契约 A/B)。本计划落地契约 A、B。

**Goal:** 让"录入哪些字段、用什么指标排序与选 MVP"由赛季级 `statProfile` capability 决定,彻底解除写死 `ratingPro` 的耦合,使无 rating 平台也能跑通。

**Architecture:** 新增 `StatProfile` 类型 + 完美默认常量;`seasons` 加 `statProfile` json、`match_player_stats` 加 `source` 枚举。把排序/MVP 候选从写死 `ratingPro` 改为读 `rankMetric`,并新增一个纯函数 `computeRecommendedMvp` 作系统推荐。OCR 面板按 `inputFields` 动态渲染。

**Tech Stack:** Drizzle ORM + PG enum/json、Vitest(co-located `*.test.ts`)、Next.js Server Actions、React/shadcn。

---

### Task 1: StatProfile 类型与完美默认常量

**Files:**
- Modify: `src/types/season.ts`(追加导出)
- Create: `src/lib/config/stat-profile.ts`
- Test: `src/lib/config/stat-profile.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// src/lib/config/stat-profile.test.ts
import { describe, it, expect } from "vitest";
import { PERFECTWORLD_STAT_PROFILE, ALL_STAT_FIELDS } from "./stat-profile";

describe("PERFECTWORLD_STAT_PROFILE", () => {
  it("provider 为 perfectworld 且 rankMetric 为 ratingPro", () => {
    expect(PERFECTWORLD_STAT_PROFILE.provider).toBe("perfectworld");
    expect(PERFECTWORLD_STAT_PROFILE.rankMetric).toBe("ratingPro");
  });
  it("inputFields 覆盖全部 11 个统计字段", () => {
    expect(PERFECTWORLD_STAT_PROFILE.inputFields).toEqual(ALL_STAT_FIELDS);
    expect(ALL_STAT_FIELDS).toHaveLength(11);
  });
  it("rankMetric 必须属于 inputFields", () => {
    expect(PERFECTWORLD_STAT_PROFILE.inputFields).toContain(
      PERFECTWORLD_STAT_PROFILE.rankMetric,
    );
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/lib/config/stat-profile.test.ts`
Expected: FAIL — Cannot find module './stat-profile'

- [ ] **Step 3: 在 `src/types/season.ts` 追加类型**

```typescript
export type StatFieldKey =
  | "kills" | "deaths" | "assists" | "hsPercent" | "firstKills"
  | "multiKills" | "clutches" | "adr" | "rws" | "ratingPro" | "we";

export interface StatProfile {
  /** 仅展示/标记,业务逻辑不得据此分支 */
  provider: string;
  /** OCR 面板按此顺序渲染可录入列 */
  inputFields: StatFieldKey[];
  /** 排序与 MVP 候选所用指标,必须 ∈ inputFields */
  rankMetric: StatFieldKey;
}
```

- [ ] **Step 4: 实现 `src/lib/config/stat-profile.ts`**

```typescript
import type { StatFieldKey, StatProfile } from "@/types/season";

export const ALL_STAT_FIELDS: StatFieldKey[] = [
  "kills", "deaths", "assists", "hsPercent", "firstKills",
  "multiKills", "clutches", "adr", "rws", "ratingPro", "we",
];

export const PERFECTWORLD_STAT_PROFILE: StatProfile = {
  provider: "perfectworld",
  inputFields: ALL_STAT_FIELDS,
  rankMetric: "ratingPro",
};
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm test src/lib/config/stat-profile.test.ts`
Expected: PASS (3 个用例)

- [ ] **Step 6: 提交**

```bash
git add src/types/season.ts src/lib/config/stat-profile.ts src/lib/config/stat-profile.test.ts
git commit -m "feat: 新增 StatProfile 类型与完美默认 stat profile"
```

---

### Task 2: match_player_stats 增加 source 来源枚举(契约 A)

**Files:**
- Modify: `src/db/schema/player-stats.ts`
- 迁移产物: `drizzle/`(由 `pnpm db:generate` 生成)

- [ ] **Step 1: 修改 schema 增加 enum 与字段**

在 `src/db/schema/player-stats.ts` 顶部 import 后追加:

```typescript
import { pgEnum } from "drizzle-orm/pg-core";

export const statSourceEnum = pgEnum("stat_source", ["manual_ocr", "demo_import"]);
```

在 `matchPlayerStats` 的「审核信息」段之前插入字段:

```typescript
  // 数据来源（契约 A）
  source: statSourceEnum("source").notNull().default("manual_ocr"),
```

- [ ] **Step 2: 生成迁移**

Run: `pnpm db:generate`
Expected: 在 `drizzle/` 生成新增 enum + ALTER TABLE 的 SQL,无报错。

- [ ] **Step 3: 类型检查**

Run: `pnpm tsc --noEmit`
Expected: 通过(default 兜底,现有插入无需改)。

- [ ] **Step 4: 提交**

```bash
git add src/db/schema/player-stats.ts drizzle/
git commit -m "feat: match_player_stats 增加 source 来源枚举"
```

> 注:`pnpm db:push` 推到 Supabase 由执行者在联调阶段手动确认(macOS 偶发连接问题见 AGENTS.md §10),不在自动步骤内。

---

### Task 3: seasons 增加 statProfile capability(契约 B)

**Files:**
- Modify: `src/db/schema/seasons.ts`
- 迁移产物: `drizzle/`

- [ ] **Step 1: 修改 seasons schema**

在 `src/db/schema/seasons.ts` 顶部追加 import:

```typescript
import type { StatProfile } from "@/types/season";
```

在 capability 段(`positions` 字段之后、分隔线之前)插入:

```typescript
  // 统计字段与排序/MVP 口径(契约 B);业务逻辑唯一判断依据
  statProfile: json("stat_profile")
    .$type<StatProfile>()
    .notNull()
    .default(
      sql`'{"provider":"perfectworld","inputFields":["kills","deaths","assists","hsPercent","firstKills","multiKills","clutches","adr","rws","ratingPro","we"],"rankMetric":"ratingPro"}'::json`,
    ),
```

- [ ] **Step 2: 生成迁移**

Run: `pnpm db:generate`
Expected: ALTER TABLE seasons ADD COLUMN stat_profile,带 default。

- [ ] **Step 3: 类型检查**

Run: `pnpm tsc --noEmit`
Expected: 通过。

- [ ] **Step 4: 提交**

```bash
git add src/db/schema/seasons.ts drizzle/
git commit -m "feat: seasons 增加 statProfile capability(默认完美口径)"
```

---

### Task 4: 排序与系统推荐 MVP 纯函数

**Files:**
- Create: `src/lib/stats/mvp.ts`
- Test: `src/lib/stats/mvp.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// src/lib/stats/mvp.test.ts
import { describe, it, expect } from "vitest";
import { sortByMetric, computeRecommendedMvp } from "./mvp";

type Row = { perfectName: string; adr: number | null; kills: number | null; deaths: number | null; ratingPro: number | null };

const rows: Row[] = [
  { perfectName: "A", adr: 90, kills: 20, deaths: 15, ratingPro: 1.3 },
  { perfectName: "B", adr: 70, kills: 18, deaths: 18, ratingPro: 1.1 },
  { perfectName: "C", adr: 110, kills: 25, deaths: 14, ratingPro: 1.5 },
];

describe("sortByMetric", () => {
  it("按指定指标降序,null 视为最小", () => {
    const sorted = sortByMetric(rows, "ratingPro");
    expect(sorted.map((r) => r.perfectName)).toEqual(["C", "A", "B"]);
  });
  it("可切换到 adr 口径", () => {
    expect(sortByMetric(rows, "adr").map((r) => r.perfectName)).toEqual(["C", "A", "B"]);
  });
});

describe("computeRecommendedMvp", () => {
  it("用 ADR 排名 + K/D 排名复合分,返回名次最佳者", () => {
    const mvp = computeRecommendedMvp(rows);
    expect(mvp?.perfectName).toBe("C");
  });
  it("空数组返回 null", () => {
    expect(computeRecommendedMvp([])).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/lib/stats/mvp.test.ts`
Expected: FAIL — Cannot find module './mvp'

- [ ] **Step 3: 实现 `src/lib/stats/mvp.ts`**

```typescript
import type { StatFieldKey } from "@/types/season";

type MetricRow = Partial<Record<StatFieldKey, number | null>> & { perfectName: string };

/** 按指标降序,null 视为 -Infinity(排末尾)。返回新数组,不改原数组。 */
export function sortByMetric<T extends MetricRow>(rows: T[], metric: StatFieldKey): T[] {
  return [...rows].sort((a, b) => (num(b[metric]) - num(a[metric])));
}

/**
 * 系统推荐 MVP:借鉴 Astra 的 ADR 排名 + K/D 排名复合打分。
 * 不依赖任何平台特有 rating,适用于缺 rating 的赛季。
 */
export function computeRecommendedMvp<T extends MetricRow>(rows: T[]): T | null {
  if (rows.length === 0) return null;
  const byAdr = rankMap(rows, (r) => num(r.adr));
  const byKd = rankMap(rows, (r) => kd(r));
  let best: T | null = null;
  let bestScore = Infinity; // 名次和越小越好
  for (const r of rows) {
    const score = (byAdr.get(r) ?? 0) + (byKd.get(r) ?? 0);
    if (score < bestScore) { bestScore = score; best = r; }
  }
  return best;
}

function num(v: number | null | undefined): number {
  return typeof v === "number" ? v : Number.NEGATIVE_INFINITY;
}
function kd(r: MetricRow): number {
  const k = typeof r.kills === "number" ? r.kills : 0;
  const d = typeof r.deaths === "number" && r.deaths > 0 ? r.deaths : 1;
  return k / d;
}
/** 返回每行 → 名次(1 = 最高),数值相同名次相同。 */
function rankMap<T>(rows: T[], val: (r: T) => number): Map<T, number> {
  const sorted = [...rows].sort((a, b) => val(b) - val(a));
  const m = new Map<T, number>();
  sorted.forEach((r, i) => m.set(r, i + 1));
  return m;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test src/lib/stats/mvp.test.ts`
Expected: PASS (4 个用例)

- [ ] **Step 5: 提交**

```bash
git add src/lib/stats/mvp.ts src/lib/stats/mvp.test.ts
git commit -m "feat: 新增按指标排序与系统推荐 MVP 纯函数"
```

---

### Task 5: detail-stats MVP 候选改用 rankMetric

**Files:**
- Modify: `src/lib/matches/detail-stats.ts:226-228`(MVP 候选)与 `aggregateFinishedPlayerStats` 签名
- Test: `src/lib/matches/detail-stats.test.ts`

- [ ] **Step 1: 在 `detail-stats.test.ts` 追加失败测试**

```typescript
import { sortByMetric } from "@/lib/stats/mvp";
// ... 现有 import 保留

describe("aggregateFinishedPlayerStats MVP 候选按 rankMetric", () => {
  it("传入 rankMetric=adr 时候选按 adr 排序", () => {
    // 用现有测试夹具构造 allStats;断言 mvpCandidates 顺序按 adr 降序取前 4
    const result = aggregateFinishedPlayerStats(
      fixtureStats, userIdToTeamId, "teamA", "teamB", roundsMap, "adr",
    );
    const adrs = result.mvpCandidates.map((c) => c.adr ?? 0);
    expect([...adrs]).toEqual([...adrs].sort((a, b) => b - a));
  });
});
```

> 执行者注:`fixtureStats` 等沿用该测试文件已有的夹具变量名;若现有用例已构造则复用,不要新建夹具。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/lib/matches/detail-stats.test.ts`
Expected: FAIL — 参数个数不匹配 / 顺序错误

- [ ] **Step 3: 修改 `aggregateFinishedPlayerStats` 签名与候选逻辑**

签名末尾追加可选参数(默认 `ratingPro`,保持现有调用兼容):

```typescript
import type { StatFieldKey } from "@/types/season";
import { sortByMetric } from "@/lib/stats/mvp";

export function aggregateFinishedPlayerStats(
  /* ...现有参数保持不变... */
  rankMetric: StatFieldKey = "ratingPro",
) {
```

把 226-228 行替换为:

```typescript
  const mvpCandidates = sortByMetric(aggregated, rankMetric).slice(0, 4);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test src/lib/matches/detail-stats.test.ts`
Expected: PASS(含新用例与原有用例)

- [ ] **Step 5: 提交**

```bash
git add src/lib/matches/detail-stats.ts src/lib/matches/detail-stats.test.ts
git commit -m "feat: MVP 候选按赛季 rankMetric 排序"
```

---

### Task 6: getPlayerStatsByMap 按 rankMetric 排序

**Files:**
- Modify: `src/actions/player-stats.ts:205-210`

- [ ] **Step 1: 修改函数签名与排序**

把 `getPlayerStatsByMap` 改为:

```typescript
import type { StatFieldKey } from "@/types/season";

export async function getPlayerStatsByMap(
  mapId: string,
  rankMetric: StatFieldKey = "ratingPro",
) {
  const rows = await db.query.matchPlayerStats.findMany({
    where: eq(matchPlayerStats.mapId, mapId),
  });
  // 应用层按 rankMetric 降序;null 排末尾
  return rows.sort((a, b) => {
    const av = a[rankMetric] ?? Number.NEGATIVE_INFINITY;
    const bv = b[rankMetric] ?? Number.NEGATIVE_INFINITY;
    return (bv as number) - (av as number);
  });
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm tsc --noEmit`
Expected: 通过(默认参数保证现有调用方 StatsOCRPanel 不报错)。

- [ ] **Step 3: 提交**

```bash
git add src/actions/player-stats.ts
git commit -m "refactor: getPlayerStatsByMap 排序改为可配 rankMetric"
```

---

### Task 7: OCR 面板按 inputFields 动态渲染

**Files:**
- Modify: `src/components/matches/StatsOCRPanel.tsx:42-54`(及 props)

- [ ] **Step 1: 给组件加 inputFields prop 并过滤 NUM_FIELDS**

在 `interface Props` 增加:

```typescript
  /** 该赛季要录入的字段;不传则全展示(向后兼容) */
  inputFields?: import("@/types/season").StatFieldKey[];
```

把 `NUM_FIELDS` 常量保留为「全集」,在组件内派生实际渲染列:

```typescript
const visibleFields = useMemo(
  () => (inputFields
    ? NUM_FIELDS.filter((f) => inputFields.includes(f.key as StatFieldKey))
    : NUM_FIELDS),
  [inputFields],
);
```

将组件内所有遍历 `NUM_FIELDS` 渲染表头/单元格的位置改为遍历 `visibleFields`(执行者:全文件搜 `NUM_FIELDS.map` 替换为 `visibleFields.map`,表头与表体两处)。

- [ ] **Step 2: 类型检查 + 构建**

Run: `pnpm tsc --noEmit`
Expected: 通过。

- [ ] **Step 3: 手动验证(无单测,组件交互)**

启动 `pnpm dev`,进入后台某比赛地图的 OCR 录入面板,确认默认仍显示全部 11 列;临时给调用处传 `inputFields={["kills","deaths","adr"]}` 应只剩 3 列。验证后还原临时传参。

- [ ] **Step 4: 提交**

```bash
git add src/components/matches/StatsOCRPanel.tsx
git commit -m "feat: OCR 面板按赛季 inputFields 动态渲染列"
```

---

### Task 8: 接线 — matches 页面传 rankMetric + MVP 面板显示系统推荐

**Files:**
- Modify: `src/app/[seasonSlug]/matches/[matchId]/page.tsx:339`(传 rankMetric)
- Modify: `src/components/matches/MatchMvpVote.tsx`(展示「系统推荐」标记)

- [ ] **Step 1: 页面侧把赛季 rankMetric 传入聚合**

页面已加载 `season`,在调用处改为:

```typescript
const rankMetric = season.statProfile.rankMetric;
const aggregatedStats = aggregateFinishedPlayerStats(
  allStats, userIdToTeamId, match.teamAId, match.teamBId, currentMapRoundsMap, rankMetric,
);
```

- [ ] **Step 2: 计算系统推荐并传给投票组件**

页面侧在 `mvpCandidates` 之后:

```typescript
import { computeRecommendedMvp } from "@/lib/stats/mvp";
const recommendedMvpName = computeRecommendedMvp(mvpCandidates)?.perfectName ?? null;
```

给 `<MatchMvpVote>` 增加 prop `recommendedMvpName={recommendedMvpName}`。

- [ ] **Step 3: MatchMvpVote 渲染推荐标记**

在 `MatchMvpVoteProps` 增加 `recommendedMvpName: string | null`,在候选卡片渲染处,当 `candidate.perfectName === recommendedMvpName` 时显示一个「系统推荐」徽标(用现有 Panel/标签样式,不新增依赖)。

- [ ] **Step 4: 类型检查 + 手动验证**

Run: `pnpm tsc --noEmit` → 通过。
启动 `pnpm dev`,打开一场已结束比赛,确认 MVP 候选仍是 4 人、排序正确,且 ADR/KD 综合最佳者带「系统推荐」标记。

- [ ] **Step 5: 提交**

```bash
git add "src/app/[seasonSlug]/matches/[matchId]/page.tsx" src/components/matches/MatchMvpVote.tsx
git commit -m "feat: MVP 面板按赛季口径排序并标注系统推荐"
```

---

## Self-Review 检查

- **Spec 覆盖:** 契约 A(Task 2)、契约 B(Task 1/3)、排序解耦(Task 5/6)、系统推荐 MVP(Task 4/8)、OCR 动态字段(Task 7)全部有对应任务。✅
- **类型一致:** `StatFieldKey` / `StatProfile` 在 Task 1 定义,Task 4/5/6/7 复用同名;`rankMetric` 默认值统一 `"ratingPro"`,`sortByMetric` 在 Task 4 定义、Task 5 复用。✅
- **无占位符:** 每个代码步给出完整实现;Task 5 夹具复用现有测试变量已注明。✅

## 完成后维护

- 跑 `zsh scripts/check-claude-md.sh` + 更新 `docs/code-map.md`(新增 `stat-profile.ts` / `mvp.ts`)。
- `pnpm db:push` 推送两处迁移到 Supabase(联调阶段手动)。
