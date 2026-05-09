# 平台配置化 + Stage 框架 设计 Spec

**日期**：2026-05-09  
**范围**：赛事管理 UI、报名配置化、Stage/赛制框架重构  
**版本归属**：v1（框架 + UI + 报名），v2（瑞士轮执行器）  
**依赖 Spec**：`2026-05-08-swiss-tournament-design.md`（瑞士轮算法细节）

---

## 背景

当前问题：

1. **赛事只能通过 seed 脚本创建**，没有 admin UI，不可运营
2. **报名字段全部硬编码**，段位门槛、身份类型（在校/毕业/外校）、每位置上限均写死在 validator 里
3. **赛制硬编码为两个枚举列**（`qualifierFormat`/`playoffFormat`），无法描述多阶段赛制（Major 的三轮 Swiss + Playoff）

目标：v1 搭好框架地基，让 Rivals 在新体系上跑通；v2 在此基础上接入 Swiss，支撑 Major。

---

## v1 范围

### 一、数据库层

#### seasons 表

**删除**：`qualifierFormat`、`playoffFormat` 两列及对应 pgEnum 定义（`qualifierFormatEnum`、`playoffFormatEnum`）

**新增**：

```typescript
// 替代 qualifierFormat + playoffFormat
stagePlan: json("stage_plan").$type<StagePlan>().notNull().default([])

// 报名配置（v1 支持 allowedPlayerTypes + rankThreshold + maxPerPosition + screenshotCount）
registrationConfig: json("registration_config").$type<RegistrationConfig>().notNull().default({})
```

**保留**：`registrationMode`（solo/team）、`positions` array——仍是 capability 字段，stagePlan 不替代。

#### season_registrations 表

新增：

```sql
player_type TEXT NOT NULL DEFAULT 'enrolled'
-- 值域: 'enrolled' | 'graduated' | 'external'
```

#### matches 表

当前 `matches.stage` 已存在，类型为 `match_stage` enum（`qualifier | playoff`），且为 `NOT NULL`。本次不是新增 `stage`，而是迁移：

```sql
stage TEXT NOT NULL  -- 存 StagePlan[n].key，不存展示名
round INTEGER        -- 瑞士轮轮次（1–5）；round_robin/elim 为 null
```

迁移要求：

- `matches.stage = 'qualifier'` 继续映射到 `stagePlan` 中 `key = 'qualifier'` 的阶段
- `matches.stage = 'playoff'` 继续映射到 `stagePlan` 中 `key = 'playoff'` 的阶段
- 删除 `matchStageEnum` 前必须先完成列类型迁移，避免 enum drop 影响历史数据

#### 类型定义

```typescript
// src/types/season.ts

type StageType = "round_robin" | "double_elim" | "single_elim" | "swiss";

interface StageConfig {
  key: string;        // 稳定业务标识："qualifier" | "playoff" | "stage-1" 等，写入 matches.stage
  name: string;       // 展示名："排位赛" | "正赛" | "Stage 1" | "Playoff" 等，可改名/i18n
  type: StageType;
  teamCount: number;
  advance: number;    // 晋级队伍数；0 = 决赛阶段（无下一阶段）
  seeds?: number[];   // 仅 Swiss：该阶段的初始种子列表（1-based）
}

type StagePlan = StageConfig[];

interface RegistrationConfig {
  allowedPlayerTypes: Array<"enrolled" | "graduated" | "external">;
  rankThreshold: {
    currentMin: string | null;  // null = 无门槛
    peakMin: string | null;
  };
  maxPerPosition: number;
  screenshotCount: number;
}
```

Rivals 默认 stagePlan：

```json
[
  { "key": "qualifier", "name": "排位赛", "type": "round_robin", "teamCount": 8, "advance": 8 },
  { "key": "playoff",   "name": "正赛",   "type": "double_elim", "teamCount": 8, "advance": 1 }
]
```

Rivals 默认 registrationConfig：

```json
{
  "allowedPlayerTypes": ["enrolled"],
  "rankThreshold": { "currentMin": "A", "peakMin": "A+" },
  "maxPerPosition": 15,
  "screenshotCount": 1
}
```

---

### 二、Stage 框架

#### StageExecutor 接口

```typescript
// src/lib/formats/types.ts

interface StageExecutor {
  /** 初始化阶段：生成第一轮/全部对阵，写入 matches */
  initialize(seasonId: string, config: StageConfig, teams: Team[]): Promise<{ matchCount: number }>;

  /** 逐轮推进（仅 Swiss 需要；淘汰赛 initialize 一次性生成全部对阵） */
  advanceRound?(seasonId: string, stageKey: string): Promise<{ matchCount: number }>;

  /** 该阶段是否已完成（所有 match finished，且无 active 参赛方） */
  isComplete(seasonId: string, stageKey: string): Promise<boolean>;
}
```

