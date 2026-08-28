# RivalHub Major 2.0 Golden Major rehearsal

验收日期：2026-08-28（Asia/Shanghai）

## 实验边界

- 本次 Local release acceptance 的 runtime SHA：`55e91314e4cadbe3a51115d64933cc14f60a5e38`
- 该 SHA 包含本会话已复现并修复的 privacy 与 Local browser/prestart harness 问题；本文件只记录本次 integration gate，不复用 child PR 的通过结果
- 数据库：Supabase Local loopback；fresh reset 从 `0000` 到 `0012_dapper_devos` 完整执行，共 13 条 migration
- staging / production：没有 migration、write 或环境变更
- 可复现入口：`pnpm test:major-golden:local`
- fixture generator：`scripts/db/major-start-integration.ts`
- 固定 fixture label：`retry`；队伍、选手、正式参赛队、roster snapshot、seed 均使用 deterministic UUID 和固定字段

Golden runner 的 32 队 runtime rehearsal 使用 canonical ready fixture；报名、邀请、资料 readiness、队伍审核、2/3 NJU 边界和 active-claim 并发另由 `test:team-registration:local`、`test:major-prestart:local` 以及真实浏览器 fixture 覆盖。这样不会把直接 fixture 写入误报成 32 队浏览器报名。

## Fixture 与 Major preset

- 32 队、160 名选手；每队 5 名正式成员、5 名 primary starters、至少 3 名 NJU 成员
- 每名选手均有 verified email、display identity、Steam64、Perfect ID、QQ、approved education 和历史/上赛季/当前赛季竞技事实
- tournament seed 为 1–32；正式参赛队、最终名单 snapshot 和 seed 在开赛前已经明确固化
- Stage 1：普通比赛 BO1，3–0 / 3–1 / 3–2 决定晋级的比赛由 Swiss engine 使用 BO3
- Stage 2：普通比赛 BO1，3–0 / 3–1 / 3–2 决定晋级的比赛由 Swiss engine 使用 BO3
- Stage 3：全部 BO3
- Playoffs：QF BO3、SF BO3、启用 third-place BO3、Final BO5
- Major map pool：Ancient、Anubis、Cache、Dust II、Inferno、Mirage、Nuke；共享 pool 仍包含 Overpass
- roster 5–9；NJU roster >=3；NJU starters >=3

## Swiss final tables

`currentSeed / initialStageSeed / tournamentSeed / record / difficultyScore / status`

### Stage 1

| # | current | initial | tournament | team | record | difficulty | status |
|---:|---:|---:|---:|---|---|---:|---|
| 1 | 1 | 13 | 29 | Golden Team 29 | 3-0 | -3 | advanced |
| 2 | 2 | 4 | 20 | Golden Team 20 | 3-0 | -5 | advanced |
| 3 | 3 | 1 | 17 | Golden Team 17 | 3-1 | 3 | advanced |
| 4 | 4 | 6 | 22 | Golden Team 22 | 3-1 | 2 | advanced |
| 5 | 5 | 7 | 23 | Golden Team 23 | 3-1 | -4 | advanced |
| 6 | 6 | 15 | 31 | Golden Team 31 | 3-2 | 3 | advanced |
| 7 | 7 | 14 | 30 | Golden Team 30 | 3-2 | -2 | advanced |
| 8 | 8 | 10 | 26 | Golden Team 26 | 3-2 | -5 | advanced |
| 9 | 9 | 8 | 24 | Golden Team 24 | 2-3 | 7 | eliminated |
| 10 | 10 | 11 | 27 | Golden Team 27 | 2-3 | 2 | eliminated |
| 11 | 11 | 16 | 32 | Golden Team 32 | 2-3 | -7 | eliminated |
| 12 | 12 | 2 | 18 | Golden Team 18 | 1-3 | 4 | eliminated |
| 13 | 13 | 3 | 19 | Golden Team 19 | 1-3 | 0 | eliminated |
| 14 | 14 | 9 | 25 | Golden Team 25 | 1-3 | -1 | eliminated |
| 15 | 15 | 5 | 21 | Golden Team 21 | 0-3 | 3 | eliminated |
| 16 | 16 | 12 | 28 | Golden Team 28 | 0-3 | 3 | eliminated |

### Stage 2

