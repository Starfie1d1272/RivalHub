# 管理后台 UX 补全 + 报名自动推进设计

> 状态：已确认 · 日期：2026-05-13 · 分支：`feat/phase-tracker-v2`

## 范围

三个独立但相关的改进：

1. **容量口径修正** — `maxPerPosition` 限制提交数，`maxTotal` 限制通过数
2. **报名自动推进** — 审批满或截止时间到，自动 `registration → voting`
3. **管理后台导航补全** — 赛季子页 tabs + 侧边栏标签明确化

---

## 一、容量口径修正

### 现状问题

`getPositionCounts()` 统计全部报名（含 rejected/waitlisted），变量名叫 `totalApproved` 但实际统计的是全部提交。`maxTotal = 56` 含义被混淆。

### 设计

**`getPositionCounts()` 保持不变** — 统计全部提交（不限 status），用于位置 bar 展示和表单提交时的位置上限检查。

**`src/actions/register.ts:203-210`** — `maxTotal` 提交上限检查改为只检查已通过的：

```typescript
// 修改前：AND count(*) >= maxTotal（全部报名）
// 修改后：AND status = 'approved' AND count(*) >= maxTotal
```

这样只有审批通过的人数达标才关闭报名，被拒的不占名额。

**`src/app/[seasonSlug]/register/page.tsx`** — 容量面板改为双行：

| 行 | 展示 | 数据来源 |
|---|---|---|
| 位置 bar | `12 / 15` — 提交/上限 | `getPositionCounts()` (全部提交，不变) |
| Total | `Approved: 32 / 56` | 新增 `getApprovedCount(seasonId)` 查询 |

底部 Total 行文案从 `Total X / Y` 改为 `Approved: X / Y`。

### 数据库影响

无 schema 变更。

---

## 二、自动推进 registration → voting

### 新增文件：`src/actions/transitions.ts`

```
maybeAdvanceFromRegistration(tx, seasonId)
  → 查询 approved count
  → 检查 ≥ maxTotal | registrationDeadline 过期
  → 任一满足 → set status
  → 无队长投票的赛季 → 跳到 "playing"
  → 写 audit_log (action: "season.auto_advance")
```

### 触发点

1. **`approveRegistration()` / `bulkApprove()`** — 审批通过后调用 `maybeAdvanceFromRegistration()`
2. **新 Cron API** `src/app/api/cron/check-registration-deadline/route.ts` — 每分钟检查 `status = "registration"` 的赛季，截止时间过期则推进

### 状态迁移

| 赛季能力 | registration 推进到 |
|---|---|
| `hasCaptainVoting = true` | `"voting"` |
| `hasCaptainVoting = false` | `"playing"` |

### 数据库影响

无 schema 变更。依赖现有 `audit_logs` 表。

---

## 三、管理后台导航补全

### 新增组件：`src/components/admin/SeasonSubNav.tsx`

渲染在赛季子页顶部（`[seasonSlug]/layout.tsx` 或各页面自行引入）。

Tabs 及显示规则：

| Tab | 路由 | 显示条件 |
|---|---|---|
| 报名审核 | `/admin/[slug]/registrations` | 始终 |
| 队长确认 | `/admin/[slug]/captains` | `hasCaptainVoting` |
| 选秀控制 | `/admin/[slug]/draft` | `hasDraft` |
| 赛程管理 | `/admin/[slug]/matches` | `stagePlan` 非空 |
| 赛季设置 | `/admin/[slug]/settings` | `super_admin` |

当前页高亮，`status` 不满足的阶段显示为灰色（不可点击）还是始终可点击？始终可点击（页面自行做权限/状态校验）。

### 侧边栏微调

`src/components/admin/AdminSidebar.tsx`：
- "概览" → "赛季管理"（标签更明确，路由不变）

### 数据库影响

无。

---

## 自我审查

- [x] 无 TBD / TODO 占位符
- [x] 无内部矛盾
- [x] 范围聚焦，不涉及无关重构
- [x] 每条需求明确，无双义

## 未覆盖

- 报名截止后管理员仍可手动改 status（现有功能不受影响）
- 审批通过后位置容量 bar 不变（只影响底部 Total，语义合理）
- E2E 测试（实现阶段按需添加）
