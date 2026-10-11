# 全仓错误流覆盖与第一批证据（2026-10-11）

长期执行归口：#912，Refs #571/#572。

Baseline：`296e35db38473c9729b5bf7cb1c31beb8680f0d9`。`inventory.json` 枚举 src/scripts 的 catch 候选与 Action/HTTP entrypoint；batch 1 的 DAK owner 已反映在 inventory 中。枚举不是逐 catch 行为验收。矩阵将已检查 owner、现有保护、发现缺陷与仍待实证分开；没有生产 fault injection、日志关闭、全局动态化、删除、凭据变更或 Windows 操作。

## 覆盖计划与验收语义

每条链核对六项：原始 cause 是否保留到 canonical owner；脱敏是否去除 credential/SQL/body/PII；request/trace 是否关联；UI/HTTP 是否提供安全短原因；是否有实际恢复入口；失败是否保留正确事实并由行为回归保护。先查安全/结果不确定/权限与持久化，再查后台恢复/外部服务，最后处理次要展示与噪声。已合并 #900/#905/#907/#908 的工作不重做；LIVE 缓存/重复连接的 src 读链由另一个线程负责，本线只记录边界，不编辑该范围。

状态：**已检查**仅表示所列源码链已阅读；**现有测试**指文件中的保护，未表示本轮已运行；**本轮回归**有实际执行证据；**待验证**不能按源码猜测生产发生率/影响。#571 的真实 baseline/双 sink/告警与 #572 的 provider 当前 retention 仍开放；#903/#904 的产品删除和恢复撤销边界不纳入隐式修复。

## 错误流覆盖矩阵

