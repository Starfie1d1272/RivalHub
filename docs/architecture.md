# RivalHub 技术架构

本文件只描述跨模块稳定边界。领域事实见 [`domain-model.md`](./domain-model.md)，生命周期见 [`workflows.md`](./workflows.md)，精确实现以 code/schema/tests 为准。

## System shape

RivalHub 使用 Next.js App Router、TypeScript、Drizzle/PostgreSQL 与 Supabase。页面默认是 Server Components；first-party mutation 通常通过 Server Actions，协议型 HTTP integration 可使用 Route Handler，但都必须委托同一个 canonical domain operation。

```text
Browser
  └─ Next.js App Router
       ├─ Server Components ───────────────┐
       ├─ Server Actions / Route Handlers ─┼─ canonical domain owner
       └─ Client islands                   │     ├─ Drizzle → PostgreSQL
                                           │     └─ Supabase Auth / Storage
                                           └─ explicit public projection
```

客户端负责交互，不拥有持久化业务规则。数据库、secret、privileged SDK、复杂事务、资格、赛制和恢复逻辑保持 server-only。

## Application boundaries

### Entrypoint vs domain owner

Entrypoint 负责不可信输入、鉴权、transport result 和 revalidation；可复用的规则或 transaction workflow 进入明确的 canonical owner。相同 transition、derived fact、validation 或 formatter 不在 page/action/component 中复制第二份。

预期业务结果统一使用 `ActionResult<T>`；unexpected runtime failure 进入 canonical observability，而不是把 exception 当业务状态。

### Stable dependency direction

跨领域依赖沿着稳定的业务方向收敛：

```text
Identity / Catalog
        ↓
Competition Definition
        ↓
Participation
        ↓
Tournament Runtime
        ↓
Match / Official Result
        ↓
History / Analytics / Spectator
```

Page、Server Action、Route Handler 和 Client Component 是 entrypoint/presentation 层，只调用 canonical `src/lib/` owner；`src/lib/` domain/library 代码不得反向依赖 `src/actions/`、`src/app/` 或 `src/components/`。Client graph 只能通过 `use server` action boundary 进入 server workflow，不能到达数据库、secret/provider owner 或 server-only observability facade。

这条方向由 `pnpm architecture:check` 执行检查。检查器读取项目 tsconfig 并使用 TypeScript module resolver 解析 alias、relative 和 runtime dynamic import；Client→Server 泄漏只沿 runtime graph 检查，而 canonical third-party provider ownership 连 type-only edge 也 fail closed。DTO/serializer 的字段泄漏仍由对应 serializer tests 负责。

### Public data

```text
DB/internal facts
→ server-only query/domain logic
→ explicit public DTO/read model
→ public RSC payload / Client props
```

公开页面默认不暴露 email、QQ、`studentId`、`authId`、管理员授权范围、教育证据或内部备注。不能把内部查询对象直接序列化给浏览器。

### Persistence

- `src/db/schema/` 表达当前应用 schema；`drizzle/migrations/` 是唯一 active migration chain。
- `pnpm db:push` 被阻止；远程 schema write 只能走受保护的 staging/release path。
- 应用代码通过 server-only DB facade 取得 Drizzle client；CLI/runtime exception 使用显式共享 runtime boundary。
- 需要历史复现、审计或恢复的 snapshot 是领域事实，不因与 live data 重复而去重。

## Competition architecture

赛事由 capability 驱动，而不是按 `seasons.kind` 写业务分支。报名模式、投票/选秀、社区奖、阶段计划、名单与资格规则都来自 persisted capability/config；`competitionTemplate` 只负责内置模板身份与固定语义。

当前两个内置体系共享账号、Team、CompetitionEntry、Match、审计和数据基础设施：

| 体系 | 参与模型 | 专属运行时 |
| --- | --- | --- |
| Rivals | 个人报名后形成赛事原生 CompetitionEntry | 投票、选秀、循环赛/双败流程 |
| Major | 长期 Team 创建 CompetitionEntry | 赛前冻结、managed StageRun、Swiss/Playoffs、恢复与赛后事实 |

具体赛制属于赛事政策和 stage/runtime owner，不在架构文档复制当前轮次、人数或 BO 数字。

