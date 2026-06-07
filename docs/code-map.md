# 代码地图

本文档记录"某类修改应该从哪里开始"的业务域 → 文件入口映射。
项目结构导航请使用 CodeGraph（`codegraph_files`），本文档不维护目录树。

## 业务域入口

| 修改目标 | 主要入口 | 规则 / 辅助 |
|---|---|---|
| 个人报名 | `src/app/[seasonSlug]/register/`、`src/components/register/RegistrationForm.tsx`、`src/actions/register.ts` | `src/lib/validators/registration.ts`、`src/lib/registration/window.ts`；队伍报名闭环尚未实现 |
| 队长投票 | `src/app/[seasonSlug]/captains/`、`src/components/captains/`、`src/actions/captains.ts` | `src/lib/captains/rules.ts`、`src/lib/captains/data.ts` |
| 选秀 | `src/app/[seasonSlug]/draft/`、`src/components/draft/`、`src/actions/draft/` | `src/lib/draft/rules.ts`、`src/lib/draft/auto-pick.ts`、`src/lib/draft/data.ts` |
| 队伍 | `src/app/[seasonSlug]/teams/`、`src/components/teams/`、`src/actions/teams.ts` | `src/lib/teams/data.ts` |
| 比赛列表 / 生成 | `src/app/[seasonSlug]/matches/`、`src/app/admin/[seasonSlug]/matches/`、`src/actions/matches/schedule.ts` | `src/lib/formats/`、`src/lib/bracket/` |
| 比赛详情 | `src/app/[seasonSlug]/matches/[matchId]/page.tsx` | `src/actions/dak-analysis.ts`、`@cs2dak/react` 的 `MatchWorkspace` |
| 比赛结果 / BP / 阵容 | `src/actions/matches/`、`src/components/matches/` | `src/lib/match-transitions.ts`、`src/lib/validators/match.ts` |
| DAK ZIP 导入与版本化分析 | `src/actions/demo-import.ts`、`src/actions/demo-batch-import.ts`、`scripts/rebuild-dak-season.ts` | `src/lib/demo/dak.ts`、`src/db/schema/demo-analysis.ts`；ZIP 是不可变原始事实，分析快照可版本化替换 |
| DAK 比赛页展现 | `src/app/[seasonSlug]/matches/[matchId]/page.tsx`、`src/actions/dak-analysis.ts` | `@cs2dak/react` 的 `MatchWorkspace`；数据库保存紧凑工作区，回放/高频地图点保留在 ZIP |
| 数据统计排行榜 | `src/app/[seasonSlug]/stats/page.tsx` | `@cs2dak/react` 的 `SeasonLeaderboard`，数据来自 `season_analysis_runs` |
| 选手 / 战队分析 | `src/app/players/[userId]/page.tsx`、`src/app/[seasonSlug]/teams/[teamId]/page.tsx` | `@cs2dak/presentation` 的 `buildPlayerSeasonProfile` / `buildTeamCohortSummary` |
| 评分系统 (RR / PRISM) | `src/actions/compute-season-ratings.ts`（重算入口） | DAK cohort 接线 `@rivalhub/rival-rating`；`player_ratings` 仅保留查询投影，不再是分析真相源 |
| 赛季管理 | `src/app/admin/seasons/`、`src/components/admin/SeasonForm.tsx`、`src/actions/seasons.ts` | `src/types/season.ts`、`src/lib/utils/season.ts` |
| 权限 / 会话 | `src/actions/auth.ts`、`src/actions/account.ts`、`src/middleware.ts` | `src/lib/auth/session.ts`、`src/lib/auth/supabase.ts` |
| Cron | `src/app/api/cron/` | `src/actions/draft/picks.ts`、`src/actions/transitions.ts`、`src/actions/matches/scheduling.ts` |

## 拆分原则

- 页面文件保留路由参数、数据加载、权限派生和 JSX；统计计算、聚合、可复用查询放到 `src/lib/<domain>/`。
- Server Action 保留边界职责；复杂事务步骤拆成同目录 `_shared.ts` 或 `src/lib/<domain>/` 的 service。
- 组件超过 400 行时，优先按可见区块拆子组件；表单可把草稿、字段区块、提交反馈拆成 hook 或局部组件。
- 新增第三方库调用时先找适配层。Bracket 只能经过 `src/lib/bracket/`。
- 新增状态迁移前先改 `docs/state-machines.md`，再改代码。
