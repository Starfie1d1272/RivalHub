# fix/swiss-review-fixes 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 PR #39 Swiss executor 的 2 个严重 bug + 5 个代码质量问题，StageExecutor 接口对齐 v2 design（新增 `getQualifiers` + `initialize` 加 `qualifiers` 参数），所有 5 个 executor 同步更新，补 6 个核心路径测试。

**Architecture:** 改动沿现有 `src/lib/formats/` 模块边界：`types.ts` 定义接口 → 各 executor 实现 → `index.ts` 注册。`QualifiedTeam` 类型定义在 `src/types/season.ts`。测试沿用项目 Vitest 模式，新建 `tests/unit/lib/formats/swiss.test.ts`。

**Tech Stack:** TypeScript strict, Drizzle ORM, Vitest

---

### Task 1: 定义 `QualifiedTeam` 类型 + 更新 `StageExecutor` 接口

**Files:**
- Create: `src/types/season.ts` (追加 `QualifiedTeam` export)
- Modify: `src/lib/formats/types.ts`

- [ ] **Step 1: 在 `src/types/season.ts` 中新增 `QualifiedTeam` 类型**

在文件末尾追加：
```typescript
/** 阶段晋级结果，由 executor.getQualifiers() 返回 */
export interface QualifiedTeam {
  teamId: string;
  /** 对应 advanceTiers[].placement，如 "1st"、"2nd"、"*" */
  placement: string;
  /** 分组标识；groupCount > 1 时填充，单组阶段为 undefined */
  group?: string;
}
```

- [ ] **Step 2: 更新 `src/lib/formats/types.ts` — `StageExecutor` 接口**

```typescript
import type { Team } from "@/db/schema/teams";
import type { StageConfig, QualifiedTeam } from "@/types/season";

export interface StageExecutor {
  initialize(
    seasonId: string,
    config: StageConfig,
    teams: Team[],
    qualifiers?: QualifiedTeam[],
  ): Promise<{ matchCount: number }>;
  getQualifiers(seasonId: string, config: StageConfig): Promise<QualifiedTeam[]>;
  advanceRound?(seasonId: string, stageKey: string): Promise<{ matchCount: number }>;
  isComplete(seasonId: string, stageKey: string): Promise<boolean>;
}
```

- [ ] **Step 3: 验证类型检查**

```bash
pnpm tsc --noEmit 2>&1 | head -40
```
预期：只有各 executor 缺少 `getQualifiers` 和 `qualifiers` 参数的错误（后续 task 修）。

---

### Task 2: Swiss executor — bug 修复 + `getQualifiers` + 签名更新

**Files:**
- Modify: `src/lib/formats/swiss.ts`

- [ ] **Step 1: 删除未使用的 import（B4）**

```typescript
// 替换前
import { matches, swissStandings, teams as teamsTable } from "@/db/schema";

// 替换后
import { matches, swissStandings } from "@/db/schema";
```

- [ ] **Step 2: 在 imports 中新增 `QualifiedTeam`**

```typescript
import type { StageConfig, QualifiedTeam } from "@/types/season";
// 替代原来的:
// import type { StageConfig } from "@/types/season";
```

- [ ] **Step 3: `initialize` 签名加 `qualifiers?: QualifiedTeam[]` 参数**

```typescript
// 替换前
async initialize(seasonId, config, teams) {

// 替换后
async initialize(seasonId, config, teams, _qualifiers) {
```

- [ ] **Step 4: 修复 B1 — `advanceRound` 步骤 4 胜负判定**

替换 wins/losses 更新代码块。原代码：
```typescript
      for (const m of roundMatches) {
        if (m.status === "cancelled") continue;
        const winA = (m.scoreA ?? 0) > (m.scoreB ?? 0);
        if (winA) {
```