| 链/原始 cause owner | 原因保留与脱敏 | request 关联/用户短原因 | 实际处理入口与状态边界 | 行为证据/剩余缺口 |
| --- | --- | --- | --- | --- |
| DAK HTTP：`src/app/api/integrations/dak/**/route.ts` → `demo-integration/http.ts` | baseline 五入口吞异常；batch 1 由唯一 `dak.request.failure` capture 原 cause，PG 只留分类；不 log 请求体/配对 token | 固定 route、operation、phase 与请求 header ID；500 的既有 code/message shape 增加编号，header 同编号 | 客户端按现有 message 显示；导入后失效失败提示已收到提交，先查看保存结果与导入状态，不诱导重试或重传；不自动 replay | 本轮 HTTP/脱敏/提交后失败/4xx/成功兼容回归；实际 DAK UI 与 production sink 未测 |
| Mizar HTTP：`mizar/http.ts`，operation route | `withMizarRequest` capture 原因；body bytes/time bound；Zod/body 的 expected outcome 无 raw payload | auth/read/validate/domain/revalidation + requestId；短原因与 header | 更新 Mizar/刷新资料；revalidation 提示数据可能保存；source/authority owner 仍独立 | 现有 `mizar-http`/机器协议、PG fencing 回归；LIVE read/cache deferred |
| 系统版本：`api/system/release/route.ts` | 配置失败返回安全 503；无 raw config 回显 | no-store，caller 以 semantic identity 判断 | canonical release/read-back gate fail closed，不自动发布 | 现有 release identity/runtime config tests；非用户错误恢复页 |
| Server Action：`action-utils.ts`，actions 全文件见 inventory | unexpected capture；INTERNAL AppError 安全化；expected message/presentation | action.operation、phase、requestId；提示先刷新确认结果 | 各既有 action/UI；禁止按 INTERNAL 盲重放写入 | action/permission tests；INTERNAL 强制 application 会掩盖底层 dependency，逐 owner 复核 |
| Next RSC/render：`instrumentation.ts`、stats/match error pages | shared safe exception，digest严格十进制；页面不显示 raw message | digest+时间/route → requestId/trace；#907 已合 | 页面 reset/重新加载，先核对已提交结果 | #907 tests/本地截图已归档；自然客户端 → production event 未验收 |
| Next session/prerender：`auth/session.ts` | #908 在解封前建立 request boundary | Session clock 仍实时；prerender abort不能当500 | 已合未发布；不缓存会话到期、不 force-dynamic | #908 real installed-Next/iron crypto与构建证据；上线自然流量仍待核对 |
| DB：`db/client-runtime.ts`、`db/errors.ts` | cause链识别 SQLSTATE，query/params/detail不输出；pool rebuild owner | db事件与trace关联；outcome_unknown 禁止自动重放 | 仅明确连接前失败重试一次；不确定结果刷新/audit核对 | 现有 DB runtime/retry/PG tests；DB/action/scheduler多层事件不是唯一incident数 |
| Cron九 jobs：`api/cron/**` → `scheduler/execution.ts` | scheduler capture原 cause；health仅稳定失败分类；health写失败单独记录 | shared route context；手动执行经 action；health admin显示 | `/admin/settings` scheduler owner，watchdog与人工break-glass；fresh no-op保持安静 | scheduler execution/health tests；真实 cadence/freshness #571，不能用日志量替代 |
| 统计投影后台：`stats/projection-backfill.ts:reconcileMissingStatisticsProjections` → scheduler runner | 两处 catch仅 failed++；runner新建计数 Error，原 cause丢失 | 最终scheduler事件可关联，原因无法复原 | 已提交 rebuilt/invalid先失效再报失败；cursor wrap重试，页面不偷修源数据 | **已确认源码缺口**；现有 stats projection PG tests保护事务/游标，补错误保留回归待下一批 |
| MVP结算后台：`matches/mvp.ts` → scheduler runner | 每项 failure capture；failures汇总 AggregateError（canonical sanitizer不遍历errors） | item事件/request关联；最终scheduler失败摘要 | committed成功先刷新，失败仍due；禁止全批重放已结算事实 | 现有MVP PG/runner tests；多层event须按请求归并，不压掉真实失败 |
| 预测/BET后台：`predictions/reconciliation.ts` | 每个program原error capture；最终计数exception告失败 | sharedscheduler请求；business health不因局部成功变绿 | 成功事务保留，失败program可重试；账本不手工补写 | 现有真实PG reconciliation/幂等tests；原始错误在item事件，不把summary当唯一原因 |
| 赛前默认阵容：`matches/time-auto-award.ts` | 所有materialization异常落入空catch；无法区分合法blocked与DB/invariant失败 | 最终cron可成功；UI可能仍是start blocker | 管理员阵容owner处理；已有合法block不能改为强制生成 | **已确认源码缺口**，用户影响/真实异常尚待故障回归；下一批只分开expected/unexpected |
| Demo单份重检：`demo-integration/revalidation.ts` | `loadCanonicalTarget`全catch转STORED_TARGET_INVALID，可能吞DB/coding error并改写归因 | 管理UI见业务issue而非原始故障；actionError无法看到被转换原因 | 重检/拒绝/修身份；PG错误通常abort事务，不能宣称已证明污染成功落库 | **已确认宽catch归因缺口**；现有demo-submit PG覆盖锁/晋级；须补故障后原facts不变回归 |
| Demo批量/身份fanout：同文件 `revalidateCandidateRows`，`actions/demo-integration.ts` | per-item和fanout setup只留failed计数，原error丢失 | UI显示部分失败（现有DTO）；无逐项编号 | 单份重检入口继续可用；身份确认已提交不应变为失败 | **已确认诊断缺口**；existing actions test保护身份确认成功；补cause+failed恢复链待下一批 |
| Demo质量读取：`admin/matches/demo-quality.ts` | invariant capture原cause；Admin boundedquality DTO，不展示rawpayload | failureId与事件同编号；短说明无法读取 | 管理员核对这份Demo；不从QA数量猜详情 | 现有admin-demo质量/DTOtests；诊断自由文本只服务端 |
| OCR：`ocr/siliconflow.ts`、`ocr/diagnostics.ts`、`actions/player-stats.ts` | config/auth/quota/rate/network/timeout/payload/image分类；bounded code/message/cause与确切凭据/图片去除 | 同requestId跨格式降级；固定UI提示不回传diagnostic自由文本 | `/admin/settings#ocr-configuration` → Vercel变量绑定/SiliconFlow控制台；人工记分板fallback | 现有ocr-provider/diagnostics/组件tests；已配置不等于凭据/额度有效，真实provider自然失败未验收 |
| Steam：`lib/steam.ts` → `steam-profiles.ts` | HTTP保留status；network catch丢原error并新建通用error；意外cache-fill catch返回cached | dependencyevent可查但无法判DNS/reset/timeout；action可提示稍后重试 | Steam64核对/官方profile入口；provider配置由原owner；缓存fallback非成功拉取 | **已确认原因丢失**，现有steam.test刻意断言通用error；需安全diagnostic投影再修，不能直接回显凭据 |
| Supabase教育Storage：`education/storage.ts` → commands/actions | adapter void error，只有dependency摘要；INTERNAL wrapper再经action变application；bucket未allowlist | action编号但provider状态/原因丢；上传补偿失败有另事件 | 私有上传/签名入口；清理scheduler唯一owner；#905到期访问已合 | storage/教育PG/cleanup现有tests；只投影安全status/code待下一批，不输出object key/file/rawbody |
| Supabase公开图片：`season-public-info/storage.ts` → actions | 同样void error；best-effort旧图删除可能无cause | action编号；失败归因混application/dependency | 赛事Logo/群二维码重新上传入口；DB失败删除新object，不能自动删历史 | **已确认诊断缺口**；不改retention；补偿失败需安全事件与可行动处理 |
| SupabaseAuth登录/邮件：`actions/auth.ts`、auth providers | provider-returnederror按code转固定产品提示；throw走action | expected错误不告警；邮件发送固定code可诊断 | 验证邮箱/重发/密码重置入口；避免账号存在枚举 | auth/reverification/session现有tests；检查5xx是否被无差别转expected（待故障证据） |
| 密码变更：`auth/password-mutation.ts` → account/recovery actions | thrown provider、5xx/unknown/4xx都新建INTERNAL AppError丢cause | action安全通用提示掩盖“未知结果登录暂停”与“旧会话已退出”差别 | registry deny fence先提交；未知保留fence，需管理员核对provider后原owner恢复；不盲解除 | **已确认恢复提示/原因缺口**；现有password-mutation/sessionPG保护fence；新安全presentation与cause投影待下一批 |
| 权限：session/admin-access/guards/actions | expected UNAUTHORIZED/FORBIDDEN与unexpected区分；DTO另授权 | expected短提示，无raw grants/session | 登录/当前赛事管理员入口；不能借错误恢复扩大权限 | 现有session/auth guards、DB access matrix；#904 snapshot撤销恢复未定义，本线不实现权限扩张 |
| 赛事生命周期：major-prestart/matches/results/corrections/postevent等actions | 事务/锁domain owner → actionError；部分pure projection catch转validation | 业务blocked短原因；unexpected requestId | 既有赛前工作台/开赛/轮次确认/更正plan/apply/adjudication入口 | 现有Major/结果更正PG/concurrencytests；逐pure throw是否为输入规则需核对，不能全文rawmessage当安全契约 |
| 客户端刷新：PredictionBoard/OnlineCounter等 | transport catch有空fallback；server action未必缺capture | 有的保留旧count/board无stale标记；用户难判断当前状态 | 刷新页面/现有action UI；不能默认显示0或清除合法draft | **待行为验证**：断网/迟到response/stale state；无需修改另一线程LIVE consumer |
| 观测sink本身：logger/tracing/flush/config/span-sanitizer | sink失败best-effort不影响核心结果；allowlist、boundcause、getter-safeexception；safeContext另检查 | release/deployment/environment与trace | Vercel/Better Stack；stdout/OTLP不要重复相加；retention/readback待provider证据 | existing安全/flushtests；safeContext getter、AggregateError细节是否丢失待故障验证；不新增日志DB |
| CLI/备份/发布：scripts/db/recovery、scripts/release，inventory | canonical protected wrappers/低敏摘要；不导出secret/dump | exactsource/release identity与StepSummary | offline restore/reconcile原owner，retention建议由#903，撤销边界#904 | 本轮仅源码inventory；未执行remote/recovery/deploy；不以本地分析代替provider验收 |

