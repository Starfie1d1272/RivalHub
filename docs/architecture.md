# RivalHub 技术架构

## System shape

RivalHub 使用 Next.js App Router。页面默认使用 Server Components；first-party UI mutation 通常通过 Server Actions，HTTP/protocol integration 可使用 Route Handler，但所有入口共享同一个 canonical domain operation。Drizzle 访问 Postgres；Supabase 提供 Auth 与 Storage；iron-session 承载应用会话。

```text
Browser
  └─ Next.js App Router
       ├─ Server Components ── Drizzle ── Postgres
       ├─ Server Actions / protocol routes ── canonical domain operations
       │                                      └─ Drizzle / Supabase Auth / Storage
       └─ Client islands ─── Supabase Auth only; live views use server refresh/polling
```

页面负责路由、读取和呈现；复杂事务、资格判断、赛制和恢复逻辑位于 `src/actions/` 与 `src/lib/` 的 canonical owner。页面和客户端组件不旁路写入；普通 API/协议入口如存在，也必须委托同一 domain operation。所有管理操作写入 `audit_logs`。

entrypoint 负责鉴权与输入验证；transaction boundary 可以由 action 直接持有，也可以由可复用的 server-only domain service 作为 canonical owner。qualification、roster、赛制、恢复或序列化逻辑不得在页面与 action 中重复实现。

## Public data boundary

```text
database internal object
  → server-only query / domain model
  → explicit public projection or DTO
  → public RSC payload / Client Component props
```

服务端查询可读取 email、QQ、教育材料等私密字段以完成权限和业务判断。匿名或公开响应只传递明确的 public projection，不能把 internal query object 原样序列化到 RSC payload 或 Client Component props。email、QQ、`studentId`、`authId`、赛季授权范围、审核材料和内部备注默认不是公开字段；public serializer 的回归测试保护这一边界。

## Stable application contracts

- Server Action 和其它应用入口使用 `ActionResult<T>`、`ok()` / `fail()` 表达预期结果；错误码由 `src/lib/errors.ts` 维护。
- 时间持久化为 UTC，展示层按产品约定转换为 `Asia/Shanghai`。
- `brackets-manager` 只由 `src/lib/bracket/` adapter 接触；其它 domain 依赖 adapter 暴露的类型和操作。

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

比赛、地图、BP、阵容、时间协商和结果由各自 schema/action owner 维护。`matches.scoreA/scoreB` 是所有 format 的官方系列赛比分，`match_maps.scoreA/scoreB` 是实际进行地图的回合比分；正常比赛结果只能由 map-level owner 写入，弃赛不制造虚构地图。Major match 带有 managed ownership 与 `stageRunId` 归属，结果结算推进同一 StageRun 的完整事实。更正必须遵守已冻结的规则和后续阶段边界；当恢复会改变后续配对时，使用 Major recovery 逻辑而不是直接改 projection。

纪律与赛后领域保持独立：sanction、adjudication、placement 与 honor 不相互暗示结果。无季军赛时保留 3–4 placement group；最终结果先进入 `pending_confirmation`，确认后才形成可归档的历史事实。

## Security and operational boundaries

- Supabase Auth 管理邮箱账号；应用会话与角色由 `public.users` + `rivalhub-session` 管理。
- 管理员统一使用 Supabase Auth；`users.role` 与 `season_admin_grants` 是当前权限事实，`rivalhub-session` 只保存身份。
- Data API 对业务表默认拒绝；Server-only DB 是业务读写 owner。完整的 public table 分类与 terminal contract 见 [`security/database-access-matrix.md`](./security/database-access-matrix.md)，由 `scripts/db/access-matrix.ts` 在 migration/local/production verification 中 fail closed。
- 应用代码统一通过 server-only 的 `src/db/client.ts` 取得 Drizzle client；Node CLI 入口使用共享的 `src/db/client-runtime.ts`，并由 ESLint 约束应用代码回到 canonical facade。
- 当前 first-party browser Supabase client 仅用于 Auth；`DraftLiveRoom` 与 `CaptainVotingPanel` 使用现有 server refresh/polling fallback，不再订阅业务表 Realtime。若未来新增 direct Supabase client 或 Realtime table，必须在矩阵中声明最小权限、RLS policy、一致性语义与正反例测试。
- active Drizzle migrations 是唯一 migration authority；`pnpm db:push` 被阻止。
- Local、staging、production 是独立边界，详细执行方式见 [`deployment.md`](./deployment.md)。
- runtime structured logs/traces 由 `src/lib/observability/` 统一拥有；audit log 仍只记录业务事实，操作手册见 [`operations/observability.md`](./operations/observability.md)。

## Stable code-area map

| 领域 | Canonical code area |
|---|---|
| Auth / session / owner bootstrap | `src/lib/auth/`, `src/actions/auth.ts`, `src/app/auth/` |
| Season capabilities / templates | `src/types/season.ts`, `src/actions/seasons.ts`, `src/db/schema/seasons.ts` |
| CS2 map catalog / Active Duty / event projection | `src/types/season.ts`, `src/lib/maps.ts`, `src/lib/recruitment/data.ts` |
| Identity / education / competitive profile | `src/actions/account.ts`, `src/actions/education-verifications.ts`, `src/actions/competitive-profile.ts`, matching schema files |
| Rivals registration / voting / draft | `src/actions/register.ts`, `src/actions/captains.ts`, `src/actions/draft/`, `src/lib/draft/` |
| Long-lived Teams / CompetitionEntry | `src/lib/teams/`, `src/lib/competition-entries/`, corresponding actions and schema files |
| Major prestart and runtime | `src/actions/major-prestart.ts`, `src/lib/major/`, `src/db/schema/major-prestart.ts`, `src/db/schema/major-stage.ts` |
| Matches / rosters / results | `src/actions/matches/`, `src/lib/matches/`, `src/db/schema/matches.ts`, `src/db/schema/match-rosters.ts` |
| Discipline / post-event | `src/actions/discipline.ts`, `src/actions/postevent.ts`, `src/lib/discipline/`, matching schema files |
| Schema / active migrations | `src/db/schema/`, `drizzle/migrations/` |
| CI / Cron | `.github/workflows/`, `src/app/api/cron/` |

用 repository search 或 IDE 定位具体文件；本映射只维护稳定的 domain boundary。