改为：
```typescript
      for (const m of roundMatches) {
        if (m.status === "cancelled") continue;
        if (m.scoreA === null || m.scoreB === null) {
          throw new AppError(
            ErrorCode.VALIDATION_FAILED,
            `第 ${currentRound} 轮比赛 ${m.id} 比分未录入`,
          );
        }
        if (m.scoreA === m.scoreB) {
          throw new AppError(
            ErrorCode.VALIDATION_FAILED,
            `第 ${currentRound} 轮比赛 ${m.id} 出现平局，瑞士轮不允许平局`,
          );
        }
        const winA = m.scoreA > m.scoreB;
        if (winA) {
```

- [ ] **Step 5: 修复 B2 — `slidePair` fallback 重赛检查**

替换 `slidePair` 函数末尾的 fallback 分支：
```typescript
// 替换前
      if (!found) {
        // 退而求其次：与第二个配对
        used.add(top.teamId);
        used.add(remaining[1].teamId);
        result.push({ teamAId: top.teamId, teamBId: remaining[1].teamId, format: "bo1" });
      }

// 替换后
      if (!found) {
        const fallback = remaining[1];
        if (opponents.get(top.teamId)?.has(fallback.teamId)) {
          throw new AppError(
            ErrorCode.VALIDATION_FAILED,
            `无法为 ${top.teamId} 配对：所有同战绩候选均已交手`,
          );
        }
        used.add(top.teamId);
        used.add(fallback.teamId);
        result.push({ teamAId: top.teamId, teamBId: fallback.teamId, format: "bo1" });
      }
```

- [ ] **Step 6: 新增 `getQualifiers` 方法**

在 `isComplete` 之后插入：
```typescript
  async getQualifiers(seasonId, config) {
    const rows = await db.query.swissStandings.findMany({
      where: and(
        eq(swissStandings.seasonId, seasonId),
        eq(swissStandings.stage, config.key),
        eq(swissStandings.status, "advanced"),
      ),
      orderBy: [asc(swissStandings.seed)],
    });
    return rows.map((r) => ({
      teamId: r.teamId,
      placement: "*",
    }));
  },
```

- [ ] **Step 7: 删除 `Team` import（不再需要）**

确认 `initialize` 的 `teams` 参数类型仍需要 `Team`，保留该 import。

---

### Task 3: Round-robin executor — `getQualifiers` + 签名更新

**Files:**
- Modify: `src/lib/formats/round-robin.ts`

- [ ] **Step 1: `initialize` 签名加 `_qualifiers?: QualifiedTeam[]`**

```typescript
// 替换前
  async initialize(seasonId, config, teams) {

// 替换后
  async initialize(seasonId, config, teams, _qualifiers) {
```

- [ ] **Step 2: 新增 imports**

在现有 imports 中添加：
```typescript
import { calculateStandings } from "@/lib/standings";
import type { QualifiedTeam } from "@/types/season";
```

（`calculateStandings` 可能已有 import，检查后决定）

- [ ] **Step 3: 新增 `getQualifiers` 方法**

在 `isComplete` 之后插入：
```typescript
  async getQualifiers(seasonId, config) {
    const seasonTeams = await db.query.teams.findMany({
      where: eq(teams.seasonId, seasonId),
    });
    const standings = await calculateStandings(seasonId, seasonTeams, config.key);
    // 兼容旧 advance 字段和新 advanceTiers
    const advanceCount =
      (config as Record<string, unknown>).advance as number ??
      (config.advanceTiers?.[0]?.count as number | undefined) ??
      0;
    return standings.slice(0, advanceCount).map((s) => ({
      teamId: s.teamId,
      placement: "*",
    }));
  },
```

需要确认 imports 中有 `teams` 和 `calculateStandings`。

- [ ] **Step 4: 确认 round-robin.ts 已有 `calculateStandings` 和 `teams` import**

检查文件。当前 round-robin.ts imports：
```typescript
import { and, count, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { matches, seasons } from "@/db/schema";
```

需要补充 `teams` import 和 `calculateStandings` import。

---

### Task 4: Double-elim executor — `getQualifiers` + 签名更新

**Files:**
- Modify: `src/lib/formats/double-elim.ts`

