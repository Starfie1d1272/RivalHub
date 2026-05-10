# StageExecutor 框架 v2 扩展设计

**日期**：2026-05-10
**前置调研**：`2026-05-10-cs2-tournament-format-survey.md`
**依赖**：`2026-05-08-swiss-tournament-design.md`（Swiss 算法细节）

---

## 一、背景

当前 `StageExecutor` 框架（PR #38）只覆盖 Rivals 场景：`round_robin → double_elim`，所有阶段假设均匀晋级（`advance: number`）。

Liquipedia 抓取验证发现（7 个赛事页面），2025-2026 CS2 大赛在采样范围内观察到 3 种主流赛制模式，其中 IEM/BLAST 的 GSL 分组 + 分层晋级当前框架无法表达。

这篇 spec 定义 v2 框架扩展，将覆盖率从 Rivals（1 种赛制）扩展到采样中 7/7 赛事的阶段结构可建模。Major 的种子轮空（高位种子从后续阶段进入）在 v2.5 补全。

---

## 二、抽象原则

在进入具体设计前，明确各概念的职责边界：

| 概念 | 负责 | 不负责 |
|---|---|---|
| **Stage** | 产生比赛、维护 standings、决定 advancement | 不知道整体 tournament structure |
| **Match** | 记录对阵双方、比分、状态 | 不知道自己属于 bracket 的哪个位置 |
| **Advancement** | 描述 placement → downstream entry 的映射 | 不负责 seeding policy |
| **Seed** | 初始顺序 + 阶段内调整 + 阶段间传递 | 不是静态数字，是贯穿赛事的流动状态 |

核心约束：
- `Stage_i` 只知道 `Stage_{i-1}` 的晋级结果（`QualifiedTeam[]`），不知道更早的阶段
- `Match` 行不跨阶段——每场比赛只属于一个 stage
- `AdvanceTier` 是 first-class 配置，不是 `advance: 8` 的语法糖

v2 阶段拓扑：**restricted linear pipeline**——`Stage_i → Stage_{i+1}` 线性推进，允许分层 placement 和 delayed entry（种子轮空），但不允许 branching、merge-back 或 side pipeline。

---

## 三、Seeding 生命周期

种子在赛事全生命周期中的流转：

```
初始种子（VRS / 赛事排名 / 直邀优先级）
  │
  └→ Stage 1 入口配对
        │
        ├→ 阶段内调整（Buchholz / 战绩 / opponent score）
        │
        └→ 阶段间传递 →
              │
              ├→ 下一阶段入口配对
              │     └→ 分层晋级时：placement × group → targetRound
              │
              └→ Playoff 种子方式
                    ├─ fixed bracket：1st-A vs 3rd-B（cross-group，固定）
                    └─ reseed：最高种子 vs 最低种子（当前采样未覆盖）
```

当前采样中所有赛事使用 **fixed bracket**（cross-group 交叉），不需要 dynamic reseed。

---

## 四、StageConfig 扩展

### 4.1 `advance` → `advanceTiers`

`advance: number` 被 `advanceTiers` 替代。`advanceTiers` 是一个有序数组，描述"什么名次 → 多少人 → 进入下一阶段的哪个入口"：

```typescript
interface AdvanceTier {
  /** 名次标识："*" = 全部晋级；"1st"/"2nd"/"3rd" 等 = 分层晋级。
   *  Zod 在 Server Action 端校验有效值，类型层面保持 string 以允许赛事自定义扩展。
   *  当 placement 为 "*" 时，count 必须等于该阶段 teamCount（Zod 校验），表示全员晋级。 */
  placement: string;
  /** 该名次每组晋级队伍数；groupCount > 1 时总晋级数 = count × groupCount */
  count: number;
  /** 进入下一阶段的 bracket 入口轮次；默认 "quarterfinal"（淘汰赛第一轮） */
  targetRound?: string;
}

interface StageConfig {
  key: string;
  name: string;
  type: StageType;
  teamCount: number;
  advanceTiers: AdvanceTier[];
  groupCount?: number;
  matchFormat?: "bo1" | "bo3" | "bo5";
  hasThirdPlaceMatch?: boolean;
  seeds?: number[];
}
```

### 4.2 新增 `StageType`

```typescript
type StageType = "round_robin" | "double_elim" | "single_elim" | "swiss" | "gsl_group";
```

### 4.3 `targetRound` 有效值

