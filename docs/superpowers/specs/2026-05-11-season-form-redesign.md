# 赛季创建表单重构

## 日期
2026-05-11

## 目标
重构 `/admin/seasons/new` 表单，以队伍报名 + Major 赛制为默认，按报名模式差异化显示字段，赛制配置完全表单化，改进 UX。

---

## 1. 顶部预设下拉

表单最上方加一个下拉菜单，选择预设后一键填充所有默认值：

```
预设: [Major 公开赛 ▾]
      ├ Major 公开赛
      └ Rivals 选秀联赛
```

| 字段 | Major 预设 | Rivals 预设 |
|------|-----------|------------|
| kind | "Major" | "选秀联赛" |
| registrationMode | team | solo |
| maxTeamSize | 9 | 7 |
| minTeamSize | 5 | 7 |
| starterCount | 5 | 5 |
| hasCaptainVoting | false（隐藏） | true（默认勾选） |
| hasDraft | false（隐藏） | true（默认勾选） |
| positions | ["igl","awper","opener","closer","anchor"]（可选填） | 同左（必填） |
| registrationConfig | 隐藏 | RIVALS_REGISTRATION_CONFIG |
| teamRegistrationConfig | MAJOR_TEAM_CONFIG | 隐藏 |
| stagePlan | MAJOR_STAGE_PLAN | RIVALS_STAGE_PLAN |

选完预设后可以手动修改任意字段（二次确认弹窗："应用预设将覆盖当前所有配置，是否继续？"）。

---

## 2. 基础信息

| 字段 | 改动 |
|------|------|
| 名称 `name` | 输入后自动生成 slug（中文→拼音→kebab-case） |
| Slug `slug` | 自动填充 + 说明 "URL 路径标识，留空自动生成"；创建后锁定 |
| 类型 `kind` | 文本，跟随预设 |
| 主题色 `themeColor` | 6 色块点击选择（#f97316 / #3b82f6 / #22c55e / #8b5cf6 / #ef4444 / #14b8a6）+ 可自定义 hex 输入 |
| 开始/结束时间 | datetime-local，加大输入框 |

### Slug 自动生成规则
- 输入 "2026 NJU Major" → `2026-nju-major`
- 输入 "2026 NJU Rivals 春季赛" → `2026-nju-rivals-chun-ji-sai`
- 中文用简化规则转换
- 用户可覆盖手写

---

## 3. Capability（按报名模式差异化）

### Team 模式（Major 默认）

```
┌─ 报名模式: [队伍报名 ▾] ────────────────────────────┐
│                                                     │
│  位置列表: [igl,awper,opener,closer,anchor]          │
│  说明: 可选填，不填位置则不参与排行榜和最佳五人组评选  │
│  每队人数上限: [9]                                   │
│  每队人数下限: [5]                                   │
│  首发人数:     [5]                                   │
│                                                     │
│  (队长投票、蛇形选秀隐藏)                             │
└─────────────────────────────────────────────────────┘
```

- `hasCaptainVoting` 和 `hasDraft` 强制设为 `false`，不可见
- `positions` 显示但可选，带说明文字

### Solo 模式（Rivals 默认）

```
┌─ 报名模式: [个人报名 ▾] ────────────────────────────┐
│                                                     │
│  位置列表: [igl,awper,opener,closer,anchor]          │
│  每队人数上限: [7]                                  │
│  每队人数下限: [7]                                  │
│  首发人数: [5]                                      │
│  ☑ 队长投票                                         │
│  ☑ 蛇形选秀                                         │
└─────────────────────────────────────────────────────┘
```

- `hasCaptainVoting` 和 `hasDraft` 默认勾选
- 切换报名模式时：Solo→Team 时自动隐藏投票/选秀并设为 false；Team→Solo 时显示并恢复为 true

---

## 4. 报名配置（按模式差异化）

### 4.1 Solo 模式 — 个人报名配置（RegistrationConfig）

