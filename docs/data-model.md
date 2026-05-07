# 数据模型

## ER 图（Mermaid）

```mermaid
erDiagram
  users {
    uuid id PK
    uuid auth_id UK "Supabase auth.users"
    text email UK
    text steam64
    text qq
    timestamp created_at
    timestamp updated_at
  }

  seasons {
    uuid id PK
    text slug UK "e.g. rivals-2026-spring"
    text name
    season_kind kind "仅展示用，业务逻辑读 capability"
    season_status status
    text theme_color
    registration_mode registration_mode "solo | team"
    bool has_captain_voting
    bool has_draft
    bracket_type bracket_type "double_elim | single_elim | round_robin | null"
    int team_size
    int starter_count
    timestamp start_at
    timestamp end_at
    timestamp created_at
    timestamp updated_at
  }

  season_registrations {
    uuid id PK
    uuid user_id FK
    uuid season_id FK
    position primary_position
    position secondary_position
    int peak_rating
    text screenshot_url
    registration_status status
    bool willing_to_be_captain
    text notes
    timestamp created_at
    timestamp updated_at
  }

  teams {
    uuid id PK
    uuid season_id FK
    text name
    uuid captain_registration_id FK
    int draft_order "1-based 蛇形顺位"
    timestamp created_at
  }

  team_members {
    uuid id PK
    uuid team_id FK
    uuid registration_id FK
    bool is_starter
    timestamp joined_at
  }

  captain_votes {
    uuid id PK
    uuid voter_registration_id FK
    uuid candidate_registration_id FK
    timestamp created_at
  }

  draft_state {
    uuid id PK
    uuid season_id UK
    int current_round
    uuid current_team_id FK
    timestamp round_deadline
    bool is_active
    timestamp updated_at
  }

  draft_picks {
    uuid id PK
    uuid season_id FK
    uuid team_id FK
    uuid registration_id FK
    int round
    int pick_number
    bool auto_picked
    text client_request_id UK "幂等键"
    timestamp created_at
  }

  matches {
    uuid id PK
    uuid season_id FK
    uuid team_a_id FK
    uuid team_b_id FK
    int score_a
    int score_b
    match_status status
    text bracket_node_id
    timestamp scheduled_at
    timestamp completed_at
    timestamp created_at
    timestamp updated_at
  }

  audit_logs {
    uuid id PK
    uuid season_id FK
    text action "e.g. registration.approve"
    text actor_id
    text target_id
    text target_type
    jsonb meta
    timestamp created_at
  }

  users ||--o{ season_registrations : "has"
  seasons ||--o{ season_registrations : "contains"
  seasons ||--o{ teams : "has"
  seasons ||--o{ draft_state : "controls"
  seasons ||--o{ draft_picks : "records"
  seasons ||--o{ matches : "hosts"
  seasons ||--o{ audit_logs : "logs"
  teams ||--o{ team_members : "has"
  teams ||--o{ draft_picks : "makes"
  season_registrations ||--o{ captain_votes : "voter"
  season_registrations ||--o{ captain_votes : "candidate"
  season_registrations ||--o{ team_members : "member"
  season_registrations ||--|| teams : "captain"
```

---

## 枚举值

### `season_kind`
| 值 | 说明 |
|---|---|
| `rivals` | NJU Rivals 春季赛（仅展示标记） |
| `major` | NJU Major 秋季赛（仅展示标记） |

> ⚠️ `kind` 仅用于界面展示，业务逻辑不得读取此字段做功能分支。所有功能门控读 capability 字段（`hasDraft`、`hasCaptainVoting` 等）。

### `registration_mode`
| 值 | 说明 |
|---|---|
| `solo` | 个人报名（Rivals 模式） |
| `team` | 队伍整体报名（Major v2 模式） |

### `bracket_type`
| 值 | 说明 |
|---|---|
| `double_elim` | 双败淘汰 |
| `single_elim` | 单败淘汰 |
| `round_robin` | 循环赛 |

### `season_status`
| 值 | 说明 |
|---|---|
| `draft` | 未发布 |
| `registration` | 报名开放中 |
| `voting` | 队长投票阶段 |
| `drafting` | 蛇形选秀进行中 |
| `playing` | 正赛进行中 |
| `finished` | 赛季已结束 |
| `archived` | 历史归档 |

### `position`
| 值 | 游戏内名称 |
|---|---|
| `igl` | 指挥（IGL） |
| `awper` | 狙击手（AWPer） |
| `entry` | 突破手（Opener/Entry） |
| `lurker` | 自由人（Closer/Lurker） |
| `support` | 主防（Anchor/Support） |

### `registration_status`
| 值 | 说明 |
|---|---|
| `pending` | 待审核 |
| `approved` | 已通过 |
| `rejected` | 已拒绝 |
| `waitlisted` | 等待名单 |

### `match_status`
| 值 | 说明 |
|---|---|
| `scheduled` | 已排期 |
| `in_progress` | 进行中 |
| `finished` | 已结束 |
| `cancelled` | 已取消 |

---

## 唯一约束 & 关键索引

| 表 | 约束 |
|---|---|
| `users` | `UNIQUE(email)`, `UNIQUE(auth_id)` |
| `seasons` | `UNIQUE(slug)` |
| `season_registrations` | `UNIQUE(user_id, season_id)` |
| `captain_votes` | `UNIQUE(voter_registration_id, candidate_registration_id)` |
| `draft_state` | `UNIQUE(season_id)` |
| `draft_picks` | `UNIQUE(client_request_id)` |

建议索引（`drizzle-kit` 迁移中添加）：
- `season_registrations(season_id, status)` — 审核列表过滤
- `season_registrations(season_id, primary_position)` — 位置计数
- `captain_votes(candidate_registration_id)` — 票数聚合
- `draft_picks(season_id, round, pick_number)` — 选秀顺序查询
- `matches(season_id, status)` — 赛程过滤

---

## 强制约束（来自规则书）

1. 每个主选位置上限 15 人（应用层 Server Action 校验，不用 DB 触发器）。
2. 每位选手每届赛事只能投 3 票（应用层计数校验）。
3. 每队同主选位置不超过 3 人（选秀 pick 时 Server Action 校验）。
4. 选秀共 6 轮，每队选 6 人（队长本人 + 6 pick = 7 人）。
5. 时间字段统一 UTC 存储，`Asia/Shanghai` 展示。