与 `matches.entry_round` 共享同一组值：

| 值 | 说明 |
|---|---|
| `round_of_32` | 32 强 |
| `round_of_16` | 16 强 |
| `quarterfinal` | 八强赛 |
| `semifinal` | 半决赛 |
| `final` | 决赛 |
| `third_place` | 季军赛 |

### 4.4 `count` 语义

`advanceTiers[].count` 表示**每组**该名次的队伍数。`groupCount > 1` 时总晋级数 = `count × groupCount`。

例如 IEM Rio (`groupCount: 2`)，`{ placement: "1st", count: 1 }` →每组 1 支 2-0 队，共 2 支晋级到 semifinal。

### 4.5 matchFormat 默认值

| 字段 | 默认值 | 说明 |
|---|---|---|
| `groupCount` | `1` | 并行组数。>1 时队伍蛇形分配 |
| `matchFormat` | 见下表 | 该阶段默认 BoX |

各 executor 默认值：

| Executor | 默认 matchFormat | 说明 |
|---|---|---|
| `round_robin` | `bo1` | 排位赛固定 BO1 |
| `gsl_group` | `bo3` | IEM/BLAST 小组赛全 Bo3 |
| `swiss` | `bo3` | PGL/Major Stage 3 全 Bo3；Major Stage 1/2 executor 内部覆写 |
| `double_elim` | `bo3` | 正赛；决赛可从 BO3 改为 BO5 |
| `single_elim` | `bo3` | 淘汰赛；决赛可从 BO3 改为 BO5 |

### 4.6 字段语义
| `hasThirdPlaceMatch` | `false` | 季军赛（PGL Astana / ESL PL 使用） |
| `seeds` | `[]` | Swiss 初始种子（1-based 排名），非 Swiss 阶段忽略 |

### 4.7 配置示例

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

## 五、阶段间晋级契约（核心新增）

### 5.1 `QualifiedTeam`

每个阶段完成后，executor 产出结构化的晋级结果，作为下一阶段的输入：

```typescript
interface QualifiedTeam {
  teamId: string;
  /** 对应 advanceTiers[].placement，如 "1st"、"2nd"、"3rd"、"*" */
  placement: string;
  /** 分组标识；groupCount > 1 时填充（如 "A"、"B"），单组阶段为 undefined */
  group?: string;
}
```

### 5.2 `StageExecutor` 接口

```typescript
interface StageExecutor {
  /**
   * 初始化阶段，生成该阶段的首批 matches。
   * 晋级结果由 getQualifiers() 在阶段完成后计算，不在 initialize 返回值中。
   *
   * @param qualifiers 上一阶段的晋级结果；首阶段为 undefined
   */
  initialize(
    seasonId: string,
    config: StageConfig,
    teams: Team[],
    qualifiers?: QualifiedTeam[],
  ): Promise<{ matchCount: number }>;

  /**
   * 从已完成的比赛中计算晋级结果。
   * 供 initializeStage 调用，取上一阶段的 QualifiedTeam[] 后传给下一阶段的 initialize。
   */
  getQualifiers(seasonId: string, config: StageConfig): Promise<QualifiedTeam[]>;

  /** 逐轮推进（Swiss 专用；其他 executor 的 initialize 一次性完成） */
  advanceRound?(seasonId: string, stageKey: string): Promise<{ matchCount: number }>;

  /** 该阶段是否已完成（所有 match finished，无 active 参赛方） */
  isComplete(seasonId: string, stageKey: string): Promise<boolean>;
}
```

**相比 v1 的变更**：
- `initialize` 新增 `qualifiers?: QualifiedTeam[]` 参数
- 新增 `getQualifiers` 方法（所有 executor 必须实现）
- 其余签名不变

### 5.3 数据流

```
generateSchedule(seasonId)
  │
  ├─→ getExecutor(stage[0].type).initialize(seasonId, config, teams)
  │     └─ 生成 stage[0] 的 matches，qualifiers 为 undefined
  │
  ⋮ （比赛进行，结果录入）
  │
  └─→ admin 触发 initializeStage(seasonId, stage[1].key)
        │
        ├─→ getExecutor(stage[0].type).getQualifiers(seasonId, stage[0])
        │     └─ GSL: 读 matches 算每组战绩 → [{ teamId, placement: "1st", group: "A" }, ...]
        │     └─ round_robin: 读 standings → [{ teamId, placement: "*" }, ...]
        │     └─ Swiss: 读 matches 计胜负 → [{ teamId, placement: "*" }, ...]
        │
        └─→ getExecutor(stage[1].type).initialize(seasonId, config, teams, qualifiers)
              └─ single_elim: 根据 qualifiers[].placement 映射 targetRound，处理 bye
```

