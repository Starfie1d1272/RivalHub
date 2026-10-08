# 全仓测试减债复核结论（2026-10-08）

本次逐文件复核已完成：台账 615 条记录，559 个现存文件已审查、56 个历史路径已移除、0 个待审。每个现存 test/spec 文件均在 [file-review.csv](2026-10-08-file-review.csv) 记录当前内容 SHA-256、处置理由与相关生产证据 owner；owner 列可以列出多个实际源码/工作流入口，迁移链使用目录入口。文件已审查不等于必须删除，也不等于永远不能再清理。

PR #839 已合并；本次后续工作全部在下一版本 Draft PR [#841](https://github.com/Starfie1d1272/RivalHub/pull/841)，不自动合并。已同步最新 main `279ce1bb`（v2.15.4），包括测试赛 #840 与 #843/#844 修复；#839 squash `4e44e8469c75203658f7ee525c360fc86a4ed924` 仅作为历史统计基线。

## 数量与结论

| 统计口径 | test/spec 源文件 | 源码行数 |
| --- | ---: | ---: |
| 原始全仓审计清单 | 591 | 75,446 |
| #839 合并后历史基线 | 577 | 73,646 |
| 当前 main（279ce1bb） | 581 | 74,045 |
| 本 PR 最终复核（含新测试赛） | 559 | 69,463 |

相对原审计净减 5,983 行（约 7.9%），已包含审计期间 main 新增功能的测试；本 PR 相对当前 main 净减 4,582 行（约 6.2%）。同步 main 前曾累计净减 6,388 行，新功能增量不能算作清理回退。不同基线不能混用。统计仅包含 `.test` / `.spec` 源文件，不把报告、CSV、测试 helper 和产品代码删行计入测试减债。56 个移除路径包含删除、合并和迁移，因此不等于净少 56 个文件。

没有证据支持直接删除 50%。剩余大文件中有真实数据库的事务回滚、外键/名单冻结、并发幂等、赛果纠错与身份安全，还有 24/32 两种赛事生命周期。65536 个结果组合由独立 oracle 验证 Swiss 不重赛、同战绩与参与者完整性；100 次模拟检查完整五轮业务不变量，不是重复稳定性实验。这些证据不能用 mock 的全绿代替。后续仍可压缩 fixture/setup，但仅缩短写法不一定降低 CI 耗时。

## 最后完成的清理

| 范围 | 最终处置与保障 |
| --- | --- |
| captain / draft identity 两份 573 行 mock suite | 删除，统一为 `rivals-formation-identity.test.ts` 调用真实 confirmCaptains、pickPlayer 和代表身份查询；保留 8 支 Entry 形成顺序、注册来源、名单/代表 provenance、跨赛季/非本场拒绝、未授权零写入与幂等审计。 |
| Major roster safety | 删除测试内复制的过期生产事务，调用真实 submit/adminSelect/confirm Actions。原复制体遗漏 BP 代表字段；真实 Action 与真实 DB 现在一起接受验证。首发资格、冻结名单、数据库 scope trigger、重提交、审计、并发开赛全部保留。 |
| 注册与认证 | 移除 normalizeEmail、compactUndefined 和 registration schema 的同源 mock。注册 happy fixture 改为真实允许的输入，invalid QQ 经真实 schema 拒绝；合并重复 Steam 投影场景。防枚举、验证码、identity/session 隔离与日志脱敏保留。 |
| 审计/public payload/readiness/preview | 删除复制的 action 清单、源码标签字符串、完整 DTO 后重复字段检查、固定下一步文案。已删除 audit mock tombstone suite，将实际清理后标签负例纳入 DB owner；公开数据不泄密、未知字段 fail closed、真实 preview mirror 保留。 |
| 迁移测试 | 删除约束/索引名字清单和已由当前真实写入约束保护的 FK metadata 检查；保留 RLS、唯一性、非法写入与历史数据兼容。map-score migration 原“保留统计”在迁移后才插入统计，现改为迁移前插入、迁移后读取。 |
| Mizar 安装撤销 | 删除只数 mock 更新调用的会话关闭测试；实际 PG 验证 revokedAt、live session closeReason、arming 清理、重试状态不变及单条 audit。容量实验仍与正确性分开，未回到 required gate。 |
| team registration / predictions / recovery | 删除手工 UPDATE 状态冒充生命周期、复制的资格查询、普通 SQL JSON/插入读取往返、无断言的 stage2 注入；唯一 participant 约束负例合入现有 DB scope 场景。真实竞争报名、资金守恒/债务、纠错恢复和冻结拒绝保留。 |
| Major lifecycle | 删除仅用于 console 证据表的 SQL/投影与固定荣誉结论；保留真实 24/32 全流程、三阶段比赛/audit 数量、官方名次精确覆盖、归档门禁和故障注入回滚。 |
| CI/release/recovery guard | Vitest 配置源码字符串改为实际配置导入，验证 CI/local 重试与隔离；删除重复 FULL 矩阵、旧 release commit fixture 和固定日志措辞。发布权限、恢复目标隔离、备份窗口顺序和 rollback/ambiguous outcome 仍保留。 |