| 字段 | 类型 | 说明 |
|------|------|------|
| 允许选手类型 | 多选：在校/毕业/外校 | 勾选哪些身份可报名 |
| 当前段位门槛 | 下拉 | 本赛季段位不低于此（可选"无门槛"） |
| 历史段位门槛 | 下拉 | 历史最高段位不低于此（可选"无门槛"） |
| 每位置上限 | 数字 | 每位置最多报名人数 |
| 截图数量 | 数字 | 报名需上传几张截图 |

### 4.2 Team 模式 — 队伍报名配置（TeamRegistrationConfig）

#### 身份/学校约束

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `allowExternal` | boolean | false | 是否允许外校选手 |
| `graduateCountsAsHome` | boolean | true | 毕业生是否算本校 |
| `minHomeMembers` | number | 5 | 每队最少本校人数 |
| `minEnrolledMembers` | number | 0 | 每队最少在校生人数 |
| `maxExternalMembers` | number | 0 | 每队最多外校人数上限 |

> **注**：`minTeamSize` / `maxTeamSize` 是 seasons 表列（见第6节），不放在此 JSONB 中，避免重复。

#### 位置分配

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `requirePositions` | boolean | false | 是否强制每个队员分配位置 |
| `maxPerPositionPerTeam` | number | 2 | 同队同一位置最多几人 |

#### 队伍管理

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `captainCanKick` | boolean | true | 队长能否移除队员 |
| `captainCanTransfer` | boolean | true | 队长能否转让队长身份 |
| `lockAfterRegistration` | boolean | true | 报名截止后锁定队伍成员 |
| `requireUniqueTeamName` | boolean | true | 队伍名是否要求唯一 |
| `requireTeamLogo` | boolean | false | 是否强制上传队伍 Logo |

### 4.3 切换行为

- Solo 模式 → 显示 RegistrationConfig 区块，隐藏 TeamRegistrationConfig 区块
- Team 模式 → 隐藏 RegistrationConfig 区块，显示 TeamRegistrationConfig 区块
- 切换时保留各区块的填写内容

---

## 5. 赛制配置（完全表单化）

### 5.1 阶段编辑器

每个阶段一张卡片，所有字段表单化填写：

```
┌─ 阶段 1 ──────────────────────────────────────────┐
│  阶段名称: [瑞士轮阶段______]                       │
│  阶段标识: [stage1]（自动从名称生成，可手动改）      │
│  赛制类型: [Swiss ▾]                               │
│  队伍数:   [16]         比赛 BO: [BO1 ▾]            │
│  分组数:   [4]                                     │
│  晋级规则: [全部晋级 ▾] → 取前 [8___] 名            │
│  ☐ 三四名决赛                                       │
│  (决赛 BO 覆写 — 非淘汰赛不显示)                    │
│  [× 删除阶段]                                      │
└────────────────────────────────────────────────────┘
┌─ 阶段 2 ──────────────────────────────────────────┐
│  阶段名称: [淘汰赛阶段______]                       │
│  阶段标识: [stage2]                                 │
│  赛制类型: [Single Elim ▾]                         │
│  队伍数:   [8]          比赛 BO: [BO3 ▾]            │
│  晋级规则: [冠军→1] [亚军→1]                        │
│  ☑ 三四名决赛                                       │
│  决赛 BO 覆写: [BO5 ▾]                              │
│  [× 删除阶段]                                      │
└────────────────────────────────────────────────────┘

[+ 添加阶段]
```

### 5.2 阶段字段按 type 动态显示

| 赛制类型 | 显示字段 | 隐藏字段 |
|---------|---------|---------|
| round_robin | 名称、标识、队伍数、BO、晋级规则、分组数 | 决赛BO覆写、种子数 |
| single_elim | 名称、标识、队伍数、BO、晋级规则、三四名决赛、决赛BO覆写 | 分组数 |
| double_elim | 名称、标识、队伍数、BO、三四名决赛、决赛BO覆写 | 分组数、晋级规则 |
| swiss | 名称、标识、队伍数、BO、分组数、晋级规则 | 决赛BO覆写 |
| gsl_group | 名称、标识、队伍数、BO、分组数、晋级规则 | 决赛BO覆写 |

### 5.3 预设应用

