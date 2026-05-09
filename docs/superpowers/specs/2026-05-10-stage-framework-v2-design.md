# StageExecutor 框架 v2 扩展设计

**日期**：2026-05-10
**前置调研**：`2026-05-10-cs2-tournament-format-survey.md`
**依赖**：`2026-05-08-swiss-tournament-design.md`（Swiss 算法细节）

---

## 一、背景

当前 `StageExecutor` 框架（PR #38）只覆盖 Rivals 场景：`round_robin → double_elim`，所有阶段假设均匀晋级（`advance: number`）。

Liquipedia 抓取验证发现，2025-2026 CS2 大赛实际只有 3 种赛制模式，其中 IEM/BLAST 共 7+ 赛事使用 GSL 分组 + 分层晋级，当前框架无法表达。

这篇 spec 定义 v2 框架扩展，将覆盖率从 0%（仅 Rivals）提升到 >90% S-Tier 赛事。

---

## 二、StageConfig 扩展

### 2.1 `advance` → `advanceTiers`

`advance: number` 被 `advanceTiers` 替代。`advanceTiers` 是一个有序数组，描述"什么名次 → 多少人 → 进入下一阶段的哪个入口"：

```typescript
interface AdvanceTier {
  /** 名次标识；"*" = 全部晋级（不分名次，如 Rivals 排位赛后全员进正赛） */
  placement: string;
  /** 该名次的队伍数 */
  count: number;
  /** 进入下一阶段的 bracket 入口轮次；默认 "round_1" */
  targetRound?: string;
}

interface StageConfig {
  key: string;
  name: string;
  type: StageType;
  teamCount: number;
  // 替代 advance
  advanceTiers: AdvanceTier[];
  // 新增字段
  groupCount?: number;
  matchFormat?: "bo1" | "bo3" | "bo5";
  hasThirdPlaceMatch?: boolean;
  seeds?: number[];  // 保持
}
```

### 2.2 新增 `StageType`

```typescript
type StageType = "round_robin" | "double_elim" | "single_elim" | "swiss" | "gsl_group";
```

### 2.3 字段语义

| 字段 | 默认值 | 说明 |
|---|---|---|
| `groupCount` | `1` | 并行组数。>1 时队伍蛇形分配 |
| `matchFormat` | type 推导 | 该阶段默认 BoX。Swiss/Major 由 executor 内部区分 |
| `hasThirdPlaceMatch` | `false` | 季军赛（PGL Astana / ESL PL 使用） |
| `seeds` | `[]` | Swiss 初始种子（1-based 排名），非 Swiss 阶段忽略。例如 16 队 [1,2,...,16] |

### 2.5 `count` 语义

`advanceTiers[].count` 表示**每组**该名次的队伍数。`groupCount > 1` 时总晋级数 = `count × groupCount`。

例如 IEM Rio (`groupCount: 2`)，`{ placement: "1st", count: 1 }` → 2 支队伍（每组 1 支 2-0 队）晋级到 semifinal。

### 2.4 配置示例

**Rivals（等价改写）**：
```json
[
  { "key": "qualifier", "type": "round_robin", "teamCount": 8,
    "advanceTiers": [{ "placement": "*", "count": 8 }],
    "matchFormat": "bo1" },
  { "key": "playoff", "type": "double_elim", "teamCount": 8,
    "advanceTiers": [{ "placement": "1st", "count": 1 }],
    "matchFormat": "bo3" }
]
```

**IEM Rio**：
```json
[
  { "key": "groups", "type": "gsl_group", "teamCount": 16, "groupCount": 2,
    "advanceTiers": [
      { "placement": "1st", "count": 1, "targetRound": "semifinal" },
      { "placement": "2nd", "count": 1, "targetRound": "quarterfinal" },
      { "placement": "3rd", "count": 1, "targetRound": "quarterfinal" }
    ],
    "matchFormat": "bo3" },
  { "key": "playoff", "type": "single_elim", "teamCount": 6,
    "advanceTiers": [{ "placement": "1st", "count": 1 }],
    "matchFormat": "bo3" }
]
```

