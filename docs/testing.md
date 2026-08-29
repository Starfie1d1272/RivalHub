# 测试与上线验收

## Verification evidence model

RivalHub 以最高已完成的验证层级描述能力证据：

```text
实现 → 自动化验证 → 完整环境演练 → 生产实战验证
```

| 体系 | 当前最高证据 | 范围 |
|---|---|---|
| Rivals · Spring | 生产实战验证 | 2026 NJU Rivals 完成个人报名、审核、队长投票、选秀、循环赛、双败淘汰、比赛管理、时间协商、BP/赛果、MVP、OCR 统计与赛季结束 |
| Major · Autumn | 自动化生命周期验证 | unit/integration、Local Supabase 和 browser fixture 覆盖队伍报名、资格、prestart、三段 Swiss、Playoffs、roster、recovery、discipline 与 post-event |

**2.0 RC 正式验证策略：**自动化与 Local Supabase 集成验证完成后，进行 RC production smoke；随后以真实报名逐步验证运营流程。完整 32 队 staging lifecycle 仍可作为专项演练，但不再是稳定 RC 的强制 gate。

## Repository checks

| 命令 | 用途 |
|---|---|
| `pnpm type-check` | Next route typegen + TypeScript |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest unit / integration suite |
| `pnpm test:e2e` | Playwright browser suite |
| `pnpm db:check` | Drizzle active migration chain |
| `pnpm build` | production build |

Local Supabase 集成入口：

```bash
pnpm test:team-registration:local
pnpm test:major-profile:local
pnpm test:major-browser:local
pnpm test:major-lifecycle:local
pnpm test:major-prestart:local
pnpm test:major-roster-safety:local
pnpm test:major-result-recovery:local
pnpm test:discipline:local
pnpm test:postevent:local
pnpm test:season-governance:local
```

这些命令经 `scripts/db/local.ts` 运行，目标为 Local Supabase。`test:major-golden:local`、`test:major-start:local` 与 `test:major-swiss:local` 是 `test:major-lifecycle:local` 的 aliases。

## Coverage intent

单元测试覆盖 capability、状态和 action input boundary，包括 persisted template identity、custom definition validator（executor registry 与 groupCount 晋级计算）、qualification batch/single parity 与竞技上下文冻结/解冻；本地集成测试覆盖 Major team registration、长期 participant profile、browser fixture、prestart、StageRun lifecycle、roster safety、result recovery、discipline、post-event，以及 season governance（空赛季删除/撤回 guard、竞技冻结生命周期、队长交接并发语义）。历史 Golden Major rehearsal 保存在 [`archive/rehearsals/`](./archive/rehearsals/)，不是当前策略的替代品。

## Test layers

```text
Vitest unit/integration
        ↓
Local Supabase integration
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
→ education verification → competitive profile → team application → logo
→ member invite / confirmation → designated starters → submit → review
→ return → edit → resubmit → approve → materialized team → prestart
→ entrants → final rosters → seeds → lock/start → Stage 1 → Stage 2
→ Stage 3 → Playoffs → champion → result correction → discipline
→ post-event → archive
```

完整 destructive lifecycle 只在独立 staging DB 执行，结束后 reset staging DB。它用于专项运营演练；2.0 RC 的稳定 gate 是 automated/local integration → RC production smoke → real registrations progressive validation。production 仅进行真实赛事所需 smoke，不承担模拟清理工作。

本轮覆盖 canonical Rivals/Major template、custom definition fail-closed publish gate、平台赛季目录身份与冻结引用、qualification 单一 owner、empty-draft 删除/撤回 guard 与队长交接事务语义；完整 staging lifecycle 仅作为专项演练，不构成 RC 上线门槛。

## Change-level validation

文档或小改动至少运行相关 checker；运行时、schema 或 workflow 改动应增加相应单测/本地集成验证。提交前检查 diff、未跟踪文件、敏感信息和生成产物；不要以 PR 文字或视觉 demo 代替实际验证。