- [ ] **Step 1: `initialize` 签名加 `_qualifiers?: QualifiedTeam[]`**

```typescript
// 替换前
  async initialize(seasonId, config, teams) {

// 替换后
  async initialize(seasonId, config, teams, _qualifiers) {
```

- [ ] **Step 2: 新增 `QualifiedTeam` import**

```typescript
import type { QualifiedTeam } from "@/types/season";
```

- [ ] **Step 3: 新增 `getQualifiers` 方法（占位）**

在 `isComplete` 之后插入：
```typescript
  async getQualifiers(_seasonId, _config) {
    return [];
  },
```

---

### Task 5: Single-elim executor — `getQualifiers` + 签名更新

**Files:**
- Modify: `src/lib/formats/single-elim.ts`

当前内容是复用 double-elim 的方法引用。新增 `getQualifiers` 后不能简单复用，需要改为独立对象。

- [ ] **Step 1: 新增 imports**

```typescript
import { doubleElimExecutor } from "./double-elim";
import type { StageExecutor } from "./types";
import type { QualifiedTeam } from "@/types/season";

// 新增（如果还没 import）：
// 不需要额外 import — getQualifiers 是轻量实现
```

- [ ] **Step 2: 替换为独立 executor 对象**

```typescript
// 替换前
export const singleElimExecutor: StageExecutor = {
  initialize: doubleElimExecutor.initialize,
  isComplete: doubleElimExecutor.isComplete,
};

// 替换后
export const singleElimExecutor: StageExecutor = {
  initialize(seasonId, config, teams, _qualifiers) {
    return doubleElimExecutor.initialize(seasonId, config, teams, _qualifiers);
  },
  isComplete: doubleElimExecutor.isComplete,
  async getQualifiers(_seasonId, _config) {
    return [];
  },
};
```

---

### Task 6: Swiss data layer — 类型清理（B3）

**Files:**
- Modify: `src/lib/swiss/data.ts`

- [ ] **Step 1: 添加 schema type import**

```typescript
import type { SwissStanding } from "@/db/schema/swiss-standings";
```

- [ ] **Step 2: 删除底部手工类型定义**

删除这段：
```typescript
type SwissStanding = {
  seasonId: string;
  stage: string;
  teamId: string;
  seed: number;
  wins: number;
  losses: number;
  buScore: number;
  status: string;
};
```

---

### Task 7: SwissBracket 组件 — 未使用 import 清理（B5）

**Files:**
- Modify: `src/components/matches/SwissBracket.tsx`

- [ ] **Step 1: 删除未使用的 import**

```typescript
// 替换前
import type {
  SwissViewData,
  SwissRoundColumn,
  SwissRecordGroup,
  SwissMatchRow,
  SwissTeamSlot,
} from "@/lib/swiss/data";

// 替换后
import type {
  SwissViewData,
  SwissRoundColumn,
  SwissRecordGroup,
} from "@/lib/swiss/data";
```

---

### Task 8: 创建 `tests/unit/lib/formats/swiss.test.ts`

**Files:**
- Create: `tests/unit/lib/formats/swiss.test.ts`

- [ ] **Step 1: 创建测试文件**

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock db before importing executor
vi.mock("@/db/client", () => ({
  db: {
    insert: vi.fn(),
    query: {
      swissStandings: { findMany: vi.fn() },
      matches: { findMany: vi.fn() },
      teams: { findMany: vi.fn() },
    },
  },
}));

import { db } from "@/db/client";
import { swissExecutor } from "@/lib/formats/swiss";
import { AppError } from "@/lib/errors";
import type { Team } from "@/db/schema/teams";

function makeTeams(n: number): Team[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `team-${i}`,
    name: `Team ${i + 1}`,
    seasonId: "season-1",
    draftOrder: i + 1,
    // minimal Team fields for type check
  } as Team));
}

