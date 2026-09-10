# RivalHub 领域模型

本文件定义跨模块必须共同理解的实体、事实层级和不变量。字段、约束和迁移细节以 `src/db/schema/`、active migrations 与 tests 为准；流程见 [`workflows.md`](./workflows.md)。

## Identity and long-lived facts

### User and authorization

`users.id` 是自然人的 canonical identity，也是长期公开资料的根实体。Supabase Auth、邮箱与未来 provider identity 都是由 `user_identities` 绑定的 credential，而不是 person id；同一 active external identity 全局只属于一个 canonical user。全局角色只有 `user` 与 `super_admin`；具体赛事管理权由 `season_admin_grants` 单独表达。授权不是客户端状态，也不从历史报名或队伍身份推导。

credential linking 只证明并绑定新的 identity，不复制或移动赛事事实。两个已有 `users.id` 的归并必须先生成 fail-closed preflight：用户选择的保留账号资料和竞技资料原样不变，待归并账号的竞技资料直接删除；登录身份、已确认的 person facts 和不冲突的业务历史归到保留账号，临时状态关闭，历史 actor/provenance 继续保留原账号。只有 Steam 身份、Team 时间线/队长状态、不同参赛身份或同一地图两份正式比赛数据等无法无歧义处理的事实才阻止自助归并。成功归并后 loser 作为可追溯 alias 保留在 `user_merge_ledger`，不会被无痕删除。

### Education

`institutions` 是机构目录，`education_verifications` 是长期教育资格事实。学校邮箱快速认证消费 canonical user 的任一 verified email credential 的精确 active domain mapping，而非仅 primary login email；认证事实仍写入 canonical `users.id`。赛事资格只消费已验证教育事实和当届冻结规则；legacy `studentId` 不构成 Major eligibility。

### Competitive profile

竞技资料分四层：

```text
CompetitivePlatform
├─ Rank ladder
├─ PlatformSeason chronology
└─ CompetitiveRankFact (user fact)
```

- platform 拥有稳定 key 和 rank ladder；season 只表达时间目录，不拥有另一份段位顺序。
- 当前竞技平台身份、ladder 与 canonical Rating 属于产品定义的内置 domain；新增平台、改变段位体系或重新定义 canonical Rating 需要显式产品/迁移变更，不能由管理员临时创建另一套语义。
- `rank`、`stars`、`rating` 是不同事实：rank 是稳定段位身份，stars 是星段位内部精确值，rating 是平台定义的 performance rating。
- 缺失事实保持 unknown；不能为了展示或资格判断制造默认段位、默认星数或 `0`。
- 跨平台比较使用版本化 `ConversionPolicy`。mapping 与 `sourceNote`、`rationale`、`changeSummary` 属于平台级可审计事实；`internalNote` 只属于 super admin 运营面，不进入赛事设置或冻结快照。
- `ConversionPolicy` 由独立 lifecycle owner 管理：已有策略 clone 成 draft，draft 保存和 approve 共用 mapping validator，approved 版本可原子切换 current，只有非 current 的 approved 版本可以 retired；每个 mutation 都保留 `audit_logs`。
- 需要竞技资格的赛事在实际报名开放时冻结本届需要的 season/ladder/evidence/conversion context。赛事只保存 policy identity/version 与当届 conversion snapshot；全局 current、provenance 或 policy retire 不得重解释该届或历史 StageRun。没有 stable policy id 的 legacy mapping 不伪造全局 policy 引用。

CS2 地图同样区分稳定地图目录、当前轮换、长期用户熟练度与赛事自身图池。具体当前地图集合属于代码/config，不在本文件复制。

## Season and capabilities

`seasons` 是赛事容器；业务能力来自 persisted capability/config，而不是展示字段 `kind`。内置 Rivals/Major 模板提供初始固定语义，自定义赛事使用同一 capability model。

重要边界：