## 本批处置与证据 owner

| 文件 / 范围 | 处置 | 独立保护与理由 |
| --- | --- | --- |
| `tests/unit/release/runtime-contract.test.ts` | 删除 runtime 版本/setup SHA、文档措辞、Knip entry、源码内部变量/固定 timeout/API 字符串、phase timing 文案检查 | manifest/lockfile 与实际工具执行拥有工具契约；`routing.test.ts` 验证切流、补偿、限流、模糊结果、凭证隔离和请求 timeout；实际 hermetic build 验证构建能力 |
| 同文件发布安全门禁 | 保留并加固 | 生产权限、迁移失败阻断、checkpoint/迁移/smoke/切流顺序、OIDC 凭证边界、scheduler fail-fast 仍保护发布；顺序比较现在同时拒绝步骤缺失，防止 `indexOf=-1` 意外通过 |
| `tests/unit/ci/preview-mirror-contract.test.mjs` | 删除 reset 实现、persona 源码/文档、Suspense 精确 JSX 文本检查 | `preview-personas.test.ts` 与 `preview-environment.test.ts` 拥有实际配置行为；production browser/build 负责构建与运行边界；保留 production read / staging write、环境保护、序列化与敏感 artifact retention 门禁 |
| `src/lib/formats/round-robin.test.ts` | 删除 | 仅检查三个函数是否存在；TypeScript 接口及实际 executor 行为提供证据 |
| `tests/unit/lib/formats/{double-elim,round-robin}.test.ts` | 删除两份相同完成规则矩阵；保留各自晋级行为 | 三个 executor 的完成判断均委托 `_shared.isStageComplete`；规则下沉至 `stage-completion.test.ts`，保留非空且无 active 比赛的正反例，使用真实 Drizzle 而非空操作符 mock |
| `tests/unit/components/{layout/Footer,admin/MapPoolEditor,settings/PrivacyContent}.test.tsx` | 删除 | 仅固定标题/翻译/历史错字，Footer 名称仍声称布局但没有布局断言；这些不证明隐私权限或实际 UI 布局。公开数据隔离测试保留 |
| `tests/unit/actions/seasons.test.ts`、`tests/unit/seasons/edit.test.ts` | 删除 6 项重复编辑规则，归属冻结负例下沉到 planner；增加统一授权拒绝矩阵 | slug/config 冻结与 metadata 规则由 `edit.test.ts` 拥有；打开时间 replay 的实际持久化由 `season-registration-correctness.test.ts` 拥有。Action 保留错误转换、Date payload、审计与 revalidation。9 个 privileged 入口拒绝权限后不得读写 DB 或刷新缓存；补齐原测试全部把授权 mock 为成功的证据缺口 |
| `tests/unit/components/matches/AdminRosterDialog.test.tsx` | 改为按可访问名称选择选手，删除 `li` 祖先断言 | 保留五人 payload、显式确认后才提交、已确认禁止重复操作、历史选手移出后不可重新选择 |
| `tests/unit/components/{players/PlayerAvatar,teams/TeamLogo}.test.tsx` | 删除原生 `img` DOM 结构检查 | 保留可访问 fallback、失败后回退、URL 更新恢复及直连资源行为 |
| `tests/unit/components/players/PlayerProfileLink.test.tsx` | 修正名称 | 实际保护 URL identity 编码，不再声称已验证 focus 外观 |
| `tests/unit/components/settings/MapPreferencesForm.test.tsx` | 删除 `div.grid` 选择器 | 验证未填写/不会的按钮状态及 sparse 保存 payload；不依赖 CSS 容器 |
| `tests/unit/components/season/SeasonPublicInfoView.test.tsx` | 修正布局声明并强化负例 | closed fixture 即使仍携带群号、join URL、QR URL，也不能渲染加入操作或对应数据；原 fixture 已清空字段，不能证明组件的隐藏分支 |

