# Demo 存量目标读取故障证据

限定范围：[#912 第 3 项](https://github.com/Starfie1d1272/RivalHub/issues/912#issuecomment-6112761515)。原版为 `e9f3e11297aa755a9cf2b91f6044eefc6b4c1e95`，保留 #913/#914 已合入的安全 cause 投影和提交后恢复语义。此文件是本地实施证据，不是独立验收或生产验收。

## 真实 owner 与恢复入口

`AdminMatchWorkbench → DemoDataReviewPanel → recheckStoredDemoImport / recheckSeasonStoredDemoImports → revalidateStoredDemoImportInTx / revalidateCandidateRows → loadCanonicalTarget → loadEffectiveMatchRoster`。身份确认先写 gameplay alias 与审计，再调用同一存量重检；晋级共用 `promoteDemoImportInTx`，包含 lineage、source rounds、scoreboard 与统计投影。批量每个候选独立事务。已确认的当前 import 不进入待处理候选；不自动重放上传或身份确认。

目标读取只对 owner 明确得出的“比赛/地图不存在、关联不匹配或缺少赛事关联”抛出专用业务失效类型，兼容原有 NOT_FOUND/VALIDATION_FAILED transport code。名单读取及其他依赖抛出的同码 AppError 不属于该类型。数据库、编码或其他系统异常原样抛向事务与既有安全 observability boundary。

重检失败先刷新核对保存状态。可重试 PG 分类（例如 57014/40001）可以稍后使用单图“按当前资料重新检查”或赛事全部待处理重检；非 retryable 系统原因先联系管理员，恢复后使用同一入口。没有自动 retry。提交完成后的缓存失效失败只要求刷新核对结果，不重传 Demo 或重复确认身份。批量或确认后的关联重检失败保留已成功部分、提供同一个服务端排查编号，重检只处理当前待处理数据。上传 HTTP wire、Evidence schema 和版本未改。

## 原版反证

使用 `RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm test:integration -- tests/integration/db/demo-integration-submit.test.ts`，canonical wrapper 从 template1 创建隔离 baseline，回放 active migrations，再克隆独立 worker DB；没有访问远程数据库。

| 隔离故障 | 原版实际结果 |
| --- | --- |
| 目标比赛读取的真实 `SELECT 1 / 0` | 原始 SQLSTATE 22012 被 catch 后的问题列表写入覆盖，事务中止后调用方得到 25P02。新增首因断言失败。这不证明 SQL 错误导致坏投影落库。 |
| 同一 driver 读取返回普通 TypeError，PG 事务仍健康 | 原版不抛失败；实际提交的 issues 从 PARTICIPANT_IDENTITY_UNRESOLVED / ROSTER_PARTICIPANT_MISSING 改成 STORED_TARGET_INVALID。新增持久化 issues 比对失败。这是隔离系统异常下的错误归因持久化证据。 |

故障只在测试内替换 driver 的指定查询；SQLSTATE 来自真实 PG。普通 TypeError 只用于区分健康事务与 aborted 事务；不是生产 coding 故障发生过的证据。

## 修后行为证据

同一 PostgreSQL 文件调用真实 owner，验证普通异常、真实除零 22012、真实 statement timeout 57014，以及身份 alias/审计写入后第三次目标读取失败。失败前后逐项读取并比较 import（含 payload/hash/状态/issues/lineage）、round facts、scoreboard、全部统计投影、gameplay identities、audit、比赛与地图；这些事实均未变化，之前已确认的投影也保留。原首因经 `actionError` 映射到只含安全分类的 event，与失败响应 requestId 一致；无 SQL、payload、token 或原 PG detail。

真实批量 owner 的 pooled Client 目标地图读取注入 PG 故障：结果为 failed=1、remaining=0，没有业务成功 affectedMatchIds；event 保留 22012 与返回的 requestId，已成功事实不变。移除故障后批量重检返回 remaining=1、failed=0，真实管理员 review reader 仍显示 confirmable；原身份确认 owner 随后真实确认并更新 round facts/统计投影。显式空目标查询仍返回 STORED_TARGET_INVALID，探针事务独立回滚。

最低充分 host evidence：target owner 的三类预期失效与同码依赖异常；真实 Action 的失败 cause/requestId/安全投影及提交后缓存失败恢复；批量成功/失败摘要与同编号；#913 HTTP cause 和上传 wire 回归；现有管理员 read model 回归。

`DemoDataReviewPanel.test.tsx` 通过 awaited userEvent 验证：失败展示排查编号，控件恢复可点击；再点同一按钮只发送相同 importId，成功后刷新，没有身份确认或拒绝。批量部分成功显示编号、保留已确认部分的说明，原批量按钮仍可再次操作。该证据运行真实 React 组件及控件，Action response 为测试替身；它不是完整浏览器/RSC/生产用户恢复验收。

本地验证：domain 23 项、Action/HTTP 13 项、React 17 项、真实 PG 文件 2 项（包含上述故障探针）；app/tests 类型检查、变更文件 ESLint、architecture contract。Ready PR 的 exact-head required CI 以 GitHub 记录为准，独立复审仍交父会话。无发布、生产写入、Windows 操作或凭据收集上传。