**PGL Astana（带季军赛）**：
```json
[
  { "key": "swiss", "type": "swiss", "teamCount": 16,
    "advanceTiers": [{ "placement": "*", "count": 8 }],
    "matchFormat": "bo3", "seeds": [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16] },
  { "key": "playoff", "type": "single_elim", "teamCount": 8,
    "advanceTiers": [{ "placement": "1st", "count": 1 }],
    "matchFormat": "bo3", "hasThirdPlaceMatch": true }
]
```

**BLAST Rivals**：
```json
[
  { "key": "groups", "type": "gsl_group", "teamCount": 8, "groupCount": 2,
    "advanceTiers": [
      { "placement": "1st", "count": 1, "targetRound": "semifinal" },
      { "placement": "2nd", "count": 1, "targetRound": "quarterfinal" },
      { "placement": "3rd", "count": 1, "targetRound": "quarterfinal" }
    ],
    "matchFormat": "bo3" },
  { "key": "playoff", "type": "single_elim", "teamCount": 6,
    "advanceTiers": [{ "placement": "1st", "count": 1 }],
    "matchFormat": "bo3" }
]
```

---

## 三、新增 Executor

### 3.1 GSL Group Executor

**接口**：复用 `StageExecutor`，不新增方法。`initialize` 接受 `teams` 和 `config`，检测 `groupCount > 1` 时蛇形分配。

**蛇形分配**（16 队 2 组）：种子 #1→A, #2→B, #3→B, #4→A, #5→A, #6→B, ...

**组内对阵（8 队 GSL，完全确定性，10 场/组）**：
```
Round 1 (4场): 1vs8, 4vs5, 2vs7, 3vs6
Round 2 (2场): W(1/8) vs W(4/5), W(2/7) vs W(3/6) → 2-0 晋级
Round 3 (2场): L(1/8) vs L(4/5), L(2/7) vs L(3/6) → 0-2 淘汰
Round 4 (2场): R2败者 vs R3胜者 ×2 → 2-1 晋级, 1-2 淘汰
```
产出排名：1st (2-0), 2nd (2-1), 3rd (1-2)。

**4 队 GSL**（BLAST Rivals）：每组 5 场，产出 1st/2nd/3rd（三进二）。

**`round` 列**：存 GSL 内轮次号（1-4）。

**不依赖 brackets-manager**——GSL 对阵完全确定性，无需第三方库。

### 3.2 Swiss Executor

详见 `2026-05-08-swiss-tournament-design.md`。框架层面关键行为：

- `initialize`：生成 Round 1，按种子配对（1vs16, 2vs15, …）
- `advanceRound`：每轮完成后管理员触发，按 Buchholz + 种子重新配对（同战绩互碰，避免重复）
- `isComplete`：8 队 3-0/3-1/3-2 晋级 + 8 队 0-3/1-3/2-3 淘汰

**BoX 规则**：默认使用 `config.matchFormat`。Major Stage 1/2 的"Bo1 为主、淘汰/晋级战 Bo3"由 executor 内部判断——该场比赛是否为 elimination/advancement 战。

---

## 四、Single Elim Executor — Bye + 季军赛

`single-elim.ts` 从委托改为独立实现，支持两个新能力：

### 4.1 Bye（轮空）

`initialize` 接收到带 `targetRound` 的队伍列表（来自上一阶段 `advanceTiers`），直通四强的队伍不参与八强轮的 match 生成：

```
teams: [
  { teamId: W_A, targetRound: "semifinal" },
  { teamId: W_B, targetRound: "semifinal" },
  { teamId: RU_A, targetRound: "quarterfinal" },
  { teamId: RU_B, targetRound: "quarterfinal" },
  { teamId: 3rd_A, targetRound: "quarterfinal" },
  { teamId: 3rd_B, targetRound: "quarterfinal" },
]

生成:
  QF1: RU_A vs 3rd_B → winner to SF1
  QF2: RU_B vs 3rd_A → winner to SF2
  SF1: W_A vs QF1 winner
  SF2: W_B vs QF2 winner
  Final: SF1 winner vs SF2 winner
```