| # | current | initial | tournament | team | record | difficulty | status |
|---:|---:|---:|---:|---|---|---:|---|
| 1 | 1 | 13 | 23 | Golden Team 23 | 3-0 | 5 | advanced |
| 2 | 2 | 6 | 14 | Golden Team 14 | 3-0 | -1 | advanced |
| 3 | 3 | 2 | 10 | Golden Team 10 | 3-1 | 4 | advanced |
| 4 | 4 | 15 | 30 | Golden Team 30 | 3-1 | 0 | advanced |
| 5 | 5 | 4 | 12 | Golden Team 12 | 3-1 | -2 | advanced |
| 6 | 6 | 11 | 17 | Golden Team 17 | 3-2 | 2 | advanced |
| 7 | 7 | 5 | 13 | Golden Team 13 | 3-2 | -2 | advanced |
| 8 | 8 | 7 | 15 | Golden Team 15 | 3-2 | -6 | advanced |
| 9 | 9 | 9 | 29 | Golden Team 29 | 2-3 | 3 | eliminated |
| 10 | 10 | 14 | 31 | Golden Team 31 | 2-3 | 1 | eliminated |
| 11 | 11 | 8 | 16 | Golden Team 16 | 2-3 | -2 | eliminated |
| 12 | 12 | 10 | 20 | Golden Team 20 | 1-3 | 1 | eliminated |
| 13 | 13 | 1 | 9 | Golden Team 9 | 1-3 | 0 | eliminated |
| 14 | 14 | 16 | 26 | Golden Team 26 | 1-3 | -5 | eliminated |
| 15 | 15 | 12 | 22 | Golden Team 22 | 0-3 | 4 | eliminated |
| 16 | 16 | 3 | 11 | Golden Team 11 | 0-3 | -2 | eliminated |

### Stage 3

| # | current | initial | tournament | team | record | difficulty | status |
|---:|---:|---:|---:|---|---|---:|---|
| 1 | 1 | 13 | 12 | Golden Team 12 | 3-0 | 5 | advanced |
| 2 | 2 | 6 | 6 | Golden Team 6 | 3-0 | -1 | advanced |
| 3 | 3 | 2 | 2 | Golden Team 2 | 3-1 | 4 | advanced |
| 4 | 4 | 15 | 13 | Golden Team 13 | 3-1 | 0 | advanced |
| 5 | 5 | 4 | 4 | Golden Team 4 | 3-1 | -2 | advanced |
| 6 | 6 | 11 | 10 | Golden Team 10 | 3-2 | 2 | advanced |
| 7 | 7 | 5 | 5 | Golden Team 5 | 3-2 | -2 | advanced |
| 8 | 8 | 7 | 7 | Golden Team 7 | 3-2 | -6 | advanced |
| 9 | 9 | 9 | 23 | Golden Team 23 | 2-3 | 3 | eliminated |
| 10 | 10 | 14 | 17 | Golden Team 17 | 2-3 | 1 | eliminated |
| 11 | 11 | 8 | 8 | Golden Team 8 | 2-3 | -2 | eliminated |
| 12 | 12 | 10 | 14 | Golden Team 14 | 1-3 | 1 | eliminated |
| 13 | 13 | 1 | 1 | Golden Team 1 | 1-3 | 0 | eliminated |
| 14 | 14 | 16 | 15 | Golden Team 15 | 1-3 | -5 | eliminated |
| 15 | 15 | 12 | 30 | Golden Team 30 | 0-3 | 4 | eliminated |
| 16 | 16 | 3 | 3 | Golden Team 3 | 0-3 | -2 | eliminated |

每个 stage 都实际生成 R1–R5；每个 stage 8 队晋级、8 队淘汰，三阶段合计 99 场 Swiss managed matches。stage handoff 只读取对应 StageRun 的 canonical entrants 和已完成 matches。

## Playoff bracket

| round | format | team A | score | team B | state |
|---|---|---|---:|---|---|
| quarterfinal | BO3 | Golden Team 12 | 2:1 | Golden Team 7 | finished |
| quarterfinal | BO3 | Golden Team 13 | 1:2 | Golden Team 4 | finished |
| quarterfinal | BO3 | Golden Team 6 | 2:1 | Golden Team 5 | finished |
| quarterfinal | BO3 | Golden Team 2 | 1:2 | Golden Team 10 | finished |
| semifinal | BO3 | Golden Team 12 | 2:1 | Golden Team 4 | finished |
| semifinal | BO3 | Golden Team 6 | 1:2 | Golden Team 10 | finished |
| third_place | BO3 | Golden Team 4 | 2:1 | Golden Team 6 | finished |
| final | BO5 | Golden Team 12 | 3:2 | Golden Team 10 | finished |

启用 third-place 时明确产生 3 / 4；没有把 honor 或赛后裁决混入 placement 计算。

## Final canonical facts

- final result：`confirmed`
- season：`archived`
- champion：Golden Team 12
- runner-up：Golden Team 10
- third：Golden Team 4
- fourth：Golden Team 6
- placement groups：5–8（Golden Team 2、5、7、13）；9–11（8、17、23）；12–14（1、14、15）；15–16（3、30）；17–19（16、29、31）；20–22（9、20、26）；23–24（11、22）；25–27（24、27、32）；28–30（18、19、25）；31–32（21、28）
- champion honor 显式 revoke 后保持 `revoked`；runner-up honor 保持 `valid`；没有自动冠军递补
- 重复 final confirm、honor grant/revoke、adjudication、archive 均命中幂等事实
- archive 后普通 match mutation 被拒绝；post-archive adjudication 和 honor revoke 保持允许

## 故障注入与配套回归

Golden runner 实际注入：并发 start retry、重复 stage transition、重复 result correction、同胜者比分更正、非法/缺失结果拒绝、并发 final confirm、重复 honor/adjudication/archive、archive 后普通 mutation 拒绝、archive 后专用 adjudication 允许、start 事务 trigger failure rollback。

