# PostgreSQL 保留集合的风险审查

起点是 #942 首次提交的 **318 个 PG 用例**，不是原仓库 352 个。完整原保留名称在 [pg-original-retention.csv](./pg-original-retention.csv)，最终逐用例处置在 [cases.csv](./cases.csv)。分类只组织审查，不以“migration/permission”标签自动保留。以下每项以实际被测 owner 和既有 oracle 为依据；未把多个旧 `it` 合并来减少计数。

## 原 318 分类

| 类别 | 原用例 | 独有风险 |
| --- | ---: | --- |
| 金额/下注/结算 | 65 | BET/预测市场的账本、资格、窗口、幂等、退款/反转/债务与旧 reader/publisher 兼容；free predictions 的锁/身份隔离属于同类数据边界。 |
| 身份/Session | 31 | Auth subject 和应用 user 的绑定、撤销水位、provider 未知结果 fence、实际行锁竞争与合并 FK/历史/alias；不同入口或不同锁顺序不能只以 generic rollback 替代。 |
| 教育证据 | 10 | 并发提交、审核状态、私有文件/key、过期前可见性、Storage 删除失败与历史保留；只读排序/分页/facets 可退役。 |
| 迁移/恢复 | 37 | 非空 legacy backfill、不同 SQL 前置条件、DDL/FK/ACL/RLS/恢复种子碰撞与真实迁移 journal/hash；空库重放只覆盖正常路径。 |
| 报名/队伍/邀请 | 11 | 用户、队伍、Entry、roster commitment 与邀请所属边界、withdrawal/claim history、报名时钟及并发；视图经过同函数不替代拒绝后事实不变。 |
| 赛事/冻结/治理 | 28 | 资格 waiver revision、catalog/current 与冻结引用、prestart 原子 freeze、真实 Major/Play-in 晋级/成绩/历史；独立 24/32 或 Direct/Swiss 规则入口。 |
| 比赛/约战/赛后 | 86 | 真实 map/series 更正、实际开始的 immutable facts、锁后重查、proposal attribution/coverage capacity、claimant 与赛后/申诉 recovery/原子提交。 |
| 机器接口/LIVE | 45 | 机器主体与 season/match/source/epoch/generation/lineup scopes，可靠 ingest→正式结果，private 广播 fencing/撤权与有限 ingress 故障清理。 |
| 审计/后台读模型 | 4 | 审计展示重新授权、secret/identity 不外泄、match detail 不跨赛事；纯列表 counts/pagination 可退役。 |
| DB 未知提交结果 | 1 | 实际 commit 后 response loss 不能转为第二次写入，SQL constraint 与 rollback 仍成立。 |

## 本次代表性缩减：9 个

| 删除 | 替代证据 / 减少的具体 oracle |
| --- | --- |
| admin-high-value-read-models 的 counts/分页整项（1） | 退役唯一的列表 SQL 计数/排序/分页 oracle，没有等价替代；不是权限/写入/账本验证。admin-match-read-models 的真实跨赛事拒绝保留。 |
| education review 排序/分页与 facets（2） | 退役读模型组合；同文件 expired evidence 在物理删除前必须不被查出、不能以 evidence code 搜索命中且不外泄 object key 的独立 privacy 用例保留；Retention 的历史/Storage 失败用例保留。 |
| commentary schedule=null 变体（1） | cancellation policy 完全不读取 scheduledAt；保留 dated 样本执行相同真实 owner、并发只删除自身/audit-once/释放 capacity。未保留 null 显示的独立 oracle。 |
| commentary finished/cancelled 锁等待变体（2） | policy 对两者先返回不同文案，后续统一 status !== scheduled 仍拒绝；保留 in_progress 的锁后重查与事实不变，以及 BP/active source 两个独立数据 guard。其它用例仍验证 terminal claim 拒绝与 finished submitted-roster DB trigger。退役两种状态各自的 cancellation branch 回归；不声称完全等价。 |
| relief balance=3（1） | 保留 0→10、9→1、10 拒绝覆盖补给公式和边界，三者仍用真实 ledger、并发 replay、profit/source 检查。余额 3 是同一算式中间值，无新分支。 |
| stale series preview 的 later-map/session 变体（1） | previewRevision 直接 hash 完整 sessions，对 lastReliableSeq 的 primitive 变更仍测相同 hash owner；Map 3 active/historical/result/OCR 的真正禁止提前结束 guard 另有四种负例；保留 map score、Date、session 与 progression 四个 revision 来源。退役 currentMapId 的单独 hash 字段 oracle。 |
| restriction-overrides migration（1） | 该用例最终重放全 migration 链，并只重复 verifyDatabaseAccessMatrix、RLS=true、anon/auth SELECT 拒绝。database-access-boundary 重放同一终态并调用同一 matrix；matrix inventory 含 competition_entry_restriction_overrides，比较 RLS 和每个 role 的实际 privileges。业务 PG 另保留 revision-scoped waiver/audit。这里是具体重复，不是按 migration 类别删除。 |

