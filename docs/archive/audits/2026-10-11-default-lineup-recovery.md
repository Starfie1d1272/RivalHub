# #912 默认首发补齐限定证据

范围为 issuecomment-6112761515 第 4 项。基线 `403e5882`。这是开发者本地复现与回归记录，独立复审、生产日志 sink 与真实管理员运营尚未验收；不涉及 #911、发布、生产写入或 Windows。

## 原版反证

在 canonical `pnpm test:integration` 创建的隔离、已回放 migration 的 worker DB 中，使用 `seedFixture` 准备合法 frozen EventRoster，再创建 scheduled、T−2h 内、尚无 MatchRoster 的比赛。安装仅匹配该比赛 `match.roster.system_default` audit 的 BEFORE INSERT trigger，抛出 SQLSTATE `23514`。直接调用真实 `materializeDefaultLineupsInTx`，通过 `extractPgError` 确认实际错误为 `23514`；再调用原版 `runSchedulerJobManually({ jobKey: "match-time-auto-award" })`。

19:36 UTC 原版探针 1/1 通过，断言的是缺陷：人工任务返回 `success:true` / `businessTransitions:0`，`lastManualSucceededAt` 被推进；该场无名单，比赛 facts 不变，未出现 `match.default_lineup.failure` 或 `scheduler.job.failure`。因此证明的是诊断与健康失败丢失，未声称 PG 污染落库。原版四个 runtime 文件从 `git show 403e5882:<path>` 读取；探针后恢复修复代码并移出临时探针。

## 修后 owner 链

`runSchedulerJobManually`（仅 session stub）→ `executeScheduledJobManually` → `runSchedulerJobByKey` → `runMatchTimeAutoAwardCron` → match/event-roster 锁 → `materializeDefaultLineupsInTx` → `persistMatchRosterInTx` → canonical eligibility preflight → roster/audit 同事务。

`tests/integration/db/default-lineup-recovery.test.ts` 验证：合法未 frozen 名单及只有四名 declared primary 的名单安静等待、任务成功且不造首发；真实 audit INSERT 的 PG23514 回滚 roster 与 audit，保留比赛事实；原错误经 canonical logger 只投影 SQLSTATE，item log 与人工响应排查编号一致，health 保存失败代码且不推进人工成功时间。移除故障后同一管理员入口补齐双方各五人，触发比赛页面 revalidation，真实 `loadAdminMatchWorkbench` 从缺少名单变为十名可见首发。再通过 `confirmMatchRosterInTx` 确认，连续两次人工任务报告零推进，confirmed roster/player rows 与 system-default audit 数不变。

这证明目标页真实数据库 read owner 与恢复按钮组合链；没有把 jsdom 冒充浏览器、生产 cache 或生产运营证据。`tests/unit/SchedulerHealthPanel.test.tsx` 另验证面板失败后刷新健康、退出确认态并可再次确认运行，成功提示与恢复动作可达。

## 本地验证

- 真实 PostgreSQL：新恢复文件 3/3；`major-roster-safety.test.ts` 1/1（内含 canonical roster/qualification/确认/冻结不变量）；`match-time-scheduling.test.ts` 9/9（锁等待、重复授予、权限与排期）。
- 定向 unit/component：worker 4、runner 9、manual action 4、scheduler execution 6、cron route 2、panel interaction 1，共 26 项。
- `pnpm type-check:app`、`pnpm type-check:tests`、changed-file ESLint、`pnpm architecture:check` 与 diff whitespace 检查。

真实 PG 命令：

```bash
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 RIVALHUB_INTEGRATION_WORKERS=1 pnpm test:integration -- tests/integration/db/default-lineup-recovery.test.ts tests/integration/db/major-roster-safety.test.ts tests/integration/db/match-time-scheduling.test.ts
```

合法资格拒绝只沿 owner 的 `VALIDATION_FAILED` 分类；`INTERNAL_ERROR`、PG 与其他异常仍是系统失败。后台未更改 qualification snapshot、成员、首发选择规则、确认事实、赛果或既有时间授予规则。每个失败项保留安全事件；public cron 摘要移除异常数组和内部关联字段。部分成功先刷新目标页，再报告批次失败，不在当前调用中自动重放失败事务。


## 独立复审 P2：提交后提议查询失败

父线程在 `9cbe81fd` 指出首发事务提交后，提议候选 SELECT 失败会丢失已提交比赛的失效目标；重复运行跳过已有名单，不能补回第一次失效。修后内部 `CommittedDefaultLineupsError` 携带原 cause、关联编号与已提交目标，runner 先失效这些目标再报告原故障；人工提示明确首发已保存、先核对首发及排期。

新增真实 PG 回归在最后一队补齐 audit INSERT 时，将隔离 worker DB 的提议表重命名；首发事务真实提交后，紧接着的实际候选 SELECT 抛42P01。失败调用已经触发目标页面失效，名单和audit保持已提交；action日志保存42P01、同一响应编号及 `phase=proposal_read_after_lineups`，不输出SQL或表名。随后通过真实owner确认首发，恢复提议表，再成功运行任务；该次零推进、没有再触发该比赛失效，confirmed roster/player rows、首发audit和比赛facts不变，真实工作台读取双方五名首发。这条证据同时证明失效必须发生在第一次失败调用，而不是靠后续成功重跑补救。
