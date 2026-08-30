# CompetitionEntry 终态迁移与退役验收

状态：已实施（2.x）

## 终态

长期队伍只描述跨赛事持续存在的队伍关系。每次参赛由一条独立的参赛记录承担，比赛、赛段参赛方和赛后结果均指向该记录。

```text
长期队伍 → 参赛记录 → 赛事名单 → 赛段参赛方 / 比赛 → 本场阵容
```

`CompetitionEntry` 是参赛方的唯一规范标识。它从报名草稿存续到历史查询；不会再在参赛记录之下生成另一层运行时队伍。

人员事实严格分层：

| 事实 | Owner | 不可替代的含义 |
| --- | --- | --- |
| 长期队伍成员 | `team_memberships` | 跨赛事的队伍归属和队长关系 |
| 本届参赛承诺 | `competition_entry_participants` | 是否确认参加这一届赛事 |
| 报名版本 | `competition_entry_roster_revisions` / `competition_entry_roster_members` | 可审核、可补正的报名内容 |
| 赛事名单 | `event_rosters` / `event_roster_members` | 已冻结的资格与名单事实 |
| 本场阵容 | `match_rosters` / `match_roster_players` | 本场实际出场人员 |

因此，本场阵容只关联 `event_roster_members`，不会回退依赖可变的报名成员或长期队伍成员。

## 存量转换

迁移 `0017_broad_doctor_octopus` 在一个事务内锁定并重命名旧表、建立新表、回填外键、验证无未映射事实，最后删除旧表。

- 2026 Spring Rivals 的旧 `teams.id` 复用为 `event_native CompetitionEntry.id`；不创建长期队伍。原队名、队长、成员、对阵和赛果随参赛记录与赛事名单保留。
- Major 的 `team_application.id = A → teams.id = B` 使用 `A` 作为唯一 `CompetitionEntry.id`，`B` 仅通过 `competition_entry_legacy_identities` 记录来源；如需长期队伍，使用 `B` 作为新长期 Team 的保留 ID。ID 保留服务于迁移，绝不引入第二个参赛方 ID。
- `matches`、`major_stage_entrants`、`major_prestart_entrants`、Swiss standings、选秀、地图 veto、赛后裁决与荣誉均回填为 Entry 外键；历史阵容成员回填为 `event_roster_members`。

## 退役计划与验收条件

迁移完成即满足以下条件：

1. active schema 不存在 `team_members`、`team_applications`、`team_application_members`、`team_application_active_claims` 或 `major_prestart_roster_members`。
2. active schema 不存在任何 `runtime_team_id`，且所有比赛参赛方外键为 `entry_a_id` / `entry_b_id`。
3. 每个历史 Match、StageEntrant、预开赛 entrant 和 roster player 均有可解析的 Entry 或赛事名单成员；发现缺失映射即让迁移失败并回滚。
4. 新建长期队伍不会自动成为任一赛事参赛方；每届赛事均须创建独立报名记录。
5. Data API 对新旧敏感表均默认拒绝，业务读写只通过服务器端流程。

可复核命令：

```bash
pnpm db:check
pnpm db:local:reset
pnpm db:local:verify-migrations
pnpm test:team-registration:local
pnpm test
```

旧 ID 映射表只用于历史来源追溯、审计和迁移核对，不是运行时兼容 API。下一次数据保留期审查应确认无外部消费者后，按数据保留政策清理该 provenance 记录；不会恢复旧运行时表或写入路径。
