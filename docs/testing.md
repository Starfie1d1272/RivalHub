# 测试与上线验收

## Verification evidence model

RivalHub 以最高已完成的验证层级描述能力证据：

```text
实现 → 自动化验证 → 完整环境演练 → 生产实战验证
```

| 体系 | 当前最高证据 | 范围 |
|---|---|---|
| Rivals · Spring | 生产实战验证 | 2026 NJU Rivals 完成个人报名、审核、队长投票、选秀、循环赛、双败淘汰、比赛管理、时间协商、BP/赛果、MVP、OCR 统计与赛季结束 |
| Major · Autumn | 自动化生命周期验证 | unit/integration、Local Supabase 和 browser fixture 覆盖 Entry 报名、资格、prestart、三段 Swiss、Playoffs、roster、recovery、discipline 与 post-event |

**RC4 之后的验证策略：**v2.0.0-rc.4 已完成 production 恢复、17/17 migration 与 production smoke。后续变更仍按自动化、Local Supabase、适用的 browser/staging gate 和真实运营证据逐层验证；完整 32 队 staging lifecycle 可作为专项演练，但不是稳定 RC 的强制 gate。

真实注册确认邮件与密码重置邮件的投递是 production canary 和持续运营观察项。记录送达、延迟、退信及供应商异常，在真实流量中持续核对；它们不回溯为 RC4 release blocker，也不以 API 成功响应替代真实收件证据。

## Repository checks

| 命令 | 用途 |
|---|---|
| `pnpm type-check` | Next route typegen + TypeScript |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest unit suite 与不依赖数据库的组件/领域测试 |
| `pnpm test:coverage` | V8 覆盖率诊断报告，不作为百分比 gate |
| `pnpm test:integration` | 通过 Local runner 串行运行真实 PostgreSQL / migration replay suite |
| `pnpm test:e2e` | 准备并清理 Local browser fixture 后运行 Playwright |
| `pnpm check` | type-check + lint + db:check + test |
| `pnpm verify` | check + production build；build 不需要数据库或 fake DB URL |
| `pnpm verify:local` | 确保 Local ready，bootstrap/verify、verify、real-PG integration 与 browser E2E |
| `pnpm db:check` | Drizzle active migration chain |
| `pnpm build` | production build |
| `pnpm build:local` | 注入 loopback Local Supabase 环境的 production build |

`pnpm test:integration` 与 `pnpm test:e2e` 都拒绝缺少或非 loopback 的 Local 数据库目标。前者运行 `tests/integration/db/**/*.test.ts`，后者通过 `pnpm dev:local` 启动应用，并在测试前后自动创建、清理 browser fixture；运行前先执行 `pnpm db:local:bootstrap`。

Local PostgreSQL / migration evidence：

多个 worktree 共享同一个 Local Supabase project/端口时，scripts/db/local.ts 会对 bootstrap、migration、seed、verify、real-PG integration、browser E2E、reset 和 verify:local 持有跨 worktree 的 OS 临时目录锁；占用者结束后才继续，异常退出留下的锁会按 PID 存活状态回收。普通 type-check、unit test 与 build 不经过该锁。invite-concurrency.test.ts 只证明 PostgreSQL invite row 的 FOR UPDATE serialization 与 maxUses pattern；它不调用 production claimInviteCode()，因此 PR5 Auth/Permission convergence 仍需用真实 production command/service 的 real-PG concurrency evidence 替换或升级这条 canary。

```bash
pnpm test:integration
pnpm test:integration -- tests/integration/db/major-start.test.ts
pnpm test:integration -- tests/integration/db/migrations/competitive-catalog.test.ts
pnpm test:e2e
pnpm verify:local
```

所有 real-PG 套件通过 `scripts/db/local.ts` 注入同一个 loopback Local Supabase 目标，并由 `vitest.integration.config.ts` 关闭文件并发、保持 fixture 顺序独立。migration replay 使用独立 scratch database；不使用 testcontainers，也不以 mock 代替事务、约束或并发证据。需要缩小调试范围时直接使用 Vitest 文件或 `-t` pattern filter。

## Coverage intent

单元测试覆盖 capability、状态和 action input boundary，包括 persisted template identity、custom definition validator（executor registry 与 groupCount 晋级计算）、qualification batch/single parity 与竞技上下文冻结/解冻；本地集成测试覆盖 Major Entry registration（含跨 Entry aggregate invariant）、0017 migration replay、长期 participant profile、browser fixture、prestart（含 prestart↔CompetitionEntry coherence guard）、StageRun lifecycle（含开赛前名单一致性 fail-closed 与开赛时按冻结规则重验竞技资料）、roster safety、result recovery、discipline、post-event、“我的”资料/Team/CompetitionEntry/qualification/sanction 组合 read model、Team 邀请过期生命周期，以及 season governance（空赛季删除/撤回 guard、竞技冻结生命周期、队长交接并发语义、行锁终态转换与原子审计）。所有入口都运行在 CompetitionEntry/event-roster schema 上。历史 Golden Major rehearsal 保存在 [`archive/rehearsals/`](./archive/rehearsals/)，不是当前策略的替代品。

## Test layers

```text
Vitest unit
        ↓
Vitest real-PG / migration replay
        ↓
Playwright browser E2E
        ↓
RC production smoke
        ↓
real registrations progressive validation
```

每一层回答不同问题：Vitest 验证 pure rules 与 action boundary；Local Supabase 验证真实 Postgres/Auth/Storage 合作；Playwright 验证浏览器任务；RC production 只承载最小 smoke，后续真实报名以渐进方式验证运营事实。完整 staging lifecycle 可补充验证，但不替代这些分层证据。

## 完整 staging lifecycle（专项演练，非稳定 RC 强制 gate）

如需进行完整 staging lifecycle，可在独立 staging DB 按以下流程专项演练：

```text
管理员创建 Major → 发布 → 用户注册 → 邮箱确认 → participant profile
→ education verification → competitive profile → 长期 Team → 创建
CompetitionEntry → roster revision → member invite / confirmation
→ designated starters → submit → review
→ return → edit → resubmit → approve → prestart
→ entrants → final rosters → seeds → lock/start → Stage 1 → Stage 2
→ Stage 3 → Playoffs → champion → result correction → discipline
→ post-event → archive
```

完整 destructive lifecycle 只在独立 staging DB 执行，结束后 reset staging DB。它用于专项运营演练；2.0 RC 的稳定 gate 是 automated/local integration → RC production smoke → real registrations progressive validation。production 仅进行真实赛事所需 smoke，不承担模拟清理工作。

本轮覆盖 canonical Rivals/Major template、custom definition fail-closed publish gate、平台赛季目录身份与冻结引用、qualification 单一 owner、empty-draft 删除/撤回 guard 与队长交接事务语义；完整 staging lifecycle 仅作为专项演练，不构成 RC 上线门槛。

## Change-level validation

文档或小改动至少运行相关 checker；运行时、schema 或 workflow 改动应增加相应单测/本地集成验证。提交前检查 diff、未跟踪文件、敏感信息和生成产物；不要以 PR 文字或视觉 demo 代替实际验证。
