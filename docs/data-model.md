# 数据模型

## ER 图（Mermaid）

```mermaid
erDiagram
  users {
    uuid id PK
    uuid auth_id UK "Supabase auth.users"
    text email UK
    user_role role "user | season_admin | super_admin，默认 user"
    uuid[] admin_season_id "season_admin 管辖赛季列表，默认空数组"
    text student_id "学号；毕业生填毕业年份+学院"
    text qq
    text perfect_name "完美平台昵称（记分板显示名）"
    text steam_name "Steam 昵称"
    text steam64 "Steam 64-bit ID"
    text steam_profile_url "Steam 个人资料链接"
    text avatar_url "Steam 头像 URL（报名时缓存；旧数据缺失时 player page fallback 实时获取）"
    timestamp created_at
    timestamp updated_at
  }

  seasons {
    uuid id PK
    text slug UK "e.g. spring-2026-league"
    text name
    text kind "自由文本标记，仅展示用"
    season_status status
    text theme_color
    registration_mode registration_mode "solo | team"
    bool has_captain_voting
    bool has_draft
    json stage_plan "StageConfig[]"
    json registration_config "RegistrationConfig (含 maxTotal)"
    int min_team_size
    int max_team_size
    json team_registration_config "TeamRegistrationConfig"
    int starter_count
    text[] positions "该赛季可用位置列表"
    json bracket_data "brackets-manager state"
    timestamp start_at "报名提交开放时间"
    timestamp registration_deadline "报名提交截止时间"
    timestamp end_at "赛季结束时间"
    timestamp created_at
    timestamp updated_at
  }

  registration_drafts {
    uuid id PK
    uuid season_id FK
    text email
    json payload "未校验表单快照"
    timestamp created_at
    timestamp updated_at
  }

  season_registrations {
    uuid id PK
    uuid user_id FK
    uuid season_id FK
    text player_type "enrolled | graduated | external"
    text primary_position
    text secondary_position
    text peak_rank
    text peak_rank_season
    real peak_rating "0.01–3.00，两位小数"
    real peak_we "0.0–16.0，一位小数，可选"
    text current_season_peak_rank
    real current_rating "0.01–3.00，两位小数"
    real current_we "0.0–16.0，一位小数，可选"
    text[] screenshot_urls
    text gameplay_style
    text competition_history
    text highlight_video_url
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
    text logo_url "可空；Supabase Storage team-logos bucket 公开 URL"
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
    text stage "StagePlan[n].key"
    int round "Swiss round; null for round_robin / elim"
    match_format format "bo1 | bo3 | bo5"
    int score_a "系列赛比分（如 BO3 中 2:1）"
    int score_b
    match_status status
    text bracket_node_id
    timestamp scheduled_at
    timestamp completion_deadline
    timestamp completed_at
    timestamp created_at
    timestamp updated_at
  }

  match_maps {
    uuid id PK
    uuid match_id FK
    int map_order "1-based, 最大 5"
    text map_name "如 de_inferno"
    uuid picked_by_team_id FK "决胜图为 null"
    side team_a_start_side "t | ct | null"
    int score_a
    int score_b
    timestamp completed_at
    timestamp created_at
  }

  match_player_stats {
    uuid id PK
    uuid match_id FK
    uuid map_id FK
    text perfect_name "记分板原始昵称"
    uuid user_id FK "可 null：未匹配用户"
    int kills
    int deaths
    int assists
    int hs_percent "0–100"
    int first_kills
    int multi_kills
    int clutches
    real adr
    real rws
    real rating_pro
    real we "0.0–16.0"
    text verified_by_admin
    timestamp verified_at
    timestamp created_at
  }

  match_veto_steps {
    uuid id PK
    uuid match_id FK
    int step_order
    text action_type "ban | pick | decider"
    text map_name "如 de_inferno"
    uuid team_id FK "执行队伍，decider 为 null"
    side side "t | ct | null"
    timestamp created_at
  }

  match_mvp_votes {
    uuid id PK
    uuid match_id FK
    uuid player_user_id FK "可 null：未注册选手"
    text player_name "兜底显示名"
    uuid voter_user_id FK
    timestamp created_at
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

  admin_users {
    uuid id PK
    text username UK
    text password_hash "scrypt(salt+password)"
    admin_role role
    bool is_active
    timestamp created_at
    timestamp updated_at
  }

  admin_invites {
    uuid id PK
    text code UK
    text created_by "创建者标识（root:xxx 或 users.id）"
    admin_role role "admin(→season_admin) | super_admin"
    uuid season_id FK "season_admin 邀请绑定赛季，super_admin 邀请为 null"
    int max_uses
    int used_count
    text[] used_by_usernames
    timestamp expires_at
    bool is_active
    timestamp created_at
  }




  users ||--o{ season_registrations : "has"
  seasons ||--o{ season_registrations : "contains"
  seasons ||--o{ teams : "has"
  seasons ||--o{ draft_state : "controls"
  seasons ||--o{ draft_picks : "records"
  seasons ||--o{ matches : "hosts"
  seasons ||--o{ audit_logs : "logs"
  matches ||--o{ match_veto_steps : "records_veto"
  matches ||--o{ match_maps : "consists_of"
  matches ||--o{ match_player_stats : "has"
  match_maps ||--o{ match_player_stats : "has"
  users ||--o{ match_player_stats : "identified_as"
  teams ||--o{ team_members : "has"
  teams ||--o{ draft_picks : "makes"
  season_registrations ||--o{ captain_votes : "voter"
  season_registrations ||--o{ captain_votes : "candidate"
  season_registrations ||--o{ team_members : "member"
  season_registrations ||--|| teams : "captain"
```