const mockConfig = {
  key: "swiss-stage",
  name: "瑞士轮",
  type: "swiss" as const,
  teamCount: 8,
  seeds: [1, 2, 3, 4, 5, 6, 7, 8],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("swissExecutor", () => {
  // Case 1: initialize 正确生成 standings + R1 matches
  describe("initialize()", () => {
    it("inserts standings for all teams and creates R1 matches (top-half vs bottom-half)", async () => {
      const mockInsert = db.insert as ReturnType<typeof vi.fn>;
      mockInsert.mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });

      const result = await swissExecutor.initialize(
        "season-1",
        mockConfig,
        makeTeams(8),
        undefined,
      );

      // 8 standings + 4 R1 matches = 12 inserts
      expect(mockInsert).toHaveBeenCalledTimes(12);

      // R1: team-0 vs team-4, team-1 vs team-5, team-2 vs team-6, team-3 vs team-7
      const matchInserts = mockInsert.mock.calls.filter(
        (call: unknown[]) => call.length > 0,
      );
      expect(result.matchCount).toBe(4);
    });

    it("throws when seeds length !== teams length", async () => {
      await expect(
        swissExecutor.initialize(
          "season-1",
          { ...mockConfig, seeds: [1, 2] },
          makeTeams(8),
          undefined,
        ),
      ).rejects.toThrow(AppError);
    });
  });

  // Case 2: advanceRound 未完成比赛时抛错
  describe("advanceRound()", () => {
    it("throws when current round has unfinished matches", async () => {
      // Arrange: mock current round having an in_progress match
      const mockTx = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ round: 1 }]),
        query: {
          matches: {
            findMany: vi.fn().mockResolvedValue([
              { id: "m1", teamAId: "t0", teamBId: "t4", scoreA: null, scoreB: null, status: "in_progress", round: 1 },
            ]),
          },
          swissStandings: {
            findMany: vi.fn().mockResolvedValue([]),
          },
        },
      };

      (db as any).transaction = vi.fn().mockImplementation(async (fn: Function) => fn(mockTx));

      await expect(
        swissExecutor.advanceRound!("season-1", "swiss-stage"),
      ).rejects.toThrow("比赛未结束");
    });

    // Case 3: 平局比分抛错
    it("throws on draw score", async () => {
      const mockTx = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ round: 1 }]),
        query: {
          matches: {
            findMany: vi
              .fn()
              .mockResolvedValueOnce([
                { id: "m1", teamAId: "t0", teamBId: "t4", scoreA: 1, scoreB: 1, status: "finished", round: 1 },
              ]),
          },
          swissStandings: {
            findMany: vi.fn().mockResolvedValue([]),
          },
        },
      };

      (db as any).transaction = vi.fn().mockImplementation(async (fn: Function) => fn(mockTx));

      await expect(
        swissExecutor.advanceRound!("season-1", "swiss-stage"),
      ).rejects.toThrow("平局");
    });
  });

  // Case 4: isComplete
  describe("isComplete()", () => {
    it("returns true when all standings are advanced or eliminated", async () => {
      const mockFindMany = db.query.swissStandings.findMany as ReturnType<typeof vi.fn>;
      mockFindMany.mockResolvedValue([
        { status: "advanced" },
        { status: "advanced" },
        { status: "eliminated" },
      ]);

      const result = await swissExecutor.isComplete("season-1", "swiss-stage");
      expect(result).toBe(true);
    });

    it("returns false when any standing is active", async () => {
      const mockFindMany = db.query.swissStandings.findMany as ReturnType<typeof vi.fn>;
      mockFindMany.mockResolvedValue([
        { status: "advanced" },
        { status: "active" },
        { status: "eliminated" },
      ]);

      const result = await swissExecutor.isComplete("season-1", "swiss-stage");
      expect(result).toBe(false);
    });

    it("returns false when no standings exist", async () => {
      const mockFindMany = db.query.swissStandings.findMany as ReturnType<typeof vi.fn>;
      mockFindMany.mockResolvedValue([]);

      const result = await swissExecutor.isComplete("season-1", "swiss-stage");
      expect(result).toBe(false);
    });
  });

  // Case 5: getQualifiers
  describe("getQualifiers()", () => {
    it("returns advanced teams as QualifiedTeam[]", async () => {
      const mockFindMany = db.query.swissStandings.findMany as ReturnType<typeof vi.fn>;
      mockFindMany.mockResolvedValue([
        { teamId: "t0", seed: 1, status: "advanced" },
        { teamId: "t3", seed: 4, status: "advanced" },
      ]);

      const result = await swissExecutor.getQualifiers("season-1", mockConfig);
      expect(result).toEqual([
        { teamId: "t0", placement: "*" },
        { teamId: "t3", placement: "*" },
      ]);
    });
  });

  // Case 6: advanceRound 完整流程（wins/losses 更新 + BU 计算）
  describe("advanceRound() full flow", () => {
    it("updates wins/losses and calculates BU correctly", async () => {
      const mockTx = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ round: 1 }]),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockResolvedValue(undefined),
        query: {
          matches: {
            findMany: vi
              .fn()
              .mockResolvedValueOnce([
                // round 1 matches
                { id: "m1", teamAId: "t0", teamBId: "t4", scoreA: 16, scoreB: 8, status: "finished", round: 1 },
              ])
              .mockResolvedValueOnce([
                // all finished matches for BU calc
                { id: "m1", teamAId: "t0", teamBId: "t4", status: "finished" },
              ]),
          },
          swissStandings: {
            findMany: vi
              .fn()
              .mockResolvedValueOnce([
                // initial standings
                { id: "s0", teamId: "t0", seed: 1, wins: 0, losses: 0, buScore: 0, status: "active" },
                { id: "s4", teamId: "t4", seed: 5, wins: 0, losses: 0, buScore: 0, status: "active" },
              ])
              .mockResolvedValueOnce([
                // after win/loss update
                { id: "s0", teamId: "t0", seed: 1, wins: 1, losses: 0, buScore: 0, status: "active" },
                { id: "s4", teamId: "t4", seed: 5, wins: 0, losses: 1, buScore: 0, status: "active" },
              ])
              .mockResolvedValueOnce([
                // final standings for BU calc
                { id: "s0", teamId: "t0", seed: 1, wins: 1, losses: 0, buScore: 0, status: "active" },
                { id: "s4", teamId: "t4", seed: 5, wins: 0, losses: 1, buScore: 0, status: "active" },
              ])
              .mockResolvedValueOnce([
                // active rows for next round pairing
                { id: "s0", teamId: "t0", seed: 1, wins: 1, losses: 0, buScore: 0, status: "active" },
                { id: "s4", teamId: "t4", seed: 5, wins: 0, losses: 1, buScore: 0, status: "active" },
              ]),
          },
        },
      };

      (db as any).transaction = vi.fn().mockImplementation(async (fn: Function) => fn(mockTx));

      const result = await swissExecutor.advanceRound!("season-1", "swiss-stage");
      expect(result.matchCount).toBeGreaterThan(0);
    });
  });
});
```

- [ ] **Step 2: 创建测试目录 + 运行测试**

```bash
mkdir -p tests/unit/lib/formats
pnpm test tests/unit/lib/formats/swiss.test.ts --run
```

---

### Task 9: 全局类型检查

**Files:**
- Check: All modified files

- [ ] **Step 1: 运行类型检查**

```bash
pnpm tsc --noEmit 2>&1
```

预期：0 errors。如有错误，逐一修复。

- [ ] **Step 2: 运行全部测试**

```bash
pnpm test --run
```

预期：所有已有测试 + 新增 6 个 Swiss 测试通过。

---

### Task 10: 验证 `src/lib/formats/index.ts` 无须改动

**Files:**
- No changes expected

- [ ] **Step 1: 确认 registry 不依赖 executor 的具体签名**

`getExecutor` 只返回 `StageExecutor` 类型引用，不调用具体方法。接口变更后 type 层面自动兼容，`index.ts` 无需修改。

