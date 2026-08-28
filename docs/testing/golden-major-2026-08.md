# RivalHub Major 2.0 Golden Major rehearsal

验收日期：2026-08-28（Asia/Shanghai）

## 实验边界

- frozen child baseline：`d393679ba931ebd048806fef13ec27192d871cf4`
- 验收代码候选 SHA（证据生成时）：`3e99c92c2884c093a44d8df993cdd023b616194a`
- 最终 pre-merge SHA：由最终门禁在合并前记录（最终汇报给出；避免在包含本文件的 commit 中制造自引用哈希）
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

- 真实 Chromium 浏览器完成 PLAYER、CAPTAIN、ADMIN/REFEREE 的 Local fixture 流程：资料 readiness、Perfect ID 与 Perfect Name 分离、教育 fast path、竞技档案 Radix Select、隐私确认、邀请、成员确认、5 primary starters、提交审核、admin approve、公开队伍/选手/统计页面
- 390 / 768 / 1440 px 实测 `documentWidth === bodyWidth`，无水平溢出；长身份字段和 blocker 文本未破坏布局
- anonymous team detail 不显示 QQ/email；同队授权页面按设计显示必要私有联系方式；公开选手页仅显示 display identity、Perfect/Steam identity、institution/verification state、competitive facts
- 公开页面修复了 team-registration 成员没有 season registration row 时被 inner join 丢失的问题；stats 页面不再查询不存在的 `match_player_stats.source` 列
- operator checklist 勾选是本地页面 reminder；refresh 后按设计重置，不能绕过 authoritative preflight，也不会阻止 server-side legitimate start

## Commands / result

```text
pnpm db:check                         pass
pnpm db:local:reset                   pass (13 migrations)
pnpm db:local:verify                  pass (Auth, Storage, RLS/Data API deny)
pnpm exec supabase db lint --local    pass
pnpm test:major-profile:local         pass
pnpm test:team-registration:local    pass
pnpm test:major-prestart:local       pass
pnpm test:major-roster-safety:local  pass
pnpm test:major-result-recovery:local pass
pnpm test:discipline:local            pass
pnpm test:postevent:local              pass (P1–P20)
pnpm test:major-golden:local          pass
pnpm test:e2e                          pass (2 tests: Chromium + mobile Chromium)
pnpm test:coverage                    pass (111 files, 800 tests; funcs 60%, branches 73.61%, lines 42.41%)
pnpm lint                              pass
pnpm type-check                        pass
pnpm build                             pass
git diff --check                       pass
```

最终工作树、feature SHA、GitHub CI/Vercel 和 merge 后 integration SHA 在 PR 合并收尾时补录；本文件不保存任何密码、token 或环境 secret。