### 5.4 `initializeStage` 泛化

```typescript
export async function initializeStage(seasonId: string, stageKey: string) {
  const season = await getSeasonOrThrow(seasonId);
  // normalizeStagePlan: 解析 JSONB，兼容 advance → advanceTiers 旧格式，返回 StageConfig[]
  const stagePlan = normalizeStagePlan(season.stagePlan);
  const stage = getStageByKey(stagePlan, stageKey);
  const prevStage = getPreviousStage(stagePlan, stageKey);
  const prevExecutor = prevStage ? getExecutor(prevStage.type) : null;
  const executor = getExecutor(stage.type);

  const teams = await getSeasonTeams(seasonId);

  // 从上一阶段计算晋级结果
  const qualifiers = prevExecutor && prevStage
    ? await prevExecutor.getQualifiers(seasonId, prevStage)
    : undefined;

  // 传给当前阶段
  const { matchCount } = await executor.initialize(seasonId, stage, teams, qualifiers);

  // audit...
  return ok({ matchCount });
}
```

---

## 六、新增 Executor

### 6.1 GSL Group Executor

**`initialize`**：`groupCount > 1` 时蛇形分配（种子 #1→A, #2→B, #3→B, #4→A, ...）。组内对阵完全确定性。

**8 队 GSL 组内对阵**（10 场/组）：
```
Round 1 (4场): 1vs8, 4vs5, 2vs7, 3vs6
Round 2 (2场): W(1/8)vsW(4/5), W(2/7)vsW(3/6) → 2-0 晋级
Round 3 (2场): L(1/8)vsL(4/5), L(2/7)vsL(3/6) → 0-2 淘汰
Round 4 (2场): R2败者 vs R3胜者 ×2 → 2-1 晋级, 1-2 淘汰
```
产出排名（gsl_group.placement）：`1st` (2-0), `2nd` (2-1), `3rd` (1-2)。

**4 队 GSL 组内对阵**（BLAST Rivals，5 场/组）：
```
Round 1 (2场): 1vs4, 2vs3
Round 2 (1场): W(1/4)vsW(2/3) → 2-0 晋级
Round 3 (1场): L(1/4)vsL(2/3) → 0-2 淘汰
Round 4 (1场): R2败者 vs R3胜者 → 2-1 晋级, 1-2 淘汰
```
产出排名：`1st` (2-0), `2nd` (2-1), `3rd` (1-2)。结构与 8 队 GSL 完全同构，仅首轮对阵数和队伍数缩减。

**`round` 列**：存 GSL 内轮次号（1-4）。

**`getQualifiers`**：读 `matches` 表，按 `round` 列计每队战绩 → 每组成绩排序 → 返回 `QualifiedTeam[]`（含 `placement` + `group`）。

**不依赖 brackets-manager**——当前采样中 IEM/BLAST 的 GSL 对阵完全确定性。

**扩展性 caveat**：当前 executor 覆盖 ESL-style 标准 GSL（固定对阵）。未来如需支持 cross-group dynamic reseeding（最高种子 vs 最低种子）、rematch avoidance、decider ordering 等变体，应通过 `StageConfig` 扩展参数或新增 executor 变体实现，不重写现有 GSL executor。

### 6.2 Swiss Executor

详见 `2026-05-08-swiss-tournament-design.md`。框架层面关键行为：

- `initialize`：生成 Round 1（按种子配对 1vs16, 2vs15, …）
- `advanceRound`：每轮完成后管理员触发，按 Buchholz + 种子重新配对
- `isComplete`：8 队达成 3 胜 + 8 队达成 3 败
- `getQualifiers`：读 matches 计胜负 → 返回晋级 8 队的 `QualifiedTeam[]`

**BoX 规则**：默认取 `config.matchFormat`；Major Stage 1/2 的"Bo1+淘汰/晋级战 Bo3"由 executor 内部分支。

---

## 七、Single Elim Executor — Bye + 季军赛

`single-elim.ts` 独立实现（不再委托 double-elim）。

