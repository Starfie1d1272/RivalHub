# 蛇形选秀流程

## 状态机

```
[idle]
  → admin 确认队长，调用 initDraft()
[active: round=1, teamIdx=0, deadline=now+3min]
  → 队长 pick / autoPick
  → nextTurn()
[active: round=1, teamIdx=1, deadline=now+3min]
  → ...（共 8 支队伍，第 1 轮 1→8 正向）
[active: round=2, teamIdx=7, deadline=now+3min]
  → ...（第 2 轮 8→1 反向，蛇形）
  → ...
[active: round=6, 最后一队]
  → 所有 pick 完成 → completeDraft()
[finished]
```

蛇形规则（round 奇数正向，偶数反向）：
```
Round 1: team[0] → team[1] → ... → team[7]
Round 2: team[7] → team[6] → ... → team[0]
Round 3: team[0] → ...
...
Round 6: team[7] → ...
```
共 6 轮 × 8 队 = 48 picks（48 名普通队员 + 8 名队长 = 56 人）。

---

## draft_state 字段语义

| 字段 | 说明 |
|---|---|
| `current_round` | 当前轮次（1-6） |
| `current_team_id` | 当前应该 pick 的队伍 ID |
| `round_deadline` | 当前队伍的超时时间（UTC） |
| `is_active` | 选秀是否进行中 |

---

## 并发安全

### 行锁机制

```sql
BEGIN;
SELECT * FROM draft_state WHERE season_id = $1 FOR UPDATE;
-- 后续所有 check 和 INSERT 在同一事务内
-- 其他并发请求在此 SELECT FOR UPDATE 阻塞
INSERT INTO draft_picks ...;
UPDATE draft_state SET current_team_id = $next_team, round_deadline = $new_deadline;
COMMIT;
```

### 幂等性（`client_request_id`）

客户端每次点击"选择"生成唯一 UUID 作为 `client_request_id`：
- 首次请求：正常插入 draft_picks
- 网络超时后重试（同 ID）：检查 `UNIQUE(client_request_id)`，若已存在则返回成功而不重复插入

```typescript
// 客户端
const clientRequestId = crypto.randomUUID(); // 按钮 disabled 前生成
await pickPlayer(teamId, registrationId, clientRequestId);
```

---

## Vercel Cron 超时自动 pick

### 触发配置

```json
// vercel.json
{
  "crons": [{
    "path": "/api/cron/draft-timeout",
    "schedule": "* * * * *"
  }]
}
```

每分钟触发一次，仅当选秀活跃且当前队伍已超时时执行 `autoPick`。

### autoPick 逻辑

```
1. 查询 draft_state WHERE is_active = true AND round_deadline < NOW()
2. 找出当前队伍已选择的 primary_position 分布
3. 从剩余未选选手中过滤同位置 ≤ 2 人的（确保选后不超 3 人）
4. 按 peak_rating DESC 排序，取第 1 名
5. 以 auto_pick=true 调用 pickPlayer 事务
```

### 安全验证

```typescript
// /api/cron/draft-timeout/route.ts
const authHeader = req.headers.get("authorization");
if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  return new Response("Unauthorized", { status: 401 });
}
```

---

## 同位置约束（≤ 3 人）

每次 pick 时在事务内校验：

```sql
SELECT COUNT(*) FROM team_members tm
JOIN season_registrations sr ON sr.id = tm.registration_id
WHERE tm.team_id = $teamId
  AND sr.primary_position = $targetPosition;
-- 若 COUNT >= 3，拒绝 pick，返回错误
```

---

## 前端 Realtime 更新

选秀直播间通过 Supabase Realtime 订阅：

```typescript
supabase
  .channel("draft-live")
  .on("postgres_changes", { event: "*", schema: "public", table: "draft_state" }, handler)
  .on("postgres_changes", { event: "INSERT", schema: "public", table: "draft_picks" }, handler)
  .subscribe();
```

每次 pick 完成后，所有订阅客户端收到推送，自动刷新：
- 当前轮次 / 当前队伍高亮
- 倒计时重置（从新的 `round_deadline` 计算）
- 已选队员格子填入

---

## 选秀结束后

选秀完成（6 轮 × 8 队）后：
1. `draft_state.is_active = false`
2. 赛季状态从 `drafting` 变为 `playing`
3. 队伍展示页解锁（`/[seasonSlug]/teams`）
4. 管理员可在 `/admin/[seasonSlug]/matches` 创建赛程