## 深读后保留的证据

- `recovery-contract.test.ts`、`recovery-r2.test.ts`：恢复身份完整性、生产目标隔离、Storage snapshot 窗口一致性、离线 fetch 校验、R2 lock/lifecycle/privacy 与真实 GET/hash；不能仅按源码读取特征删除。
- `release/{routing,production-identity}.test.ts`：切流/回滚状态机、请求失败、token 隔离、真实临时 Git identity fixture。
- `db/{local-environment,postgres-connection,preview-environment,preview-personas}.test.ts`：目标声明、凭证与 TLS 边界；保留真实 TLS handshake 正反例。
- `quality/radar-assets-contract.test.ts`：真实部署资源/provenance hash，不是源码写法约束。
- `lib/{mizar-live-contract,demo-evidence-contract}.test.ts`：真实 producer fixture、协议版本、公开 payload 隔离、JSON Schema 与跨仓格式契约。
- `components/{matches/PreMatchOperatorChecklist,matches/OperatorLiveStatus,matches/PerfectRoomGuide,teams/TeamDirectoryCard,admin/AdminExceptionSummary,admin/MajorPrestartConsole,admin/season-prestart-capability-panel,my/MyWorkspaceNav,settings/SettingsNav,operations/InformationFeedbackLauncher,MarkdownDocument}.test.tsx`：分别保护资格门禁、实时 freshness/执行隔离、复制 payload、解散队伍状态、操作入口、阶段操作归属、能力入口、路由语义、公告确认与 Escape/focus、HTML/XSS 与文档标题处理；长度或 DOM 使用本身不是删除理由。

- 大型 `major/swiss.test.ts` 深读后保留：真实 greedy deadlock 反例、独立 oracle 验证 65,536 个结果组合的不重赛/同战绩/参与者完整性；不是重复稳定性实验。`actions/auth.test.ts` 的防枚举、验证码负路径、日志脱敏与 identity/session 隔离有独立价值，保留。报名 remediation、capabilities 与 window 分别保护规则、组合门禁与实际开放事实，不能仅因共用 import 判为重复。

## 继续深审：持久化证据与重复领域 owner

