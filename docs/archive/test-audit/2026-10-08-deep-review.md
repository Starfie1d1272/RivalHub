# 测试减债后续审查：发布配置、共享完成规则与 UI

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

## 验证与限制

- 本批所有产品代码、migration、PostgreSQL/E2E spec 与 CI 选择器均未修改；没有新增 skip/retry 或实验替代 required 用例。
- 基线全部 test/spec 源文件 577 个、73,646 行；本批代码清理后 574 个、73,326 行，净减 320 行（不含本报告）。
- 全量单元执行 476 文件、2,800 测试，全部通过，0 失败/跳过，wall time 109.00 秒。基线最新 #839 CI 为 479 文件、2,815 测试；两次环境不同，不据此声称 wall time 性能提升。
- 发布/恢复/preview 定向执行 109/109；共享 format 9/9；最终名单 5/5；地图偏好 2/2；公开赛事信息/DTO 7/7；最后发布契约 14/14 全部通过。测试 type-check、修改文件 ESLint 与 diff whitespace 检查通过。
- 第一次 UI 定向执行 26/27，名单选择器误假设昵称后有空白；修正为名称前缀及数字边界后 5/5 通过。失败保留在本地验证记录中，不通过跳过掩盖。
- 顺序 helper 单独执行 1 个有效顺序和 4 个缺失/逆序反例，全部符合预期。
- 本地 PostgreSQL 与 browser 未重跑；本批不将 #839 的真实环境执行伪称为新 commit 的验证。Draft CI 的实际选择与结果由 PR Actions 提供。

剩余工作流门禁仍有字符串/步骤名耦合，recovery orchestration 还有源码顺序断言。这些保护写入授权、备份一致性和发布阻断，必须先补充可执行编排或结构化工作流证据再替换，不能为了删行直接取消。其余清单仍需逐项审查，不能把本批保留项或全量绿灯外推到所有未深读文件。
