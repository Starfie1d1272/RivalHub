# Plan 3 · Demo 明细前端展现与静态热力图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development 或 superpowers:executing-plans。
> **依赖 Plan 2**(13 张 demo 表已落库)。坐标标定见 `2026-05-29-demo-analytics-index.md` 契约 C。

**Goal:** 把 demo 数据消费到全站四个页面:**比赛页**(明细表/热力图/时间线/击杀 Feed/经济曲线/残局复盘)、**选手页**(进阶雷达/个人热区/武器偏好/首杀倾向/残局能力/utility 贡献)、**数据面板**(进阶榜单/武器榜/高光榜/经济转化率)、**队伍页**(风格画像/半场强弱)。**2D 动态回放本期不做**(未来项)。

**Architecture:** 坐标标定与世界→像素变换、经济转化率/半场胜率/武器聚合等为纯函数(可单测);热力图用 Canvas 在 radar 底图上画点;明细数据走 RSC 查询 Server Action。**所有跨场聚合必须按 `match_maps.activeStatSource` 过滤来源**(契约 E),demo 明细统计走 `demo_*` 表按映射后的 `userId` 聚合。

**Tech Stack:** Next.js RSC + Server Action、Canvas 2D、Drizzle 查询、Vitest。

## 任务分组

- **Part A — 比赛页** `matches/[matchId]`:Task 1–9(基础标定/明细/热力图/时间线 + 击杀 Feed/经济曲线/残局复盘)
- **Part B — 选手页** `players/[userId]`:Task 10–15
- **Part C — 数据面板** `[seasonSlug]/stats`:Task 16–19
- **Part D — 队伍页** `teams/[teamId]`:Task 20–21

> 依赖:Part A 的 Task 1(标定)、Task 2(查询基建)是其余 Part 的前提;Part B/C/D 之间互相独立,可并行。

---

### Task 1: 地图 radar 标定与坐标变换(契约 C)

**Files:**
- Create: `src/lib/demo/map-calibration.ts`
- Test: `src/lib/demo/map-calibration.test.ts`
- Asset: `public/maps/radars/de_mirage.png`(执行者从 SimpleRadar 资源获取)

- [ ] **Step 1: 写失败测试**

```typescript
// src/lib/demo/map-calibration.test.ts
import { describe, it, expect } from "vitest";
import { worldToPixel, getCalibration } from "./map-calibration";

describe("worldToPixel", () => {
  it("用 de_mirage 标定把世界坐标映射到 0..1024 像素", () => {
    const cal = getCalibration("de_mirage")!;
    const px = worldToPixel({ x: cal.offsetX, y: cal.offsetY, z: 0 }, cal);
    expect(px.x).toBeCloseTo(0, 1);
    expect(px.y).toBeCloseTo(0, 1);
  });
  it("未知地图返回 null 标定", () => {
    expect(getCalibration("de_unknown")).toBeNull();
  });
});
```

- [ ] **Step 2: 跑确认失败** → `pnpm test src/lib/demo/map-calibration.test.ts` FAIL

- [ ] **Step 3: 实现 `map-calibration.ts`**

```typescript
export interface MapCalibration {
  offsetX: number; offsetY: number; scale: number; radar: string;
}
type Vec3 = { x: number; y: number; z: number };

// SimpleRadar 标准标定值(de_mirage 官方值)
const CALIBRATIONS: Record<string, MapCalibration> = {
  de_mirage: { offsetX: -3230, offsetY: 1713, scale: 5.0, radar: "/maps/radars/de_mirage.png" },
};

export function getCalibration(mapName: string): MapCalibration | null {
  return CALIBRATIONS[mapName] ?? null;
}

/** 世界坐标 → radar 像素(SimpleRadar 公式) */
export function worldToPixel(p: Vec3, cal: MapCalibration): { x: number; y: number } {
  return {
    x: (p.x - cal.offsetX) / cal.scale,
    y: (cal.offsetY - p.y) / cal.scale,
  };
}
```

