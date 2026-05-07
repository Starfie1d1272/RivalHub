# 领域状态机

> 本文档定义所有实体的合法状态及迁移规则。
> **多人协作原则：任何代码对状态的改变必须符合此文档，状态机变更需先修改此文档再改代码。**

---

## 1. Season（赛季）

### 状态图

```
draft
  ↓ [admin: publish]
registration
  ↓ [admin: close registration]
voting
  ↓ [admin: confirm captains → generate teams]
drafting
  ↓ [draft: all picks complete]
playing
  ↓ [admin: finalize season]
finished
  ↓ [admin: archive]
archived
```

### 合法迁移表

| 当前状态 | 可迁移至 | 触发方 | 备注 |
|---|---|---|---|
| `draft` | `registration` | admin | 发布赛季，开放报名 |
| `registration` | `voting` | admin | 手动关闭报名，进入投票 |
| `registration` | `draft` | admin | 撤回发布（仅无任何报名时允许） |
| `voting` | `drafting` | admin | 确认 8 名队长，生成队伍和选秀顺位 |
| `voting` | `registration` | admin | 撤回进入重新报名（特殊情况，需清空投票） |
| `drafting` | `playing` | system | 所有 pick 完成时自动触发 |
| `playing` | `finished` | admin | 赛季结束 |
| `finished` | `archived` | admin | 历史归档 |

### 禁止迁移

- `archived` → 任何状态（归档不可逆）
- `playing` → `drafting`（选秀不可回退）
- `finished` → `playing`（已结束不可重开）

---

## 2. SeasonRegistration（报名）

### 状态图

```
pending
  ├─ [admin: approve] → approved
  ├─ [admin: reject]  → rejected
  └─ [admin: waitlist]→ waitlisted

waitlisted
  ├─ [admin: approve] → approved
  └─ [admin: reject]  → rejected

approved
  └─ [admin: reject]  → rejected   ← 仅在赛季 registration 阶段允许

rejected
  └─ [admin: approve] → approved   ← 仅在赛季 registration 阶段允许
```

### 合法迁移表

| 当前状态 | 可迁移至 | 触发方 | 前置条件 |
|---|---|---|---|
| `pending` | `approved` | admin | 赛季 status = registration 或 voting |
| `pending` | `rejected` | admin | 任意阶段 |
| `pending` | `waitlisted` | admin | 赛季 status = registration |
| `waitlisted` | `approved` | admin | 赛季 status = registration 或 voting，且位置未满 |
| `waitlisted` | `rejected` | admin | 任意阶段 |
| `approved` | `rejected` | admin | 赛季 status = registration（已进入 voting/drafting 后不允许） |
| `rejected` | `approved` | admin | 赛季 status = registration，且位置未满 |

### 禁止迁移

- `approved → pending`（不允许回到待审核）
- `rejected → pending`（不允许回到待审核）
- 赛季进入 `voting` 或之后，禁止 `approved → rejected`

---

## 3. DraftState（选秀进行状态）

### 状态图

```
[not_started]          ← 队伍生成后，选秀未开始
    ↓ [admin: start]
[active]               ← 当前有队伍在选人，有倒计时
    ├─ [captain: pick / system: autoPick] → 推进到下一队
    ├─ [admin: pause]  → [paused]
    └─ [all picks done]→ [completed]

[paused]               ← 管理员暂停（紧急情况）
    └─ [admin: resume] → [active]

[completed]            ← 6 轮全部完成，自动触发 season → playing
```

### 合法迁移表

| 当前状态 | 可迁移至 | 触发方 | 备注 |
|---|---|---|---|
| `not_started` | `active` | admin | 设置第 1 轮第 1 队 + round_deadline |
| `active` | `active` | captain/cron | pick 后推进（更新 current_team + round_deadline） |
| `active` | `paused` | admin | 紧急暂停，不更新 round_deadline |
| `active` | `completed` | system | 第 6 轮最后一队 pick 完成后自动触发 |
| `paused` | `active` | admin | 恢复，重新设置 round_deadline |

### 禁止迁移

- `completed` → 任何状态（不可回滚选秀）
- `paused` → `completed`（必须经过 active）
- **任何状态下禁止回退已完成的 pick**

### 注意：`is_active` 字段语义

`draft_state.is_active` 对应 `active | paused`，均为 true；`not_started | completed` 为 false。
判断是否可以 pick，必须同时满足：`is_active = true AND current_team_id IS NOT NULL AND round_deadline > NOW()`

---

## 4. Match（比赛）

### 状态图

```
scheduled
  ↓ [admin: start match / match begins]
in_progress
  ↓ [admin: record result]
finished

scheduled / in_progress
  ↓ [admin: cancel]
cancelled
```

### 合法迁移表

| 当前状态 | 可迁移至 | 触发方 | 备注 |
|---|---|---|---|
| `scheduled` | `in_progress` | admin | 比赛开始 |
| `scheduled` | `cancelled` | admin | 双方队伍弃权或赛程调整 |
| `in_progress` | `finished` | admin | 录入比分，必须同时更新 bracket |
| `in_progress` | `cancelled` | admin | 特殊情况（不影响已进行局数的 bracket） |

### 禁止迁移

- `finished` → 任何状态（比赛结果不可撤销，需 admin 特权操作并写 audit_log）
- `cancelled` → `in_progress`（取消后不可恢复，需重新创建比赛）

### 比分录入规则

比分录入时必须同步调用 `lib/bracket/advanceMatch()`，不允许仅更新 `matches` 表而不推进 bracket。

---

## 5. CaptainVote（队长投票）

无状态机，为不可变记录（insert only）。

**业务约束**（应用层校验）：
- 每名选手每届赛事最多投 3 票：`SELECT COUNT(*) WHERE voter_registration_id = $id AND season_id = $season`
- 不能给自己投票：`voter_registration_id ≠ candidate_registration_id`
- 只能在 season.status = `voting` 时投票
- 撤票（DELETE）仅允许在 season.status = `voting` 时

---

## 变更流程

1. 修改此文档，描述新的状态或迁移路径
2. 修改 `src/db/schema/` 对应 enum
3. 修改 `src/actions/` 中的状态校验逻辑
4. 在 PR 描述中引用此文档的具体章节
