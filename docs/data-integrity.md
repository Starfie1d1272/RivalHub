# 数据完整性策略

> 本文档定义每条业务规则在哪一层（DB / 应用层 / 两者）保证。
> **多人协作原则：能 DB 保证的尽量 DB 保证，应用层只做无法在 DB 表达的复杂规则。**

---

## 约束矩阵

| 业务规则 | DB 层 | 应用层 (Zod / Server Action) | 备注 |
|---|---|---|---|
| **users** | | | |
| email 唯一 | `UNIQUE(email)` | Zod email 格式 | |
| email 格式 | — | Zod | |
| auth_id 唯一 | `UNIQUE(auth_id)` | — | |
| Steam64 17 位数字 | — | Zod regex | DB 不加 CHECK，便于将来兼容其他平台 |
| **seasons** | | | |
| slug 唯一 | `UNIQUE(slug)` | — | |
| capability 默认值 | DB DEFAULT | — | 见 schema |
| **season_registrations** | | | |
| 一人一赛季只一份 | `UNIQUE(user_id, season_id)` | — | |
| 主次位置不同 | — | Zod refine | |
| peak_rating 范围 | — | Zod | DB 不强制（数据来源可信度低） |
| 状态合法迁移 | — | Server Action 校验 | 见 `state-machines.md` |
| 位置上限 ≤ 15 | — | Server Action `COUNT GROUP BY` | 不做 DB 触发器 |
| **captain_votes** | | | |
| 不能给同一人投两票 | `UNIQUE(voter_id, candidate_id)` | — | |
| 不能给自己投票 | — | Server Action | DB CHECK 也可，但应用层够用 |
| 每人最多 3 票 | — | Server Action `COUNT` | 无法用 UNIQUE 表达 |
| 仅 voting 阶段可投 | — | Server Action | 读 season.status |
| **teams** | | | |
| 队伍属于赛季 | `season_id` FK | — | |
| draft_order 唯一（赛季内）| `UNIQUE(season_id, draft_order)` | — | **建议 Phase 6 添加** |
| **team_members** | | | |
| 一名选手只能在一队 | `UNIQUE(registration_id)` | — | **建议添加**（赛季内） |
| **draft_state** | | | |
| 一赛季单例 | `UNIQUE(season_id)` | — | |
| **draft_picks** | | | |
| 同选手不能选两次 | `UNIQUE(season_id, registration_id)` | — | **建议添加** |
| 幂等键唯一 | `UNIQUE(client_request_id)` | — | |
| 同位置 ≤ 3 人/队 | — | Server Action（事务内） | 见 `draft-flow.md` |
| 当前轮次校验 | — | Server Action（事务内 SELECT FOR UPDATE） | |
| **matches** | | | |
| 双方队伍不同 | — | Server Action / DB CHECK | 建议加 CHECK：`team_a_id != team_b_id` |
| 比分非负 | — | Zod + DB CHECK | `score_a >= 0 AND score_b >= 0` |
| 状态合法迁移 | — | Server Action | 见 `state-machines.md` |
| **audit_logs** | | | |
| 不允许修改 | RLS DENY UPDATE/DELETE | — | append-only |

---

## Phase 2 时建议补充的 DB 约束

以下约束当前 schema 未加，建议在 Phase 2（数据层）补 DDL：

```sql
-- teams
ALTER TABLE teams ADD CONSTRAINT teams_season_draft_order_unique
  UNIQUE (season_id, draft_order);

-- team_members（一名选手在一赛季只能进一队）
-- 因为 team_members 没有直接 season_id，需通过 teams 表关联
-- 简化做法：在 registration_id 上加 UNIQUE
ALTER TABLE team_members ADD CONSTRAINT team_members_registration_unique
  UNIQUE (registration_id);

-- draft_picks（同选手不能选两次）
ALTER TABLE draft_picks ADD CONSTRAINT draft_picks_season_registration_unique
  UNIQUE (season_id, registration_id);

-- matches
ALTER TABLE matches ADD CONSTRAINT matches_teams_different
  CHECK (team_a_id != team_b_id);
ALTER TABLE matches ADD CONSTRAINT matches_score_nonnegative
  CHECK ((score_a IS NULL OR score_a >= 0)
     AND (score_b IS NULL OR score_b >= 0));
```

实施方式：通过 Drizzle 的 `unique()` / `check()` 函数加进 schema，再 `db:generate`。

---

## Soft Delete 策略

**本系统不使用 soft delete。**

### 替代方案

| 场景 | 处理方式 |
|---|---|
| 报名被拒 | `status = 'rejected'`（保留行） |
| 报名退出 | 暂不支持，特殊情况 admin 改 status |
| 队员调整 | 不支持中途换人，仅 BO3/BO5 之间替补登场 |
| 比赛取消 | `status = 'cancelled'` |
| 队长撤票 | `DELETE FROM captain_votes WHERE ...`（hard delete） |
| 选秀回滚 | **不支持**——选秀完成后 picks 不可改 |
| 数据修正（admin） | hard delete + audit_log 记录 |

### 为什么不 soft delete

1. 唯一约束（如 `UNIQUE(user_id, season_id)`）在 soft delete 时会冲突，需要复杂的 partial index
2. 业务上"删除"语义不存在——所有"删除"实际上是状态变更
3. `audit_logs` 已经覆盖追溯需求

### 例外

`captain_votes` 的撤票是真删除（DELETE）。原因：撤票场景频繁、票数靠 COUNT 聚合、不需要历史追溯。

---

## Supabase Storage Bucket 策略

### Bucket 列表

| Bucket 名 | 是否 public | 访问方式 | 用途 |
|---|---|---|---|
| `registration-screenshots` | ❌ private | Service Role 生成签名 URL | 报名天梯截图、活跃度截图 |
| `avatars` | ✅ public | 直接 URL | 用户头像、队伍头像（v2） |
| `highlights` | ❌ private | Service Role 生成签名 URL | 高光视频（可选填，admin 审核用） |
| `match-replays` | ❌ private | Service Role 生成签名 URL | demo 文件（v2 可选） |

### 路径约定

```
registration-screenshots/{seasonId}/{userId}/{timestamp}-{filename}
avatars/users/{userId}.{ext}
avatars/teams/{teamId}.{ext}
highlights/{seasonId}/{registrationId}/{filename}
```

### 上传方式

| Bucket | 上传方 | 方式 |
|---|---|---|
| `registration-screenshots` | 客户端 | 直传（Supabase JS Client，从 Server Action 拿到上传 URL） |
| `avatars` | 客户端 | 直传 |
| `highlights` | 客户端 | 直传（大文件） |

### 签名 URL 生成

私有 bucket 的访问统一通过 Server Action：

```typescript
// 仅 admin 可生成签名 URL
async function getScreenshotUrl(registrationId: string): Promise<ActionResult<string>> {
  await requireAdmin();
  // ... 用 Service Role 生成签名 URL，TTL 1 小时
}
```

---

## 多人协作执行规则

1. **新增字段必须先在此文档登记约束归属**（DB / 应用层 / 两者），再写 schema
2. **DB 约束修改必须通过 Drizzle schema + `db:generate`**，禁止手写 SQL 迁移
3. **应用层约束必须有对应的 Zod schema**，并在 `tests/unit/lib/validators/` 有单测
4. **任何"约束在两层都做"的，应用层错误信息和 DB 错误码必须能映射**（通过 `ErrorCode` 统一）