## 第一批复现与验证

新增 HTTP 回归的独立价值：保护已经提交而送达失败时的恢复提示、原 cause关联与原始SQL/凭据不跨边界，并验证预期拒绝不被新增告警吞并。事务/幂等本身继续由已有真实PostgreSQL suites拥有，此批不修改事务、权限、schema或账本。

在 baseline owner上运行 `tests/unit/api/dak-error-recovery.test.ts`：7 tests中3 failed、4 passed。失败分别是 X-Request-Id为空、postcommit提示仍为通用重试、SQLSTATE事件不存在。工作改动恢复后，相同回归及既有HTTP/事件协议/统计失效回归共19 passed。使用实际canonical logger/redactor，只有provider/业务调用与Next after由synthetic harness隔离；不宣称取得真实production日志或desktop UI截图。

app/tests类型检查、修改文件ESLint、architecture:check和diff check通过；冻结安装未改manifest或lockfile。独立审查与远端required CI在PR接收，不由自审冒称完成。

可重现命令：

```bash
source /workspace/.onboarding/activate.sh # 云环境存在时
pnpm install --frozen-lockfile
pnpm exec vitest run tests/unit/lib/demo-integration-http.test.ts tests/unit/api/dak-error-recovery.test.ts tests/unit/api/demo-integration-events-route.test.ts tests/unit/api/public-statistics-invalidation.test.ts
pnpm type-check:app
pnpm type-check:tests
pnpm architecture:check
```

新增源代码范围仅DAK HTTP五入口与canonical adapter；未编辑src live读链。500仍失败，保留published `error.code/message` shape而不增加JSON字段，编号在message与header；成功body不变。`withRouteObservability`复用请求trace与after flush，关闭此wrapper的通用500 response event以避免同一handled错误重复capture，不关闭其他日志。expected4xx仍无exceptionevent。

## 后续批次与决策边界

1. 后台统计/阵容/Demo重检：先证明原错误可保留、partial commit仍刷新、unexpected不伪装业务issue；涉及查询/事务必须真实PG回归。
2. 密码与provider：安全的cause/status/code投影、正确错误归因、未知结果fence的用户说明和实际管理员核对入口；不能用盲重试或解除fence解决。
3. 客户端状态/噪声：故障响应与恢复操作行为验证，明确stale/current，不自动重放赛事/财务写操作。
4. #571自然production关联、双sink、告警/资源与#572 provider retention属于外部证据；本地/CI不能替代。没有read/query入口时记录缺失，不获取ingestsecret或扩大权限。

保留/删除建议仅归#903；没有已授权期限的pending教育材料、feedback正文、raw Demo/receipt不执行purge。#904由recovery/auth/Mizar原owner定义撤销对账，本线不猜测旧snapshot后的事实。矩阵为首轮覆盖地图与可验证缺陷，不声称全仓所有error path已通过测试。