- [ ] **Step 4: 跑确认通过** → PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/demo/map-calibration.ts src/lib/demo/map-calibration.test.ts public/maps/radars/de_mirage.png
git commit -m "feat: 地图 radar 标定与世界坐标变换"
```

---

### Task 2: 明细数据查询 Server Action

**Files:**
- Create: `src/actions/demo-detail.ts`

- [ ] **Step 1: 实现查询**

`getDemoDetail(mapId)` 返回该 map 最新 `demoImports` 批次的:`playerStats`(demoPlayerStats 行)、`rounds`、以及热力图点集 `killPoints`/`deathPoints`/`bombPoints`/`grenadePoints`(从 demoKills/demoBombs/demoGrenades 取坐标 + roundNumber + side)。无导入返回 `ok(null)`。页面只读查询,返回 `ActionResult`。

- [ ] **Step 2: 类型检查** → `pnpm tsc --noEmit` 通过

- [ ] **Step 3: 提交**

```bash
git add src/actions/demo-detail.ts
git commit -m "feat: demo 明细数据查询 action"
```

---

### Task 3: 详细 player-stats 表组件

**Files:**
- Create: `src/components/matches/DemoPlayerStatsTable.tsx`

- [ ] **Step 1: 实现组件**

展示 demo 独有的丰富字段:KAST、ADR、utility damage、trade K/D、首杀/首死、多杀细分(1K–5K)、残局细分(1v1–1v5 attempts/won)、wallbang/noscope/collateral。用现有 shadcn `Table`,按 teamKey 分两栏(对齐现有 OCR 双栏风格)。纯展示组件,接收 Task 2 的 `playerStats` 数据。

- [ ] **Step 2: 手动验证**

`pnpm dev` → 已导入 demo 的比赛地图页 → 确认明细表渲染全部字段、两队分栏正确。

- [ ] **Step 3: 提交**

```bash
git add src/components/matches/DemoPlayerStatsTable.tsx
git commit -m "feat: demo 详细 player-stats 展示表"
```

---

### Task 4: 静态热力图组件

**Files:**
- Create: `src/components/matches/DemoHeatmap.tsx`

- [ ] **Step 1: 实现 Canvas 热力图**

`"use client"`。props:`mapName`、点集 `points: {x:number;y:number}[]`(世界坐标)、`mode`(kills/deaths/bombs/grenades 切换,影响点色)。逻辑:
1. `getCalibration(mapName)`;为 null 时显示「该地图暂无标定」占位。
2. `<img>` 渲染 radar 底图(1024×1024 缩放到容器),Canvas 同尺寸绝对定位叠加其上。
3. 对每个点 `worldToPixel` 后画半透明径向渐变圆(密集处自然叠加成热区)。
4. 提供 mode 切换按钮(击杀/死亡/炸弹/道具)。

- [ ] **Step 2: 手动验证**

`pnpm dev` → de_mirage 的导入数据 → 确认点位落在地图合理位置(出生点/包点附近),切换 mode 点色变化。若点位整体偏移,核对 Task 1 标定值。

- [ ] **Step 3: 提交**

```bash
git add src/components/matches/DemoHeatmap.tsx
git commit -m "feat: demo 静态热力图组件"
```

---

### Task 5: 回合时间线组件

**Files:**
- Create: `src/components/matches/DemoRoundTimeline.tsx`

- [ ] **Step 1: 实现**

横向展示每回合:回合号、胜方 side(T/CT 配色)、endReason、双方赛前比分。接收 Task 2 的 `rounds`。纯展示。

- [ ] **Step 2: 手动验证 + 提交**

```bash
git add src/components/matches/DemoRoundTimeline.tsx
git commit -m "feat: demo 回合时间线展示"
```

---

### Task 6: 接线到比赛地图页

**Files:**
- Modify: `src/app/[seasonSlug]/matches/[matchId]/page.tsx`

- [ ] **Step 1: 页面查询并条件渲染**

已结束比赛时调用 `getDemoDetail(mapId)`;有数据则在现有 OCR 汇总区下方渲染新增 Tab/区块:`DemoPlayerStatsTable`、`DemoHeatmap`、`DemoRoundTimeline`;无数据不渲染(保持现状)。遵守 RSC 只读、`force-dynamic` 不引入。

- [ ] **Step 2: 手动验证**

`pnpm dev` → 已导入 demo 的比赛页:三个新区块出现;未导入的比赛页:无新增区块、原功能不变。

- [ ] **Step 3: 提交**

```bash
git add "src/app/[seasonSlug]/matches/[matchId]/page.tsx"
git commit -m "feat: 比赛地图页接入 demo 明细与热力图"
```

---

---

## Part A 进阶 — 比赛页补充功能

### Task 7: 击杀 Feed 时间线(A1)

**Files:**
- Create: `src/components/matches/DemoKillFeed.tsx`
- Modify: `src/actions/demo-detail.ts`(返回 `kills` 明细:roundNumber/tick/killer/victim/weapon/headshot/tradeKill)

- [ ] **Step 1: 扩展查询返回 kills 明细**(按 roundNumber、tick 升序)。
- [ ] **Step 2: 实现组件**:按回合分组,每条杀展示「击杀者 [武器图标/名] 死者」+ HS/trade/穿烟 标记;映射到站内选手的显示站内名,否则 demo 昵称。纯展示。
- [ ] **Step 3: 手动验证**:比赛页 Feed 按回合顺序、标记正确。
- [ ] **Step 4: 提交** `git commit -m "feat: demo 击杀 Feed 时间线"`

### Task 8: 经济曲线(A2)

**Files:**
- Create: `src/lib/demo/economy-series.ts` + `.test.ts`
- Create: `src/components/matches/DemoEconomyChart.tsx`
- Modify: `src/actions/demo-detail.ts`(返回 `economies`:roundNumber/teamKey/equipmentValue/type)

- [ ] **Step 1: 写失败测试**

```typescript
// src/lib/demo/economy-series.test.ts
import { describe, it, expect } from "vitest";
import { buildEconomySeries } from "./economy-series";