底部下拉 + 应用按钮，一键覆盖所有阶段：

```
预设: [Major 32队 ▾]  [应用预设]
      ├ Major 32队     → 3轮瑞士轮 BO1 → 单败淘汰 BO3(决赛BO5)
      ├ Rivals 8队     → 单循环 BO1 → 双败淘汰 BO3
      └ 空赛制         → 清除所有阶段
```

点击"应用预设"弹出确认："当前赛制配置将被覆盖，是否继续？"

### 5.4 阶段标识自动生成

从阶段名称自动生成 key：
- "瑞士轮阶段" → `swiss`
- "淘汰赛阶段" → `knockout`
- "排位赛阶段" → `ranking`
- 用户可手动修改，key 仅限英文/数字/下划线

### 5.5 StagePlan 数据结构（不变）

```typescript
interface StageConfig {
  key: string;
  name: string;
  type: "round_robin" | "single_elim" | "double_elim" | "swiss" | "gsl_group";
  teamCount: number;
  matchFormat: "bo1" | "bo3" | "bo5";
  advanceTiers: { placement: string; count: number }[];
  seeds?: number[] | null;
  entrySeeds?: number | null;
  finalFormat?: "bo1" | "bo3" | "bo5" | null;
  groupCount?: number;
  hasThirdPlaceMatch?: boolean;
}
```

---

## 6. DB Schema 变更

### seasons 表

| 变更 | 说明 |
|------|------|
| 新增 `min_team_size` | integer, default 5 |
| 重命名 `team_size` → `max_team_size` | integer, default 7 |
| 新增 `team_registration_config` | jsonb, default `'{}'`，存 TeamRegistrationConfig |

### migration 要点

- 现有 solo 赛季 `max_team_size` = 原 `team_size` 值，`min_team_size` = 原 `team_size` 值
- 现有 solo 赛季 `team_registration_config` = `'{}'`

---

## 7. 类型与常量

### 7.1 TeamRegistrationConfig 类型（`src/types/season.ts`）

```typescript
export interface TeamRegistrationConfig {
  allowExternal: boolean;
  graduateCountsAsHome: boolean;
  minHomeMembers: number;
  minEnrolledMembers: number;
  maxExternalMembers: number;
  requirePositions: boolean;
  maxPerPositionPerTeam: number;
  captainCanKick: boolean;
  captainCanTransfer: boolean;
  lockAfterRegistration: boolean;
  requireUniqueTeamName: boolean;
  requireTeamLogo: boolean;
}
```

### 7.2 预设常量

```typescript
export const MAJOR_TEAM_CONFIG: TeamRegistrationConfig = {
  allowExternal: false,
  graduateCountsAsHome: true,
  minHomeMembers: 5,
  minEnrolledMembers: 0,
  maxExternalMembers: 0,
  requirePositions: false,
  maxPerPositionPerTeam: 2,
  captainCanKick: true,
  captainCanTransfer: true,
  lockAfterRegistration: true,
  requireUniqueTeamName: true,
  requireTeamLogo: false,
};
```

---

## 8. 实施范围

全部纳入本次实现：

1. SeasonForm 组件重构（预设下拉、差异化字段显示、位置可选、投票/选秀默认值修正）
2. 赛制配置完全表单化（阶段编辑器、动态字段、预设应用）
3. RegistrationConfig 区块（Solo 专用）
4. TeamRegistrationConfig 区块 + 类型定义（Team 专用）
5. DB schema：新增 `min_team_size`、`team_registration_config`、重命名 `team_size` → `max_team_size`
6. `createSeason` / `updateSeason` Server Action 适配
7. 赛季编辑页同步更新
8. 预设常量（MAJOR_TEAM_CONFIG 等）
9. Slug 自动生成
10. 主题色色块选择器

---

## 9. 不变项目

- `RegistrationConfig` 类型保持不变
- `stagePlan` 存 JSONB 格式不变，仅前端编辑方式改为表单
- 业务逻辑不读 `season.kind` 的原则不变
- Server Action 返回 `ActionResult<T>` 规范不变
- 预设常量值不变
