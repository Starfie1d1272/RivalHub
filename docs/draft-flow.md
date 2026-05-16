# 蛇形选秀流程

## 状态机

详细状态迁移规则见 `docs/state-machines.md` § 3（DraftState）。

```
not_started
  ↓ [admin: start]
active (round=1, team[0], deadline=now+3min)
  ↓ captain pick / autoPick / admin pause
  ...（共 6 轮 × 8 队 = 48 picks）
completed
  → 自动触发 season.status = playing
```

蛇形顺序（round 奇数反向即后位先选，偶数正向）：
```
Round 1: team[7] → team[6] → ... → team[0]
Round 2: team[0] → team[1] → ... → team[7]
...
Round 6: team[0] → ... → team[7]
```

---

## Pick 事务边界（核心并发约束）

**一次合法 pick 必须包含以下 8 步，且全部在同一 Postgres 事务内完成：**

```sql
BEGIN;

-- 1. 行锁：锁住当前赛季的选秀状态，阻塞并发请求
SELECT * FROM draft_state
  WHERE season_id = $seasonId
  FOR UPDATE;

-- 2. 幂等检查：若 client_request_id 已存在于 draft_picks，
--    且 season/team/registration 与本次请求一致，直接返回成功
SELECT id FROM draft_picks WHERE client_request_id = $clientRequestId;

-- 3. 校验：draft_state.is_active = true
--          current_team_id = $teamId（轮到该队了）
--          round_deadline > NOW()（未超时）
--          当前登录用户是该队 captain

-- 4. 校验：目标选手未被选（draft_picks 中不存在该 registration_id）

-- 5. 校验：同主选位置约束（该队同位置已选 < 2 人，包含队长）
SELECT COUNT(*) FROM team_members tm
  JOIN season_registrations sr ON sr.id = tm.registration_id
  WHERE tm.team_id = $teamId
    AND sr.primary_position = $targetPosition;
-- 若 COUNT >= 2 → ROLLBACK，返回错误

-- 6. INSERT draft_picks
INSERT INTO draft_picks (season_id, team_id, registration_id, round,
  pick_number, auto_picked, client_request_id)
VALUES (...);

-- 7. INSERT team_members
INSERT INTO team_members (team_id, registration_id, is_starter)
VALUES ($teamId, $registrationId, <按 round 判断首发/替补>);

-- 8. UPDATE draft_state：推进到下一队 / 下一轮 / completed
UPDATE draft_state
  SET current_team_id = $nextTeamId,
      current_round   = $nextRound,
      round_deadline  = NOW() + INTERVAL '3 minutes',
      is_active       = $stillActive,   -- 最后一 pick 后设为 false
      updated_at      = NOW()
  WHERE season_id = $seasonId;

COMMIT;

-- ⚠️ Realtime 广播必须在 COMMIT 之后触发
-- 不允许在事务内部发送 Realtime 消息
-- 实现：commit 成功后，Server Action 返回前调用广播
```

**违反此规则的常见错误：**
- 在步骤 2 之前 INSERT（丢失幂等保护）
- 遗漏步骤 7（team_members 未写入）
- 在 COMMIT 前广播 Realtime（导致客户端看到中间态）
- 将步骤拆分为多个独立事务（破坏原子性）

---

## Realtime 广播时序

```
Server Action pickPlayer()
  └── db.transaction(8 步)
        └── COMMIT ← 必须先到这里
  └── supabase.channel("draft-live").send({...})  ← 然后才广播
  └── return { success: true }
```

**为什么广播必须在 commit 后**：如果广播在 commit 前失败或事务回滚，客户端将看到一个"幽灵 pick"，导致 UI 和数据库不一致。

---

## 幂等性（`client_request_id`）

客户端每次点击"选择"前生成唯一 UUID，按钮 disabled 后锁定该 ID：

```typescript
// 客户端
const [clientRequestId] = useState(() => crypto.randomUUID());
// 点击后按钮立即 disabled，同一 ID 的重试请求会被步骤 2 短路
await pickPlayer(teamId, registrationId, clientRequestId);
```

重复请求必须允许在 `draft_state` 已经推进到下一队之后返回成功，因此幂等检查要在当前轮次校验之前完成；若同一个 `client_request_id` 被不同 season/team/registration 复用，应返回校验错误。

---

## Cron 超时自动 pick

### 当前生产配置（GitHub Actions）

当前生产由 `.github/workflows/cron.yml` 每分钟调用：

```text
https://match.starfie1d.top/api/cron/draft-timeout
```

请求必须携带 `Authorization: Bearer $CRON_SECRET`。Vercel 环境变量和 GitHub Actions Secret 需要保持一致。

### 可选配置（Vercel Cron）

若后续迁回 Vercel Cron，可使用：

```json
{
  "crons": [{
    "path": "/api/cron/draft-timeout",
    "schedule": "* * * * *"
  }]
}
```

### autoPick 流程

1. 查询 `draft_state WHERE is_active = true AND round_deadline < NOW()`
2. 若不存在，直接返回（大多数情况）
3. 找出当前队伍的位置分布，确定同位置 ≤ 2 人的可选范围
4. 从剩余未选选手中按 `peak_rating DESC` 取第 1 名
5. 以 `auto_picked = true` 走相同的 8 步事务

### 安全验证

```typescript
const authHeader = request.headers.get("authorization");
if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
```

---

## 首发 / 替补判断规则

| 轮次 | 身份 |
|---|---|
| Round 1–4 | 首发（`is_starter = true`） |
| Round 5–6 | 替补（`is_starter = false`） |

加上队长本人，每队 5 首发 + 2 替补 = 7 人（对应 `season.starterCount`）。

---

## Realtime 订阅范围

选秀相关的 Realtime 订阅仅限以下两张表：

| 表 | 事件 | 订阅方 |
|---|---|---|
| `draft_state` | `UPDATE` | 围观页 + 队长面板 |
| `draft_picks` | `INSERT` | 围观页（新 pick 动画） |

**禁止**订阅 `teams`、`team_members`、`season_registrations` 的 Realtime（它们通过正常 RSC 刷新即可）。
