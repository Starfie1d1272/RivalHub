# W12/W13 实现与隔离验证记录

基线 `4ebecf5d5e1b629371c7d0c8851b6bab9c31d7f8`，保留 #1081。此目录只含自行生成的合成 fixture 证据，不含用户附件原始遥测、真实身份、图片或凭据。实现未部署，不能将以下数字解释为线上 LCP、连接池容量或业务长尾改善。

## 可重复的前后读取

Loopback PostgreSQL 隔离数据库，1000 条合成 player LFT、两平台；10 轮交错先后顺序，共 40 次读。Next cache directives 在测试中为 no-op，双方均按冷目录读取；这不是框架缓存命中实验。计数来自真实 Pool.query，不含事务连接上的语句；这里的被测 reader 不持有事务。`rows` 是所有 SQL 结果行的和，count SQL 的一行结果不表示只扫描一行。

| 场景 | 基线 → 候选 SQL | SQL 返回行 | 卡片数 / JSON bytes | 读取耗时中位数，N=10/侧 |
| --- | --- | --- | --- | --- |
| 设置 readiness 两平台 | 15 → 7 | 46 → 40 | 不适用 | 17.53 → 7.19 ms |
| 招募 players 当前页 | 9 → 10 | 1035 → 59 | 1000 / 762275 → 24 / 18289 | 54.99 → 26.93 ms |

招募多一次 SQL 用于完整筛选后的双页签计数；另一视图不加载卡片与用户富化。不能由这些本机小样本推导真实网络下的提速比例。池等待、transaction hold、browser ready、LCP、CLS 未测，原始 JSON 明确保存 null。

复现只使用已有 Local Supabase / loopback PG，遵循仓库 wrapper 的 worktree 串行锁：

```bash
source /workspace/.onboarding/activate.sh # 若存在
mkdir -p .agent-tmp
git show 4ebecf5d:src/lib/recruitment/data.ts > tests/integration/db/w12-baseline-recruitment.ts
git show 4ebecf5d:src/lib/qualification/service.ts > tests/integration/db/w12-baseline-qualification.ts
cp docs/archive/performance-w12-w13-2026-10-25/reproduce.fixture.txt tests/integration/db/w12-performance.tmp.test.ts
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm test:integration -- tests/integration/db/w12-performance.tmp.test.ts
rm tests/integration/db/w12-performance.tmp.test.ts tests/integration/db/w12-baseline-recruitment.ts tests/integration/db/w12-baseline-qualification.ts
```

`reproduce.fixture.txt` 是临时实验的可审查源码，不属于常驻 suite；结果写入 `.agent-tmp/w12-before-after-pg.json`。基线 loader 从精确 git 提交恢复，未复制一套长期业务 evaluator。

## 任务状态

“待具体实验”允许已实现子项继续交付，不能据此关闭整个任务。静态检查不替代 PG、provider 或浏览器证据。

| 任务 | 状态 | 已实现/保持 | 尚缺证据、下一动作和 owner |
| --- | --- | --- | --- |
| AS-00 | 待具体实验 | 固定 auth clock/canonical/session、password begin/provider/finalize、OCR players 阶段；OCR requestId 顶层兼容 | W01 #1082 合并后接真实 ready consumer；集成人验证同导航 token 与 receiver-first |
| AS-01 | 待具体实验 | 设置/readiness 复用公开目录 owner；仅公开冷读允许三表独立并行；freeze/写仍 caller executor 顺序读取 | W12/W01 量 production build 下冷/暖真实 cache hit 和主表单 ready/LCP；本机 no-op cache 不能证明命中 |
| AS-02 | 已实现已测 | 单次 raw bundle + platform/fallback 纯投影，兼容旧 loader；私有事实不跨请求缓存 | PG 检查同 executor、4 次 raw 查询、投影零查询、primary/fallback/unranked；资格冻结/修正 suite 通过 |
| AS-03 | 待具体实验 | next-match request memo、只富化每 entry 首场；My 复用当前队伍 owner | W12 真实 RSC 同请求 memo/队长成员/多历史 cohort；长期历史分页须先有 payload/人口证据，未无证据重写 |
| AS-04 | 待具体实验 | 候选/当前名单并读，claims/roles/facts 按依赖共同开始，旧批准名单提前；准入与 revision 不变 | W12/总体验证者跑 team/solo/Major 注册窗口真实浏览器；PG 资格与冻结链已回归 |
| AS-05 | 已实现已测 | 当前视图有界卡片；完整 SQL filter 后计数与分页；页数收缩纠正；仅当前页富化 | PG 覆盖 q/event/position/size/map、邀请/过期及 1000 intents；浏览器 ready 与生产资源收益另验 |
| AS-06 | 已实现已测 | 原始 canonical candidate ID 去重；冲突拒绝、锁后归属、revoked subject/fresh-auth fence 保留 | 真实独立 PG 连接的身份撤销/登录 12 项回归通过；不据此承诺解决 13s provider 尾延迟 |
| AS-07 | 待具体实验 | Login/Forgot/Reset/Change transport 受控恢复；密码 unknown 禁重提，成功导航保留 | 组件与 password PostgreSQL；真实 Local Supabase/browser 由总体验证者执行；静态 reset 页慢样本尚无资源归因 |
| AS-08 | 待具体实验 | 邮件 unknown 不取消 pending；明确 4xx 与 5xx/408/transport 分离；identity UI 禁立即重发 | W12 需要 provider adapter 的持久 unknown/cooldown/双击并发证据；原申请入口仍可显式重建旧 pending，不宣称 durable receipt 已完成 |
| AS-09 | 已实现已测 | 统一 7 MiB 原图预算，编码后保留 >680 KiB envelope；服务端 canonical base64/signature 复核 | 6/7/7.5/8/10 MiB、伪装/截断单测通过；没有提高全局 body limit；实际反代边界与慢上行由总体验证者测 |
| AS-10 | 已实现已测 | OCR 窄 map/match join，先 fresh admin，再 players/provider 并行；typed 回读不伪空 | app types/architecture/组件；付费模型未调用，生产 provider 时间与字段精度尚不宣称 |
| AS-11 | 待具体实验 | fallback 共用原 180s monotonic deadline；真实 decoded imageBytes；既有关 thinking/tuple/body timeout 不重复计功 | W12/资料 owner 提供至少20张脱敏代表截图，做字段精度/完整率/时延/费用实验；缺图片且没有新增付费调用 |
| AS-12 | 待具体实验 | typed read、finally、unknown 保留草稿禁重写、已知 commit 与 refresh 分离；显式重试失效不重放 mutation；initialRows undefined/[] 不同 | W03 分配 actor/map/operationId/digest/version receipt 的 active migration；W12 后续 lost COMMIT ack/双管理员版本冲突 PG。当前 read 只加载最新状态，不能证明某次未知写属于本操作 |
| AS-13 | 待具体实验 | 删除 action 两处重复完整 assert；保留 persist 锁后完整校验；postcommit 返回 refreshPending | PG 名单/资格通过；W04/集成人让 MatchRosterForm 消费 refreshPending 与 transport unknown，receipt/版本核对仍待 W03 合同 |
| AS-14 | 待具体实验 | 教育页用户窄字段；资料/安全/竞技主表单与辅助 readiness/列表/roles/maps 分 leaf | W12/总体验证者 production build 的实际 form-ready 与 shift source；没有用占位高度宣称 CLS 达标 |
| AS-15 | 待具体实验 | postmatch match/season 一次窄 join；commit 与失效结果分离；录像未知 move 不重放、save 稳定 ID 保留 | PG 录像 owner、action postcommit、组件 unknown 通过；严格 receipt/版本+双管理员 lost response 和 ready trace 仍待集成 |
| AS-16 | 待具体实验 | candidate/season 窄投影；锁序/锁后 deadline/代表/coverage 不变；未知回应禁重放 | 真实 PG 排期/身份回归与组件通过；receipt 归属/版本恢复仍待锁组；未无依据合并 legacy 提议方 SQL |