Season capability 的代码 ownership 固定为：`src/types/season.ts` 只表达 canonical data contract；`src/lib/competition/templates.ts` 只拥有当前内置赛事默认值；`src/lib/config/cs2-maps.ts` 拥有稳定地图目录与当前 Active Duty 轮换，`src/lib/config/cs2-positions.ts` 拥有位置目录；`src/lib/seasons/compatibility.ts` 只把 legacy/partial persisted shape 投影为 canonical shape；`src/lib/seasons/presentation.ts` 拥有 Season status、报名排期、player type 和 stage type 展示标签；`src/lib/maps.ts` 拥有地图展示与偏好 projection。current template 不依赖 historical compatibility fallback，frozen event facts 也不因 current preset/catalog 变化被重新解释。

## Runtime truth

定义态、报名态和运行态不能互相覆盖：

```text
Season capability/config
        ↓ open/freeze
CompetitionEntry / EventRoster
        ↓ start
StageRun + frozen rule/eligibility facts
        ↓ matches
official Match / Map facts
        ↓ finalize
FinalResult / adjudication / honor
```

Major runtime 的阶段参与者和已完成比赛是推进依据；standings、后台摘要和其它 UI projection 只是 read model。比赛更正如果影响下游配对，必须经过受控 recovery，而不是直接改 projection。

通用 Stage 的 logical identity 是 `(seasonId, StageConfig.key)`；`StageConfig.name` 只用于展示。`brackets-manager` 只能经 `src/lib/bracket/` adapter 使用，每个 provider-backed Stage 独立拥有 `(competition_id, stage_key)` 状态，provider stage name 和 numeric participant id 不得扩散成领域 contract。参与者必须携带稳定的 `rivalhubEntryId`，比赛解析只消费该 metadata。

Major Swiss 不经过通用 provider adapter：它由 `majorStageEntrants`、official managed matches 和 StageRun 的 `finalizedRound` 投影，配对与晋级继续由 `src/lib/major/swiss.ts` / runtime owner 决定。旧 `competition_bracket_states` 与 `swiss_standings` 在 Release N 仅作为兼容壳保留，应用没有 active consumer；后续 contract release 才删除。

## Security and operations

- Supabase Auth 管理邮箱凭据；应用 session 只保存身份，当前角色和 season grants 每次从数据库读取。
- 业务表默认 server-only；Data API/RLS terminal contract 见生成式 [`security/database-access-matrix.md`](./security/database-access-matrix.md)。新增 direct browser Data API 或 Realtime surface 必须同时定义最小 GRANT/RLS、consumer、一致性语义和正反例测试。
- 管理 mutation 产生 `audit_logs` 业务审计；runtime logs/traces 由 `src/lib/observability/` 独立拥有。
- 业务关键 scheduler 由 shared registry、Supabase primary dispatch、现有 Cron endpoint runner 和有界 health projection 组成；数据库 dispatch 只负责唤醒，不复制 domain transition。GitHub watchdog、participant opening recovery 和 super-admin break-glass 都复用同一 execution/domain owner。
- local / preview / staging / production 的写权限严格分离，见 [`deployment.md`](./deployment.md)。
- 时间持久化使用 UTC；产品展示按约定时区转换。

## Stable code areas

这里只维护长期边界，不列逐文件 inventory：

| 领域 | 主要区域 |
| --- | --- |
| Auth / permissions | `src/lib/auth/`, auth actions/routes |
| Season contract / templates / compatibility | `src/types/season.ts`, `src/lib/competition/templates.ts`, `src/lib/seasons/compatibility.ts`, `src/lib/seasons/presentation.ts` |
| CS2 map / position catalogs | `src/lib/config/cs2-maps.ts`, `src/lib/config/cs2-positions.ts`, `src/lib/maps.ts` |
| Identity / education / competitive | `src/lib/identity/`, `src/lib/competitive/`, `src/lib/qualification/` |
| Teams / CompetitionEntry / recruitment | `src/lib/teams/`, `src/lib/competition-entries/`, `src/lib/recruitment/` |
| Rivals voting / draft | `src/lib/captains/`, `src/lib/draft/`, corresponding actions |
| Major prestart / runtime | `src/lib/major/` |
| Match / roster / result | `src/lib/matches/`, `src/lib/match-rosters/`, match actions |
| Discipline / post-event / awards | corresponding `src/lib/` domain owners |
| Scheduler / background recovery | `src/lib/scheduler/`, `src/lib/seasons/registration-recovery.ts`, protected `scripts/db/scheduler.ts` |
| Persistence / migration | `src/db/schema/`, `drizzle/migrations/` |

需要具体 owner 时先 repository search，再沿 tests 和 callers 确认；不要把本表扩成实时文件清单。