### 4.2 季军赛

`config.hasThirdPlaceMatch = true` 时，两场四强赛的败者自动生成一场季军赛。写 `matches` 表时标记 `entry_round: "third_place"`。

### 4.3 `matches.entry_round`

新增列（nullable text），标记该比赛属于 bracket 的哪个入口轮次。有效值：

| 值 | 说明 |
|---|---|
| `quarterfinal` | 八强赛 |
| `semifinal` | 半决赛 |
| `final` | 决赛 |
| `third_place` | 季军赛 |

默认 `null`（普通排位赛 / 无 byes 的淘汰赛）。`targetRound` 和 `entry_round` 使用同一组值。

---

## 五、数据迁移

### 5.1 现有 stagePlan 迁移

migration SQL 将现有 `stage_plan` JSONB 中的 `advance` 转为 `advanceTiers`：

```sql
UPDATE seasons
SET stage_plan = (
  SELECT jsonb_agg(
    CASE
      WHEN elem->>'advance' IS NOT NULL THEN
        elem - 'advance' || jsonb_build_object(
          'advanceTiers', jsonb_build_array(
            jsonb_build_object('placement', '*', 'count', (elem->>'advance')::int)
          )
        )
      ELSE elem
    END
  )
  FROM jsonb_array_elements(stage_plan) elem
)
WHERE stage_plan IS NOT NULL AND jsonb_typeof(stage_plan) = 'array';
```

### 5.2 `matches.entry_round` 列

```sql
ALTER TABLE matches ADD COLUMN entry_round text;
```

---

## 六、预设更新

```typescript
export const RIVALS_STAGE_PLAN: StagePlan = [
  { key: "qualifier", type: "round_robin", teamCount: 8,
    advanceTiers: [{ placement: "*", count: 8 }],
    matchFormat: "bo1" },
  { key: "playoff", type: "double_elim", teamCount: 8,
    advanceTiers: [{ placement: "1st", count: 1 }],
    matchFormat: "bo3" },
];
```

`DRAFT_LEAGUE_PRESET` 和 `OPEN_TOURNAMENT_PRESET` 保持引 `RIVALS_STAGE_PLAN`，无需修改。

Admin SeasonForm 的"Rivals 预设"按钮更新为新的 JSON 结构。

---

## 七、不改动

- `StageExecutor` 接口签名
- `src/lib/bracket/` 适配层
- v1 double_elim executor（Rivals 核心逻辑零改动）
- `generateSchedule` 和 `initializeStage` 的调用方式

---

## 八、改动文件清单

| 文件 | 改动 |
|---|---|
| `src/types/season.ts` | `StageConfig` 扩展；`AdvanceTier` 类型；`StageType` 加 `"gsl_group"`；删 `advance` 字段引用 |
| `src/lib/formats/gsl-group.ts` | 新建，GSL 组 executor |
| `src/lib/formats/swiss.ts` | 新建，Swiss executor |
| `src/lib/formats/single-elim.ts` | 独立实现（bye + 季军赛），不再委托 double-elim |
| `src/lib/formats/index.ts` | 注册表加 gsl_group + swiss |
| `src/actions/matches.ts` | `initializeStage` 改为读取 `advanceTiers`，传递 `targetRound` 给 playoff executor |
| `src/db/schema/matches.ts` | 加 `entry_round` 列 |
| `src/components/admin/SeasonForm.tsx` | 更新预设 JSON |
| `src/lib/utils/season.ts` | `advance` 引用改为 `advanceTiers` |
| migration | `advance` → `advanceTiers` 转换 + `entry_round` 列 |
| `docs/state-machines.md` | `matches.stage` 枚举更新 |