| 范围 | 处置与独立保障 |
| --- | --- |
| 竞技目录 Action 的 13 个 mock 案例、临时排序 helper 重复案例、catalog mock 引用检查 | 改由 `competitive-catalog-actions.test.ts` 调用真实 Action：已有负排序槽位下交换唯一排序、当前赛季切换、稳定身份改名、当前/停用赛季拒绝、已引用段位禁止移动/删除、未引用项删除、真实 audit 写入失败后的事务回滚。仍保留创建输入规范化、内置平台身份与授权入口单元证据。 |
| `competitive-catalog.test.ts` 的三份复制 SQL 查询 | 删除手写 production 查询副本；新 Action 测试覆盖 historical provenance、current/previous/reference/recent 与跨平台 fallback 五种冻结引用，同时确认未引用赛季仍可删除。真实 DB CHECK、rank frozen JSON 与 fallback catalog references 原测试保留。 |
| `src/actions/competitive-platform.ts` | 真实反例发现 fallback source 引用被错误放在主平台匹配条件内；修复为独立 OR 分支。旧 production code 下新反例实际返回删除成功；修复后拒绝删除、记录仍存在且不写 audit。提交中文 patch Changeset。 |
| `matches-results.test.ts` 整份 mock suite | 删除，6 场景下沉到 `map-score-correction.test.ts`：真实 Action 的 BO1/BO3 正例、MR12 非法分数、winner reversal、unresolved series；拒绝后整份 match/maps/audit 事实保持不变。不是用 mock 替代事务证据。 |
| `match-lineup-actions.test.ts` | 删除复制的 `actionError` mock，使用真实错误转换 owner；保留 actor、DTO/private identity、恢复确认与 wrapper 行为。 |
| draft / captains / match-transitions / standings / registration 两套重复 suites | 合并到单一领域 owner，删除重复文件；保留独有的自定义 position limit、输入不变、even-round 推进、空 roster、8 人截断与排序优先级、11 种非法状态迁移、非 2 次幂 bracket rounding、无 final override、自定义地图与拒绝池外地图。 |
| `getPickNumber` 与 `types/draft.test.ts` | 删除仅测试调用的死函数和 8 项测试；旧奇偶顺序与当前 draft owner 不同。实际规则、持久化操作与 UI 不依赖它；当前 draft rule tests 保留。 |
| `HeaderClient.test.ts`、`MatchRosterView.test.tsx`、SeasonForm 四个标题/说明案例 | 删除固定导航对象文案、共享头像是否渲染与表单纯说明矩阵；保留导航实际路由与 aria-current、公开身份可见性、头像 owner、表单提交/确认/冻结控件行为。 |
| template / education 分层重复 | 删除重复 Major preset / custom draft / capability overlay；转移唯一的空 custom stage 与深层 clone 检查到原 owner。CHSI 正反例只由 validation owner 持有，email domain spoof 负例迁至同处；education eligibility 仍验证实际高校资格和历史选取。 |
| 页面层后续复核 | 删除 Overview 固定标题/列数量、空数据只检查排序按钮、九处共享帮助按钮清单；canonical 154 回合断言合入 coverage 场景，保留 economy 真实分母过滤与聚合、自定义 tooltip 交互。删除队伍主页四组固定区块顺序与详情页 BP/MVP 固定顺序；保留 disclosure、名单快照、弃赛/统计失败降级。Admin roster 改按五名选手的实际链接验证，移除 p 祖先耦合；audit raw action 不曝光仍保留，移除 pre 标签约束。 |
| PR metadata / scheduler / OCR | 删除 metadata 工作流整段文本快照；真正的 title 正反例与 required pr-title job 保留。删除 scheduler checkout 固定 SHA 副本，保留不可变 action pin 和真实 CLI / shell 编排行为。OCR 缺失与零值语义归入 OCR owner，避免 production adapter suite 夹带另一领域。 |
| registration / automatic transitions / time auto-award | 删除 7 项规则表形状快照，改为调用真实 validator 验证 9 种允许迁移在 7 个赛季阶段的正反例及全部未定义迁移。原 pending→finished 的 try/catch-only 断言可能静默通过，改为必须抛错。删除自动完赛两份相同 count=0 fixture 的重复案例，修正其名称；库级 transition/cron 测试移出 Actions project。time-auto-award 删除 Drizzle/表结构副本 mock，保留 mock DB 边界并使用真实 SQL expression/schema。 |

该批测试层选择曾以 `unit-domain-node` 显式运行旧 actions 路径，因零发现而失败；改为实际 project 运行通过，随后将纯 Veto sequence suite 移到领域层。新 PostgreSQL fixture 起初有 nullable audit actor / 参数类型假设错误，修正 fixture 后才获得 production 漏洞反例；没有跳过失败案例。


## 最新 main 增量复核

