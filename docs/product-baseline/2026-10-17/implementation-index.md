# 实现与证据索引 · 固定基线

本文只服务于 [产品事实](product-facts.md) 的溯源。所有源码/政策/测试链接固定在 `main@4ca5f800c44ea2611f82e18fcbede2077e3cdafc`；行号定位命令、契约或对应文件入口，不表示整个文件的所有实现都已逐行审计。

**证据分层**：已发布规则说明政策；领域命令、schema 与 active migrations 说明实现和约束；测试源码说明已有保护场景。测试未在本轮执行，不能当作新测试通过记录；文档、注释与可执行分支冲突时分别注明，不能用注释覆盖代码。高频参数仅作为本基线快照，不成为新的长期 owner。

本索引保留技术细节和当前路由；产品事实正文不需要借助这些结构才能理解。

<a id="e01"></a>

## E01 · 产品范围、模板与正式政策

正文第 1、4、5、6、7 节。政策必须按适用赛事/版本阅读；README 运营历史是仓库声明，模板参数不是生产配置。

**规则/实现定位**

- [README.md:10](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/README.md#L10) — `面向高校电竞赛事`
- [src/lib/competition/templates.ts:36](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/competition/templates.ts#L36) — `export const RIVALS_STAGE_PLAN`
- [src/lib/competition/definition.ts:71](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/competition/definition.ts#L71) — `export function`
- [docs/rules/README.md:3](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/docs/rules/README.md#L3) — `当前统一规则`
- [docs/rules/published/nju-major-v1.1.md:7](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/docs/rules/published/nju-major-v1.1.md#L7) — `## 1.`
- [src/app/rules/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/rules/page.tsx#L1)
- [src/components/rules/SpringHistoricalRules.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/components/rules/SpringHistoricalRules.tsx#L1)

政策/范围声明不以运行测试证明；实际部署及运营历史未在本轮核验。

<a id="e02"></a>

## E02 · 角色与授权

正文第 2、10 节。全局角色、赛事授权、队伍身份、解说登记分别检查；用 action/guard 判断可写能力，不仅看页面。

**规则/实现定位**

- [src/db/schema/users.ts:4](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/db/schema/users.ts#L4) — `userRoleEnum`
- [src/db/schema/season-admin-grants.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/db/schema/season-admin-grants.ts#L1)
- [src/lib/auth/session.ts:116](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/auth/session.ts#L116) — `export async function requireSeasonAdmin`
- [src/lib/auth/admin-access.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/auth/admin-access.ts#L1)
- [src/lib/auth/admin-invites.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/auth/admin-invites.ts#L1)
- [src/actions/seasons.ts:45](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/actions/seasons.ts#L45) — `export async function createSeason`
- [src/lib/postmatch/commentary-policy.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/postmatch/commentary-policy.ts#L1)

**已有测试源码（未重跑）**

- [tests/integration/db/invite-concurrency.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/invite-concurrency.test.ts#L1)
- [tests/integration/db/migrations/auth-permissions.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/migrations/auth-permissions.test.ts#L1)
- [tests/integration/db/match-commentary.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/match-commentary.test.ts#L1)

<a id="e03"></a>

## E03 · 人、凭据、账号恢复和长期声明

正文第 3、4.1/4.2 节。绑定与归并不同；密码结果不确定的阻断、旧会话撤销、保留账号资料语义以命令和测试为准。

**规则/实现定位**

- [src/actions/auth.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/actions/auth.ts#L1)
- [src/actions/password-recovery.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/actions/password-recovery.ts#L1)
- [src/lib/auth/session-registry.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/auth/session-registry.ts#L1)
- [src/lib/auth/password-mutation.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/auth/password-mutation.ts#L1)
- [src/lib/identity/linking.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/identity/linking.ts#L1)
- [src/lib/identity/merge.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/identity/merge.ts#L1)
- [src/lib/identity/gameplay-steam.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/identity/gameplay-steam.ts#L1)
- [src/lib/player-declared-profile.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/player-declared-profile.ts#L1)
- [src/db/schema/identity.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/db/schema/identity.ts#L1)
- [docs/auth-and-permissions.md:52](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/docs/auth-and-permissions.md#L52) — `## Session`

**已有测试源码（未重跑）**

- [tests/integration/db/user-identity-merge.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/user-identity-merge.test.ts#L1)
- [tests/integration/db/identity-revocation-race.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/identity-revocation-race.test.ts#L1)
- [tests/integration/db/application-sessions.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/application-sessions.test.ts#L1)
- [tests/unit/actions/password-recovery.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/unit/actions/password-recovery.test.ts#L1)

<a id="e04"></a>

## E04 · 教育认证、人工审核和证据到期

正文第 4.2、10 节。邮箱需精确 registry；材料访问只有超级管理员；七天以 reviewedAt 计算，不以提交时间猜测放弃。

**规则/实现定位**

- [src/lib/education/commands.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/education/commands.ts#L1)
- [src/lib/education/eligibility.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/education/eligibility.ts#L1)
- [src/lib/education/admin-review.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/education/admin-review.ts#L1)
- [src/lib/education/retention-policy.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/education/retention-policy.ts#L1)
- [src/lib/education/evidence-access.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/education/evidence-access.ts#L1)
- [src/lib/education/retention.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/education/retention.ts#L1)
- [src/app/admin/education-verifications/[id]/evidence/route.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/education-verifications/%5Bid%5D/evidence/route.ts#L1)
- [src/db/schema/education.ts:8](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/db/schema/education.ts#L8) — `educationVerificationStatusEnum`

**已有测试源码（未重跑）**

- [tests/integration/db/education-verification-submission.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/education-verification-submission.test.ts#L1)
- [tests/integration/db/education-manual-submission.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/education-manual-submission.test.ts#L1)
- [tests/integration/db/education-admin-review.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/education-admin-review.test.ts#L1)
- [tests/integration/db/education-manual-retention.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/education-manual-retention.test.ts#L1)

<a id="e05"></a>

## E05 · 竞技事实、资格与换算

正文第 4.2 节。段位/星数/Rating 分离，资料完整与可豁免限制分离；只有冻结证据才解释旧赛事。

**规则/实现定位**

- [src/lib/competitive/builtins.ts:56](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/competitive/builtins.ts#L56) — `BUILT_IN_COMPETITIVE_PLATFORMS`
- [src/lib/competitive/save-profile.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/competitive/save-profile.ts#L1)
- [src/lib/qualification/service.ts:110](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/qualification/service.ts#L110) — `function createCompetitiveCandidateResolver`
- [src/lib/qualification/finding.ts:6](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/qualification/finding.ts#L6) — `export interface QualificationFinding`
- [src/lib/major/player-strength.ts:73](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/major/player-strength.ts#L73) — `export function comparePlayerStrengthFacts`
- [src/lib/major/composite-rank.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/major/composite-rank.ts#L1)
- [src/actions/conversion-policies.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/actions/conversion-policies.ts#L1)
- [src/lib/seasons/lifecycle.ts:250](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/seasons/lifecycle.ts#L250) — `export async function freezeCompetitiveContext`
- [src/db/schema/competitive-profile.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/db/schema/competitive-profile.ts#L1)
- [src/db/schema/conversion-policies.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/db/schema/conversion-policies.ts#L1)

**已有测试源码（未重跑）**

- [tests/integration/db/competitive-catalog.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/competitive-catalog.test.ts#L1)
- [tests/integration/db/conversion-policy-admin.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/conversion-policy-admin.test.ts#L1)
- [tests/integration/db/competition-entry-qualification-override.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/competition-entry-qualification-override.test.ts#L1)

<a id="e06"></a>

## E06 · 长期队伍、邀请和招募

正文第 3、4.3 节。Team 当前关系、招募意向、本届名单分离；未结束赛事改名同步是明确实现例外。

**规则/实现定位**

- [src/lib/teams/commands.ts:67](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/teams/commands.ts#L67) — `export async function createTeamInTx`
- [src/lib/teams/commands.ts:88](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/teams/commands.ts#L88) — `export async function updateTeamProfileInTx`
- [src/lib/teams/invitations.ts:73](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/teams/invitations.ts#L73) — `export async function acceptTeamInvitationInTx`
- [src/lib/recruitment/commands.ts:122](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/recruitment/commands.ts#L122) — `export async function expressRecruitmentInterestInTx`
- [src/lib/recruitment/target-policy.ts:15](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/recruitment/target-policy.ts#L15) — `export function canRecruitForSeason`
- [src/db/schema/teams.ts:14](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/db/schema/teams.ts#L14) — `teamLifecycleEnum`
- [src/db/schema/recruitment.ts:8](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/db/schema/recruitment.ts#L8) — `recruitmentIntentKindEnum`
- [drizzle/migrations/0061_sync_active_team_entry_names.sql:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/drizzle/migrations/0061_sync_active_team_entry_names.sql#L1)

**已有测试源码（未重跑）**

- [tests/integration/db/team-invitation.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/team-invitation.test.ts#L1)
- [tests/integration/db/recruitment.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/recruitment.test.ts#L1)
- [tests/e2e/flows/team-invitations.spec.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/e2e/flows/team-invitations.spec.ts#L1)

<a id="e07"></a>

## E07 · 赛事发布、报名窗口与自动推进

正文第 5.1、9 节及 C01。对照 workflow 的绝对陈述与真实调用链：审核和 scheduler 都可触发 solo 自动推进。

**规则/实现定位**

- [src/types/season.ts:7](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/types/season.ts#L7) — `export type SeasonStatus`
- [src/lib/registration/window.ts:61](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/registration/window.ts#L61) — `export function getRegistrationWindowState`
- [src/lib/seasons/lifecycle.ts:311](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/seasons/lifecycle.ts#L311) — `export async function openSeasonRegistrationInTx`
- [src/lib/seasons/transitions.ts:28](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/seasons/transitions.ts#L28) — `export async function maybeAdvanceFromRegistration`
- [src/lib/scheduler/runners.ts:23](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/scheduler/runners.ts#L23) — `export async function runRegistrationDeadlineJob`
- [src/actions/admin.ts:127](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/actions/admin.ts#L127) — `maybeAdvanceFromRegistration(tx`
- [src/actions/seasons.ts:279](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/actions/seasons.ts#L279) — `export async function revertSeasonToDraft`
- [docs/workflows.md:37](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/docs/workflows.md#L37) — `报名截止不会自行推进`

**已有测试源码（未重跑）**

- [tests/integration/db/season-registration-correctness.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/season-registration-correctness.test.ts#L1)
- [tests/integration/db/season-governance.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/season-governance.test.ts#L1)

<a id="e08"></a>

## E08 · Rivals 个人报名、投票与选秀

正文第 5.2 节。报名阈值来自配置，队长数/票数、选秀轮次/计时当前为固定实现；操作、超时和最终名单共用 owner。

**规则/实现定位**

- [src/lib/validators/registration.ts:57](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/validators/registration.ts#L57) — `export function buildRegistrationSchema`
- [src/actions/register.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/actions/register.ts#L1)
- [src/lib/registration-transitions.ts:12](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/registration-transitions.ts#L12) — `export const TRANSITION_RULES`
- [src/lib/captains/rules.ts:3](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/captains/rules.ts#L3) — `export const MAX_CAPTAIN_VOTES`
- [src/actions/captains.ts:187](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/actions/captains.ts#L187) — `export async function confirmCaptains`
- [src/types/draft.ts:26](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/types/draft.ts#L26) — `DRAFT_TOTAL_ROUNDS`
- [src/lib/draft/rules.ts:17](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/draft/rules.ts#L17) — `export function getSnakeOrder`
- [src/lib/draft/auto-pick.ts:14](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/draft/auto-pick.ts#L14) — `export function selectAutoPickCandidate`
- [src/lib/draft/operations.ts:100](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/draft/operations.ts#L100) — `export async function executeDraftPick`
- [src/actions/draft/state.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/actions/draft/state.ts#L1)

**已有测试源码（未重跑）**

- [tests/integration/db/rivals-formation-identity.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/rivals-formation-identity.test.ts#L1)
- [tests/unit/actions/register.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/unit/actions/register.test.ts#L1)

<a id="e09"></a>

## E09 · 当届报名、承诺、版本和名单调整

正文第 3、5.3/5.4、9 节及 C05。actions 定义输入与授权，commands 再验名单/资格；schema/迁移保护同届唯一承诺和历史成员。

**规则/实现定位**

- [src/actions/competition-entries.ts:62](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/actions/competition-entries.ts#L62) — `export async function confirmCompetitionEntryParticipation`
- [src/lib/competition-entries/commands.ts:229](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/competition-entries/commands.ts#L229) — `export async function createCompetitionEntryInTx`
- [src/lib/competition-entries/commands.ts:403](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/competition-entries/commands.ts#L403) — `export async function withdrawCompetitionEntryFromReviewInTx`
- [src/lib/competition-entries/commands.ts:457](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/competition-entries/commands.ts#L457) — `export async function grantCompetitionEntryRestrictionOverrideInTx`
- [src/lib/competition-entries/roster-change.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/competition-entries/roster-change.ts#L1)
- [src/lib/competition-entries/capabilities.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/competition-entries/capabilities.ts#L1)
- [src/lib/event-rosters/owner.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/event-rosters/owner.ts#L1)
- [src/lib/major/roster-window.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/major/roster-window.ts#L1)
- [src/db/schema/competition-entries.ts:24](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/db/schema/competition-entries.ts#L24) — `competitionEntryRegistrationStatusEnum`
- [drizzle/migrations/0021_team_entry_current_owners.sql:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/drizzle/migrations/0021_team_entry_current_owners.sql#L1)
- [drizzle/migrations/0057_event_roster_member_history.sql:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/drizzle/migrations/0057_event_roster_member_history.sql#L1)

**已有测试源码（未重跑）**

- [tests/integration/db/team-registration.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/team-registration.test.ts#L1)
- [tests/integration/db/competition-entry-roster-change.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/competition-entry-roster-change.test.ts#L1)
- [tests/integration/db/competition-entry-qualification-override.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/competition-entry-qualification-override.test.ts#L1)

<a id="e10"></a>

## E10 · Major 赛前、资格赛与种子

正文第 5.4 节及 C04。Direct BO3/Short Swiss 的范围可执行，公开规则更广；方案保存、确认、轮次生成和最终冻结不是同一操作。

**规则/实现定位**

- [src/lib/competition-qualification/policy.ts:3](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/competition-qualification/policy.ts#L3) — `export type CompetitionQualificationFormat`
- [src/lib/competition-qualification/draft.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/competition-qualification/draft.ts#L1)
- [src/lib/competition-qualification/runtime.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/competition-qualification/runtime.ts#L1)
- [src/lib/competition-qualification/eligibility.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/competition-qualification/eligibility.ts#L1)
- [src/lib/major/prestart.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/major/prestart.ts#L1)
- [src/lib/major/prestart-entrants.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/major/prestart-entrants.ts#L1)
- [src/lib/major/prestart-roster.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/major/prestart-roster.ts#L1)
- [src/lib/major/prestart-seeds.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/major/prestart-seeds.ts#L1)
- [src/lib/major/seed-recommendation-snapshot.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/major/seed-recommendation-snapshot.ts#L1)
- [src/db/schema/competition-qualification.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/db/schema/competition-qualification.ts#L1)
- [src/db/schema/major-prestart.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/db/schema/major-prestart.ts#L1)

**已有测试源码（未重跑）**

- [tests/integration/db/competition-qualification-acceptance.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/competition-qualification-acceptance.test.ts#L1)
- [tests/integration/db/major-prestart.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/major-prestart.test.ts#L1)
- [tests/integration/db/major-prestart-selection.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/major-prestart-selection.test.ts#L1)

<a id="e11"></a>

## E11 · 阶段运行、晋级与正式最终结果

正文第 5.5 节。标准托管 profile 从能力和 frozen StagePlan 判断，不是任意容量；榜单是投影，StageRun/官方比赛才是推进依据。

**规则/实现定位**

- [src/lib/major/standard.ts:15](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/major/standard.ts#L15) — `export function getStandardMajorDefinition`
- [src/lib/major/start.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/major/start.ts#L1)
- [src/lib/major/run-snapshot.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/major/run-snapshot.ts#L1)
- [src/lib/major/swiss.ts:139](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/major/swiss.ts#L139) — `MAJOR_SWISS_WIN_THRESHOLD`
- [src/lib/major/swiss-runtime.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/major/swiss-runtime.ts#L1)
- [src/lib/major/playoff-runtime.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/major/playoff-runtime.ts#L1)
- [src/lib/matches/stage-transition.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/matches/stage-transition.ts#L1)
- [src/lib/formats/supported.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/formats/supported.ts#L1)
- [src/db/schema/major-stage.ts:50](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/db/schema/major-stage.ts#L50) — `majorResultStatusEnum`
- [src/lib/postevent/service.ts:85](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/postevent/service.ts#L85) — `export async function confirmMajorFinalResultInTx`

**已有测试源码（未重跑）**

- [tests/integration/db/major-start.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/major-start.test.ts#L1)
- [tests/integration/db/major-result-recovery.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/major-result-recovery.test.ts#L1)
- [tests/integration/db/postevent.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/postevent.test.ts#L1)

<a id="e12"></a>

## E12 · 时间、转播容量与单场首发

正文第 6.2、9 节。首次沉默采纳、明确改期、转播预留和名单冻结各有条件；T−2h 默认首发仍必须合法。

**规则/实现定位**

- [src/lib/matches/time-rules.ts:3](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/matches/time-rules.ts#L3) — `export const PROPOSAL_RESPONSE_HOURS`
- [src/lib/matches/time-proposals.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/matches/time-proposals.ts#L1)
- [src/lib/matches/time-proposal-side.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/matches/time-proposal-side.ts#L1)
- [src/lib/matches/time-auto-award.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/matches/time-auto-award.ts#L1)
- [src/lib/matches/coverage.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/matches/coverage.ts#L1)
- [src/lib/match-rosters/service.ts:445](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/match-rosters/service.ts#L445) — `export async function persistMatchRosterInTx`
- [src/lib/match-rosters/service.ts:659](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/match-rosters/service.ts#L659) — `export async function materializeDefaultLineupsInTx`
- [src/db/schema/match-time-proposals.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/db/schema/match-time-proposals.ts#L1)
- [src/db/schema/match-rosters.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/db/schema/match-rosters.ts#L1)
- [drizzle/migrations/0081_match-scheduling-safety.sql:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/drizzle/migrations/0081_match-scheduling-safety.sql#L1)

**已有测试源码（未重跑）**

- [tests/integration/db/match-time-scheduling.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/match-time-scheduling.test.ts#L1)
- [tests/integration/db/coverage-scheduling.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/coverage-scheduling.test.ts#L1)
- [tests/integration/db/default-lineup-recovery.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/default-lineup-recovery.test.ts#L1)
- [tests/integration/db/major-roster-safety.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/major-roster-safety.test.ts#L1)

<a id="e13"></a>

## E13 · BP、申诉和真实开局边界

正文第 6.3、9、11 节。序列/计时有政策与代码；实际开局后的保护不依赖 closed producer。此基线 reader1/publisher0 只支持读 closed，不写新自动关闭。

**规则/实现定位**

- [src/lib/matches/veto-sequence.ts:53](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/matches/veto-sequence.ts#L53) — `export function getVetoTurnDefinitions`
- [src/lib/matches/veto-room/service.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/matches/veto-room/service.ts#L1)
- [src/lib/matches/veto-room/appeal-lifecycle.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/matches/veto-room/appeal-lifecycle.ts#L1)
- [src/lib/matches/veto-room/lifecycle-publication.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/matches/veto-room/lifecycle-publication.ts#L1)
- [src/lib/matches/veto-room/lifecycle-contract.json:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/matches/veto-room/lifecycle-contract.json#L1)
- [src/lib/matches/map-start.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/matches/map-start.ts#L1)
- [src/db/schema/match-veto-room.ts:18](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/db/schema/match-veto-room.ts#L18) — `matchVetoAppealStatusEnum`
- [drizzle/migrations/0087_veto-lifecycle-scheduler-gate.sql:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/drizzle/migrations/0087_veto-lifecycle-scheduler-gate.sql#L1)

**已有测试源码（未重跑）**

- [tests/integration/db/veto-reconcile.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/veto-reconcile.test.ts#L1)
- [tests/integration/db/veto-lifecycle-reader.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/veto-lifecycle-reader.test.ts#L1)
- [tests/integration/db/veto-appeal-lifecycle.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/veto-appeal-lifecycle.test.ts#L1)
- [tests/unit/actions/veto-room-access.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/unit/actions/veto-room-access.test.ts#L1)

<a id="e14"></a>

## E14 · 正式结果、弃赛、更正与恢复

正文第 6.4、9 节。比赛执行状态与呈现阶段分开，整场比分仅正式终态持久化；通用 transition 不能代替各命令更严格的 gate。

**规则/实现定位**

- [src/lib/match-transitions.ts:5](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/match-transitions.ts#L5) — `MATCH_TRANSITIONS`
- [src/lib/matches/presentation-phase.ts:15](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/matches/presentation-phase.ts#L15) — `export type MatchPresentationPhase`
- [src/lib/matches/result-rules.ts:8](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/matches/result-rules.ts#L8) — `export function validateSeriesScore`
- [src/lib/matches/results.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/matches/results.ts#L1)
- [src/lib/matches/competition-results.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/matches/competition-results.ts#L1)
- [src/actions/matches/results.ts:463](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/actions/matches/results.ts#L463) — `export async function forfeitMatch`
- [src/lib/match-corrections/service.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/match-corrections/service.ts#L1)
- [src/lib/matches/map-score-correction.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/matches/map-score-correction.ts#L1)
- [src/lib/matches/series-score-correction.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/matches/series-score-correction.ts#L1)
- [src/lib/matches/deletion.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/matches/deletion.ts#L1)

**已有测试源码（未重跑）**

- [tests/integration/db/match-score-semantics.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/match-score-semantics.test.ts#L1)
- [tests/integration/db/map-score-correction.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/map-score-correction.test.ts#L1)
- [tests/integration/db/series-score-correction.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/series-score-correction.test.ts#L1)
- [tests/integration/db/major-result-recovery.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/major-result-recovery.test.ts#L1)

<a id="e15"></a>

## E15 · Mizar、公开 LIVE、OCR 与 DAK

正文第 6.3/6.5、10 节及 C02。人负责授权与外部现场，机器上报只在核验后形成正式结果；文档、协议/代码、测试与现场验收分开。

**规则/实现定位**

- [docs/operations/major-referee-guide.md:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/docs/operations/major-referee-guide.md#L1)
- [src/lib/mizar/installation.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/mizar/installation.ts#L1)
- [src/lib/mizar/source.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/mizar/source.ts#L1)
- [src/lib/mizar/reliable.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/mizar/reliable.ts#L1)
- [src/lib/mizar/live.ts:93](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/mizar/live.ts#L93) — `export async function issueLiveViewerToken`
- [docs/auth-and-permissions.md:72](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/docs/auth-and-permissions.md#L72) — `仅对公开 playing`
- [src/lib/mizar/live-viewer-state.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/mizar/live-viewer-state.ts#L1)
- [src/lib/mizar/live-previous-view.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/mizar/live-previous-view.ts#L1)
- [src/lib/matches/scoreboard-ownership.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/matches/scoreboard-ownership.ts#L1)
- [src/lib/ocr/siliconflow.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/ocr/siliconflow.ts#L1)
- [src/lib/demo-integration/submit.ts:76](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/demo-integration/submit.ts#L76) — `export async function submitRivalHubEvidence`
- [src/lib/demo-integration/review.ts:99](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/demo-integration/review.ts#L99) — `export async function confirmStoredDemoParticipantIdentityInTx`
- [src/lib/demo-integration/promotion.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/demo-integration/promotion.ts#L1)

**已有测试源码（未重跑）**

- [tests/integration/db/mizar-live-correctness.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/mizar-live-correctness.test.ts#L1)
- [tests/integration/db/mizar-observed-lineup.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/mizar-observed-lineup.test.ts#L1)
- [tests/integration/db/demo-integration-submit.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/demo-integration-submit.test.ts#L1)
- [tests/integration/db/test-matches.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/test-matches.test.ts#L1)
- [tests/e2e/flows/public-match-live.spec.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/e2e/flows/public-match-live.spec.ts#L1)

<a id="e16"></a>

## E16 · 测试赛与无赛事比赛的能力层级

正文第 6.1/6.4 节。测试有正式入口与真实名单；无赛事创建是领域入口，没有独立用户约战产品。不能将 executionContext 与赛事外键混搭。

**规则/实现定位**

- [src/actions/test-matches.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/actions/test-matches.ts#L1)
- [src/lib/matches/test-matches.ts:29](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/matches/test-matches.ts#L29) — `export async function createTestMatchInTx`
- [src/lib/matches/creation.ts:19](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/matches/creation.ts#L19) — `export async function createUnassociatedMatchInTx`
- [src/lib/matches/unassociated-result.ts:31](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/matches/unassociated-result.ts#L31) — `export async function concludeUnassociatedMatchInTx`
- [src/lib/matches/execution.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/matches/execution.ts#L1)
- [src/lib/matches/scope.ts:6](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/matches/scope.ts#L6) — `export function officialMatchCondition`
- [src/db/schema/matches.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/db/schema/matches.ts#L1)
- [drizzle/migrations/0078_match_variant_invariants.sql:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/drizzle/migrations/0078_match_variant_invariants.sql#L1)
- [drizzle/migrations/0079_test-matches.sql:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/drizzle/migrations/0079_test-matches.sql#L1)
- [docs/workflows.md:159](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/docs/workflows.md#L159) — `不提供约战产品入口`

**已有测试源码（未重跑）**

- [tests/integration/db/match-execution.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/match-execution.test.ts#L1)
- [tests/integration/db/test-matches.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/test-matches.test.ts#L1)
- [tests/e2e/flows/test-matches.spec.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/e2e/flows/test-matches.spec.ts#L1)

<a id="e17"></a>

## E17 · 统计、Player/Team 历史与公开发现

正文第 4.2、8 节。公共统计消费有效正式事实和已确认投影，不从现成员倒灌队史；缺证据减少覆盖。

**规则/实现定位**

- [src/lib/stats/contract.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/stats/contract.ts#L1)
- [src/lib/stats/platform-query.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/stats/platform-query.ts#L1)
- [src/lib/stats/public-query.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/stats/public-query.ts#L1)
- [src/lib/stats/sql.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/stats/sql.ts#L1)
- [src/lib/stats/ranking.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/stats/ranking.ts#L1)
- [src/lib/stats/projection.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/stats/projection.ts#L1)
- [src/lib/stats/records.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/stats/records.ts#L1)
- [src/lib/stats/insights.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/stats/insights.ts#L1)
- [src/lib/players/public-profile.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/players/public-profile.ts#L1)
- [src/lib/players/public-record.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/players/public-record.ts#L1)
- [src/lib/teams/profile-read-model.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/teams/profile-read-model.ts#L1)
- [docs/domain-model.md:245](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/docs/domain-model.md#L245) — `## Tournament statistics`

**已有测试源码（未重跑）**

- [tests/integration/db/demo-import-egress.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/demo-import-egress.test.ts#L1)
- [tests/unit/components/stats-metric-bindings.test.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/unit/components/stats-metric-bindings.test.tsx#L1)
- [tests/e2e/flows/platform-stats.spec.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/e2e/flows/platform-stats.spec.ts#L1)
- [tests/e2e/flows/public-discovery.spec.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/e2e/flows/public-discovery.spec.ts#L1)

<a id="e18"></a>

## E18 · 自由推演与正式 Pick’Em

正文第 7.1 节。模拟选择、正式草稿/提交、阶段判定与纪念币分开；旧 prediction 金融兼容结构不证明新入口共用 BET。

**规则/实现定位**

- [src/lib/predictions/context-simulator.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/predictions/context-simulator.ts#L1)
- [src/lib/predictions/qualification-baseline.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/predictions/qualification-baseline.ts#L1)
- [src/lib/predictions/lifecycle.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/predictions/lifecycle.ts#L1)
- [src/lib/predictions/service.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/predictions/service.ts#L1)
- [src/lib/predictions/rules.ts:29](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/predictions/rules.ts#L29) — `export const DEFAULT_RULES`
- [src/lib/predictions/reconciliation.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/predictions/reconciliation.ts#L1)
- [src/actions/predictions.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/actions/predictions.ts#L1)
- [src/db/schema/predictions.ts:76](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/db/schema/predictions.ts#L76) — `export const predictionPicks`
- [docs/operations/spectator-predictions.md:5](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/docs/operations/spectator-predictions.md#L5) — `Pick’Em 不设独立管理员页面`

**已有测试源码（未重跑）**

- [tests/integration/db/predictions.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/predictions.test.ts#L1)
- [tests/unit/predictions/rules.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/unit/predictions/rules.test.ts#L1)
- [tests/e2e/flows/predictions.spec.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/e2e/flows/predictions.spec.ts#L1)

<a id="e19"></a>

## E19 · 免费单场赛果/BP 预测

正文第 7.1 节。选择/revision 私有，支持率和成绩公共；不能把 BET 净收益排序误认为免费选择发积分。

**规则/实现定位**

- [docs/decisions/free-predictions.md:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/docs/decisions/free-predictions.md#L1)
- [src/lib/free-predictions/service.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/free-predictions/service.ts#L1)
- [src/lib/free-predictions/domain.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/free-predictions/domain.ts#L1)
- [src/lib/free-predictions/ranking.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/free-predictions/ranking.ts#L1)
- [src/lib/free-predictions/data.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/free-predictions/data.ts#L1)
- [src/actions/free-predictions.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/actions/free-predictions.ts#L1)
- [src/db/schema/free-predictions.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/db/schema/free-predictions.ts#L1)
- [drizzle/migrations/0085_free-predictions.sql:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/drizzle/migrations/0085_free-predictions.sql#L1)

**已有测试源码（未重跑）**

- [tests/integration/db/free-predictions.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/free-predictions.test.ts#L1)
- [tests/integration/db/free-predictions-play-in.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/free-predictions-play-in.test.ts#L1)
- [tests/e2e/flows/free-predictions.spec.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/e2e/flows/free-predictions.spec.ts#L1)

<a id="e20"></a>

## E20 · BET 市场、账本、补给与发布能力

正文第 4.1、7.1、11 节。此基线 BO3 capability publisher1 与 ledger publisher1；是否线上发布/某赛事启用没有采集证据。

**规则/实现定位**

- [src/actions/bet.ts:19](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/actions/bet.ts#L19) — `async function publicSeason`
- [src/lib/bet/policy.ts:4](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/bet/policy.ts#L4) — `export const BET_POLICY`
- [src/lib/bet/relief.ts:2](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/bet/relief.ts#L2) — `export const BET_RELIEF_POLICY`
- [src/lib/bet/admission.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/bet/admission.ts#L1)
- [src/lib/bet/service.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/bet/service.ts#L1)
- [src/lib/bet/domain.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/bet/domain.ts#L1)
- [src/lib/bet/pool.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/bet/pool.ts#L1)
- [src/lib/bet/resolution.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/bet/resolution.ts#L1)
- [src/lib/bet/operations.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/bet/operations.ts#L1)
- [src/lib/bet/catalog-contract.json:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/bet/catalog-contract.json#L1)
- [src/lib/bet/ledger-contract.json:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/bet/ledger-contract.json#L1)
- [src/db/schema/bet.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/db/schema/bet.ts#L1)
- [docs/operations/spectator-predictions.md:22](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/docs/operations/spectator-predictions.md#L22) — `## BET`

**已有测试源码（未重跑）**

- [tests/integration/db/bet.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/bet.test.ts#L1)
- [tests/integration/db/bet-relief.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/bet-relief.test.ts#L1)
- [tests/integration/db/bet-bp-present.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/bet-bp-present.test.ts#L1)
- [tests/integration/db/bet-slot-compat.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/bet-slot-compat.test.ts#L1)

<a id="e21"></a>

## E21 · 解说认领、制作资料与单场 MVP

正文第 6.2/6.5、7.2 节。认领、实际名单确认、录像与逐图统计齐备分开；注册满 24 小时的判断使用用户 createdAt。

**规则/实现定位**

- [src/lib/postmatch/service.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/postmatch/service.ts#L1)
- [src/lib/postmatch/commentary-policy.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/postmatch/commentary-policy.ts#L1)
- [src/lib/postmatch/completion.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/postmatch/completion.ts#L1)
- [src/lib/admin/matches/postmatch-tasks.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/admin/matches/postmatch-tasks.ts#L1)
- [src/actions/player-stats.ts:327](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/actions/player-stats.ts#L327) — `export async function castMatchMvpVote`
- [src/lib/matches/mvp.ts:27](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/matches/mvp.ts#L27) — `export async function settleExpiredMatchMvpVotes`
- [src/lib/utils/date.ts:58](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/utils/date.ts#L58) — `MVP_DEADLINE_MS`
- [src/db/schema/mvp-votes.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/db/schema/mvp-votes.ts#L1)
- [src/db/schema/postmatch.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/db/schema/postmatch.ts#L1)

**已有测试源码（未重跑）**

- [tests/integration/db/match-commentary.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/match-commentary.test.ts#L1)
- [tests/integration/db/postmatch-community-awards.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/postmatch-community-awards.test.ts#L1)
- [tests/integration/db/admin-match-read-models.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/admin-match-read-models.test.ts#L1)

<a id="e22"></a>

## E22 · 纪律、最终荣誉与社区奖

正文第 5.5、7.2/7.3 节及 C03。社区奖 capability 不排除命令自己的 archived gate；纪律效果不会自动改比分或递补荣誉。

**规则/实现定位**

- [src/db/schema/discipline.ts:14](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/db/schema/discipline.ts#L14) — `sanctionEffectEnum`
- [src/lib/discipline/service.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/discipline/service.ts#L1)
- [src/lib/postevent/service.ts:224](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/postevent/service.ts#L224) — `export async function grantTournamentHonorInTx`
- [src/db/schema/postevent.ts:82](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/db/schema/postevent.ts#L82) — `honorStateEnum`
- [src/lib/community-awards/service.ts:30](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/community-awards/service.ts#L30) — `export async function submitCommunityAwardInTx`
- [src/lib/community-awards/service.ts:170](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/community-awards/service.ts#L170) — `export async function resolveCommunityAwardInTx`
- [src/db/schema/community-awards.ts:7](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/db/schema/community-awards.ts#L7) — `communityAwardStatusEnum`
- [docs/workflows.md:212](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/docs/workflows.md#L212) — `## Community awards`

**已有测试源码（未重跑）**

- [tests/integration/db/discipline.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/discipline.test.ts#L1)
- [tests/integration/db/postevent.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/postevent.test.ts#L1)
- [tests/integration/db/postmatch-community-awards.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/postmatch-community-awards.test.ts#L1)

<a id="e23"></a>

## E23 · 公开运营信息、公告与反馈

正文第 8 节。私人联系方式与主动公开信息分离；反馈是接受文本和内部 triage，不证明回复/送达闭环。

**规则/实现定位**

- [src/lib/season-public-info/commands.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/season-public-info/commands.ts#L1)
- [src/lib/season-public-info/read-model.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/season-public-info/read-model.ts#L1)
- [src/actions/season-public-info.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/actions/season-public-info.ts#L1)
- [src/lib/announcements/commands.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/announcements/commands.ts#L1)
- [src/lib/announcements/read-model.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/announcements/read-model.ts#L1)
- [src/actions/feedback.ts:16](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/actions/feedback.ts#L16) — `export async function submitFeedback`
- [src/lib/feedback/commands.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/feedback/commands.ts#L1)
- [src/lib/feedback/validation.ts:5](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/feedback/validation.ts#L5) — `export const FEEDBACK_CATEGORY_LABELS`
- [src/db/schema/announcements.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/db/schema/announcements.ts#L1)
- [src/db/schema/feedback.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/db/schema/feedback.ts#L1)

**已有测试源码（未重跑）**

- [tests/integration/db/operations-hardening.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/operations-hardening.test.ts#L1)
- [tests/unit/actions/season-logo.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/unit/actions/season-logo.test.ts#L1)
- [tests/e2e/flows/event-logo.spec.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/e2e/flows/event-logo.spec.ts#L1)

<a id="e24"></a>

## E24 · 私密性、保留与运维边界

正文第 9–11 节。本文引用仓库数据契约，不作法律合规审定；provider 当前 retention、删除/恢复实际验收仍未知。

**规则/实现定位**

- [docs/security/data-lifecycle.md:33](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/docs/security/data-lifecycle.md#L33) — `## 保留、到期与删除`
- [docs/security/database-access-matrix.md:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/docs/security/database-access-matrix.md#L1)
- [src/components/settings/PrivacyContent.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/components/settings/PrivacyContent.tsx#L1)
- [src/lib/audit/write.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/audit/write.ts#L1)
- [src/lib/audit/presentation.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/audit/presentation.ts#L1)
- [src/lib/scheduler/definitions.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/lib/scheduler/definitions.ts#L1)
- [src/actions/scheduler.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/actions/scheduler.ts#L1)
- [docs/operations/disaster-recovery.md:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/docs/operations/disaster-recovery.md#L1)
- [docs/operations/observability.md:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/docs/operations/observability.md#L1)
- [drizzle/migrations/0034_database_access_boundary.sql:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/drizzle/migrations/0034_database_access_boundary.sql#L1)
- [scripts/db/recovery/storage-policy.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/scripts/db/recovery/storage-policy.ts#L1)

**已有测试源码（未重跑）**

- [tests/integration/db/migrations/database-access-boundary.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/migrations/database-access-boundary.test.ts#L1)
- [tests/integration/db/education-evidence-retention.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/education-evidence-retention.test.ts#L1)
- [tests/unit/lib/public-payload.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/unit/lib/public-payload.test.ts#L1)
- [tests/integration/db/scheduler-contract.test.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/tests/integration/db/scheduler-contract.test.ts#L1)

## 当前入口全量核对

以下由基线的 `src/app/**/page.tsx` 与 `src/app/**/route.ts` 清单逐项归类。它是实现位置索引，不规定未来的信息架构。页面可见不等于可以写入，仍需返回各 E 组读取 action/owner 的权限与生命周期。重定向、历史规则页、测试辅助及机器接口均保留在盘点中。

| 基线入口文件 | 当前用途 | 产品事实证据组 |
| --- | --- | --- |
| [src/app/[seasonSlug]/announcements/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/%5BseasonSlug%5D/announcements/page.tsx#L1) | 赛事公告 | [E23](#e23) |
| [src/app/[seasonSlug]/bet/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/%5BseasonSlug%5D/bet/page.tsx#L1) | Major 免费预测与积分市场共用当前入口 | [E19](#e19) / [E20](#e20) |
| [src/app/[seasonSlug]/captains/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/%5BseasonSlug%5D/captains/page.tsx#L1) | 队长投票 | [E08](#e08) |
| [src/app/[seasonSlug]/community-awards/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/%5BseasonSlug%5D/community-awards/page.tsx#L1) | 社区奖提案/证据/结果 | [E22](#e22) |
| [src/app/[seasonSlug]/draft/captain/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/%5BseasonSlug%5D/draft/captain/page.tsx#L1) | 队长选人 | [E08](#e08) |
| [src/app/[seasonSlug]/draft/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/%5BseasonSlug%5D/draft/page.tsx#L1) | 选秀观看 | [E08](#e08) |
| [src/app/[seasonSlug]/info/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/%5BseasonSlug%5D/info/page.tsx#L1) | 赛事公开信息 | [E23](#e23) |
| [src/app/[seasonSlug]/matches/[matchId]/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/%5BseasonSlug%5D/matches/%5BmatchId%5D/page.tsx#L1) | 公开单场详情/BP 房间 | [E12](#e12) / [E13](#e13) / [E14](#e14) / [E15](#e15) / [E16](#e16) / [E21](#e21) |
| [src/app/[seasonSlug]/matches/[matchId]/veto/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/%5BseasonSlug%5D/matches/%5BmatchId%5D/veto/page.tsx#L1) | 公开单场详情/BP 房间 | [E12](#e12) / [E13](#e13) / [E14](#e14) / [E15](#e15) / [E16](#e16) / [E21](#e21) |
| [src/app/[seasonSlug]/matches/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/%5BseasonSlug%5D/matches/page.tsx#L1) | 本届正式赛程 | [E10](#e10) / [E11](#e11) / [E14](#e14) |
| [src/app/[seasonSlug]/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/%5BseasonSlug%5D/page.tsx#L1) | 赛事公开汇总 | [E07](#e07) / [E10](#e10) / [E11](#e11) / [E17](#e17) |
| [src/app/[seasonSlug]/players/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/%5BseasonSlug%5D/players/page.tsx#L1) | 本届选手 | [E08](#e08) / [E09](#e09) / [E17](#e17) |
| [src/app/[seasonSlug]/predictions/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/%5BseasonSlug%5D/predictions/page.tsx#L1) | Major 推演/Pick’Em | [E18](#e18) |
| [src/app/[seasonSlug]/register/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/%5BseasonSlug%5D/register/page.tsx#L1) | 个人或队伍报名 | [E08](#e08) / [E09](#e09) |
| [src/app/[seasonSlug]/stats/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/%5BseasonSlug%5D/stats/page.tsx#L1) | 平台/赛事统计 | [E17](#e17) |
| [src/app/[seasonSlug]/teams/[entryId]/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/%5BseasonSlug%5D/teams/%5BentryId%5D/page.tsx#L1) | 本届参赛方详情 | [E09](#e09) / [E17](#e17) |
| [src/app/[seasonSlug]/teams/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/%5BseasonSlug%5D/teams/page.tsx#L1) | 本届参赛方 | [E09](#e09) / [E10](#e10) |
| [src/app/admin/[seasonSlug]/bet/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/%5BseasonSlug%5D/bet/page.tsx#L1) | BET 管理 | [E20](#e20) |
| [src/app/admin/[seasonSlug]/captains/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/%5BseasonSlug%5D/captains/page.tsx#L1) | 队长确认 | [E08](#e08) |
| [src/app/admin/[seasonSlug]/community-awards/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/%5BseasonSlug%5D/community-awards/page.tsx#L1) | 社区奖管理 | [E22](#e22) |
| [src/app/admin/[seasonSlug]/discipline/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/%5BseasonSlug%5D/discipline/page.tsx#L1) | 纪律管理 | [E22](#e22) |
| [src/app/admin/[seasonSlug]/draft/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/%5BseasonSlug%5D/draft/page.tsx#L1) | 选秀管理 | [E08](#e08) |
| [src/app/admin/[seasonSlug]/logs/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/%5BseasonSlug%5D/logs/page.tsx#L1) | 本届审计 | [E24](#e24) |
| [src/app/admin/[seasonSlug]/matches/[matchId]/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/%5BseasonSlug%5D/matches/%5BmatchId%5D/page.tsx#L1) | 单场赛务 | [E12](#e12) / [E13](#e13) / [E14](#e14) / [E15](#e15) / [E21](#e21) |
| [src/app/admin/[seasonSlug]/matches/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/%5BseasonSlug%5D/matches/page.tsx#L1) | 比赛总览 | [E12](#e12) / [E14](#e14) / [E21](#e21) |
| [src/app/admin/[seasonSlug]/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/%5BseasonSlug%5D/page.tsx#L1) | 本届管理汇总 | [E07](#e07) / [E10](#e10) / [E11](#e11) |
| [src/app/admin/[seasonSlug]/post-event/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/%5BseasonSlug%5D/post-event/page.tsx#L1) | 正式收尾/裁决/荣誉 | [E22](#e22) |
| [src/app/admin/[seasonSlug]/prestart/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/%5BseasonSlug%5D/prestart/page.tsx#L1) | Major 赛前准备 | [E10](#e10) |
| [src/app/admin/[seasonSlug]/registrations/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/%5BseasonSlug%5D/registrations/page.tsx#L1) | 报名审核 | [E08](#e08) / [E09](#e09) |
| [src/app/admin/[seasonSlug]/settings/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/%5BseasonSlug%5D/settings/page.tsx#L1) | 本届设置 | [E07](#e07) |
| [src/app/admin/[seasonSlug]/test-matches/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/%5BseasonSlug%5D/test-matches/page.tsx#L1) | 演练创建/列表 | [E16](#e16) |
| [src/app/admin/competitive-seasons/conversion-policies/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/competitive-seasons/conversion-policies/page.tsx#L1) | 全局竞技目录/政策管理 | [E05](#e05) |
| [src/app/admin/competitive-seasons/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/competitive-seasons/page.tsx#L1) | 全局竞技目录/政策管理 | [E05](#e05) |
| [src/app/admin/education-verifications/[id]/evidence/route.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/education-verifications/%5Bid%5D/evidence/route.ts#L1) | 超级管理员教育审核/材料访问 | [E04](#e04) |
| [src/app/admin/education-verifications/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/education-verifications/page.tsx#L1) | 超级管理员教育审核/材料访问 | [E04](#e04) |
| [src/app/admin/invites/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/invites/page.tsx#L1) | 授权邀请/平台用户治理 | [E02](#e02) / [E03](#e03) |
| [src/app/admin/logs/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/logs/page.tsx#L1) | 管理入口/运行健康/审计 | [E02](#e02) / [E24](#e24) |
| [src/app/admin/operations/announcements/[announcementId]/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/operations/announcements/%5BannouncementId%5D/page.tsx#L1) | 公开运营信息管理 | [E23](#e23) |
| [src/app/admin/operations/announcements/new/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/operations/announcements/new/page.tsx#L1) | 公开运营信息管理 | [E23](#e23) |
| [src/app/admin/operations/announcements/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/operations/announcements/page.tsx#L1) | 公开运营信息管理 | [E23](#e23) |
| [src/app/admin/operations/feedback/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/operations/feedback/page.tsx#L1) | 平台反馈处理 | [E23](#e23) |
| [src/app/admin/operations/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/operations/page.tsx#L1) | 公开运营信息管理 | [E23](#e23) |
| [src/app/admin/operations/season-info/[seasonSlug]/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/operations/season-info/%5BseasonSlug%5D/page.tsx#L1) | 公开运营信息管理 | [E23](#e23) |
| [src/app/admin/operations/season-info/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/operations/season-info/page.tsx#L1) | 公开运营信息管理 | [E23](#e23) |
| [src/app/admin/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/page.tsx#L1) | 管理入口/运行健康/审计 | [E02](#e02) / [E24](#e24) |
| [src/app/admin/seasons/new/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/seasons/new/page.tsx#L1) | 创建赛事 | [E01](#e01) / [E07](#e07) |
| [src/app/admin/settings/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/settings/page.tsx#L1) | 管理入口/运行健康/审计 | [E02](#e02) / [E24](#e24) |
| [src/app/admin/users/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/admin/users/page.tsx#L1) | 授权邀请/平台用户治理 | [E02](#e02) / [E03](#e03) |
| [src/app/announcements/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/announcements/page.tsx#L1) | 公告列表 | [E23](#e23) |
| [src/app/api/cron/check-registration-deadline/route.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/api/cron/check-registration-deadline/route.ts#L1) | 受保护调度：开放报名/个人报名自动推进 | [E07](#e07) |
| [src/app/api/cron/cleanup-education-evidence/route.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/api/cron/cleanup-education-evidence/route.ts#L1) | 受保护调度：清理到期教育证据 | [E04](#e04) / [E24](#e24) |
| [src/app/api/cron/draft-timeout/route.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/api/cron/draft-timeout/route.ts#L1) | 受保护调度：选秀超时选择 | [E08](#e08) |
| [src/app/api/cron/match-time-auto-award/route.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/api/cron/match-time-auto-award/route.ts#L1) | 受保护调度：首次排期自动采纳/默认阵容 | [E12](#e12) |
| [src/app/api/cron/rebuild-statistics-projections/route.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/api/cron/rebuild-statistics-projections/route.ts#L1) | 受保护调度：统计投影重建 | [E17](#e17) |
| [src/app/api/cron/reconcile-predictions/route.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/api/cron/reconcile-predictions/route.ts#L1) | 受保护调度：Pick’Em/BET 待处理结算 | [E18](#e18) / [E20](#e20) |
| [src/app/api/cron/refresh-steam-profiles/route.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/api/cron/refresh-steam-profiles/route.ts#L1) | 受保护调度：公开 Steam 资料缓存刷新 | [E03](#e03) / [E17](#e17) |
| [src/app/api/cron/resolve-match-veto-timeouts/route.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/api/cron/resolve-match-veto-timeouts/route.ts#L1) | 受保护调度：BP 超时及申诉协调 | [E13](#e13) |
| [src/app/api/cron/settle-match-mvp/route.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/api/cron/settle-match-mvp/route.ts#L1) | 受保护调度：MVP 截止结算 | [E21](#e21) |
| [src/app/api/integrations/dak/events/route.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/api/integrations/dak/events/route.ts#L1) | 机器接口/人的设备授权入口 | [E15](#e15) |
| [src/app/api/integrations/dak/evidence/route.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/api/integrations/dak/evidence/route.ts#L1) | 机器接口/人的设备授权入口 | [E15](#e15) |
| [src/app/api/integrations/dak/pairing/poll/route.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/api/integrations/dak/pairing/poll/route.ts#L1) | 机器接口/人的设备授权入口 | [E15](#e15) |
| [src/app/api/integrations/dak/pairing/start/route.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/api/integrations/dak/pairing/start/route.ts#L1) | 机器接口/人的设备授权入口 | [E15](#e15) |
| [src/app/api/integrations/dak/pairings/[pairingId]/route.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/api/integrations/dak/pairings/%5BpairingId%5D/route.ts#L1) | 机器接口/人的设备授权入口 | [E15](#e15) |
| [src/app/api/matches/[matchId]/live-viewer/route.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/api/matches/%5BmatchId%5D/live-viewer/route.ts#L1) | 公开单场只读 LIVE 授权接口 | [E15](#e15) |
| [src/app/api/mizar/[operation]/route.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/api/mizar/%5Boperation%5D/route.ts#L1) | 机器接口/人的设备授权入口 | [E15](#e15) |
| [src/app/api/mizar/pairing/poll/route.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/api/mizar/pairing/poll/route.ts#L1) | 机器接口/人的设备授权入口 | [E15](#e15) |
| [src/app/api/mizar/pairing/start/route.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/api/mizar/pairing/start/route.ts#L1) | 机器接口/人的设备授权入口 | [E15](#e15) |
| [src/app/api/system/release/route.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/api/system/release/route.ts#L1) | 部署身份只读接口 | [E24](#e24) |
| [src/app/api/test/e2e/auth/route.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/api/test/e2e/auth/route.ts#L1) | 测试辅助，非正式用户能力 | [E03](#e03) |
| [src/app/auth/callback/[flow]/route.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/auth/callback/%5Bflow%5D/route.ts#L1) | 账号入口 | [E03](#e03) |
| [src/app/auth/callback/route.ts:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/auth/callback/route.ts#L1) | 账号入口 | [E03](#e03) |
| [src/app/auth/confirmation/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/auth/confirmation/page.tsx#L1) | 账号入口 | [E03](#e03) |
| [src/app/forgot-password/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/forgot-password/page.tsx#L1) | 账号入口 | [E03](#e03) |
| [src/app/integrations/dak/connect/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/integrations/dak/connect/page.tsx#L1) | 机器接口/人的设备授权入口 | [E15](#e15) |
| [src/app/integrations/mizar/connect/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/integrations/mizar/connect/page.tsx#L1) | 机器接口/人的设备授权入口 | [E15](#e15) |
| [src/app/invite/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/invite/page.tsx#L1) | 授权邀请/平台用户治理 | [E02](#e02) / [E03](#e03) |
| [src/app/login/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/login/page.tsx#L1) | 账号入口 | [E03](#e03) |
| [src/app/my/competitions/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/my/competitions/page.tsx#L1) | 本人比赛/参赛/组队待办汇总 | [E06](#e06) / [E08](#e08) / [E09](#e09) / [E12](#e12) / [E16](#e16) |
| [src/app/my/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/my/page.tsx#L1) | 本人比赛/参赛/组队待办汇总 | [E06](#e06) / [E08](#e08) / [E09](#e09) / [E12](#e12) / [E16](#e16) |
| [src/app/my/teams/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/my/teams/page.tsx#L1) | 本人比赛/参赛/组队待办汇总 | [E06](#e06) / [E08](#e08) / [E09](#e09) / [E12](#e12) / [E16](#e16) |
| [src/app/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/page.tsx#L1) | 公开首页/赛事发现 | [E01](#e01) / [E07](#e07) / [E17](#e17) / [E23](#e23) |
| [src/app/players/[userId]/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/players/%5BuserId%5D/page.tsx#L1) | 公开选手档案 | [E17](#e17) |
| [src/app/privacy/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/privacy/page.tsx#L1) | 隐私说明 | [E24](#e24) |
| [src/app/reset-password/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/reset-password/page.tsx#L1) | 账号入口 | [E03](#e03) |
| [src/app/rules/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/rules/page.tsx#L1) | 正式/历史规则展示 | [E01](#e01) |
| [src/app/rules/spring/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/rules/spring/page.tsx#L1) | 正式/历史规则展示 | [E01](#e01) |
| [src/app/seasons/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/seasons/page.tsx#L1) | 公开首页/赛事发现 | [E01](#e01) / [E07](#e07) / [E17](#e17) / [E23](#e23) |
| [src/app/settings/competitive/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/settings/competitive/page.tsx#L1) | 本人竞技资料 | [E05](#e05) |
| [src/app/settings/education/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/settings/education/page.tsx#L1) | 本人教育认证 | [E04](#e04) |
| [src/app/settings/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/settings/page.tsx#L1) | 本人长期资料 | [E03](#e03) / [E05](#e05) |
| [src/app/settings/password/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/settings/password/page.tsx#L1) | 账号入口 | [E03](#e03) |
| [src/app/settings/security/merge/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/settings/security/merge/page.tsx#L1) | 账号入口 | [E03](#e03) |
| [src/app/settings/security/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/settings/security/page.tsx#L1) | 账号入口 | [E03](#e03) |
| [src/app/stats/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/stats/page.tsx#L1) | 平台/赛事统计 | [E17](#e17) |
| [src/app/team-invites/[token]/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/team-invites/%5Btoken%5D/page.tsx#L1) | 长期队伍邀请响应 | [E06](#e06) |
| [src/app/teams/[slug]/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/teams/%5Bslug%5D/page.tsx#L1) | 长期队伍/公开档案/招募 | [E06](#e06) / [E17](#e17) |
| [src/app/teams/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/teams/page.tsx#L1) | 长期队伍/公开档案/招募 | [E06](#e06) / [E17](#e17) |
| [src/app/teams/recruitment/page.tsx:1](https://github.com/Starfie1d1272/RivalHub/blob/4ca5f800c44ea2611f82e18fcbede2077e3cdafc/src/app/teams/recruitment/page.tsx#L1) | 长期队伍/公开档案/招募 | [E06](#e06) / [E17](#e17) |