## 路由审查范围

| 路由 | 本次变化/核实 | 不能关闭的实测项 |
| --- | --- | --- |
| `/settings/competitive` | 公开目录、窄 facts、主表单独立 leaf | 冷/暖 catalog、桌面/移动、硬/软导航、真实 LCP/CLS |
| `/settings` | raw readiness、可编辑资料独立于 readiness | 同账号多平台主内容 ready |
| `/settings/security` | 密码表单独立、identity mail 恢复 | provider/cooldown/真实浏览器 |
| `/settings/education` | 用户投影收窄，审核/学校 mapping 语义保留 | 主身份/备用邮箱/撤销/多历史页面 cohort |
| `/my` | raw facts + 当前队伍 owner | 队长/成员/无队伍的 request memo、业务 ready |
| `/my/teams` | next-match request memo | 同请求 personal/team 双消费者真实一次读取 |
| `/my/competitions` | 首场才补对手和提议；test matches 原有 limit100 保持 | 历史规模与 actual RSC payload |
| `/[seasonSlug]/register` | 真依赖编排，冻结/批准 revision/claim 不变 | team/solo/Major 生命周期 browser matrix |
| `/teams/recruitment` | active view/page 与完整计数；1000 intent PG | 组合筛选的浏览器翻页/历史恢复与 ready |
| `/login` | canonical 去重、固定阶段、transport 提示；完整导航保留 | provider 与本地阶段同请求分布；既有 .2s LCP 不支持页面大改 |
| `/forgot-password` | 提交地址 receipt 与 unknown guidance | 发信 accepted≠实际投递，真实送达未测试 |
| `/reset-password` | transport unknown 禁再次提交 | 静态页面 1.928s LCP 的共享资源/导航归因 |
| `/auth/confirmation` | 核实显式按钮消费 token，未改自动执行 | 首次落地/确认测量；不把发信计时当本页耗时 |

## 共享接口及回滚

- W10 使用 `StatsOCRPanel` 原 `mapId/mapName`，可选 `initialRows?: OperatorScoreboardRow[]`。undefined 才触发 mount read；[] 是已读空。挂载后 preserve draft，由父层以 map ID key 隔离；首次激活后保留实例的责任在 W10。
- W12 保留 `loadParticipantQualificationFacts(userIds, options)`。新增 raw bundle 只在同请求/同 executor 使用，`projectParticipantQualificationFacts(bundle, {platform,fallbackPlatform})` 不读库。
- 没有 schema/trigger/锁模式变更，没有修改 tags/revalidation owner。撤回、身份归并和官方更正的 hard-expire 没有削弱。应用变更可整体回退，不回滚数据库事实。
- 严格 OCR 幂等、版本冲突恢复依赖 W03 active migration；当前 UI 禁盲重放是独立修复，不能代替 durable receipt。
- 尚未运行全仓 build 或全套测试，依委派由父会话统一安排；尚未合并、发版或验证线上改善。
