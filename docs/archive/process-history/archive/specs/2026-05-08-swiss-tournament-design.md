# 瑞士轮赛制 + 泛化 Stage 体系设计

> 状态：已确认 · 2026-05-08
> 目标分支：`feat/swiss-executor`（PR #39）→ `fix/swiss-review-fixes`（本次）
> **注意**：本文档中的 `StageConfig` 定义（`advance: number`）已被 `2026-05-10-stage-framework-v2-design.md` 取代（`advanceTiers: AdvanceTier[]`），以 v2 design 为准。

## 实现状态

| 需求 | 状态 |
|------|------|
| R1 种子配对（上半区 vs 下半区） | ✅ `feat/swiss-executor` |
| `advanceRound`：wins/losses 更新 → BU 重算 → slide pairing + 避重赛 | ✅ `feat/swiss-executor` |
| BO3 升级（晋级局 / 淘汰局） | ✅ `feat/swiss-executor` |
| `isComplete` 完赛检测 | ✅ `feat/swiss-executor` |
| `swiss_standings` 表 | ✅ `feat/swiss-executor` |
| `getQualifiers` 方法 | ✅ `fix/swiss-review-fixes` |
| `StageExecutor` 接口 v2 对齐（`qualifiers` 参数） | ✅ `fix/swiss-review-fixes` |
| `advance` → `advanceTiers` 迁移 | ⬜ follow-up |
| Swiss → playoff 阶段衔接（`initializeStage` 泛化） | ⬜ follow-up |
| Swiss executor 测试 | ✅ `fix/swiss-review-fixes` |

详见 `2026-05-10-swiss-implementation-status.md`。

---

## 赛制需求

### 春季赛 NJU Rivals（不变）

8 队选秀联赛：排位赛 (round_robin) → 正赛 (double_elim)

### 秋季赛 NJU Major（新增）

32 队公开赛，赛委会按纸面实力划分 1–32 种子：

| Stage  | 参赛队伍 | 赛制 | 晋级 |
|--------|---------|------|------|
| Stage 1 | seeds 17–32 (16队) | 瑞士轮 | 8 晋级 |
| Stage 2 | 晋级 8 队 + seeds 9–16 (16队) | 瑞士轮 | 8 晋级 |
| Stage 3 | 晋级 8 队 + seeds 1–8 (16队) | 瑞士轮 | 8 晋级 |
| Playoff | 8 队 | 单败淘汰 BO3 | 冠军 |

---

## 瑞士轮配对规则

### 基本参数

- 16 队，最多 5 轮
- 3 胜晋级 (advanced)，3 败淘汰 (eliminated)
- 每轮同战绩分组，组内配对
- 禁止重赛（不匹配已交手过的对局）

### 逐轮配对依据

| 轮次 | 同战绩组内排序依据 | 配对方式 |
|------|-------------------|----------|
| R1 | 种子 | 上半区对下半区：seed[i] vs seed[i+8] |
| R2 | 种子 | 组内最高种子对最低种子 |
| R3–R5 | BU 分 | 组内最高 BU 对最低 BU |
| R3–R5 tiebreak | 初始种子 | 同 BU 时种子号小者优先 |

### 局类型

| 条件 | 格式 |
|------|------|
| 胜者拿到第 3 胜（晋级局） | BO3 |
| 负者吃到第 3 败（淘汰局） | BO3 |
| 其余 | BO1 |

---

## BU 分定义

**BU = Σ(每个已交手对手的 wins - losses)**

- 例：打过 3 个对手，战绩分别为 1-2、2-1、3-0
- BU = (1-2) + (2-1) + (3-0) = (-1) + (+1) + (+3) = 3
- BU 可以是负数
- 退赛/弃赛 → 该对手当场算负，不影响算法

### 计算时机

每轮结束后对所有 active 队伍重算。对手的 wins/losses 取自最新的 `swiss_standings`。

---

## 数据模型

### matches 表新增字段

```sql
ALTER TABLE matches ADD COLUMN round integer;  -- 瑞士轮第几轮 (1-5)，非瑞士轮 null
```

### 新增 swiss_standings 表

```sql
CREATE TABLE swiss_standings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id  uuid NOT NULL REFERENCES seasons(id),
  stage      text NOT NULL,          -- "Stage 1" / "Stage 2" / "Stage 3"
  team_id    uuid NOT NULL REFERENCES teams(id),
  seed       int NOT NULL,           -- 该阶段种子 (1-16)
  wins       int NOT NULL DEFAULT 0,
  losses     int NOT NULL DEFAULT 0,
  bu_score   int NOT NULL DEFAULT 0, -- Σ(对手 wins - 对手 losses)
  status     text NOT NULL DEFAULT 'active',  -- active | advanced | eliminated
  UNIQUE(season_id, stage, team_id)
);
```

### Stage Plan（存储在 seasons JSONB）