相邻故障由独立 Local suites 实际覆盖：

- G1：无 roster、非法 5 人、非 frozen 成员、NJU starters 不足、external strength、discipline、重复 submit/confirm/start、并发 start、identity/education blocker
- G2：错误比分、forfeit canonical shape、无 downstream correction、已开始 downstream hard block、合法 invalidation/rebuild、重复 correction
- H1：personal sanction、capability scope、revoked/expired、teammate unaffected、registration 与 lineup/start 双边 enforcement
- H2：pending → confirmed、champion revoke/vacant、no auto-promotion、manual honor grant/revoke、private evidence、archive/idempotency/post-archive guards
- registration/prestart：邀请未 ready、readiness blocker、补齐后可确认、5 primary starters、2/3 NJU boundary、approved education revision 不改写 frozen snapshot、active-claim race

## Browser / privacy / responsive evidence

- 真实 Chromium 完成 PLAYER、CAPTAIN、ADMIN/REFEREE 的 Local fixture 流程：资料 readiness、Perfect ID/Name、教育、竞技档案、隐私确认、邀请、成员确认、5 primary starters、提交审核、admin approve、公开选手页。
- 独立的 32 队/160 选手 prestart browser fixture 在 32/32 正式队、1–32 seed 状态下完成 Admin 正式开赛；随后赛程页显示 Stage 1 8 场托管比赛和 authoritative lineup/preflight blockers。Swiss、playoff、correction、discipline、post-event、archive 的状态变迁由同一 SHA 的 Local PostgreSQL/Golden suites 完成，不把后端 fixture 结果冒充为手工 UI 点击。
- 390 / 768 / 1440 px 实测 `document.documentElement.scrollWidth === clientWidth`，settings、registration、admin registration、prestart、matches 页面无水平溢出；长身份字段、buttons、dialog/select 和 tables 未出现破版。浏览器 console error 为 0。
- 公开选手页 eval：`containsEmail=false`、`containsQQ=false`、`containsChsi=false`、`containsInternalEvidence=false`；公开身份只使用 display/Perfect/Steam/institution/approved verification/competitive facts。内部教育证据、纪律证据、投诉与 audit/security 细节仍在服务端/管理端边界内。
- operator checklist 是页面 reminder；refresh 后重置，不能绕过 authoritative preflight，也不会替代 server-side start/lineup gate。

## Commands / result

```text
pnpm db:local:reset                         pass (fresh loopback; 13 migrations)
pnpm db:local:verify                        pass (Auth, Storage, RLS/Data API deny)
pnpm db:check                               pass
pnpm exec tsx scripts/db/local.ts verify-migrations pass (13 active migrations)
pnpm exec supabase db lint --local          pass (no schema errors)
pnpm exec supabase db advisors --local --type security pass (no issues)
pnpm test                                   pass (112 files, 804 tests)
pnpm test:coverage                          pass (112 files, 804 tests; lines 42.43%, branches 73.64%, funcs 60.04%)
pnpm type-check                             pass
pnpm lint                                   pass
pnpm build (explicit Local status env)      pass (127.0.0.1, SSL off)
pnpm test:team-registration:local          pass
pnpm test:major-profile:local               pass
pnpm test:major-prestart:local              pass
pnpm test:major-start:local                 pass
pnpm test:major-swiss:local                 pass (same current major integration runner)
pnpm test:major-golden:local                pass (32 teams, 160 players)
pnpm test:major-roster-safety:local         pass (G1)
pnpm test:major-result-recovery:local       pass (G2)
pnpm test:discipline:local                  pass (H1)
pnpm test:postevent:local                   pass (H2 P1–P20)
git diff --check                           pass
```

## Security / recovery / scope result

- Local command wrappers scrub remote database/auth variables and require loopback for Local status, migrations, fixture writes and integration suites；`pnpm db:push` remains disabled。所有本次 destructive/reset 操作目标均为 `127.0.0.1:54322`，没有 staging/production write。
- schema、FK/unique/check/index、RLS deny-by-default、Data API exposure、public serializer 和 public identity fallback 均按最终 SHA 检查；未发现 debug route、test-only production endpoint、fixture auto-start、secret/token、Golden fixture production import 或 DAK 依赖。
- Golden 与 G1/G2/H1/H2 实际覆盖 duplicate/retry、wrong result、correction、started-downstream block、illegal roster、NJU/external/discipline blockers、forfeit、honor revoke/no auto-promotion、archive mutation block、post-archive adjudication，以及 transaction rollback。
- 本次验收产生的 fixes：`a4d9e46`（public identity 不再 email fallback）、`9a06b0a`（browser fixture 清理 user sessions）、`55e9131`（prestart browser fixture 明确写入 registration state）。没有新增产品功能、赛事规则或 DAK。

本文件不保存密码、token 或环境 secret；#239 保持 Draft，未 merge、未进入 staging/production migration 或 write 阶段。最终判定由本次 SHA 的 final diff/worktree/PR audit 一并给出。