## 不能以一个代表性样本替代的具体例子

- `0001_canonical_team_identity.sql` 为 missing captain user、missing member user、missing parent season、duplicate membership、captain/member 跨季 provenance 使用不同 SELECT/RAISE 条件。某一坏 row 被拒绝不能证明另一 SQL predicate 仍存在。正常 backfill 同时探测实际 UNIQUE/FK/NOT NULL；六个负例保留。
- `0049_ambiguous_brood.sql` 中 updated_at 比较、完整 node set 的双向 anti-join、participant 的赛事归属/唯一 node 身份、未知 legacy source、Swiss 残留和外部 DROP dependency 是独立 guard。保留正常非空 backfill及各类负例；它们不是一个通用 JSON hash。
- `conversion-policies` 除终态 RLS 还验证冻结 2026.09 seed、duplicate version/current 与 unapproved current 三种真实 constraint。不能像 restriction-overrides 一样整项判为 access-matrix 重复。
- 系列更正的 active source、历史 gameplay、正式 map result、OCR row 四个 blocker 来自不同持久化 owner，不能只留一种“Map 3 有事实”。两条 BET publisher/reader compatibility 来自不同部署版本和市场 generation，不由最新正常路径替代。
- 同一 Auth helper 在不同 server action 入口被调用，不证明每个入口仍鉴权。保留的九种 season action / 五种 conversion action 拒绝仍是独立入口 oracle；直接调用 SQL domain owner 不替代 HTTP/action auth boundary。

## 当前可支持的保留集合与差额

本轮逐风险审查可支持的保守集合为 **101 unit + 309 PG + 19 core/production browser = 429**；完整基线 3,381 的 10% 上限为 338，仍差 **91**。集合精确到文件/展开用例在 cases.csv。这是本轮有证据支持的保留集，不是数学意义的全局最小值。没有把“同路径执行/CI 全绿”当作 oracle 等价证明。

压到 338 还需净减少 91 项。此前将所有超额项概括成不可再删的独立用例并不充分；独审还给出了候选，必须逐项区分真正重复、关闭的未来 producer 和主动接受的覆盖损失，不能因风险类别默认全留，也不能隐瞒损失。当前还未取得独审 15 项的精确名称/分类，不能宣称已审完该清单。可继续独立审查针对重复具体断言，而不是默认保留整个风险类别；发现新重复时再按本表说明替代 owner/断言。

## 原保留文件与 oracle 索引

下表用于直接检查用例所在 owner。每个原展开名称见 pg-original-retention.csv；最终保留/删除见 cases.csv。