### 7.1 Bye（轮空）

`initialize` 接收 `qualifiers: QualifiedTeam[]`，用 `placement` 映射到 `advanceTiers[].targetRound`，直通四强的队伍不参与八强轮 match 生成：

```
qualifiers:
  [{ teamId: W_A, placement: "1st", group: "A" },   → targetRound: "semifinal"
   { teamId: W_B, placement: "1st", group: "B" },   → targetRound: "semifinal"
   { teamId: RU_A, placement: "2nd", group: "A" },  → targetRound: "quarterfinal"
   { teamId: RU_B, placement: "2nd", group: "B" },  → targetRound: "quarterfinal"
   { teamId: 3rd_A, placement: "3rd", group: "A" }, → targetRound: "quarterfinal"
   { teamId: 3rd_B, placement: "3rd", group: "B" }] → targetRound: "quarterfinal"

生成:
  QF1: RU_A(2nd-A) vs 3rd_B(3rd-B) → winner to SF1
  QF2: RU_B(2nd-B) vs 3rd_A(3rd-A) → winner to SF2
  SF1: W_A(1st-A) vs QF1 winner
  SF2: W_B(1st-B) vs QF2 winner
  Final: SF1 winner vs SF2 winner
```

2nd vs 3rd 的跨组交叉配对由 executor 内置。当前 executor 假设 `groupCount ≤ 2`；> 2 组的 cross-group 配对规则需在 v3 扩展。

### 7.1.1 TBD 参赛方策略

`matches.teamAId` / `teamBId` 为 NOT NULL，无法存储"待定"参赛方。
**策略**：`initialize` 只生成双方参赛队均已确定的 matches（如 QF）；SF 在有 TBD 参赛方时不创建行，等 QF 完成后由现有的 bracket 推进逻辑（`recordMatchResult` → `advanceMatch`）自动创建下一轮 match。此行为与当前 v1 `double_elim` executor 的 bracket 推进逻辑一致，无需改 schema。

### 7.2 季军赛

`config.hasThirdPlaceMatch = true` 时，两场半决赛败者自动生成一场季军赛（`entry_round: "third_place"`）。

### 7.3 `matches.entry_round`

新增列，标记该比赛属于 bracket 的哪个入口轮次：

```sql
ALTER TABLE matches ADD COLUMN entry_round text;

ALTER TABLE matches ADD CONSTRAINT matches_entry_round_check
  CHECK (entry_round IN ('round_of_32', 'round_of_16', 'quarterfinal', 'semifinal', 'final', 'third_place'));
```

默认 `null`（排位赛或无 byes 的淘汰赛）。`targetRound` 和 `entry_round` 共享同一值域。

---

## 八、数据迁移

### 8.1 `advance` → `advanceTiers`

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

`WITH ORDINALITY` + `ORDER BY idx` 保证阶段顺序不丢失。

**部署顺序**：先部署代码（代码同时兼容 `advance` 和 `advanceTiers`，优先读 `advanceTiers`，fallback 到 `advance`），确认线上正常后再跑 migration 彻底删除 `advance` 字段。读兼容期至少一个部署窗口，避免读写不一致。

### 8.2 `matches.entry_round` 列

```sql
ALTER TABLE matches ADD COLUMN entry_round text;

ALTER TABLE matches ADD CONSTRAINT matches_entry_round_check
  CHECK (entry_round IN ('round_of_32', 'round_of_16', 'quarterfinal', 'semifinal', 'final', 'third_place'));
```

---

## 九、预设更新

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

`DRAFT_LEAGUE_PRESET` 和 `OPEN_TOURNAMENT_PRESET` 保持引用 `RIVALS_STAGE_PLAN`。

---

## 实现进度