it("按回合汇总两队装备价值", () => {
  const rows = [
    { roundNumber: 1, teamKey: "teamA", equipmentValue: 4000 },
    { roundNumber: 1, teamKey: "teamB", equipmentValue: 800 },
    { roundNumber: 2, teamKey: "teamA", equipmentValue: 4500 },
  ];
  const series = buildEconomySeries(rows);
  expect(series[0]).toEqual({ roundNumber: 1, teamA: 4000, teamB: 800 });
  expect(series[1].teamA).toBe(4500);
});
```

- [ ] **Step 2: 跑确认失败** → FAIL
- [ ] **Step 3: 实现** `buildEconomySeries(rows)`:按 roundNumber 分组,各队 equipmentValue 求和,产出 `{ roundNumber, teamA, teamB }[]`(缺侧补 0)。
- [ ] **Step 4: 跑确认通过** → PASS
- [ ] **Step 5: 组件** `DemoEconomyChart`:折线图(复用项目现有图表方案/SVG),X=回合,两条线。
- [ ] **Step 6: 提交** `git commit -m "feat: demo 经济曲线"`

### Task 9: 残局复盘(A3)

**Files:**
- Create: `src/components/matches/DemoClutchList.tsx`
- Modify: `src/actions/demo-detail.ts`(返回 `clutches`:roundNumber/clutcher/opponentCount/won/killCount)

- [ ] **Step 1: 查询返回 clutches**(按 roundNumber)。
- [ ] **Step 2: 组件**:列表展示「R{round} 选手名 1vN 胜/负 ·击杀 K」,胜负配色。
- [ ] **Step 3: 手动验证 + 提交** `git commit -m "feat: demo 残局复盘列表"`

> A5(对枪热区/死亡点位)已由 Task 4 热力图的 deaths/kills mode 覆盖,无需新增 Task;如需"击杀者→死者连线"可作为 Task 4 的可选增强(本期不强制)。

---

## Part B — 选手页 `players/[userId]`

> 共用前提:新增 `src/actions/player-demo-stats.ts`,聚合该 `userId` 跨所有 `activeStatSource=demo_import` 的图的 `demo_*` 数据。各 Task 复用其查询结果。

### Task 10: 进阶雷达维度升级(B1)

**Files:**
- Modify: `src/lib/utils/hexagon.ts`(增加 demo 维度类型)
- Create: `src/actions/player-demo-stats.ts`(`getPlayerDemoAggregate(userId)`)
- Modify: `src/components/matches/PlayerRadarChart.tsx`、`src/app/players/[userId]/page.tsx`

- [ ] **Step 1: 聚合查询**:`getPlayerDemoAggregate(userId)` 从 `demoPlayerStats`(join demoImports→match_maps 且 `active_stat_source='demo_import'`)按 userId 汇总:KAST(round 加权)、ADR、avgUtilityDamagePerRound、tradeKillCount/敌方击杀比、firstKill 占比、各 vN 胜率。返回标准化前的原始指标。
- [ ] **Step 2: 维度计算**:在 `hexagon.ts` 增加 `computeDemoDimensions(metrics, cohort)`,把 KAST/Trade/Utility/Entry/Clutch/ADR 标准化到 0–100(沿用现有 `computeEventStats` 的 cohort 标准化思路)。无 demo 数据的选手返回全 0 并在 UI 置灰。
- [ ] **Step 3: 组件**:`PlayerRadarChart` 支持传入「demo 维度」数据集;选手页有 demo 数据时渲染增强雷达,否则保持现有 rws/we/ratingPro 雷达。
- [ ] **Step 4: 手动验证 + 提交** `git commit -m "feat: 选手页基于 demo 的进阶雷达维度"`

### Task 11: 个人击杀热区(B2)

**Files:**
- Create: `src/components/players/PlayerKillHeatmap.tsx`
- Modify: `src/actions/player-demo-stats.ts`(返回 `killPositions` 按 mapName 分组)

- [ ] **Step 1: 查询**:该 userId 作为 killer 的 `demoKills.killerPosition`,按 mapName 分组(只取有标定的图)。
- [ ] **Step 2: 组件**:复用 Part A 的 `DemoHeatmap`,加地图切换下拉(该选手打过的有标定的图)。
- [ ] **Step 3: 手动验证 + 提交** `git commit -m "feat: 选手页个人击杀热区"`

### Task 12: 武器偏好与命中率(B3)

**Files:**
- Create: `src/lib/demo/weapon-stats.ts` + `.test.ts`
- Create: `src/components/players/PlayerWeaponBreakdown.tsx`

- [ ] **Step 1: 写失败测试**

```typescript
// src/lib/demo/weapon-stats.test.ts
import { describe, it, expect } from "vitest";
import { aggregateWeaponKills } from "./weapon-stats";