---

## 枚举与约束速查

| 字段 | 可选值 | 说明 |
|---|---|---|
| `user_role` | `user` / `season_admin` / `super_admin` | `season_admin` 管辖 `adminSeasonIds` 内赛季 |
| `season_status` | `draft` / `registration` / `voting` / `drafting` / `playing` / `finished` / `archived` | 见 `docs/state-machines.md` |
| `registration_mode` | `solo` / `team` | 个人 / 队伍整体报名 |
| `registration_status` | `pending` / `approved` / `rejected` / `waitlisted` | |
| `admin_role` | `super_admin` / `admin` | |
| `match_status` | `scheduled` / `in_progress` / `finished` / `cancelled` | |
| `match_format` | `bo1` / `bo3` / `bo5` | |
| `matches.stage` | `qualifier` / `playoff` | 存 `StagePlan[n].key`，非展示名 |
| `side` | `t` / `ct` | 进攻方 / 防守方 |
| `season.positions[]` | `igl` / `awper` / `opener` / `closer` / `anchor` | CS2 五位置，赛季可配 |
| `season.kind` | 自由文本 | **仅展示用，禁做功能分支。读 capability 字段** |
| `season.stage_plan` | `StageConfig[]` JSON | `key`(业务标识) / `name`(展示) / `type`(`round_robin`\|`double_elim`\|`single_elim`\|`swiss`) / `teamCount` / `advance` / `seeds` |

### 唯一约束速查

`users(auth_id, email)` · `seasons(slug)` · `registration_drafts(season_id, email)` · `season_registrations(user_id, season_id)` · `captain_votes(voter, candidate)` · `draft_state(season_id)` · `draft_picks(client_request_id)` · `match_maps(match_id, map_order)` · `match_veto_steps(match_id, step_order)` · `admin_users(username)` · `admin_invites(code)` · `match_player_stats(map_id, perfect_name)` · `match_mvp_votes(match_id, voter_user_id)`

### 应用层约束（规则书）

每个主选位置上限 15 人，总报名上限 56 人（`registrationConfig.maxTotal`），每位选手每届 3 票，每队同位置 <= 2 人（选秀时校验），选秀 6 轮（队长 + 6 pick = 7 人）。时间字段统一 UTC，展示层 Asia/Shanghai。

### Phase 2 新增表

`match_time_proposals`（时间协商：`proposed_time`、`status`(pending/accepted/rejected/expired)、`reject_reason`）、`match_rosters` + `match_roster_players`（赛前名单：每场一条 roster，`is_starter` 区分首发 5 人 / 替补 <=2 人，`status`(submitted/unlocked)）。