```typescript
type StagePlan = StageConfig[];

interface StageConfig {
  name: string;        // "排位赛" | "正赛" | "Stage 1" | "Stage 2" | "Stage 3" | "Playoff"
  type: "swiss" | "round_robin" | "double_elim" | "single_elim";
  teamCount: number;
  advance: number;
  seeds?: number[];    // 仅 Swiss/Major：1-based 种子列表
}
```

春季赛 stagePlan：
```json
[
  { "name": "排位赛", "type": "round_robin",  "teamCount": 8, "advance": 8 },
  { "name": "正赛",   "type": "double_elim",  "teamCount": 8, "advance": 1 }
]
```

秋季赛 stagePlan：
```json
[
  { "name": "Stage 1", "type": "swiss",        "teamCount": 16, "advance": 8, "seeds": [17,18,...32] },
  { "name": "Stage 2", "type": "swiss",        "teamCount": 16, "advance": 8, "seeds": [9,10,...16] },
  { "name": "Stage 3", "type": "swiss",        "teamCount": 16, "advance": 8, "seeds": [1,2,...8] },
  { "name": "Playoff", "type": "single_elim",  "teamCount": 8,  "advance": 1 }
]
```

`matches.stage` 直接存 stage name 字符串，无额外映射层。

---

## StageExecutor 接口

```typescript
interface StageExecutor {
  /** 初始化阶段，生成第一轮对阵 */
  initialize(seasonId: string, config: StageConfig, teams: Team[]): Promise<{ matchCount: number }>;

  /** 逐轮推进（仅 Swiss 需要；淘汰赛一次性生成，无需此方法） */
  advanceRound?(seasonId: string, stageName: string): Promise<{ matchCount: number }>;

  /** 该阶段是否已完成 */
  isComplete(seasonId: string, stageName: string): Promise<boolean>;
}
```

执行器目录：
```
src/lib/formats/
  ├── types.ts          # StageExecutor 接口
  ├── swiss.ts          # 瑞士轮配对算法 + BU 分计算
  ├── round-robin.ts    # 现有 brackets-manager round_robin 封装
  ├── double-elim.ts    # 现有 brackets-manager double_elim 封装
  └── single-elim.ts    # brackets-manager single_elim 封装
```

---

## 瑞士轮执行流程

### initialize

1. INSERT `swiss_standings`（teamCount 行，按 seeds 填充）
2. 生成 R1 对阵：`seed[i]` vs `seed[i + teamCount/2]`
3. INSERT `matches`（stage, round=1, format=BO1）

### advanceRound

1. 确认当前轮所有 match 为 `finished`
2. 更新 `swiss_standings`：wins/losses ±1
3. 重算 BU：遍历 active 队伍，对每个队伍查其所有对手的 (wins - losses) 之和
4. 标记 status = `advanced`（3胜）和 `eliminated`（3败）
5. 过滤 `status = 'active'` 的队伍
6. 按 wins 分组（如 {3-0} 无 active, {2-0}, {1-1}, {0-2} 等）
7. 每组内按配对依据排序（R2→seed, R3+→bu_score, tiebreak→seed）
8. 组内从两端向中间配对（slide），跳过已交手
9. INSERT `matches`（stage, round=r+1, format=BO1 或 BO3）

### 完赛检测

所有队伍 status ≠ active → 标记 Swiss stage 完成 → 管理员触发下一 stage 初始化。

---

## 改动范围

| 文件 | 改动 |
|------|------|
| `src/db/schema/swiss-standings.ts` | 新增表 |
| `src/db/schema/matches.ts` | 新增 `round` 字段 |
| `src/db/schema/index.ts` | 导出新表 |
| `src/types/season.ts` | 废弃 `QualifierFormat`/`PlayoffFormat`，新增 `StagePlan` |
| `src/types/match.ts` | 新增 `round: number \| null` |
| `src/lib/formats/types.ts` | `StageExecutor` 接口 |
| `src/lib/formats/swiss.ts` | 瑞士轮配对算法 + BU 计算 |
| `src/lib/formats/round-robin.ts` | 封装现有 round_robin 逻辑 |
| `src/lib/formats/double-elim.ts` | 封装现有 double_elim 逻辑 |
| `src/lib/formats/single-elim.ts` | 封装 single_elim 逻辑 |
| `src/lib/standings.ts` | 扩展 `getStandings(stageName)` 支持 Swiss |
| `src/actions/matches.ts` | `generateSchedule` 改为遍历 stagePlan |
| `src/actions/matches.ts` | 新增 `initializeStage`、`generateSwissRound` |

**不改动**：`src/lib/bracket/` 适配层，保持现有 `round_robin`/`double_elim` 流程不变。

---

## 扩展性

- 新增赛制（如 GSL 小组赛）：实现 `StageExecutor` 接口 → 注册到 `src/lib/formats/`
- 新增游戏：赛制操作的是 teamId，与游戏无关
- stagePlan 是 JSONB，任何 stage 序列均可描述