新增四个 test/spec 全部逐文件审查；其余受影响测试重新核对行为与生产 owner。测试赛的真实名单准备、BP/LIVE 权限、原子纠错、正式赛程/统计隔离保留。删除新增 Action suite 内复制的 actionError 与无用 schema mock；preview test_config 脱敏从 SQL 字符串检查下沉为真实导出查询，源事实含私有证据而 mirror 仅保留地图/操作者字段。

测试赛浏览器生命周期明确归属 desktop project，同一用例检查手机 viewport；删除 main 新增的 runtime mobile skip。补齐 Action、领域 owner、表单与管理页面到 test-matches browser 的 planner 映射，以混合新增 PG spec 正例证明原 system 保障不会缩窄，并保留无关 UI 不触发 system 的负例。

## 最终验证

最终完整执行数据以本次 JSON 为准；历史 commit 的绿色证据不替代新 head。

| 层级 | 实际文件 | 实际用例 | 失败 / 跳过 | 耗时 |
| --- | ---: | ---: | --- | --- |
| 当前 main 完整单元 | 455 | 2,598 / 2,598 | 0 / 0 | JSON 起止 177.262s |
| 当前 main 完整 PostgreSQL | 85 | 253 / 253 | 0 / 0 | JSON 起止 152.896s |
| 当前 main 测试赛 DB 定向 | 1 | 5 / 5 | 0 / 0 | JSON 起止 6.933s |
| live fencing 定向 | 1 | 10 / 10 | 0 / 0 | JSON 起止 25.674s |

全仓 app/tests/scripts type-check、architecture check、仓库 ESLint（排除未跟踪 .agent-tmp 工具）与 diff whitespace 通过。单元 discovery 455 文件与实际执行 455 文件一致；PG 全部 85 文件与 JSON 实际清单一致，没有遗漏。同步 main 前的完整执行为单元 453/2588（167.24s）、PG 84/247（87.442s）；当前 main 新增功能及并行执行带来的耗时差异不能解释为性能退化或提升。初次完整 PG 为 246/247，固定等待竞争测试失败；改为真实 HTTP barrier + DB waiter 后定向及完整通过。单元/初次 PG 同时运行，耗时不能与此前独立运行直接比较，未声称性能比例提升。

affected 实际验证：captains、draft operations、match representative 与 roster Action 源码单独变化时自动选中新的真实 PostgreSQL owner；混合新增 identity suite 后原选中项仍全部保留。schema 变化保持完整 PostgreSQL（空 spec 列表代表 FULL），Mizar 变化保持 PostgreSQL + system。完整执行报告中的实际文件清单与当前 unit/PG 源文件比对，避免“应运行但静默跳过”。

本次完整测试过程中未修改对应测试源码；完成后仅移除 preview-policy 未使用 import，并定向重跑通过。没有新增 skip/retry 或缩小 timeout/并发证据。定向调试曾因新 identity fixture SQL 参数同时被推断为 uuid/text 而失败，修正独立参数后通过；初次 whitespace 检查发现空白瑕疵，修正后通过。此前 UI selector/project 零发现和 fixture 调试失败均在对应阶段记录，未用跳过掩盖。同步 main 后首次命令因 pnpm 依赖状态变化拒绝执行，冻结安装后正常运行；初次 ESLint 扫入 .agent-tmp 中的未跟踪审计脚本，排除临时目录后仓库检查通过。

## 保留项的边界

部分 release/recovery/preview 工作流仍有源码步骤顺序或结构 wiring 断言，保护生产写入授权、迁移失败阻断、恢复目标隔离与备份一致性。逐项审查后保留这些实际安全证据；进一步替换需要可执行编排或结构化 workflow harness，不能仅为了达到删行比例撤掉门禁。

视觉/截图/容量与重复稳定性实验保持独立可显式执行；不要求它们在普通 required CI 执行，也不把它们算作本次完整 unit/PG 的跳过。关键浏览器生命周期和精简 production browser smoke 由最新 head CI 验证。