- `competitionTemplate` 表达模板身份；`kind` 只用于展示/历史。
- `stagePlan` 是定义态，不是已启动赛事的运行时真相。
- 发布与实际报名开放是不同事实；需要冻结的报名/竞技上下文在实际开放时形成。
- 系统不存在持久化的“全局当前赛事”；首页 featured season 和后台生命周期分组都是 presentation projection。
- 社区奖是否存在由独立 capability 表达，不从 `season.status` 推导。

Season 配置的 owner 不按 `kind` 分支：`src/types/season.ts` 只定义 canonical contract；新赛事的当前默认值来自 `src/lib/competition/templates.ts`；读取 nullable/partial 历史 JSON 时才经过 `src/lib/seasons/compatibility.ts`。CS2 稳定地图目录与当前轮换由 `src/lib/config/cs2-maps.ts` 拥有，位置目录由 `src/lib/config/cs2-positions.ts` 拥有，Season 状态标签与公开报名排期 projection 由 `src/lib/seasons/presentation.ts` 拥有，地图展示与偏好 projection 由 `src/lib/maps.ts` 拥有。compatibility fallback 是冻结历史语义，不反向定义当前产品默认值。

## Team → CompetitionEntry → roster facts

这是 RivalHub 最重要的身份分层：

```text
Long-lived Team
      │ optional source
      ▼
CompetitionEntry
      ▼
Roster Revision
      ▼ approve / materialize
EventRoster
      ▼ per match
MatchRoster
```

### Long-lived Team

`teams` 与 membership/captain/name history 表达跨赛事持续存在的队伍关系。Team 不属于任何 Season，换人或改名不能修改历史赛事事实。

Recruitment 是 Team/Player 的当前意向，不是 membership、invitation 或 CompetitionEntry；正式入队仍由 Team invitation/membership owner 完成。

### CompetitionEntry

`competition_entries` 是一届赛事中的唯一参赛方身份，从报名延续到比赛和历史。Major 通常由长期 Team 创建；Rivals 选秀队可以 `teamId = null`，因此不需要凭空创建长期 Team。

人员事实严格分层：

| 事实 | 含义 |
| --- | --- |
| Team membership | 当前/历史长期队伍归属 |
| Entry participant | 本人是否确认参加这一届赛事 |
| Roster revision | 可编辑、可审核、可补正的报名名单 |
| EventRoster | 本届已确认/冻结的正式赛事名单 |
| MatchRoster | 本场实际出场阵容 |

这些 owner 不能互相替代。尤其 MatchRoster 必须来自本届 EventRoster，而不是回读可变 Team membership 或报名草稿。

Entry qualification 由 canonical qualification owner 计算。只有明确标记为可解除的政策 finding 才能形成 restriction override；资料缺失、身份、确认状态等硬 blocker 不能被管理员“强行通过”。override 绑定当前 roster revision，新 revision 不继承旧解除。

## Rivals-specific facts

Rivals 的个人报名仍由 `season_registrations` 表达；投票由 `captain_votes` 表达，选秀状态与 pick 分别由 `draft_state` / `draft_picks` 表达。选秀形成的赛事队伍最终仍落到 CompetitionEntry/roster facts，因此比赛和历史不依赖一套平行 Team runtime。

## Match facts

`matches` 是比赛身份、状态和官方系列赛结果；`match_maps` 是实际进行地图及其回合比分。正常 BO1/BO3/BO5 都由 map-level 事实推导系列赛比分；弃赛只记录官方系列赛结果，不制造未进行地图。

BP、时间协商、实际阵容、玩家统计和赛后资料拥有各自明确事实。后台列表、standings、工作台摘要都只是这些事实的 projection，不成为新的结果或 roster owner。

结果更正不能绕开 managed runtime。若更正会影响 Major 后续 pairing/stage，必须通过 recovery owner 处理。

## Major prestart and runtime

Major 从“报名通过”到“正式开赛”还需要单独的赛前事实：

```text
approved CompetitionEntry candidates
→ final entrant set
→ EventRoster reconciliation
→ freeze entrants + rosters
→ immutable SeedRecommendationSnapshot
→ human final seeds
→ start StageRun
```

