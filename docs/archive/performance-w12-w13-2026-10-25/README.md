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
| AS-00 | 待具体实验 | 固定 auth clock/canonical/session、password begin/provider/finalize、OCR players 阶段；OCR requestId 顶层兼容 | W01 #1082 已合入，真实 ready consumer/stage 已接；集成人验证同导航 token 与 receiver-first |
| AS-01 | 待具体实验 | 设置/readiness 复用公开目录 owner；仅公开冷读允许三表独立并行；freeze/写仍 caller executor 顺序读取 | W12/W01 量 production build 下冷/暖真实 cache hit 和主表单 ready/LCP；本机 no-op cache 不能证明命中 |
| AS-02 | 已实现已测 | 单次 raw bundle + platform/fallback 纯投影，兼容旧 loader；私有事实不跨请求缓存 | PG 检查同 executor、4 次 raw 查询、投影零查询、primary/fallback/unranked；资格冻结/修正 suite 通过 |
| AS-03 | 已测 request memo；人口实验待补 | next-match request memo、首场富化与当前队伍 owner | 真实 react-server dispatcher + PG：personal/team 同请求一次、下一请求重读；未据空人口 fixture 宣称完成长期历史/角色 cohort，见 bounded-acceptance.md |
| AS-04 | 已测窗口与准入链；生产性能待验 | 依赖分组、保留 revision/冻结准入；请求事实置于 leaf Suspense | 原生 Chromium team/solo/Major 九窗口 + Major 创建报名；注册 PG 五项复验；资格/冻结原 suite 保留，见 bounded-acceptance.md |
| AS-05 | 已实现已测 | 当前视图有界卡片；完整 SQL filter 后计数与分页；页数收缩纠正；仅当前页富化 | PG 覆盖 q/event/position/size/map、邀请/过期及 1000 intents；浏览器 ready 与生产资源收益另验 |
| AS-06 | 已实现已测 | 原始 canonical candidate ID 去重；冲突拒绝、锁后归属、revoked subject/fresh-auth fence 保留 | 真实独立 PG 连接的身份撤销/登录 12 项回归通过；不据此承诺解决 13s provider 尾延迟 |
| AS-07 | 已测 Local Auth/transport；生产慢样本待归因 | 登录与凭据表单受控 unknown；密码 fence 不变 | Local Supabase 真实登录与浏览器 abort 后恢复通过；Next 底层实际三次网络尝试，未伪称一次 HTTP；密码 PG 与组件独立证据保留，见 bounded-acceptance.md |
| AS-08 | 已实现已测 | 邮件 unknown 不取消 pending；明确 4xx 与 5xx/408/transport 分离；user→request 锁序与 DB clock 阻止有效 pending 被跨刷新/双击替换，原链接到期后才允许新请求 | 真实 PG 并发、原 token/status 保留、DB 过期后重建通过；provider adapter 用确定性 503/accepted，未声称实际送达 |
| AS-09 | 已实现已测；生产反代待验 | 7 MiB 原图预算与 canonical 编码/签名复核不变 | 9,786,741 字节真实 Next envelope 正常/分块均 200；超限被 body-limit 拒绝（本地 action HTTP 500）；生产反代未验证，见 bounded-proof.json |
| AS-10 | 已实现已测 | OCR 窄 map/match join，先 fresh admin，再 players/provider 并行；typed 回读不伪空 | app types/architecture/组件；付费模型未调用，生产 provider 时间与字段精度尚不宣称 |
| AS-11 | 待具体实验 | fallback 共用原 180s monotonic deadline；真实 decoded imageBytes；既有关 thinking/tuple/body timeout 不重复计功 | 当前默认 Qwen3.5-9B 与 thinking 配置未改；仓内只有响应/输入契约测试，没有标注截图精度基线。压缩/换模型属条件实验，需至少20张脱敏标注图与费用授权；没有新增付费调用 |
| AS-12 | 已实现已测 | typed read/finally、actor 绑定、版本 CAS、原子 durable receipt、非敏感 locator 与未知草稿互斥 | #1091 已合 main；非空 save/重放/CAS/superseded PG + 原生浏览器关闭重开、实际 HTTP 丢响应、missing/权限变化通过；adapter COMMIT 模拟与网络故障分别记录，见 ocr-receipts.md |
| AS-13 | 已交付独立 Ready #1110 | 保留锁后完整准入；fresh 授权完整名单/代表/内容版本核对 | 组件与真实 PG 通过；当前状态相同不当提交归属凭据、不自动重放，见 operation-readback.md；合并由父会话控制 |
| AS-14 | 已测真实 leaf；生产指标待验 | 设置窄事实/辅助 leaf；请求读取在真实表单边界内，fallback 不报 ready | 三个实际可编辑表单与 shift source tag 已测，竞技锚点为保存按钮；设置/报名 uncached-data 警告移除；不宣称生产 p75/p95 或 CLS 达标，见 bounded-proof.json |
| AS-15 | 已交付独立 Ready #1110 | 录像原 ID/内容/相对顺序与版本授权核对；保留未知草稿 | 单测/组件与真实 PG 通过；状态匹配仍不证明原提交归属，仅明确提交后的失效允许单独重试，见 operation-readback.md |
| AS-16 | 已交付独立 Ready #1110 | 原 proposalId/status/resolution/proposedTime/scheduledAt/reason 与版本核对 | 相同排期不同原提议不能判完成；fresh 代表/管理员授权，保留锁序/deadline/coverage；单测/组件/真实 PG 通过，见 operation-readback.md |

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

独立复审回归：密码 provider trace 在 exporter 前做专用 allowlist 投影，实际 OTel span 的自由文本/stack 合成凭据防泄漏通过，业务 unknown/cause 不变。OCR 显式恢复后标记首次读取完成并废弃旧请求，晚到 initialRows 不再覆盖编辑草稿。报名 current revision 限缩与教育 Page/Overview 拆分的 8 项真实 PG 通过。

取消在途 reload 的读取 epoch 与 busy owner 已分离：晚到 initialRows 仍废弃旧响应，旧请求 finally 仍释放其 busy。真实组件复现（首读失败→reload 在途→晚到 props→旧响应结束）通过，保留新快照且恢复可编辑。