it("按武器统计击杀数并降序", () => {
  const kills = [{ weapon: "ak47" }, { weapon: "awp" }, { weapon: "ak47" }];
  const r = aggregateWeaponKills(kills);
  expect(r[0]).toEqual({ weapon: "ak47", kills: 2 });
  expect(r[1]).toEqual({ weapon: "awp", kills: 1 });
});
```

- [ ] **Step 2-4: 跑失败→实现 `aggregateWeaponKills`(group by weapon 计数降序)→跑通。**
- [ ] **Step 5: 命中率(可选)**:若有 `shots` 与 `damages`,命中率 = damages 命中数 / shots 数;数据不足则只展示击杀分布。
- [ ] **Step 6: 组件 + 提交** `git commit -m "feat: 选手页武器偏好分布"`

### Task 13: 首杀倾向(B4)

**Files:**
- Create: `src/components/players/PlayerEntryStats.tsx`

- [ ] **Step 1: 用 Task 10 聚合的 firstKillCount/firstDeathCount** 算 entry 成功率 = firstKill /(firstKill+firstDeath)。
- [ ] **Step 2: 组件**:展示首杀数、首死数、entry 成功率,配 opener 倾向说明。
- [ ] **Step 3: 提交** `git commit -m "feat: 选手页首杀倾向"`

### Task 14: 残局能力(B5)

**Files:**
- Create: `src/components/players/PlayerClutchStats.tsx`

- [ ] **Step 1: 用 Task 10 聚合的 vsOne..vsFive 的 count/won** 算各 vN 胜率。
- [ ] **Step 2: 组件**:1v1–1v5 的尝试数/胜率条形或表格。
- [ ] **Step 3: 提交** `git commit -m "feat: 选手页残局能力"`

### Task 15: utility 贡献(B6)

**Files:**
- Create: `src/lib/demo/utility-stats.ts` + `.test.ts`
- Create: `src/components/players/PlayerUtilityStats.tsx`
- Modify: `src/actions/player-demo-stats.ts`(join `demoBlinds` 统计致盲人数/时长)

- [ ] **Step 1: 写失败测试**:`aggregateBlinds(rows, userId)` 统计该 userId 作为 flasher 致盲的敌方人数与总致盲秒数(只算 `flashedSide !== flasherSide`)。
- [ ] **Step 2-4: 跑失败→实现→跑通。**
- [ ] **Step 5: 组件**:utility damage / 每回合 utility / 致盲敌人数 / 致盲时长。
- [ ] **Step 6: 提交** `git commit -m "feat: 选手页 utility 贡献"`

---

## Part C — 数据面板 `[seasonSlug]/stats`

> 共用前提:新增 `src/actions/season-demo-stats.ts`,聚合赛季内 `active_stat_source='demo_import'` 的 demo 数据。

### Task 16: 进阶榜单(C1)

**Files:**
- Modify: `src/actions/season-demo-stats.ts`、`src/components/matches/StatsLeaderboard.tsx`、`src/app/[seasonSlug]/stats/page.tsx`

- [ ] **Step 1: 聚合**:赛季内按 userId 汇总 KAST、ADR、首杀、残局胜率、utility/round,产出可排序榜单数据。
- [ ] **Step 2: UI**:`StatsLeaderboard` 增加 KAST/ADR/首杀/残局/utility 排序列(沿用现有 sort 机制);仅在赛季有 demo 数据时显示这些列。
- [ ] **Step 3: 手动验证 + 提交** `git commit -m "feat: 数据面板进阶榜单"`

### Task 17: 武器/AWP 击杀榜(C2)

**Files:**
- Create: `src/components/matches/WeaponLeaderboard.tsx`
- Modify: `src/actions/season-demo-stats.ts`

- [ ] **Step 1: 聚合** `demoKills` 按 userId + weapon;单列 AWP 榜(weapon='awp')与总击杀武器分布。
- [ ] **Step 2: UI + 手动验证 + 提交** `git commit -m "feat: 武器/AWP 击杀榜"`

### Task 18: 高光榜(C3 — collateral/wallbang/noscope)

**Files:**
- Create: `src/components/matches/HighlightLeaderboard.tsx`

- [ ] **Step 1: 用 `demoPlayerStats` 的 collateralKillCount/wallbangKillCount/noScopeKillCount** 按 userId 赛季汇总,三个趣味榜。
- [ ] **Step 2: UI + 提交** `git commit -m "feat: 集火/穿墙/盲狙高光榜"`

> 名词:**collateral** = 一枪穿透击杀 ≥2 人;**wallbang** = 穿墙击杀;**noscope** = 狙击未开镜击杀。

### Task 19: 经济转化率(C4)

**Files:**
- Create: `src/lib/demo/economy-conversion.ts` + `.test.ts`
- Create: `src/components/matches/EconomyConversionPanel.tsx`

- [ ] **Step 1: 写失败测试**

```typescript
// src/lib/demo/economy-conversion.test.ts
import { describe, it, expect } from "vitest";
import { economyConversion } from "./economy-conversion";