已批准 Entry 只是候选；正式 entrant set、EventRoster、系统种子建议和管理员最终 seed 都是不同事实。系统建议 snapshot 冻结其输入与 provenance，不能因之后查看排序或人工调整而重算；最终 seed 由独立 seed owner 保存。

`major_stage_runs` 是已启动阶段的运行时身份并冻结该阶段需要的规则、entrant 和 eligibility context；`major_stage_entrants` 是阶段参与者真相。后续推进依赖 StageRun + 已完成比赛，而不是 UI standings。

历史 snapshot 保留当时事实，即使 live profile、目录或政策后来变化也不重解释。

## Discipline, results and awards

这些领域故意分离：

- `disciplinary_cases`：个人/赛事纪律事实；
- match correction / adjudication：比赛或赛后裁决；
- `major_final_results`：正式最终结果；
- `tournament_honors`：官方荣誉；
- `community_awards`：独立的社区奖流程。

处罚不会自动改写比分、placement 或 honor；冠军/荣誉撤销也不会隐式递补另一名获奖者。任何连锁影响必须由显式 adjudication 产生可审计事实。

`audit_logs` 记录“谁改变了什么业务事实”，不是领域状态本身，也不是 runtime observability。

## Spectator prediction facts

A prediction program freezes per-event slot, challenge and point rules when enabled. A contest freezes one official StageRun entrant set and a deadline; neither simulated entrants nor a mutable team roster can redefine that identity. Pick rows are append-only versions with separate draft/submitted intent. The latest accepted complete submission is effective; later drafts do not replace it. Judgement history follows accepted official stage facts and can be invalidated by correction or stage cancellation.

A spectator account belongs to one event and one canonical user. Its balance and settled profit are ledger projections, not mutable counters. Stakes, settlement batches and reversals preserve their original provenance. The first official stage launch is a separate immutable milestone, so recreating a StageRun cannot grant late joiners historical supplies. Markets preserve the original match identity and opponents even if tournament recovery deletes the match. Removed/replaced matches refund; official corrections reverse the previous batch before applying the next. Debt is retained when previously credited winnings have been spent. Account merges with a losing spectator account are blocked for manual resolution; historical scenario authors remain provenance.

Challenge coins are derived spectator achievements, separate from player `tournament_honors` and point balances. Only an enabled valid-lock participation reward can connect Pick’Em with points; correctness and coin upgrades never mint points.

## Intentional snapshots

以下重复是有意的历史冻结，不应为了“去重”删除：

| Mutable/live fact | Event/runtime snapshot |
| --- | --- |
| Team membership | CompetitionEntry / EventRoster |
| editable roster revision | approved/frozen EventRoster |
| live education/competitive profile | event/StageRun eligibility facts |
| current ConversionPolicy/catalog | event frozen competitive context |
| current seed inputs | immutable seed recommendation snapshot |
| current result | correction/adjudication history |

原则：**live profile 回答“现在是什么”，snapshot 回答“当时按什么运行”。**

## Core invariants

| Invariant | Canonical owner |
| --- | --- |
| Auth identity / email uniqueness | Auth sync + DB constraints |
| season-scoped admin authority | `season_admin_grants` + server guards |
| 一用户同赛事只能有一个 active Entry commitment | DB claim constraint + transaction owner |
| affiliation / competitive qualification | `src/lib/qualification/` |
| Team membership 与赛事 roster 分离 | teams / CompetitionEntry / roster owners |
| Entry roster change 不静默改写 frozen EventRoster | CompetitionEntry + Major prestart owners |
| 一场比赛阵容只能消费本届合法 EventRoster | match-roster owner + DB invariant |
| Major runtime 按 frozen StageRun facts 推进 | `src/lib/major/` |
| official series score 与 map score 语义分离 | match result owner |
| public business tables 默认 server-only | generated database access matrix + migrations |
| privileged mutation 保留 audit | domain transaction + `audit_logs` |

当新增需求似乎需要第二份状态字段、第二套 evaluator 或从 presentation 反推业务事实时，应先检查是否已经违反上述 ownership。
