# advance → advanceTiers 迁移实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** 将 `StageConfig.advance: number` 替换为 `advanceTiers: AdvanceTier[]`，同步更新类型、Zod 校验、migration SQL、预设、所有消费端代码。采用"代码优先兼容 → migration 收尾"策略。

**Architecture:** `StageConfig` 是配置入口点，`normalizeStagePlan` 作为兼容层同时读取新旧格式。改动沿 `types → Zod → 消费端 → preset → migration` 顺序。

**Tech Stack:** TypeScript strict, Drizzle ORM, Zod, PostgreSQL JSONB

---

### 前置：blast radius

只有 4 处引用 `advance`：
```
src/types/season.ts:23       StageConfig.advance 定义
src/types/season.ts:92-93    RIVALS_STAGE_PLAN 预设
src/actions/seasons.ts:24    Zod advance 校验
src/lib/formats/round-robin.ts:90  getQualifiers 消费
```

---

### Task 1: 定义 `AdvanceTier` 类型 + 扩展 `StageConfig`

**Files:**
- Modify: `src/types/season.ts`

**内容：**

```typescript
// 新增类型
export interface AdvanceTier {
  placement: string;
  count: number;
  targetRound?: string;
}

// StageConfig 变更
export interface StageConfig {
  key: string;
  name: string;
  type: StageType;
  teamCount: number;
  advanceTiers: AdvanceTier[];       // 替换 advance: number
  groupCount?: number;               // 新增
  matchFormat?: "bo1" | "bo3" | "bo5"; // 新增
  hasThirdPlaceMatch?: boolean;      // 新增
  seeds?: number[];
}
```

**兼容层** — 在 `normalizeStagePlan` 中添加 `advance` → `advanceTiers` 自动转换：
```typescript
export function normalizeStagePlan(stagePlan: StagePlan | null | undefined): StagePlan {
  const plan = stagePlan ?? RIVALS_STAGE_PLAN;
  return plan.map((stage) => {
    if ((stage as any).advance !== undefined && !stage.advanceTiers) {
      return {
        ...stage,
        advanceTiers: [{ placement: "*", count: (stage as any).advance }],
      };
    }
    return stage;
  });
}
```

---

### Task 2: 更新 Zod schema

**Files:**
- Modify: `src/actions/seasons.ts`

将 `advance` 校验替换为 `advanceTiers`:
```typescript
// 替换前
advance: z.number().int().min(0).max(128),

// 替换后
advanceTiers: z.array(z.object({
  placement: z.string(),
  count: z.number().int().min(1),
  targetRound: z.string().optional(),
})),
```

同时检查 `stagePlan` 字段的 Zod 校验是否需要同步更新 groupCount / matchFormat / hasThirdPlaceMatch。

---

### Task 3: 更新预设

**Files:**
- Modify: `src/types/season.ts`

`RIVALS_STAGE_PLAN` 用 `advanceTiers` 改写：
```typescript
export const RIVALS_STAGE_PLAN: StagePlan = [
  {
    key: "qualifier", name: "排位赛", type: "round_robin", teamCount: 8,
    advanceTiers: [{ placement: "*", count: 8 }],
    matchFormat: "bo1",
  },
  {
    key: "playoff", name: "正赛", type: "double_elim", teamCount: 8,
    advanceTiers: [{ placement: "1st", count: 1 }],
    matchFormat: "bo3",
  },
];
```

---

### Task 4: 更新消费端

**Files:**
- Modify: `src/lib/formats/round-robin.ts`

```typescript
// 替换前
const advanceCount = config.advance;

// 替换后
const advanceCount = config.advanceTiers.reduce((sum, t) => sum + t.count, 0);
```

同时更新 Swiss executor 的 `getQualifiers`（如果需要读 advanceCount 的话，当前 Swiss 用 `status === "advanced"` 过滤所以不依赖 `advance` 字段）。

---

### Task 5: 编写 migration SQL

**Files:**
- Create: `drizzle/migrations/0007_advance_to_advance_tiers.sql`

按设计文档 §8.1 的 SQL：
```sql
UPDATE seasons
SET stage_plan = (
  SELECT jsonb_agg(elem_clean ORDER BY idx)
  FROM (
    SELECT
      idx,
      CASE
        WHEN elem->>'advance' IS NOT NULL THEN
          elem - 'advance' || jsonb_build_object(
            'advanceTiers', jsonb_build_array(
              jsonb_build_object('placement', '*', 'count', (elem->>'advance')::int)
            )
          )
        ELSE elem
      END AS elem_clean
    FROM jsonb_array_elements(stage_plan) WITH ORDINALITY AS t(elem, idx)
  ) sub
)
WHERE stage_plan IS NOT NULL AND jsonb_typeof(stage_plan) = 'array';
```

使用 `WITH ORDINALITY` + `ORDER BY idx` 保证阶段顺序。

---

### Task 6: 全局类型检查 + 测试

```bash
pnpm tsc --noEmit   # 预期 0 errors
pnpm test --run     # 预期全部通过
```

---

### 部署顺序（来自设计文档 §8.1）

1. **先部署代码**（Task 1-4）— 代码通过 `normalizeStagePlan` 兼容层同时读 `advance` 和 `advanceTiers`
2. **确认线上正常** — 至少一个部署窗口
3. **再跑 migration**（Task 5）— 删除 DB 中的旧 `advance` 字段
4. **后续清理**（follow-up）— 移除 `normalizeStagePlan` 中的兼容代码

---

## 剩余未完成项执行顺序

> 来源：`docs/superpowers/specs/2026-05-10-stage-framework-v2-design.md` 改动清单

### Batch B: `entry_round` 列 + Single elim 独立实现

| # | 内容 | 文件 | 优先级 |
|---|------|------|--------|
| B1 | `matches.entry_round` 列 + check constraint（`round_of_32`/`round_of_16`/`quarterfinal`/`semifinal`/`final`/`third_place`） | schema + migration | P0 |
| B2 | Single elim executor 独立实现 — 支持 bye（`targetRound` 跳过）+ 季军赛（`hasThirdPlaceMatch`） | `src/lib/formats/single-elim.ts` | P0 |

### Batch C: 阶段衔接打通

| # | 内容 | 文件 | 优先级 |
|---|------|------|--------|
| C1 | `initializeStage` 泛化 — 调用 `prevExecutor.getQualifiers()` → 传入当前 executor | `src/actions/matches.ts` | P0 |
| C2 | double-elim / single-elim `getQualifiers` 完整实现（当前返回 `[]`） | `double-elim.ts` / `single-elim.ts` | P1 |

### Batch D: GSL executor

| # | 内容 | 文件 | 优先级 |
|---|------|------|--------|
| D1 | GSL 组 executor — 蛇形分配 + 确定性对阵 + 分层晋级（`placement: "1st"/"2nd"/"3rd"`） | `src/lib/formats/gsl-group.ts`（新建） | P0 |

### Batch E: 收尾清理

| # | 内容 | 文件 | 优先级 |
|---|------|------|--------|
| E1 | Admin SeasonForm 预设 UI 更新 | `src/components/admin/SeasonForm.tsx` | P1 |
| E2 | 移除 `normalizeStagePlan` 中的 `advance` 兼容逻辑 | `src/types/season.ts` | P2 |
| E3 | 种子轮空（高位种子从后续阶段进入，Major Stage 2/3） | 多文件 | P2 |

### 依赖图

```
Batch A (已完) ──→ Batch B ──→ Batch C
                      │            │
                      │            └──→ Batch D 可并行
                      │
                      └──→ Batch E（可随时做）
```