it("按经济类型统计某队回合胜率", () => {
  const rounds = [
    { teamKey: "teamA", economy: "full", won: true },
    { teamKey: "teamA", economy: "full", won: false },
    { teamKey: "teamA", economy: "eco", won: true },
  ];
  const r = economyConversion(rounds);
  expect(r.full).toEqual({ played: 2, won: 1, winRate: 0.5 });
  expect(r.eco).toEqual({ played: 1, won: 1, winRate: 1 });
});
```

- [ ] **Step 2: 跑确认失败** → FAIL
- [ ] **Step 3: 实现** `economyConversion`:把 `demo_rounds` 展开为「队伍-回合-经济类型-是否赢」(用 teamAEconomy/teamBEconomy + winnerTeamKey 推导),按 economy type 分组算 played/won/winRate。**经济类型字符串以 Insight 实际口径为准**(handoff「需要对齐」第 2 项),函数对任意字符串分组,不硬编码取值。
- [ ] **Step 4: 跑确认通过** → PASS
- [ ] **Step 5: 组件**:展示满 buy / force / eco 各胜率("以弱胜强"=低经济局胜率)。
- [ ] **Step 6: 提交** `git commit -m "feat: 经济转化率分析"`

---

## Part D — 队伍页 `teams/[teamId]`

> 共用前提:新增 `src/actions/team-demo-stats.ts`,按队伍成员 userId 集合聚合 demo 数据(限 `active_stat_source='demo_import'`)。

### Task 20: 队伍风格画像(D1)

**Files:**
- Create: `src/components/teams/TeamStyleProfile.tsx`
- Create: `src/actions/team-demo-stats.ts`

- [ ] **Step 1: 聚合**:队伍开局倾向(firstKill 率)、残局能力(vN 胜率合计)、经济转化(复用 Task 19 的 `economyConversion`,按该队比赛的 rounds)。
- [ ] **Step 2: 组件**:画像卡片(开局/残局/经济三维概述)。
- [ ] **Step 3: 手动验证 + 提交** `git commit -m "feat: 队伍风格画像"`

### Task 21: T/CT 半场强弱(D2)

**Files:**
- Create: `src/lib/demo/halfside-winrate.ts` + `.test.ts`
- Create: `src/components/teams/TeamHalfSideStats.tsx`

- [ ] **Step 1: 写失败测试**

```typescript
// src/lib/demo/halfside-winrate.test.ts
import { describe, it, expect } from "vitest";
import { halfSideWinRate } from "./halfside-winrate";

