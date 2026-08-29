# RivalHub 技术架构

## System shape

RivalHub 使用 Next.js App Router。页面以 Server Components 为主；受控写入通过 Server Actions；Cron 使用 API Route；Drizzle 访问 Postgres；Supabase 提供 Auth、Storage 与受限 Realtime；iron-session 承载应用会话。

```text
Browser
  └─ Next.js App Router
       ├─ Server Components ── Drizzle ── Postgres
       ├─ Server Actions ──── Drizzle / Supabase Auth / Storage
       ├─ Cron API Routes ── CRON_SECRET
       └─ Client islands ─── Supabase Realtime (approved tables only)
```

页面负责路由、读取和呈现；复杂事务、资格判断、赛制和恢复逻辑位于 `src/actions/` 与 `src/lib/`。业务写入不得由页面、客户端组件或普通 API Route 旁路完成。所有管理操作写入 `audit_logs`。

Server Action 拥有鉴权、输入验证和 transaction boundary；可以跨 action 复用的 qualification、roster、赛制、恢复或序列化逻辑下沉至 `src/lib/<domain>/`。页面与 action 不重复实现同一领域规则。

## Public data boundary

```text
database internal object
  → server-only query / domain model
  → explicit public projection or DTO
  → public RSC payload / Client Component props
```

服务端查询可读取 email、QQ、教育材料等私密字段以完成权限和业务判断。匿名或公开响应只传递明确的 public projection，不能把 internal query object 原样序列化到 RSC payload 或 Client Component props。email、QQ、`studentId`、`authId`、`adminSeasonIds`、审核材料和内部备注默认不是公开字段；public serializer 的回归测试保护这一边界。

## Built-in competition systems

Rivals 与 Major 是当前两个平行的内置赛事体系。

| 体系 | 参与方式 | 运行时 |
|---|---|---|
| Rivals · Spring | 个人报名 → 审核 → 队长投票 → 蛇形选秀 | 循环赛与双败淘汰赛，选秀状态由事务与幂等请求保护 |
| Major · Autumn | 队伍报名 → 成员确认 → 审核/物化 → 赛前冻结 | Major-owned 三段 Swiss、淘汰赛、赛果恢复、纪律与赛后处理 |

Major 的正式运行时由 `src/lib/major/` 与 `major_*` persistence owners 管理。其 canonical 参赛事实是 `major_stage_entrants` 与已完成比赛；`swiss_standings` 或 UI projection 不是最终真相。启动、回合结算、恢复与幂等边界都显式绑定 `stageRunId`。

## Competition extension contract

赛季使用 capability-driven 设计。`seasons.kind` 是展示/历史标签，业务功能必须从 `registrationMode`、`hasCaptainVoting`、`hasDraft`、`stagePlan`、报名配置、队伍配置和 affiliation rules 推导。

`src/types/season.ts` 定义通用 extension contract：

- `StageConfig` / `StagePlan`：阶段声明。
- `StageExecutor`：`initialize`、`getQualifiers`、`isComplete` 与可选 `advanceRound`。
- `src/lib/formats/` executor registry：将通用阶段类型路由至执行器。

这是继续支持未来赛事形态的接口，不表示每一种 `StageType` 都已作为当前产品能力完整运营。当前 Major Swiss 由 Major managed runtime ownership；当前内置赛事的产品承诺以本文件的两个体系和测试覆盖为准。

## Match lifecycle and recovery

比赛、地图、BP、阵容、时间协商和结果由各自 schema/action owner 维护。Major match 带有 managed ownership 与 `stageRunId` 归属，结果结算推进同一 StageRun 的完整事实。更正必须遵守已冻结的规则和后续阶段边界；当恢复会改变后续配对时，使用 Major recovery 逻辑而不是直接改 projection。

纪律与赛后领域保持独立：sanction、adjudication、placement 与 honor 不相互暗示结果。无季军赛时保留 3–4 placement group；最终结果先进入 `pending_confirmation`，确认后才形成可归档的历史事实。

## Security and operational boundaries

- Supabase Auth 管理邮箱账号；应用会话与角色由 `public.users` + `rivalhub-session` 管理。
- `admin_users` + `rivalhub-admin` 是 legacy emergency compatibility path。
- Data API 对业务表默认拒绝；Server-only DB 是业务读写 owner。新增 direct Supabase client 或 Realtime table 时，同一变更必须包含 explicit grant、RLS policy 与正反例测试。
- Realtime 仅服务于 `draft_state`、`draft_picks` 和 `captain_votes`，且在数据库事务 commit 后发送。
- active Drizzle migrations 是唯一 migration authority；`pnpm db:push` 被阻止。
- Local、staging、production 是独立边界，详细执行方式见 [`deployment.md`](./deployment.md)。

## Stable code-area map

| 领域 | Canonical code area |
|---|---|
| Auth / session / owner bootstrap | `src/lib/auth/`, `src/actions/auth.ts`, `src/app/auth/` |
| Season capabilities / templates | `src/types/season.ts`, `src/actions/seasons.ts`, `src/db/schema/seasons.ts` |
| Identity / education / competitive profile | `src/actions/account.ts`, `src/actions/education-verifications.ts`, `src/actions/competitive-profile.ts`, matching schema files |
| Rivals registration / voting / draft | `src/actions/register.ts`, `src/actions/captains.ts`, `src/actions/draft/`, `src/lib/draft/` |
| Team applications | `src/actions/team-applications.ts`, `src/lib/major/participant-readiness.ts`, `src/db/schema/team-applications.ts` |
| Major prestart and runtime | `src/actions/major-prestart.ts`, `src/lib/major/`, `src/db/schema/major-prestart.ts`, `src/db/schema/major-stage.ts` |
| Matches / rosters / results | `src/actions/matches/`, `src/lib/matches/`, `src/db/schema/matches.ts`, `src/db/schema/match-rosters.ts` |
| Discipline / post-event | `src/actions/discipline.ts`, `src/actions/postevent.ts`, `src/lib/discipline/`, matching schema files |
| Schema / active migrations | `src/db/schema/`, `drizzle/migrations/` |
| CI / Cron | `.github/workflows/`, `src/app/api/cron/` |

用 repository search 或 IDE 定位具体文件；本映射只维护稳定的 domain boundary。
