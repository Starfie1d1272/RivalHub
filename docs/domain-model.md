# RivalHub 领域模型

本文件描述稳定领域关系，而不是字段百科。精确列、约束与 migration history 以 `src/db/schema/` 和 `drizzle/migrations/` 为准。

## 1. Accounts / Identity

`users` 将应用账户关联到 Supabase Auth，并保存角色、跨赛事展示资料、Steam 与 Perfect World identity。`users.role` 为 `user`、`season_admin` 或 `super_admin`；`admin_users` 仅保存 legacy emergency Root 兼容身份，`admin_invites` 支持正常账号的管理员授予。

`users.studentId` 是 legacy compatibility field，不能作为 Major eligibility source。

## 2. Education

`institutions` 与 `institution_email_domains` 是机构目录；`education_verifications` 是用户的长期教育资格事实，含 institution、学籍状态、证据类型与审核状态。Major 在需要时引用已验证教育事实，而不从旧用户字段推断资格。

## 3. Competitive profile

`competitive_platform_seasons` 管理竞技平台赛季目录；`competitive_rank_facts` 存储用户对当前、历史平台赛季或跨赛季 peak 的可审查竞技事实。它们是独立于某届 RivalHub 赛事的长期资料。

## 4. Seasons

`seasons` 是赛事容器，包含状态、时间、人数、positions 与 capability configuration。`kind` 只用于展示；报名方式、选秀、阶段和资格规则由 capability fields 及关联配置决定。StagePlan 是可变的赛季定义，启动后不能代替冻结的 StageRun 事实。

## 5. Rivals registrations

`season_registrations` 是 Rivals 的本届个人报名，包含位置、报名期竞技快照、地图偏好和审核状态。`registration_drafts` 服务于可恢复的表单编辑。它们不是 Major team application 的替代物。

## 6. Team applications

`team_applications` 表示 Major 报名阶段的队伍申请；`team_application_members` 记录邀请、确认和申请期成员关系；`team_application_active_claims` 防止同一用户在同一赛季出现冲突的 active claim。审核通过后申请物化为正式 `teams` 与 `team_members`，并保留 provenance。

## 7. Teams

`teams` 是比赛运行时的正式队伍，包含 `captainUserId` 与来源；`team_members` 是正式的赛季队伍成员。Rivals 通过个人报名/选秀产生来源，Major 通过 approved application 产生来源。普通 `teams`、`match_rosters` 和 `draftOrder` 不能替代 Major entrants、最终名单或赛事种子。

## 8. Captain voting / draft

`captain_votes` 是 Rivals 投票记录。`draft_state` 维护单届实时选秀状态，`draft_picks` 用 `clientRequestId` 支持幂等。选秀与队员写入在同一事务内完成，事务完成后才可发送 Realtime。

## 9. Matches

`matches` 表示赛程和比赛状态，并区分 `manual` 与 `major_stage` ownership。`match_maps`、`match_veto_steps`、`match_time_proposals`、`match_mvp_votes` 与 `match_player_stats` 记录比赛细节。结果更正必须保留 audit 与适用的运行时边界。

## 10. Match rosters

`match_rosters` 与 `match_roster_players` 是具体比赛的提交/确认阵容；它们把某一场比赛的可操作名单与 live team membership 分开。Major match roster 校验基于对应的冻结阶段事实。

## 11. Major prestart

`major_prestart_states`、`major_prestart_entrants`、`major_prestart_roster_members`、`major_tournament_seeds` 与 `major_prestart_issues` 管理开赛前的 readiness、参赛队、最终名单、种子和 blocker。只有完成相应确认的预启动事实才能被 Major start 消费。

## 12. Major stage runtime

`major_stage_runs` 冻结阶段规则与运行时 identity；`major_stage_entrants` 是阶段参与者的 canonical truth；`major_final_results` 记录待确认/已确认的最终结果。冻结 affiliation / rule snapshot 支持恢复、审计和历史复现，不应被当作可去重的重复数据。

## 13. Discipline

`disciplinary_cases` 与 idempotency records 管理 sanction 的状态、范围与效果。纪律事实不自动重写 placement、honor 或比赛结果；关联影响通过明确的 adjudication 工作流处理。

## 14. Post-event

`post_event_adjudications` 保存赛后裁决，`tournament_honors` 保存冠军、亚军、名次或手动奖项及其有效/撤销/空缺状态。冠军被撤销不会自动把亚军提升为冠军；每项历史事实需要独立裁决。

## 15. Audit

`audit_logs` 是管理操作的持久审计轨迹。它与业务事实互补，不代替可查询的领域状态。管理员写操作必须同时考虑结果与审计记录。

## 16. Operational/support data

`user_sessions` 仅用于在线状态心跳，不是鉴权来源。Storage、Auth 与 Data API 的安全边界见 [`auth-and-permissions.md`](./auth-and-permissions.md)。

## Intentional snapshots

下列看似重复的数据是故意冻结的历史事实，支持 audit、historical truth、recovery 与 reproducibility：

| Live fact | Frozen or event-specific fact |
|---|---|
| Team application | approved formal team |
| live team membership | frozen tournament entrant / roster |
| mutable season policy | StageRun rule snapshot |
| current match result | correction / adjudication history |
| current education verification | historical eligibility reference |

清理重复时必须先确认没有破坏这些边界。
