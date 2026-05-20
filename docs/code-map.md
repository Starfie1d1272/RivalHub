# 代码地图

这份文档用于快速定位“某类修改应该从哪里开始”。它不替代架构文档，只维护当前代码入口。

## 顶层目录

| 目录 | 职责 |
|---|---|
| `src/app/` | Next.js App Router 页面、布局和 Cron API Route。页面以 Server Component 为主，负责读数据和组装 UI。 |
| `src/actions/` | Server Actions。所有业务写入从这里进入，负责输入校验、鉴权、事务调用、审计和 revalidate。 |
| `src/components/` | UI 组件。业务组件按页面域分组，通用 Tactical Grid 组件在 `components/rivalhub/`。 |
| `src/lib/` | 业务规则、查询辅助、赛制执行器、第三方适配层、工具函数。复杂逻辑优先从页面/action 下沉到这里。 |
| `src/db/schema/` | Drizzle 表结构定义。新增表或字段后同步迁移和数据模型文档。 |
| `src/types/` | 跨层共享类型，尤其是 action 返回、赛季能力、比赛格式和选秀类型。 |
| `tests/` | 测试工具、集成测试和 E2E。业务规则测试通常靠近 `src/lib/**`。 |

## 业务域入口

| 修改目标 | 主要入口 | 规则 / 辅助 |
|---|---|---|
| 报名 | `src/app/[seasonSlug]/register/`、`src/components/register/RegistrationForm.tsx`、`src/actions/register.ts` | `src/lib/validators/registration.ts`、`src/lib/registration/window.ts` |
| 队长投票 | `src/app/[seasonSlug]/captains/`、`src/components/captains/`、`src/actions/captains.ts` | `src/lib/captains/rules.ts`、`src/lib/captains/data.ts` |
| 选秀 | `src/app/[seasonSlug]/draft/`、`src/components/draft/`、`src/actions/draft/` | `src/lib/draft/rules.ts`、`src/lib/draft/auto-pick.ts`、`src/lib/draft/data.ts` |
| 队伍 | `src/app/[seasonSlug]/teams/`、`src/components/teams/`、`src/actions/teams.ts` | `src/lib/teams/data.ts` |
| 比赛列表 / 生成 | `src/app/[seasonSlug]/matches/`、`src/app/admin/[seasonSlug]/matches/`、`src/actions/matches/schedule.ts` | `src/lib/formats/`、`src/lib/bracket/` |
| 比赛详情 | `src/app/[seasonSlug]/matches/[matchId]/page.tsx` | `src/lib/matches/detail-data.ts`、`src/lib/matches/detail-stats.ts` |
| 比赛结果 / BP / 阵容 | `src/actions/matches/`、`src/components/matches/` | `src/lib/match-transitions.ts`、`src/lib/validators/match.ts` |
| 玩家数据 / OCR | `src/actions/player-stats.ts`、`src/components/matches/StatsOCRPanel.tsx` | `src/lib/ocr/`、`src/lib/utils/stats.ts` |
| 赛季管理 | `src/app/admin/seasons/`、`src/components/admin/SeasonForm.tsx`、`src/actions/seasons.ts` | `src/types/season.ts`、`src/lib/utils/season.ts` |
| 权限 / 会话 | `src/actions/auth.ts`、`src/actions/account.ts`、`src/middleware.ts` | `src/lib/auth/session.ts`、`src/lib/auth/supabase.ts` |
| Cron | `src/app/api/cron/` | `src/actions/draft/picks.ts`、`src/actions/transitions.ts`、`src/actions/matches/scheduling.ts` |

## 拆分原则

- 页面文件保留路由参数、数据加载、权限派生和 JSX；统计计算、聚合、可复用查询放到 `src/lib/<domain>/`。
- Server Action 保留边界职责；复杂事务步骤拆成同目录 `_shared.ts` 或 `src/lib/<domain>/` 的 service。
- 组件超过 400 行时，优先按可见区块拆子组件；表单可把草稿、字段区块、提交反馈拆成 hook 或局部组件。
- 新增第三方库调用时先找适配层。Bracket 只能经过 `src/lib/bracket/`。
- 新增状态迁移前先改 `docs/state-machines.md`，再改代码。