#### 执行器目录

```
src/lib/formats/
  ├── types.ts          # StageExecutor 接口 + StageConfig 类型
  ├── round-robin.ts    # 封装现有 brackets-manager round_robin 逻辑
  ├── double-elim.ts    # 封装现有 brackets-manager double_elim 逻辑
  ├── single-elim.ts    # 封装 brackets-manager single_elim（v1 新增）
  └── index.ts          # 执行器注册表
```

v2 只需在此目录加 `swiss.ts` 并注册，不改其他代码。

#### 注册表

```typescript
// src/lib/formats/index.ts

const EXECUTORS: Record<string, StageExecutor> = {
  round_robin: roundRobinExecutor,
  double_elim: doubleElimExecutor,
  single_elim: singleElimExecutor,
  // v2: swiss: swissExecutor,
};

export function getExecutor(type: string): StageExecutor {
  const e = EXECUTORS[type];
  if (!e) throw new AppError(ErrorCode.INTERNAL_ERROR, `未知赛制: ${type}`);
  return e;
}
```

#### Server Action 改造

现有 `generateSchedule` 重构为初始化第一个 stage，而不是一次性初始化所有阶段：

```typescript
const [firstStage] = season.stagePlan;
const executor = getExecutor(firstStage.type);
await executor.initialize(seasonId, firstStage, teams);
```

原因：当前 Rivals 流程是 `round_robin` 完成后，根据积分榜重新 seed `double_elim` 正赛。若在 `generateSchedule` 时一次性初始化 `double_elim`，会提前锁定正赛种子，破坏现有 `generatePlayoff` 的语义。

新增 `initializeStage(seasonId, stageKey)`：

- 根据 `stagePlan` 找到指定 stage
- 校验前置 stage 已完成
- 根据上一 stage 的结果计算晋级/种子
- 初始化该 stage 的 matches
- v1 中可替代现有 `generatePlayoff`
- v2 中用于 Swiss stage 间晋级

**不改动**：`src/lib/bracket/` 适配层，round-robin/double-elim 执行器内部调用它，外部只看 StageExecutor 接口。

#### 赛程页 capability 判断

当前 `qualifierFormat || playoffFormat` 的判断改为 `season.stagePlan.length > 0`。

---

### 三、报名配置化

#### 字段变更

`registrationSchema`（`src/lib/validators/registration.ts`）不能继续作为单一模块级静态 schema 使用。当前 Server Action 是先 `registrationSchema.safeParse(input)`，再查 season；配置化后需要改为 schema factory：

```typescript
function buildRegistrationSchema(
  config: RegistrationConfig,
  positions: readonly string[],
) {
  // 返回基于当前 season 配置的 Zod schema
}
```

Server Action 校验流程改为：

1. 用轻量 schema 只解析 `seasonId`
2. 查询 season，合并 `season.registrationConfig ?? REGISTRATION_DEFAULTS`
3. 调用 `buildRegistrationSchema(config, season.positions)` 生成完整 schema
4. 用完整 schema 校验表单输入

Client 表单也需要拿到同一份 config，用于 resolver、字段显示和名额文案。

配置项：

- 段位门槛：从 `registrationConfig.rankThreshold` 读，`null` 则跳过段位校验
- 每位置上限：`registrationConfig.maxPerPosition`
- 截图数量：`registrationConfig.screenshotCount`

`playerType` 字段加入报名表单（下拉：在校 / 毕业 / 外校），提交时 Server Action 校验 `playerType` 是否在 `registrationConfig.allowedPlayerTypes` 内。

截图字段改为数组形态：

```typescript
screenshotUrls: string[] // min/max 均由 registrationConfig.screenshotCount 控制
```

现有单个 `screenshotUrl` 输入仅作为 UI 兼容过渡，最终写入 DB 的仍是 `season_registrations.screenshot_urls`。

#### 向后兼容

`REGISTRATION_DEFAULTS` 保留，作为 `registrationConfig` 缺失时的 fallback（seed 数据补充后 fallback 实际不会触发）。

---

### 四、Admin UI（赛季管理）

#### 新增页面

| 路由 | 功能 | 权限 |
|---|---|---|
| `/admin/seasons/new` | 创建赛季表单 | super_admin |
| `/admin/[seasonSlug]/settings` | 编辑赛季配置（仅 draft 状态可改核心字段） | super_admin |
| 删除 Server Action | 仅 draft 且无报名记录可删 | super_admin |

`/admin` 首页赛季列表加「新建赛季」入口（super_admin 可见）。

#### 表单字段分组

**基础信息**：name、slug（创建时填，编辑时只读）、kind、themeColor、startAt、endAt