it("统计某队 T/CT 半场胜率", () => {
  const rounds = [
    { teamSide: "ct", won: true },
    { teamSide: "ct", won: false },
    { teamSide: "t", won: true },
  ];
  const r = halfSideWinRate(rounds);
  expect(r.ct).toEqual({ played: 2, won: 1, winRate: 0.5 });
  expect(r.t).toEqual({ played: 1, won: 1, winRate: 1 });
});
```

- [ ] **Step 2: 跑确认失败** → FAIL
- [ ] **Step 3: 实现** `halfSideWinRate`:从 `demo_rounds` 推导该队每回合 side(teamASide/teamBSide)与是否赢(winnerSide==该队 side),按 t/ct 分组算胜率。
- [ ] **Step 4: 跑确认通过** → PASS
- [ ] **Step 5: 组件 + 接线 teams 页 + 提交** `git commit -m "feat: 队伍 T/CT 半场强弱"`

---

## Self-Review

- **覆盖:** Part A 基础(Task1–6)+ A1/A2/A3(Task7–9);Part B 选手页 B1–B6(Task10–15);Part C 数据面板 C1–C4(Task16–19);Part D 队伍页 D1/D2(Task20–21)。✅
- **类型一致:** `Vec3`、`MapCalibration`、`worldToPixel` 全程统一;`DemoHeatmap` 在比赛页与选手页复用;`economyConversion` 在 C4 与 D1 复用。✅
- **来源一致:** 所有跨场聚合(B/C/D)均限定 `active_stat_source='demo_import'`(契约 E),不与 OCR 混算。✅
- **范围:** 仅静态可视化,2D 动态回放未纳入(符合「不急」决策);A5 由 Task4 热力图覆盖。✅

## 完成后维护

- 更新 `docs/code-map.md`(4 个新组件 + 2 个 lib);跑 `zsh scripts/check-claude-md.sh`。
- 补更多地图标定时,只需往 `CALIBRATIONS` 加条目 + 放 radar 图。

## 未来扩展(本期不做,记录备查)

- **2D 动态回放**:需 Insight 导出 `raw/` 全 tick 位置;用 `demoPositions`(每秒帧)可先做低帧版,流畅版需 raw。单开计划。
- **道具轨迹动画 / 残局复盘**:基于 grenades/clutches + positions。
- **跨地图/赛季热区聚合**:多 demo 点集叠加。