| 文件 | 类别 | 原展开数 | 直接被测 owner / SQL |
| --- | --- | ---: | --- |
| admin-high-value-read-models.test.ts | 审计/后台读模型 | 1 | `../../../src/lib/admin/invites`, `../../../src/lib/admin/users`, `../../../src/lib/discipline/admin-review`, `../../../src/lib/registrations/admin-review` |
| admin-match-read-models.test.ts | 审计/后台读模型 | 1 | `@/lib/teams/map-profile`, `@/lib/stats/public-query`, `@/lib/admin/matches/postmatch-tasks`, `@/lib/admin/matches/operations`, `@/lib/admin/matches/commentary` |
| application-sessions.test.ts | 身份/Session | 9 | `../../../src/db/client`, `../../../src/lib/auth/password-mutation`, `../../../src/lib/action-utils`, `../../../src/db/schema`, `../../../src/lib/auth/session-registry` |
| audit-presentation.test.ts | 审计/后台读模型 | 2 | `@/actions/audit`, `@/lib/auth/session`, `@/lib/errors` |
| bet-bp-present.test.ts | 金额/下注/结算 | 12 | `@/db/schema`, `@/lib/bet/service` |
| bet-bp-reader-compat.test.ts | 金额/下注/结算 | 3 | `@/db/schema`, `@/lib/bet/service` |
| bet-relief-reader.test.ts | 金额/下注/结算 | 1 | `@/db/schema`, `@/lib/bet/service`, `@/lib/bet/relief-data` |
| bet-relief.test.ts | 金额/下注/结算 | 11 | `@/db/schema`, `@/lib/bet/service`, `@/lib/bet/relief-data` |
| bet-slot-compat.test.ts | 金额/下注/结算 | 3 | `@/db/schema`, `@/lib/bet/service` |
| bet.test.ts | 金额/下注/结算 | 17 | `@/db/schema`, `@/lib/bet/service`, `@/lib/bet/data` |
| canonical-migration-runner.test.ts | 迁移/恢复 | 1 | `../../../scripts/db/canonical-migrate` |
| competition-entry-qualification-override.test.ts | 赛事/冻结/治理 | 1 | `../../../src/db/schema`, `../../../src/lib/competition-entries/commands`, `../../../src/lib/competition-entries/restriction-overrides`, `../../../src/lib/errors`, `../../../src/lib/competitive/builtins` |
| competition-entry-roster-change.test.ts | 报名/队伍/邀请 | 2 | `../../../src/db/client`, `../../../src/db/schema`, `../../../src/lib/competition-entries/commands`, `../../../src/lib/competition-entries/roster-change`, `../../../src/lib/errors` |
| competition-qualification-acceptance.test.ts | 赛事/冻结/治理 | 5 | `@/lib/matches/test-matches`, `@/lib/matches/unassociated-result`, `@/lib/matches/competition-context`, `../../../src/db/schema`, `../../../src/lib/competition/templates` |
| competitive-catalog-actions.test.ts | 赛事/冻结/治理 | 2 | `@/actions/competitive-platform`, `@/lib/errors` |
| competitive-catalog.test.ts | 赛事/冻结/治理 | 1 | `../../../src/db/schema`, `../../../src/lib/competitive/catalog` |
| conversion-policy-admin.test.ts | 赛事/冻结/治理 | 1 | `@/db/schema`, `@/lib/competitive/conversion-policy-admin`, `drizzle/migrations/0052_gray_supernaut.sql` |
| coverage-scheduling.test.ts | 比赛/约战/赛后 | 3 | `@/db/client`, `@/db/schema`, `@/lib/matches/coverage` |
| default-lineup-recovery.test.ts | 比赛/约战/赛后 | 3 | `@/db/client`, `@/db/schema`, `@/lib/matches/time-auto-award`, `@/lib/admin/matches/workbench`, `@/lib/match-rosters/service` |
| demo-import-egress.test.ts | 机器接口/LIVE | 1 | `@/db/client`, `@/lib/admin/matches/overview`, `@/lib/admin/matches/workbench`, `@/lib/demo-integration/read`, `@/lib/demo-integration/promotion` |
| demo-integration-read.test.ts | 机器接口/LIVE | 1 | `@/lib/bracket`, `@/lib/demo-integration/contracts`, `@/lib/demo-integration/read` |
| demo-integration-submit.test.ts | 机器接口/LIVE | 2 | `../../../src/db/errors`, `../../../src/lib/action-utils`, `../../../src/db/schema`, `../../../src/lib/matches/operator-scoreboard`, `../../../src/lib/admin/matches/demo-review` |
| discipline.test.ts | 赛事/冻结/治理 | 1 | `../../../src/lib/config/perfect-world`, `../../../src/db/schema`, `../../../src/lib/match-rosters/service`, `../../../src/lib/discipline/service`, `../../../src/lib/errors` |
| education-admin-review.test.ts | 教育证据 | 3 | `../../../src/lib/education/admin-review` |
| education-evidence-retention.test.ts | 教育证据 | 1 | `../../../src/lib/education/retention` |
| education-manual-retention.test.ts | 教育证据 | 2 | `../../../src/lib/errors`, `../../../src/lib/education/retention` |
| education-manual-submission.test.ts | 教育证据 | 2 | `../../../src/actions/education-verifications` |
| education-verification-submission.test.ts | 教育证据 | 2 | `../../../src/actions/education-verifications`, `../../../src/lib/errors` |
| free-predictions-play-in.test.ts | 金额/下注/结算 | 3 | `@/db/schema`, `@/lib/free-predictions/service`, `@/lib/free-predictions/data`, `@/lib/seasons/compatibility` |
| free-predictions.test.ts | 金额/下注/结算 | 7 | `@/db/schema`, `@/lib/free-predictions/service`, `@/lib/free-predictions/data`, `@/lib/free-predictions/ranking`, `@/lib/bet/service` |
| identity-revocation-race.test.ts | 身份/Session | 12 | `../../../src/db/schema`, `../../../src/lib/auth/session-registry`, `../../../src/lib/identity/canonical`, `../../../src/lib/identity/linking` |
| invite-concurrency.test.ts | 报名/队伍/邀请 | 1 | `../../../src/db/schema`, `../../../src/lib/auth/admin-invites` |
| major-prestart-selection.test.ts | 赛事/冻结/治理 | 5 | `../../../src/db/schema`, `../../../src/lib/major/prestart-entrants`, `../../../src/lib/competition-entries/roster-change`, `../../../src/lib/admin/season-workspace/major-prestart`, `../../../src/lib/competition-entries/commands` |
| major-prestart.test.ts | 赛事/冻结/治理 | 1 | `../../../src/db/schema`, `../../../src/lib/event-rosters/coherence`, `../../../src/lib/errors` |
| major-public-participants.test.ts | 赛事/冻结/治理 | 1 | `../../../src/lib/participants/summary`, `../../../src/lib/competition/templates`, `../../../src/lib/major/public-participants`, `../../../src/lib/competition/definition` |
| major-result-recovery.test.ts | 赛事/冻结/治理 | 1 | `../../../src/db/schema`, `../../../src/lib/match-corrections/service`, `../../../src/lib/major/playoff-runtime`, `../../../src/lib/major/swiss-runtime`, `../../../src/lib/major/swiss` |
| major-roster-safety.test.ts | 赛事/冻结/治理 | 1 | `../../../src/lib/config/perfect-world`, `../../../src/db/schema`, `../../../src/lib/match-rosters/service`, `../../../src/lib/errors`, `../../../src/lib/competition/templates` |
| major-start.test.ts | 赛事/冻结/治理 | 7 | `../../../src/db/client`, `../../../src/db/schema`, `../../../src/lib/competition-entries/roster-change`, `../../../src/lib/competition-entries/commands`, `../../../src/lib/major/prestart-roster` |
| map-score-correction.test.ts | 比赛/约战/赛后 | 6 | `@/db/client`, `@/db/schema`, `@/actions/matches/results`, `@/lib/errors` |
| match-commentary.test.ts | 比赛/约战/赛后 | 13 | `SQL fixture/constraints via canonical migration harness` |
| match-execution.test.ts | 比赛/约战/赛后 | 4 | `../../../src/lib/mizar/context`, `../../../src/db/schema`, `../../../src/lib/matches/creation`, `../../../src/lib/matches/lifecycle`, `../../../src/lib/matches/unassociated-result` |
| match-score-semantics.test.ts | 比赛/约战/赛后 | 1 | `../../../src/lib/matches/veto-room/service`, `../../../src/lib/matches/veto-room/read-model`, `../../../src/actions/matches/results` |
| match-time-scheduling.test.ts | 比赛/约战/赛后 | 9 | `@/db/client`, `@/db/schema`, `@/lib/matches/time-auto-award`, `@/lib/my/competitions`, `@/lib/competition-entries/commands` |
| auth-id-reconciliation.test.ts | 迁移/恢复 | 4 | `drizzle/migrations/0036_auth_id_reconciliation.sql` |
| auth-permissions.test.ts | 迁移/恢复 | 2 | `drizzle/migrations/0023_auth_permissions.sql` |
| canonical-team-identity.test.ts | 迁移/恢复 | 7 | `drizzle/migrations/0001_canonical_team_identity.sql` |
| community-awards-capability.test.ts | 迁移/恢复 | 1 | `drizzle/migrations/0039_clumsy_doctor_octopus.sql` |
| competition-entry-restriction-overrides.test.ts | 迁移/恢复 | 1 | `../../../../scripts/db/access-matrix`, `drizzle/migrations/0035_colorful_black_widow.sql` |
| competition-entry-terminal.test.ts | 迁移/恢复 | 1 | `SQL fixture/constraints via canonical migration harness` |
| competitive-catalog.test.ts | 迁移/恢复 | 1 | `../../../../src/lib/competitive/builtins`, `drizzle/migrations/0020_competitive_catalog_stars_bootstrap.sql` |
| conversion-policies.test.ts | 迁移/恢复 | 1 | `../../../../scripts/db/access-matrix`, `drizzle/migrations/0042_identity_foundation.sql` |
| database-access-boundary.test.ts | 迁移/恢复 | 1 | `../../../../scripts/db/access-matrix`, `drizzle/migrations/0049_ambiguous_brood.sql` |
| education-evidence-code.test.ts | 迁移/恢复 | 1 | `drizzle/migrations/0025_stale_black_bolt.sql` |
| education-evidence-object-key.test.ts | 迁移/恢复 | 1 | `SQL fixture/constraints via canonical migration harness` |
| match-score-semantics.test.ts | 迁移/恢复 | 1 | `SQL fixture/constraints via canonical migration harness` |
| participant-profile-semantics.test.ts | 迁移/恢复 | 2 | `drizzle/migrations/0026_certain_annihilus.sql` |
| player-declared-profile.test.ts | 迁移/恢复 | 1 | `drizzle/migrations/0044_cultured_supernaut.sql` |
| private-live-policy-bootstrap.test.ts | 迁移/恢复 | 1 | `drizzle/migrations/0071_restore_private_live_broadcast_policy.sql` |
| recovery-restore-seed-collision.test.ts | 迁移/恢复 | 1 | `../../../../scripts/db/production-preflight`, `../../../../scripts/db/recovery/restore`, `../../../../scripts/db/recovery/verify`, `drizzle/migrations/0048_same_epoch.sql` |
| stage-runtime-contract-cleanup.test.ts | 迁移/恢复 | 8 | `drizzle/migrations/0048_same_epoch.sql`, `drizzle/migrations/0049_ambiguous_brood.sql` |
| supabase-storage-origin.test.ts | 迁移/恢复 | 1 | `drizzle/migrations/0070_supabase_organization_storage_urls.sql` |
| mizar-live-correctness.test.ts | 机器接口/LIVE | 10 | `SQL fixture/constraints via canonical migration harness` |
| mizar-live-ingest.test.ts | 机器接口/LIVE | 31 | `@/lib/matches/competition-context`, `../../../src/db/client`, `../../../src/db/schema`, `../../../src/lib/errors`, `../../../src/lib/mizar/context` |
| operations-hardening.test.ts | 比赛/约战/赛后 | 3 | `../../../src/db/schema`, `../../../src/lib/announcements/commands`, `../../../src/lib/announcements/read-model`, `../../../src/lib/feedback/commands`, `../../../src/lib/season-public-info/commands` |
| postevent.test.ts | 比赛/约战/赛后 | 1 | `../../../src/lib/seasons/public-results`, `../../../src/db/schema`, `../../../src/lib/discipline/service`, `../../../src/lib/errors`, `../../../src/lib/match-rosters/service` |
| postmatch-community-awards.test.ts | 比赛/约战/赛后 | 2 | `@/db/client` |
| predictions.test.ts | 金额/下注/结算 | 8 | `@/db/schema`, `@/lib/competition/templates`, `@/lib/major/run-snapshot`, `@/lib/major/swiss-runtime`, `@/lib/major/stage-transition` |
| query-outcome.test.ts | DB 未知提交结果 | 1 | `SQL fixture/constraints via canonical migration harness` |
| recruitment.test.ts | 报名/队伍/邀请 | 1 | `../../../src/db/schema`, `../../../src/lib/competitive/catalog`, `../../../src/lib/teams/invitations`, `../../../src/lib/teams/commands`, `../../../src/lib/recruitment/commands` |
| registration-opening.test.ts | 报名/队伍/邀请 | 2 | `../../../src/db/client`, `../../../src/db/schema`, `../../../src/lib/competition-entries/public-visibility`, `../../../src/lib/competition-entries/commands` |
| rivals-formation-identity.test.ts | 报名/队伍/邀请 | 1 | `@/actions/captains`, `@/actions/draft/picks`, `@/actions/matches/_shared` |
| scheduler-contract.test.ts | 比赛/约战/赛后 | 3 | `SQL fixture/constraints via canonical migration harness` |
| season-governance.test.ts | 赛事/冻结/治理 | 1 | `SQL fixture/constraints via canonical migration harness` |
| season-registration-correctness.test.ts | 报名/队伍/邀请 | 2 | `../../../src/db/schema`, `../../../src/lib/competition/templates`, `../../../src/lib/seasons/lifecycle`, `../../../src/lib/seasons/edit`, `../../../src/lib/utils/date` |
| series-score-correction.test.ts | 比赛/约战/赛后 | 18 | `@/lib/matches/competition-context`, `../../../src/db/client`, `../../../src/db/schema`, `../../../src/lib/matches/series-score-correction`, `../../../src/lib/matches/map-score-correction` |
| steam-identity-foundation.test.ts | 身份/Session | 2 | `../../../src/db/schema`, `../../../src/lib/errors`, `../../../src/lib/identity/gameplay-steam`, `../../../scripts/db/steam-profile-coverage`, `../../../src/lib/steam-profiles` |
| team-invitation.test.ts | 报名/队伍/邀请 | 1 | `../../../src/db/schema`, `../../../src/lib/teams/invitations`, `../../../src/lib/teams/commands`, `../../../src/lib/errors` |
| team-registration.test.ts | 报名/队伍/邀请 | 1 | `../../../src/db/schema`, `../../../src/lib/competition-entries/commands`, `../../../src/lib/competitive/builtins`, `../../../src/lib/qualification/service` |
| test-matches.test.ts | 比赛/约战/赛后 | 7 | `../../../scripts/db/preview/policy`, `@/lib/seasons/public-results`, `@/lib/seasons/public-stage`, `@/lib/mizar/live`, `@/lib/demo-evidence/contract` |
| user-identity-merge.test.ts | 身份/Session | 8 | `../../../src/lib/auth/session-registry`, `../../../src/db/client`, `../../../src/db/schema`, `../../../src/lib/captains/rules`, `../../../src/lib/identity/linking` |
| veto-appeal-lifecycle.test.ts | 比赛/约战/赛后 | 8 | `@/db/client`, `@/db/schema`, `@/lib/matches/locking`, `@/lib/matches/map-start`, `@/lib/matches/results` |
| veto-lifecycle-reader.test.ts | 比赛/约战/赛后 | 5 | `@/db/client`, `@/db/schema`, `@/lib/bet/facts`, `@/lib/matches/locking`, `@/lib/matches/map-start` |