**报名配置**：
- `registrationMode`（solo / team）
- `allowedPlayerTypes`（多选复选框：在校 / 毕业 / 外校）
- `rankThreshold.currentMin` + `rankThreshold.peakMin`（下拉，含"无门槛"选项）
- `maxPerPosition`（数字输入，1–50）
- `screenshotCount`（数字输入，1–5）

**赛制配置**：
- v1 提供预设 + 自定义模式：
  - **Rivals 8队**：`[round_robin→8队, double_elim→8队]`（预填，可调整）
  - **自定义**：JSON textarea 直接编辑 stagePlan（v2 再做可视化编辑器）

**状态流转**（仅编辑页）：「发布」按钮（draft → registration）。其余状态迁移在各功能页操作。

#### 删除逻辑

- 仅允许 `status = 'draft'`
- 级联检查：有 `season_registrations` 记录则拒绝，提示先清空报名
- 写 `audit_logs`，action = `season.deleted`

#### Server Actions（新文件）

```
src/actions/seasons.ts
  ├── createSeason(input) → ok({ slug })
  ├── updateSeason(input) → ok(undefined)
  └── deleteSeason(seasonId) → ok(undefined)
```

---

## v2 范围（不在 v1 实施）

在 v1 框架上追加，不改已有接口：

| 新增内容 | 说明 |
|---|---|
| `src/db/schema/swiss-standings.ts` | 详见 `2026-05-08-swiss-tournament-design.md` |
| `src/lib/formats/swiss.ts` | SwissExecutor：配对算法 + BU 计算 |
| `generateSwissRound` Server Action | 每轮完成后管理员触发 |
| Major stagePlan 预设 | 创建表单加第三个预设选项 |
| 字段级报名配置 | `registrationConfig.fields: Record<string, "required" \| "optional" \| "hidden">` |

算法细节见独立 spec：`2026-05-08-swiss-tournament-design.md`。

---

## v3 范围（方向性，不承诺）

- 更多 StageExecutor（GSL 小组赛、循环赛池等）
- stagePlan 可视化编辑器（拖拽式）
- 报名表单字段完全可配置（游戏无关）
- 多游戏支持（赛制只操作 teamId，框架已满足）

---

## 改动范围汇总（v1）

| 文件 | 改动类型 |
|---|---|
| `src/db/schema/seasons.ts` | 删 `qualifierFormat`/`playoffFormat` 枚举列，加 `stagePlan`/`registrationConfig` JSONB |
| `src/db/schema/registrations.ts` | 加 `playerType` 列 |
| `src/db/schema/matches.ts` | `stage` 从 enum 迁移为 text，存 StageConfig.key；新增 `round` 列 |
| `src/db/schema/index.ts` | 导出更新 |
| `src/types/season.ts` | 废弃旧 Format 类型，新增 `StageConfig`/`StagePlan`/`RegistrationConfig` |
| `src/lib/formats/types.ts` | 新建，`StageExecutor` 接口 |
| `src/lib/formats/round-robin.ts` | 新建，封装现有逻辑 |
| `src/lib/formats/double-elim.ts` | 新建，封装现有逻辑 |
| `src/lib/formats/single-elim.ts` | 新建 |
| `src/lib/formats/index.ts` | 新建，注册表 |
| `src/lib/validators/registration.ts` | 段位门槛/上限改从 season config 读 |
| `src/actions/seasons.ts` | 新建，`createSeason`/`updateSeason`/`deleteSeason` |
| `src/actions/matches.ts` | `generateSchedule` 改为初始化首个 stage，加 `initializeStage` 替代/承接 `generatePlayoff` |
| `src/app/admin/seasons/new/page.tsx` | 新建 |
| `src/app/admin/[seasonSlug]/settings/page.tsx` | 新建 |
| `src/app/admin/page.tsx` | 加「新建赛季」入口 |
| `src/components/admin/SeasonForm.tsx` | 新建，创建/编辑共用表单 |
| `src/components/register/RegistrationForm.tsx` | 加 `playerType` 字段，配置驱动校验 |

**不改动**：`src/lib/bracket/` 适配层，`src/app/admin/(auth)/` 鉴权流程。

---

## 约束

- 所有 Server Action 返回 `ActionResult<T>`，写 `audit_logs`
- `stagePlan` 和 `registrationConfig` 在 Server Action 内用 Zod 校验后再写 DB
- `stagePlan` 必须用 `key` 作为稳定业务标识；`name` 只用于展示
- `matches.stage` 迁移必须保护历史 `qualifier` / `playoff` 数据
- 多阶段赛制不得一次性初始化所有 stage；下一阶段必须在上一阶段完成后显式初始化
- 不引入新 npm 包（shadcn 组件按需 add）
- 不改动 P7/P8 选秀相关文件
