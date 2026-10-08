# 测试减债后续审查：重复 owner、真实持久化与发布/UI 约束

基线为 PR #839 squash 合并提交 `4e44e8469c75203658f7ee525c360fc86a4ed924`。这是下一版本的独立审查批次，不是对剩余 415 文件逐断言审查完成的声明。

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

该批测试层选择曾以 `unit-domain-node` 显式运行旧 actions 路径，因零发现而失败；改为实际 project 运行通过，随后将纯 Veto sequence suite 移到领域层。新 PostgreSQL fixture 起初有 nullable audit actor / 参数类型假设错误，修正 fixture 后才获得 production 漏洞反例；没有跳过失败案例。

## 验证与限制

- 首三个 commit 没有产品行为变化；后续深审修复竞技目录跨平台冻结来源赛季的删除漏洞，移除仅测试调用的旧 `getPickNumber`。没有 migration、E2E spec 或 CI 选择器修改，没有新增 skip/retry。
- 基线全部 test/spec 源文件 577 个、73,646 行；当前清理后 566 个、72,053 行，净减 1,593 行（不含本报告）。
- 首两个 commit 全量单元执行 476 文件、2,800 测试，全部通过，0 失败/跳过，wall time 109.00 秒。基线最新 #839 CI 为 479 文件、2,815 测试；两次环境不同，不据此声称 wall time 性能提升。
- 发布/恢复/preview 定向执行 109/109；共享 format 9/9；最终名单 5/5；地图偏好 2/2；公开赛事信息/DTO 7/7；最后发布契约 14/14 全部通过。测试 type-check、修改文件 ESLint 与 diff whitespace 检查通过。
- 第一次 UI 定向执行 26/27，名单选择器误假设昵称后有空白；修正为名称前缀及数字边界后 5/5 通过。失败保留在本地验证记录中，不通过跳过掩盖。
- 顺序 helper 单独执行 1 个有效顺序和 4 个缺失/逆序反例，全部符合预期。
- 后续赛季规则去重与授权边界执行 5 文件、78/78 测试，0 失败/跳过；type-check 与修改文件 ESLint 通过。第三个 commit 全量单元为 2,804 项，新增权限负例用于补缺口，不追求测试数量下降。
- 首两个 commit 的 FULL CI `37709534614`：单元 2,800/2,800，PG 80 文件 238/238，0 失败/跳过/flaky；所有 job 与 draft-gate 通过。后续 commit 的 CI 是另一份 evidence，不能沿用旧 head 的成功。
- 第三个 commit `25b37c7f` FULL CI `37710651643`：单元 2,804/2,804；PG 238/238（103.503 秒）；browser 18/18（166.689 秒）；production smoke 2/2（21.917 秒）；0 失败/跳过/flaky。后续深审修改需要重新验证，不能沿用该 head 的结果。

- 本次深审全量单元：466 文件、2,714/2,714，0 失败/跳过，wall time 113.27 秒；app/tests type-check 与修改文件 ESLint 通过。真实 PostgreSQL 定向验证：目录 2 文件 3/3、比分更正 1 文件 6/6，0 失败/跳过。affected import graph 对目录 Action 自动选中新 suite，对比分更正保留既有 series suite 并增加新 suite；全量 PostgreSQL 与新 head CI 另行验证。

剩余工作流门禁仍有字符串/步骤名耦合，recovery orchestration 还有源码顺序断言。这些保护写入授权、备份一致性和发布阻断，必须先补充可执行编排或结构化工作流证据再替换，不能为了删行直接取消。其余清单仍需逐项审查，不能把本批保留项或全量绿灯外推到所有未深读文件。
