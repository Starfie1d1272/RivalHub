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
| Major 正式上线 | staging 全流程验收 | 在独立 staging DB 运行并清理完整运营链路 |

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
```

这些命令经 `scripts/db/local.ts` 运行，目标为 Local Supabase。`test:major-golden:local`、`test:major-start:local` 与 `test:major-swiss:local` 是 `test:major-lifecycle:local` 的 aliases。

## Coverage intent

单元测试覆盖 capability、状态和 action input boundary；本地集成测试覆盖 Major team registration、长期 participant profile、browser fixture、prestart、StageRun lifecycle、roster safety、result recovery、discipline 与 post-event。历史 Golden Major rehearsal 保存在 [`archive/rehearsals/`](./archive/rehearsals/)，不是当前策略的替代品。

## Test layers

```text
Vitest unit/integration
        ↓
Local Supabase integration
        ↓
Playwright browser E2E
        ↓
staging full-lifecycle acceptance
        ↓
production smoke / real-world operation
```

每一层回答不同问题：Vitest 验证 pure rules 与 action boundary；Local Supabase 验证真实 Postgres/Auth/Storage 合作；Playwright 验证浏览器任务；staging 验证独立环境中的完整运营；production 只承载真实赛事所需 smoke 与实战事实。

## 2.0 staging lifecycle gate

正式上线前，在独立 staging DB 完成一次完整 lifecycle：

```text
管理员创建 Major → 发布 → 用户注册 → 邮箱确认 → participant profile
→ education verification → competitive profile → team application → logo
→ member invite / confirmation → designated starters → submit → review
→ return → edit → resubmit → approve → materialized team → prestart
→ entrants → final rosters → seeds → lock/start → Stage 1 → Stage 2
→ Stage 3 → Playoffs → champion → result correction → discipline
→ post-event → archive
```

完整 destructive lifecycle 只在独立 staging DB 执行，结束后 reset staging DB。production 仅进行真实赛事所需 smoke，不承担模拟清理工作。

Captain transfer 是 accepted convergence work。当前代码尚未形成完整可验收链路前，不应把它标记为测试已通过的 gate。

## Change-level validation

文档或小改动至少运行相关 checker；运行时、schema 或 workflow 改动应增加相应单测/本地集成验证。提交前检查 diff、未跟踪文件、敏感信息和生成产物；不要以 PR 文字或视觉 demo 代替实际验证。