| 文件 | 改动 | 状态 |
|---|---|---|
| `src/lib/formats/types.ts` | `StageExecutor` 接口扩展 | ✅ |
| `src/lib/formats/swiss.ts` | Swiss executor 完整实现 + BO1/BO3 decider 覆写 | ✅ |
| `src/lib/formats/index.ts` | 注册 swiss + gsl_group | ✅ |
| `src/lib/formats/round-robin.ts` | `getQualifiers` + 签名更新 + isStageComplete 共享 | ✅ |
| `src/lib/formats/double-elim.ts` | `getQualifiers` 完整实现（冠军 + 亚军） | ✅ |
| `src/lib/formats/single-elim.ts` | 独立 executor（bye + 季军赛 + entry_round + getQualifiers） | ✅ |
| `src/lib/formats/gsl-group.ts` | 新建 GSL executor（蛇形分配 + 4 轮推进 + getQualifiers） | ✅ |
| `src/lib/formats/_shared.ts` | isStageComplete 共享工具 | ✅ |
| `src/types/season.ts` | `StageConfig` 扩展 + `AdvanceTier` + `QualifiedTeam` + `entrySeeds` + `finalFormat` + `MAJOR_STAGE_PLAN` | ✅ |
| `src/actions/seasons.ts` | Zod schema 更新（gsl_group + entrySeeds + finalFormat） | ✅ |
| `src/db/schema/matches.ts` | `entry_round` 列 | ✅ |
| `src/actions/matches.ts` | `initializeStage` 泛化（getQualifiers 管道 + entrySeeds 合并）+ 事务保护 + finalFormat 解析 | ✅ |
| migration | `0007_advance_to_advance_tiers` + `0008_entry_round` | ✅ |
| `src/components/admin/SeasonForm.tsx` | Major 32 队预设 | ✅ |
| `tests/unit/lib/formats/swiss.test.ts` | 11 tests | ✅ |
| `tests/unit/lib/formats/single-elim.test.ts` | 7 tests | ✅ |
| `tests/unit/lib/formats/gsl-group.test.ts` | 11 tests | ✅ |

---

## 十、改动文件清单

| 文件 | 改动 |
|---|---|
| `src/types/season.ts` | `StageConfig` 扩展（删 `advance`，加 `advanceTiers`/`groupCount`/`matchFormat`/`hasThirdPlaceMatch`）；`AdvanceTier` 类型；`QualifiedTeam` 类型；`StageType` 加 `"gsl_group"` |
| `src/lib/formats/types.ts` | `StageExecutor` 接口扩展（`initialize` 加 `qualifiers` 参数，新增 `getQualifiers` 方法） |
| `src/lib/formats/gsl-group.ts` | 新建，GSL 组 executor |
| `src/lib/formats/swiss.ts` | 新建，Swiss executor |
| `src/lib/formats/single-elim.ts` | 独立实现（bye + 季军赛） |
| `src/lib/formats/round-robin.ts` | 加 `getQualifiers` 实现（读 standings） |
| `src/lib/formats/double-elim.ts` | 加 `getQualifiers` 实现（末尾 stage 时返回冠军队；虽不会被 `initializeStage` 调用，但接口要求统一实现） |
| `src/lib/formats/index.ts` | 注册表加 gsl_group + swiss |
| `src/actions/matches.ts` | `initializeStage` 泛化：调用 `prevExecutor.getQualifiers()` → 传入下一 executor |
| `src/db/schema/matches.ts` | 加 `entry_round` 列 + check constraint |
| `src/components/admin/SeasonForm.tsx` | 更新预设 JSON |
| `src/lib/utils/season.ts` | `advance` 引用改为 `advanceTiers` |
| migration | `advance` → `advanceTiers` 转换 + `entry_round` 列 + constraint |

---

## 十一、v3 演进方向

以下能力当前采样未覆盖、不在 v2 scope，但 reviewer 提出的长期方向值得记录：

| 方向 | 说明 | 触发条件 |
|---|---|---|
| **DAG 化阶段拓扑** | Stage 不再是线性 pipeline，允许分支（如 LCQ side bracket）、合流、多路径晋级 | 出现第一个需要 DAG 的赛事 |
| **Generalized slot-based playoff** | 淘汰赛不硬编码 6/8 队拓扑，而是任意 slot 映射（含 BYE、play-in） | 出现非标准 bracket 规模的赛事 |
| **Seeding policy 插件化** | `seedPolicy` / `tiebreakPolicy` / `pairingPolicy` 作为可配置策略而非硬编码 | Swiss/GSL 出现多种配对规则变体 |
| **Cross-group dynamic reseeding** | GSL 淘汰赛阶段根据种子重排对阵（highest vs lowest） | 赛事规则要求 reseed 而非 fixed cross-group |

v2 的 `advanceTiers` API 设计已为这些方向预留扩展点：`placement` 为 string（可扩展名次标识）、`targetRound` 为可扩展枚举、`QualifiedTeam` 携带 `group` 元数据。未来泛化时无需重写数据模型。
