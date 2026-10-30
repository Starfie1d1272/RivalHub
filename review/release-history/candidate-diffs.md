# Release 正文候选差异（审查进行中）

仅列出有正文改动的 Release。原始正文、metadata 与资产清单见快照；所有变更须独立审阅。

## v2.24.15

```diff
--- 原文
+++ 候选
@@ -7,4 +7,7 @@
 ### Changed

 - 降低竞猜、阵容对比和制播数据读取的流量。
+
+### Fixed
+
 - 缓存连接异常时，竞猜页面自动重新读取数据。
```

## v2.24.13

```diff
--- 原文
+++ 候选
@@ -4,12 +4,15 @@

 ## [2.24.13]

-### Changed
+### Added

 - 管理员可查看数据库查询来源的短期聚合和版本趋势，以识别高流量读取及观测缺口。

+### Changed
+
+- 迁移生产数据库与图片存储，保留现有业务数据与图片链接；生产切流和验收按迁库流程完成。
+
 ### Fixed

-- 迁移生产数据库与图片存储，保留现有业务数据与图片链接；生产切流和验收按迁库流程完成。
+- 修复旧版首页处于维护或故障状态时阻止 Linux 发布的问题，继续校验旧版身份及候选和回退健康状态。
 - 支持自托管环境通过现有代理发送数据库流量归因数据，并补齐迁库后的私有实时连接策略；生产验收仍待完成。
-- 修复旧版首页处于维护或故障状态时阻止 Linux 发布的问题，继续校验旧版身份及候选和回退健康状态。
```

## v2.21.13

```diff
--- 原文
+++ 候选
@@ -8,15 +8,14 @@

 - Cloudflare 产品遥测增加页面性能指标和站内导航提交耗时，继续使用现有批量通道、七天保留与接收预算。
 - 系统状态页向超级管理员展示当前进程的内存、运行时长、事件循环与数据库连接池快照。
+- 支持每位解说添加、编辑和排序多条分图或完整回放，比赛页按解说分组展示，保留原有回放及统一赛后待办口径。

 ### Changed
-
-- 支持每位解说添加、编辑和排序多条分图或完整回放，比赛页按解说分组展示，保留原有回放及统一赛后待办口径。
 - 统计中心按当前视图加载交互代码，并隔离视图加载与赛事选择等导航控件的等待边界。
 - 复用赛事阶段事实，缩短赛事首页、我的赛事和系统状态中独立资料的串行加载等待。
+- 自托管服务延长闲置数据库连接的复用时间，减少连续浏览时重复建立连接的等待，并增加查询返回行数和连接池排队诊断。
+- BET 三类排行榜共用一次总体读取；批量读取预测结算输入，缩短选手统计保存及 Demo 导入等待。

 ### Fixed

 - 修复自托管反向代理后遥测票据续签被误判为跨域的问题，使用已配置的公网 HTTPS 来源并继续拒绝跨域、内部地址及无效来源配置。
-- 自托管服务延长闲置数据库连接的复用时间，减少连续浏览时重复建立连接的等待，并增加查询返回行数和连接池排队诊断。
-- BET 三类排行榜共用一次总体读取；批量读取预测结算输入，缩短选手统计保存及 Demo 导入等待。
```

## v2.21.11

```diff
--- 原文
+++ 候选
@@ -4,6 +4,6 @@

 ## [2.21.11]

-### Fixed
+### Changed

 - 记分板 OCR 默认改用 Qwen3.5-9B 的非思考模式，并减少重复字段输出，缩短识别等待；服务端校验表格列数后还原玩家数据。
```

## v2.21.6

```diff
--- 原文
+++ 候选
@@ -2,7 +2,7 @@

 部署状态：已上线。2026-10-21 21:41（北京时间）核验生产版本为 v2.21.6，提交为 10b554eb14e6b4efc7e9d20677ff4199fdf77f31。受保护发布流程全部适用任务成功。

-### 调整
+### Changed
 - 优化比赛后台现有赛务待办的信息层级，突出对阵、开赛时间与下一步任务。
 - 负责人联系、解说与最晚完成时间放在辅助层，排期回应规则可展开，同刻撞档独立提示。
 - 保留原后台布局、品牌色、全部八类筛选、复制催办与工作台入口，以及返回原筛选和行位置的行为。
```

## v2.21.5

```diff
--- 原文
+++ 候选
@@ -2,11 +2,11 @@

 部署状态：已上线。北京时间 2026-10-21 20:57 核验生产版本 v2.21.5，提交 bfadb31f94fa5002cbee508f3d7efa55a0c84c5f；受保护 Release 构建、候选 smoke 与生产切换成功。本次无数据库迁移。

-### 修复
+### Fixed
 - 完整正式提交 Pick’Em 后立即完成对应提交任务并获得铜币，已有提交自动体现；截止前仍可修改和重新提交，草稿不覆盖正式提交。命中任务仍在阶段锁定和结果结算后计分。
 - 纪念币侧边和立体边框使用对应素材外圈采样色，未解锁状态的铜币面与铜色侧边一致；保留原有金属高光及灯光。

-### 调整
+### Changed
 - 首轮比赛排期未齐时，预测截止时间标注“暂定”。截止仍取该阶段最早开赛时间，已锁定后不因改期重新开放。

 ### 发布证据
```

## v2.21.4

```diff
--- 原文
+++ 候选
@@ -2,15 +2,15 @@

 部署状态：已上线。北京时间 2026-10-21 19:39 核验生产版本为 v2.21.4，提交 fa16077771c259cba751b7a4c72a865be8cb9924。受保护发布流程的备份检查点、PG17 迁移演练、生产迁移、候选验证及生产切换均成功。

-### 新增
+### Added
 - 赛事推演页头新增纪念币与任务进度组件，支持任务／排行榜展开，以及大尺寸可旋转币体特写；接入本届铜、银、金、钻石币图。
 - 尚未创建比赛的推演对阵提供双方队伍资料入口；缺少正式比赛数据的选手，在地图熟练度旁展示历史最高段位及对应完美 Rating Pro。

-### 调整
+### Changed
 - 本届八项 Pick’Em 挑战按首次有效提交锁定发放铜币，银／金／钻门槛统一为 2／5／8；同完成任务数并列，组内按真实命中数排序。
 - 左侧标题和阶段导航保持原有留白，右侧成就组件独立延伸；纪念币保留原色与亮度，并增加主光、补光和轮廓光。

-### 修复
+### Fixed
 - 提高推演胜负状态可读性，保留原有卡片布局；优化弹层关闭与焦点交互，并为不支持 WebGL 的环境提供静态币图。

 ### 发布信息
```

## v2.21.3

```diff
--- 原文
+++ 候选
@@ -5,7 +5,7 @@
 - 队伍近期比赛和数据中心地图/BP筛选目录排除测试赛；清理两场已结束历史测试赛，保留正式比赛、参赛档案及删除审计。

 ### Changed
-- 收拢已审核队伍、参赛人数和近期比赛查询，页面不再自行定义数据库聚合指标，并增加架构及真实数据库回归保护。
+- 统一已审核队伍、参赛人数和近期比赛的统计口径。

 ### 生产核验
 - Release #39533233744 的 PG17 演练、加密数据库检查点、生产迁移、候选验证及上线全部通过。
```

## v2.19.4

```diff
--- 原文
+++ 候选
@@ -1,7 +1,7 @@
-### Fixed
-
-- 参赛管理默认汇总待审核、需补正与资格异常；正赛参考按正式队伍及最新名单重新排序。
-- 恢复 Play-in 淘汰选手和赛事负责人在转会窗口内自主释放参赛归属；保留历史名单与比赛记录。
-- 冠军竞猜在正式正赛队伍确定后自动开放；赛事击杀王独立等待名单冻结，阶段积分仍按阶段启动发放。
-
+### Fixed
+
+- 参赛管理默认展示待审核、需补正与资格异常；正赛实力参考按正式参赛队及最新调整名单重新排序。
+- 恢复 Play-in 淘汰选手在转会窗口内自主退出原赛事归属并加入晋级队伍的能力，包括原赛事负责人；保留历史名单与赛果，并允许没有其他进行中赛事的淘汰队伍正常解散。
+- 冠军竞猜在 Play-in 完成、正式正赛队伍确定后自动开放；赛事击杀王独立等待正式名单冻结。两者在正赛首场 BP 或比赛开始时锁盘，阶段积分仍按阶段启动发放。
+
 **Full Changelog**: https://github.com/Starfie1d1272/RivalHub/compare/v2.19.3...v2.19.4
```

## v2.19.0

```diff
--- 原文
+++ 候选
@@ -1,4 +1,4 @@
-## 更新
+### Changed

 - 管理后台按赛事组织工作范围，比赛执行、赛程阶段与赛后资料分开浏览；单场返回保留筛选、待办类别和来源位置，本届公告与赛事信息可连续办理。
 - 优化首页、赛事导航及公开赛程的桌面布局，突出近期比赛和当前阶段，保留赛事品牌与历史入口。
@@ -7,7 +7,7 @@
 - 精简单场工作台，突出排期、BP、录分和赛后资料；优化 BP 地图卡片、选边、双方准备状态与比赛详情布局。
 - 补齐新版后台页面、工作视图和赛务筛选的诊断分类。

-## 修复
+### Fixed

 - 修复登录后丢失竞猜或社区奖页面上下文、低保领取首次点击无响应，以及推演双位数比分换行的问题。
 - 修复单队地图决胜图次数的统计范围，并明确情境统计的样本门槛和指标含义。
```

## v2.18.3

```diff
--- 原文
+++ 候选
@@ -1,4 +1,4 @@
-## 修复
+### Fixed

 - 修复浏览器诊断数据无法发送的问题。
```

## v2.18.2

```diff
--- 原文
+++ 候选
@@ -1,5 +1,5 @@
-## 修复
+### Changed

-- 启用页面与操作诊断，支持定位使用问题。
+- 启用页面与操作诊断配置，支持定位使用问题；接收端和真实浏览器采集仍需核验。

 **完整更新**：https://github.com/Starfie1d1272/RivalHub/compare/v2.18.1...v2.18.2
```

## v2.18.1

```diff
--- 原文
+++ 候选
@@ -1,4 +1,4 @@
-### 修复
+### Fixed

 - 修复选手资料更新后较低的外校实力差使已有特批失效的问题。
 - 确认正赛席位承接已批准名单，实际阵容继续执行首发资格校验。
```

## v2.17.6

```diff
--- 原文
+++ 候选
@@ -8,7 +8,3 @@

 - BO1 有可信正式单图结果时，比赛详情、赛程、预测和历史赛果显示实际回合比分；多图系列赛与弃权保留系列比分，缺失结果不再显示虚假的 0:0。
 - 现场账号与登记首发不一致时，可在来源授权、地图与实时证据校验通过后继续展示网站实时数据，并提示名单异常。临时账号不关联登记选手；展示不修改固定首发、正式赛果、统计或竞猜结算。
-
-### Maintenance
-
-- 系列比分更正的浏览器证据使用独立 CI 分片，保持实际更正和拒绝路径验证。
```

## v2.17.4

```diff
--- 原文
+++ 候选
@@ -4,11 +4,11 @@

 ## [2.17.4]

+### Changed
+
+- 减少公开选手属性基准读取的统计投影数据量，保留原有统计结果、身份校验与缓存更新时效。
+- Preview 镜像保留每日及手动刷新，仅在含数据库迁移的成功发布后额外刷新，减少纯应用发布产生的全量导出。
+
 ### Fixed

-- 减少公开选手属性基准读取的统计投影数据量，保留原有统计结果、身份校验与缓存更新时效。
 - 消除比赛排期弹窗与页面重复发起的自动刷新，继续按比赛页面现有频率同步提议和比赛状态。
-
-### Changed
-
-- Preview 镜像保留每日及手动刷新，仅在含数据库迁移的成功发布后额外刷新，减少纯应用发布产生的全量导出。
```

## v2.17.3

```diff
--- 原文
+++ 候选
@@ -4,7 +4,7 @@

 ## [2.17.3]

-### Fixed
+### Changed

 - 赛事人数概览改为在数据库聚合同一份有效名单，避免仅显示人数时传输完整选手资料；保留候选、正式与冻结名单的人数和实时更新语义。
 - 合并制播比赛资料中的选手头像查询，减少名单读取的数据库往返，保持头像、替补名单和资料版本语义不变。
```

## v2.17.2

```diff
--- 原文
+++ 候选
@@ -8,7 +8,3 @@

 - 修复 BET 管理确认与公开竞猜入口在页面尚未就绪时首击无响应；准备期间明确禁用，就绪后继续确认或登录。
 - 修复创建队伍时过早填写导致名称丢失的问题；输入与创建操作就绪后再开放。
-
-### Changed
-
-- 精简重复测试与 CI 启动，保留迁移、结算、权限和安全脱敏回归保护，并更新验证档案。
```

## v2.15.10

```diff
--- 原文
+++ 候选
@@ -16,5 +16,5 @@

 ### Fixed

-- 完善 Play-in 实时数据、赛程统计及比赛入口。
-- 优化后台窄屏和长内容布局。
+- 修复 Play-in 实时订阅和投递拒收诊断，补齐正式 Swiss 与 Play-in 比赛入口并统一阶段目录。
+- 优化后台操作记录与赛后确认的窄屏和长内容布局。
```

## v2.15.8

```diff
--- 原文
+++ 候选
@@ -6,5 +6,5 @@

 ### Fixed

-- 中文字体改为本地按需加载，避免远端字体响应引发页面编译失败；保留 Noto Sans SC 字体及现有字重。
+- 中文字体改为本地按需加载，避免远端字体响应引发页面编译失败；保留 Noto Sans SC 字体及现有字重。LIVE 页面编译失败时直接报告错误，避免误报超时。
 - 修复超级管理员看到空的解说待认领队列且无法认领的问题：超级管理员无需额外赛事授权即可认领、取消自己的认领或登记为解说，空位列表与数据库资格校验保持一致。
```

## v2.15.3

```diff
--- 原文
+++ 候选
@@ -24,6 +24,6 @@

 顶部导航恢复最多一个当前活跃赛事入口，桌面与手机均可直达；赛事页移除重复切换框，通过面包屑进入赛事目录。

-### 验收说明
+### Verification

 自动化覆盖测试赛创建、权限、BP、结果、正式事实隔离和报名阶段真实 LIVE 浏览器订阅。双账号完整浏览器彩排、Windows + CS2 + Mizar + OBS、B站嵌入与真实 DAK 上传仍待通过测试赛现场验收。
```

## v2.12.0

```diff
--- 原文
+++ 候选
@@ -12,9 +12,9 @@

 ### Changed

-#### 选手主页与统计说明
+#### 选手与队伍主页

-重组选手主页信息层级和竞技数据工作区，拆分 Opening、Teamplay、Maps 与 Weapons；赛事统计指标说明统一通过提示入口查看，移除重复的区块解释。
+重组选手主页信息层级和竞技数据工作区，拆分 Opening、Teamplay、Maps 与 Weapons；赛事统计指标说明统一通过提示入口查看，移除重复的区块解释。队伍公开主页重组阵容、比赛表现和历史记录，提供地图、选手与武器数据。

 ### Fixed
```

## v2.11.0

```diff
--- 原文
+++ 候选
@@ -10,8 +10,12 @@

 赛事统计整理为 Overview、Players、Teams、Maps 和 Weapons 五个入口，并支持 Stage、Best-of、Map 与 Team 等可分享筛选。新增地图池与 BP 视图、队伍 Rating 汇总、赛事经济摘要和 Situation Highlights；正式赛果、BP 暴露及已确认 DAK 详细覆盖继续分开呈现。

-### Fixed
+### Changed

 #### 公开页面缓存与加载

-首页、公告和赛季信息改用可定向失效的共享缓存，公开路由复用 App Shell，同时保持 viewer 专属任务独立加载。更新 Next.js 与 eslint-config-next 安全补丁，并记录 Vercel build footprint。
+首页、公告和赛季信息改用可定向失效的共享缓存，公开路由复用页面框架，同时保持用户专属任务独立加载。
+
+### Security
+
+更新 Next.js 与 eslint-config-next 安全补丁。
```

## v2.10.5

```diff
--- 原文
+++ 候选
@@ -10,10 +10,6 @@

 收紧动态状态与预期业务错误的用户文案边界：状态通过类型化展示映射输出，未知值不再回退为内部键，业务错误的内部诊断与用户提示分离。

-#### Demo Steam 身份复核
-
-管理员现在可以在单场比赛工作台处理 `/3` Demo 中需要核对的 Steam 身份：确认后会复用完整 Demo 校验并自动重检，其他问题仍会保留；无效或不应接收的 Demo 可拒绝。比赛中观察到的 Steam64 会作为可审计的 gameplay alternate identity 保存，不会修改登录或报名资料中的当前 Steam64。
-
 #### 账号归并预检

 修正账号归并对已批准参赛条目的误判：只有双方同时出现在已批准或已冻结的正式名单中才阻断归并；已退出的历史参与记录不再错误阻断。归并预检同时改用面向用户的中文领域名称，不再显示 `competition`、`team`、`stats` 等内部键。
@@ -22,10 +18,16 @@

 修复 Preview mirror 在 production 与 `main` schema 处于 N/N+1 时的兼容性，并为 `Refresh Preview Data` 提供可诊断且不泄漏敏感数据的失败日志。

+#### Immutable release retry operator identity
+
+收紧 immutable release retry 的 operator identity：手动重试只能从当前 main HEAD 发起，operator commit 必须具备 canonical main CI evidence，production migration 只消费 preflight 冻结的 operator SHA。
+
+### Added
+
+#### Demo Steam 身份复核
+
+管理员可在单场比赛工作台复核 `/3` Demo 中的 Steam 身份：确认后自动重检，其他问题仍会保留；无效或不应接收的 Demo 可拒绝。比赛中观察到的 Steam64 作为可审计的替代游戏身份保存，不修改当前登录或报名资料。
+
 #### 后台选手身份下钻

 统一后台选手身份下钻、联系方式操作，以及教育认证、队伍和最近活跃状态筛选。
-
-#### Immutable release retry operator identity
-
-收紧 immutable release retry 的 operator identity：手动重试只能从当前 main HEAD 发起，operator commit 必须具备 canonical main CI evidence，production migration 只消费 preflight 冻结的 operator SHA。
```

## v2.10.4

```diff
--- 原文
+++ 候选
@@ -10,6 +10,8 @@

 恢复 `/my/teams` 当前队伍成员的 QQ 与选手资料入口，并让队长在处理有效招募意向时看到对应选手的 QQ；公开选手、队伍和招募视图继续不暴露私有联系方式。

+### Changed
+
 #### Steam 官方资料与 Steam64 身份

 统一以 Steam64 保存当前 Steam 身份，Steam 昵称、头像和资料链接改由 Steam 官方资料缓存展示；Steam64 更换会保留可审计、可撤销的历史游戏身份。
```

## v2.9.2

```diff
--- 原文
+++ 候选
@@ -1,5 +1,6 @@

 ### Fixed
+
 #### 审计日志历史目标
-修复操作日志读取路径在解析已删除目标时丢失 tombstone 生命周期的问题，确保历史删除目标显示为“已删除 / 历史目标”。

+修复操作日志对已删除目标的解析，确保历史目标显示为“已删除 / 历史目标”。
```

## v2.7.5

```diff
--- 原文
+++ 候选
@@ -19,7 +19,7 @@

 组队报名与个人报名的首页展示和数据查询按报名模式严格分离；组队赛事不再消费个人位置容量。

-#### 组队报名 readiness contract
+#### 组队报名就绪条件

 组队报名草稿与正式提交共用 canonical readiness 判断，统一名单人数、成员确认、主力、资格、纪律处罚及队伍关系等阻塞条件。

@@ -27,7 +27,7 @@

 后台赛事时间展示统一回 Asia/Shanghai 时间 contract。

-#### Canonical 用户显示名
+#### 用户显示名

 Header 和管理员用户搜索统一使用 canonical 用户显示名规则，补齐 Perfect 昵称。

@@ -64,4 +64,3 @@
 #### 管理页面时间展示

 修复部分新增管理页面依赖浏览器或运行环境本地时区展示时间的问题。
-
```

## v2.7.0

```diff
--- 原文
+++ 候选
@@ -7,7 +7,6 @@

 管理员现在可以创建换算策略草稿，填写来源与变更说明，批准并切换当前版本，或退役不再使用的版本。赛事在注册开放后会继续引用已经冻结的策略版本与来源，避免全局策略更新重新解释已经开始运营的赛事。

-#### Canonical 用户身份与安全归并
+#### 用户身份与安全归并

 用户可以绑定额外的已验证邮箱；学校邮箱快速认证也可以使用该用户任一已验证邮箱。重复账号归并会先检查身份控制证明与事实冲突：保留账号的资料和竞技资料保持不变，已确认的个人事实与无冲突的赛事历史归到保留账号，并保留可追溯的归并记录。
-
```

## v2.6.1

```diff
--- 原文
+++ 候选
@@ -1,3 +1,4 @@

-v2.6.1 是 v2.6 后的维护版本，刷新认证、数据验证和部署相关依赖，完成运行时与开发工具链升级，并收口 pnpm 12 下的依赖更新自动化兼容策略。没有赛事规则或数据库 schema 变化。
+### Changed

+- 更新认证、数据验证与部署相关依赖及开发工具链；没有赛事规则或数据库结构变化。
```

## v2.5.0

```diff
--- 原文
+++ 候选
@@ -9,21 +9,11 @@

 报名开放时，赛事会同时冻结本届的竞技上下文、换算策略和最终选中的证据来源。后续的资格判断、种子建议、开赛检查与比赛运行时继续读取同一组冻结事实，避免用户之后更新个人资料、平台赛季变化或全局换算策略调整影响已经开始运营的赛事。

-5E 数据继续转换到 Perfect World 的统一比较尺度，并保留原始平台、原始段位与星数、换算版本和最终采用来源。外校参赛限制也统一使用 Perfect 等效的历史最高竞技事实进行判断。
+5E 数据继续转换到 Perfect World 的统一比较尺度，并保留原始平台、原始段位与星数、换算版本和最终采用来源。外校参赛限制也统一使用 Perfect 等效的历史最高竞技事实进行判断；已经冻结的历史赛事不受后续策略变化影响。

-#### Tactical Grid UI 基础设施
+#### 页面布局与交互

-全站 UI 基础 contract 进一步收口。语义色彩、Card / Panel、页面标题、正文与辅助信息层级、页面宽度、响应式布局以及 Dialog 交互现在使用统一规则。
-
-Panel 的外层 surface 与内容布局职责已经分开，页面标题使用明确的语义结构；普通内容页、管理页面和高密度工作台可以根据任务选择对应的布局宽度。Dialog 统一处理移动端 viewport、内容滚动、焦点恢复和 reduced motion，减少不同页面自行实现交互细节造成的差异。
-
-横向内容的提示也会根据真实滚动位置动态显示。没有溢出时不再出现多余渐隐提示，到达内容边缘后对应方向的提示会自动消失。
-
-#### 视觉验证基线
-
-UI system 增加稳定的视觉验证 contract，并基于现有 Playwright 建立首批 deterministic screenshot baseline，覆盖典型移动端、桌面端和已登录页面状态。
-
-高密度数据页面同时统一了数字对齐、缺失值、局部横向滚动和移动端主信息可读性的设计原则。后续赛事、统计和管理页面可以直接沿用这些基础规则。
+统一页面宽度、信息层级和弹窗交互，改善移动端滚动、焦点恢复与减少动画偏好。横向内容仅在可滚动时显示对应方向的提示；高密度数据页面统一数字对齐、缺失值和窄屏浏览方式。

 ### Fixed

@@ -44,10 +34,3 @@
 #### 淘汰赛键盘操作

 公开淘汰赛 Bracket 中可进入的比赛节点现在支持键盘聚焦和 Enter 打开比赛详情，并提供明确的可访问链接名称，使键盘用户能够完成与鼠标一致的比赛浏览路径。
-
-### Reliability & Testing
-
-本版本为新的 UI foundation 增加组件级回归测试和 Playwright 视觉基线，并继续通过真实 PostgreSQL、Local Supabase、浏览器 E2E、静态检查与 production build 验证。
-
-Major 竞技证据仍沿用赛事冻结事实与既有 ConversionPolicy 体系，不修改已经冻结的历史赛事，也不会因为之后的全局策略变化重新解释既有比赛运行时。
-
```

## v2.4.0

```diff
--- 原文
+++ 候选
@@ -25,11 +25,10 @@

 管理端比赛页拆分为轻量赛事比赛总览与 `/admin/{seasonSlug}/matches/{matchId}` 单场工作台。总览聚焦阶段、积分、赛程和批量运营；实际首发、BP / 地图、结果、赛后资料、更正与恢复操作集中在单场上下文中，并继续复用既有 match、roster、audit 与 observability owner。

-### Reliability & Operations
+### Operations

 应用建立 server-side structured observability、OpenTelemetry tracing、统一错误分类与敏感字段治理，并接入 Better Stack Preview / Production 配置 contract。运行日志与业务审计保持独立；telemetry sink 失败不会成为核心业务失败原因。Better Stack 的真实 Production trace / alert acceptance 在本版本部署后继续按 #424 验收，不在 release note 中提前宣称完成。

 仓库发布模型已经收敛为 single-trunk + immutable tag：`main` 是持续可发布主干，只有 `vX.Y.Z` tag 触发受保护的生产 migration、verify、精确 Vercel Production 部署、smoke 与 GitHub Release。工程文档同时整理为按任务进入的 operations 指南。

 本版本包含两条新的 forward migration：`0039_clumsy_doctor_octopus` 增加赛事社区奖 capability，`0040_major_seed_recommendation_snapshot` 保存 Major 不可变种子建议快照与相关赛前状态。生产升级继续只通过 `v2.4.0` tag 触发标准 release workflow。
-
```

## v2.3.0

```diff
--- 原文
+++ 候选
@@ -23,6 +23,6 @@

 失效的 Team 分享邀请链接会显示明确业务状态，且不能再次被接受。重复 Team 邀请的数据库唯一约束错误也会被准确映射为业务提示，避免泄露底层查询异常或误报无关冲突。

-### Migration & Operations
+### Migration

 本版本包含三条 forward migration：`0036_auth_id_reconciliation`、`0037_match_score_semantics` 与 `0038_conversion_policies`。生产升级仍只通过 `v*` tag 触发标准 release workflow，依次执行 active migration replay、previous stable compatibility、production migrate/verify、精确版本 Vercel Production 部署与 smoke test。
```

## v2.2.4

```diff
--- 原文
+++ 候选
@@ -27,11 +27,10 @@

 应用拥有的 public 业务表统一收口为 server-only 访问模型：启用 RLS、撤销 anon/authenticated 的 Data API CRUD privileges，并移除没有正确客户端权限模型的业务表 Realtime 发布。选秀和投票等需要刷新体验的页面继续通过已有轮询路径更新，不通过放宽数据库权限来维持失效订阅。

-### Reliability & Migration
+### Migration

 发布链路新增 previous production stable → candidate schema 的 N/N+1 兼容性门禁，PR CI 与正式 release 会以真实 production stable lineage 为基线验证 active migration，而不是把候选分支上“可达的最新 tag”误当生产版本。数据库 migration risk 注释同时区分 contract cleanup 与 locking/rewrite review，类型错配或缺失会 fail closed。

-认证、报名等请求态工作区明确保持 request-bound，避免 Cache Components 对私有状态做错误的 instant-navigation 缓存判断；Major 报名 E2E 改为等待 canonical 页面状态，减少流式 RSC 瞬时探测竞态。资格判断也统一复用同一批预加载事实，避免报名审核与开赛冻结读取两套重叠资料。
+认证、报名等请求态工作区明确保持 request-bound，避免 Cache Components 对私有状态做错误的 instant-navigation 缓存判断。资格判断也统一复用同一批预加载事实，避免报名审核与开赛冻结读取两套重叠资料。

 本版本包含三条新的 forward migration：`0033_long_lived_map_preferences` 将地图熟练度沉淀为长期资料并回填既有报名数据；`0034_secure_public_tables` 收口现有 public 业务表的 RLS、Data API privileges 与 Realtime 边界；`0035_colorful_black_widow` 新增按 roster revision 绑定、可审计 grant/revoke 的资格限制解除 ledger。生产升级必须继续通过 `v*` tag 触发标准 release workflow，完成 active migration replay、production migrate/verify、精确版本 Vercel Production 部署与 smoke test。
-
```

## v2.2.3

```diff
--- 原文
+++ 候选
@@ -25,7 +25,6 @@

 修复赛事首页“队伍阵容”仍指向已退役 `/competitionEntries` 路由导致的生产 404，入口现在统一进入 canonical `/{seasonSlug}/teams` 页面。

-### Migration & Operations
+### Operations

 本版本不包含新的数据库 schema migration。教育认证凭证清理由现有受保护 Cron 运行体系执行；生产发布仍通过 `v*` tag 触发标准 release workflow，完成数据库校验、精确版本 Vercel Production 部署与 smoke test。
-
```

## v2.2.2

```diff
--- 原文
+++ 候选
@@ -17,11 +17,10 @@

 修复选秀最后一轮因无可选选手而由管理员跳过时的完成收尾。异常恢复现在与正常选秀完成共用同一收尾逻辑，正式赛事名单会正确冻结并记录为已确认。

-### Migration & Operations
+### Operations

 #### 发布、staging 与定时任务

 生产部署继续只通过正式 release workflow 执行，普通 `main` 更新不再产生无效的 Vercel Production 自动部署。新增受控的手动 staging migration / verify 工作流；多个 Cron 任务改为独立执行和重试，单个任务失败不会阻止其它定时任务运行，同时最终失败仍会明确使对应 workflow 失败。

 本版本不包含新的数据库 schema migration；生产发布仍应通过 `v*` tag 触发的标准 release workflow 完成数据库校验、精确版本部署与 smoke test。
-
```

## v2.2.0

```diff
--- 原文
+++ 候选
@@ -53,7 +53,7 @@

 收紧 Perfect World 与 5E fallback 的比较边界，避免缺失映射、跨平台 Rating 或后续目录变化改变赛事既有竞技资格含义。

-### Migration & Operations
+### Migration

 本版本包含 `0032_competitive_fact_states` 数据库迁移，为长期竞技事实增加明确的 ranked / unranked 状态以及历史最高达成赛季来源，并通过数据库约束限制不合法的事实组合。已有竞技事实会保持 ranked 语义，无需人工重录。

@@ -62,4 +62,3 @@
 CI 验证现在按变更实际需要拆分静态检查、真实 PostgreSQL、真实 Supabase 服务和浏览器端验证；受保护分支与正式发布路径仍执行完整验证。

 生产升级仍必须通过 RivalHub 标准 release workflow 执行 active Drizzle migration chain、生产数据库校验、精确版本 Vercel Production 部署和 smoke test。不要使用 `db:push` 或绕过 release gate 直接修改 production schema。
-
```

## v2.1.0

```diff
--- 原文
+++ 候选
@@ -76,9 +76,8 @@

 - 社区奖、证据、解说和赛后报告继续由 server-only 数据库 owner 读写；public Data API 的 anon/authenticated 访问被明确拒绝。

-### Migration & Operations
+### Migration

 本版本包含新的 forward migrations，用于社区奖与赛后解说、组队大厅、赛事参与窗口、名单调整 revision 来源及其 server-only 数据库访问保护。

 生产环境继续通过 RivalHub release workflow 执行 active Drizzle migration chain、迁移校验、精确版本 Vercel Production 部署和 smoke test；不要使用 `db:push` 或绕过 release gate 直接修改 production schema。
-
```

## v2.0.2

```diff
--- 原文
+++ 候选
@@ -7,7 +7,6 @@

 - 公开玩家竞技档案改用长期竞技位置与平台目录展示位置、段位、赛季和星数，不再把赛事报名快照当作长期资料。

-### Migration & Operations
+### Operations

 - Production release 会在应用部署前执行 active Drizzle migration chain 并进行 exact verify；迁移或校验失败会中止新版本部署并保留上一版 production。
-
```

## v2.0.0

```diff
--- 原文
+++ 候选
@@ -60,15 +60,10 @@
 - Local Supabase 开发环境只允许 loopback 数据库目标；staging / remote database write 需要明确 target、目标确认与显式写入授权。
 - `pnpm db:push` 被禁止，所有数据库升级必须经过 active migrations；清理无实际 consumer 的 direct dependencies，并将仍需要的 security override 限定到明确依赖路径和退出条件。

-### Reliability & Testing
-
-测试体系采用分层 verification evidence：Vitest unit / domain tests、真实 PostgreSQL integration tests、migration replay、并发与 transaction regression、Playwright browser E2E、Local Supabase 完整验证，以及 production smoke / real-operation progressive validation。Coverage report 继续作为诊断工具，但不再作为全局百分比 merge gate；CI 同时验证 production build 与 Local Supabase / PostgreSQL / browser 流程。
-
-### Migration & Operations
+### Migration

 RivalHub 2.0 使用新的 active Drizzle migration chain，旧 migration history 保留为只读历史记录。升级和部署必须使用仓库提供的 migration workflow，不使用 `db:push`；远程数据库写入前先完成 Local 与 staging 验证，production 不运行 destructive rehearsal，staging 与 production 使用独立 Supabase project。数据库连接按 Supabase Transaction Pooler contract 配置。开发与 CI 基线为 Node.js 24 与 pnpm 10.34.5。

-### Compatibility / Scope
+### Compatibility

 RivalHub 2.0 当前正式内置 Rivals · Spring 与 Major · Autumn。Custom Competition 继续使用已经实现并注册的阶段执行能力；不支持的阶段会在发布时 fail closed。2.0 保留未来赛事与其他游戏继续演进所需的结构边界，但没有提前引入 `Game`、`GameAccount`、N-way Match、通用 workflow DSL 或 tournament plugin database 等尚无真实消费者的模型。
-
```

## v2.0.0-rc.4

```diff
--- 原文
+++ 候选
@@ -1,5 +1,4 @@

-### Patch Changes
+### Changed

-- b2b7ae4: Converge 2.0 competition templates, participant qualification context, and administrator lifecycle workflows.
-
+- 统一赛事模板、参赛资格上下文和管理员赛事生命周期工作流。
```

## v2.0.0-rc.3

```diff
--- 原文
+++ 候选
@@ -1,5 +1,4 @@

-### Patch Changes
+### Fixed

-- 收敛公开队长、选秀与比赛协商 DTO，修复登录态导航、登录回跳安全、历史赛季入口与隐私链接。
-
+- 修复登录态导航、登录回跳安全、历史赛季入口与隐私链接，并收紧公开队长、选秀与比赛协商的数据范围。
```

## v2.0.0-rc.2

```diff
--- 原文
+++ 候选
@@ -1,5 +1,8 @@

-### Patch Changes
+### Changed

-- 对齐生产 Supabase 强密码策略，增加注册和重置密码确认，刷新失败的一次性 Turnstile 校验，并避免吞掉密码重置发信错误。
+- 对齐密码强度策略，并在注册和重置密码时增加确认。

+### Fixed
+
+- 认证失败后刷新已消耗的 Turnstile 验证，并在不泄露账号状态的前提下提示密码重置发信错误；未登录的后台请求会正确跳转。
```

## v2.0.0-rc.1

```diff
--- 原文
+++ 候选
@@ -1,5 +1,4 @@

-### Patch Changes
+### Changed

-- 明确 legacy Root 管理员登录入口与标准 owner email bootstrap 的边界。
-
+- 明确旧版 Root 管理员登录入口与标准 owner 邮箱初始化的边界。
```

## v2.0.0-rc.0

```diff
--- 原文
+++ 候选
@@ -1,10 +1,8 @@

-### Major Changes
+### Added

-- RivalHub 2.0 RC：引入 capability 驱动的 Major 赛事运营闭环，并收拢正式 production cutover 所需的 Auth、报名、赛程与数据完整性能力。
+- RivalHub 2.0 候选版引入 Major 赛事运营能力，并完善认证、报名、赛程与数据完整性。
+- 新增隔离旧远程数据库配置的本地 Supabase 开发入口，并验证迁移、认证、存储与数据 API 默认拒绝策略。

-### Patch Changes
-
-- dabc985: 新增 fail-closed 的 Local Supabase 开发入口，隔离旧远程数据库配置并验证 Drizzle migration、Auth、Storage 与 Data API 默认拒绝策略。
-- ed1f9cb: Team 报名与含 Swiss 赛季在完整运营闭环落地前保持 fail closed，避免误用个人报名和自动状态迁移。
-
+### Changed
+- 队伍报名与含 Swiss 阶段的赛季在完整运营闭环落地前保持关闭，避免误用个人报名和自动状态迁移。
```

## v1.30.1

```diff
--- 原文
+++ 候选
@@ -1,6 +1,4 @@

 ### Fixed

-- 排行榜和个人页面因 OCR+Demo 双录导致的 maps 数双倍计数，过滤 `source=manual_ocr`
-- 队伍页面选手 maps 数双倍计数（同图 OCR+Demo 双录），补充 `source=manual_ocr` 过滤，与排行榜/个人页对齐
-
+- 修复排行榜、个人页和队伍页因 OCR 与 Demo 双录导致的地图数重复统计。
```

## v1.26.1

```diff
--- 原文
+++ 候选
@@ -1,19 +1,12 @@
+
+现存 `v1.26.1` 标签指向 1.30.1 的提交；本条比较链接使用当时的 1.26.1 版本提交。

 ### Added

-- **HLTV Rating 2.0 计算模块**：新建 `lib/demo/hltv-rating.ts`，基于社区逆向公式（R²≈0.995）从 demo 指标实时计算 rating，导入时自动回填 `ratingPro` 字段
-- **AdminMatchRow 反向入口**：已完成图旁加「导入 Demo →」跳转链接，与独立 demos 管理页双向导航
+- Demo 导入时使用基于社区逆向公式的 HLTV Rating 2.0 估算，并回填 Rating Pro；后台比赛行增加 Demo 导入入口。

 ### Fixed

-- **契约 E 通路**：主榜（`stats/page.tsx`）和六维图（`hexagon.ts`）查询改为按 `active_stat_source` 区分数据来源，防止同一张图 OCR/demo 行双重计入；历史纯 OCR 图自动 fallback 不受影响
-- **demo-import 回填补全**：backfill 到 `matchPlayerStats` 补充 `verifiedByAdmin` 和 `ratingPro`（HLTV 2.0 补算）；`onConflictDoUpdate` 同步更新；清理 13 处冗余 `JSON.parse(JSON.stringify(...))`
-- **revalidatePath 路径修复**：修复导入后刷新路径 `/admin/matches/${matchId}` 不存在，改为正确的 `/admin/${slug}/demos` 和 `/${slug}/matches/${matchId}`
-- **真实回合数分母**：`season-demo-stats` FKPR 由硬编码 `maps × 24` 改为 JOIN `demo_rounds` 统计真实回合数；`player-demo-stats` 同步修复 `mapRounds` 假分母（`PlayerStatRow` 加 `rounds?` 字段，向后兼容）
-- **multiKills 口径统一**：`to-match-player-stats` 补入 `twoKillCount`，统一为 2K 及以上（2+3+4+5）
-- **team-demo-stats 多处错误**：补 `"use server"`；成员查询改用 Drizzle ORM；eco 查询修复列名 `di.active_stat_source` → `mm.active_stat_source`；经济转化率按 teamId 过滤并区分主客队；整体包裹 `ok()/fail()`
-- **六维图权重重归一化**：无 demo 数据时 demo-only 子指标权重自动重分配到同维度 OCR 指标；demo 维度 mean/std 仅从有 demo 数据的选手计算；30 场纯 OCR 比赛分数与修复前完全一致
-- **demos 页「已导入」badge**：修复 `inArray(demoImports.mapId, matchIds)` 错误用 matchId 查 mapId，改用正确的 mapId 集合
-- **UI 色彩合规**：13 个 demo/队伍组件硬编码 Tailwind 调色板全换 CSS 变量；`EconomyConversionPanel` 移除多余 `"use client"` 并补空态；`PlayerUtilityStats` 空态改为提示文字；`HighlightLeaderboard` emoji 加 `aria-hidden`
-- **player-demo-stats 清理**：删除 `mapCount` 死代码
-
+- 修复 OCR 与 Demo 双来源重复计入，保留历史纯 OCR 数据；导入后正确回填认证状态与评分并刷新相关页面。
+- 首杀率改用真实回合数，多杀统计计入 2K；修复队伍经济转化率的队伍归属和统计读取。
+- 无 Demo 数据时重新分配六维评分权重；修复 Demo 管理页已导入状态和空数据提示。
```

## v1.30.0

```diff
--- 原文
+++ 候选
@@ -2,16 +2,17 @@
 > **1.x 收官版本**：移除 Demo 导入相关全部功能，回归无-demo 形态（整体基于 `v1.25.6`）。Demo 体系转入 2.0.0 开发线（`release/2.0.0` 分支）继续。生产数据库中 demo 相关表（`stat_source` / `demo_import_tables` / `active_stat_source`）保留空置、不删除。

 ### Removed
+
 - **Demo 导入与解析**：移除 demo 导出包导入、批量 ZIP 导入、demo 明细数据写入与重算
 - **Demo 数据面板高级模块**：击杀热力图、武器使用细分、经济转化图、Entry 逐回合、残局列表、击杀 feed、回合时间线
 - **评分体系 demo 维度**：RR / PRISM 八维能力雷达、队伍风格画像、T-CT 半场胜率、选手 Demo 进阶卡片
 - **外部依赖**：`@cs2dak/core`、`@rivalhub/rival-rating`、`cs2-demo-format`、`jszip`

 ### Fixed
+
 - **整场汇总排序**：比赛「整场汇总」选手列表改为按 Rating 降序、空值排末尾（此前靠上游 SQL 顺序兜底，是 v1.25.6 即存在的潜伏 bug）
 - **逐图录入完赛后赛季未自动结束**：`recordMapResult` 在系列赛打完时补调 `maybeFinishSeason`，与 `recordMatchResult` 对齐（修复赛季卡在 `playing` 的根因）

 ### Changed
-- **发版流程引入 changeset**：版本号与 CHANGELOG 改由 `@changesets/cli` 管理，`release.yml` 兼容 `## [ver]` 与 `## ver` 两种标题。详见 `.claude/skills/release.md`
+
 - 比赛页保留 `error.tsx` / `loading.tsx` 错误与加载边界（v1.25.6 之后引入的独立健壮性改进）
-
```

## v1.28.0

```diff
--- 原文
+++ 候选
@@ -1,23 +1,20 @@

 ### Added
+
 - **比赛页赛前情报**：赛季风格对比 + 双队同图能力雷达（八维 PRISM / 六维回退）
 - **队伍页赛季风格分析**：T/CT 半场胜率 + 风格画像 + 经济转化率
 - **队伍能力图升级**：`TeamRadarPanel` Tab 切换六维 / PRISM 八维
 - **选手页 Demo 进阶卡片**：`PlayerDemoCard`（KAST/ADR/Entry/残局 + 武器 + 多杀 + 高光）
 - **Stats 武器榜重设计**：拆为 AWP 狙击榜 + 武器使用画像
-- **共享工具函数**：`buildPrismScores` / `averagePrismScores`（match/team/player 复用）

 ### Changed
-- **全量颜色规范化**：硬编码 `rgba()` → `color-mix()`，23 文件
-- **OCR 回退去重**：`ocrFallbackCte` / `getOcrAveragesBySeason` 三页面共用
-- **经济标签统一**：`economyLabelCn` + `ECONOMY_TYPES` 公开导出
-- **武器名去重**：`weaponFullName` 导出，消除 3 处内联映射
+
 - **经济图例重构**：SVG → HTML（完整 5 种类型 + 半区说明）
 - **Entry 面板重构**：全员排行 + 选手下钻逐回合明细
 - **热力图守卫**：全零坐标时显示空态而非误导红圈

 ### Fixed
+
 - **队伍 Rating Pro = 0.0**：demo 源 NULL 时 COALESCE OCR 源回填
 - **赛前首杀/残局为空**：Drizzle enum 类型转换改用 raw SQL
 - **M4A1 武器名**：`m4a1_silencer` 映射修正为 "M4A1-S"
-
```

## v1.27.6

```diff
--- 原文
+++ 候选
@@ -1,8 +1,4 @@

 ### Fixed
+
 - **Stats 页 GROUP BY SQL 错误**：OCR fallback CTE 引用 `ocr.avg_rating_ocr` 未用聚合函数包裹，PostgreSQL 拒绝运行；改用 `min()` 包裹解决
-- **CI 测试失败**：PlayerStatsTable 测试 mock 补全 `statSourceEnum`、`matchMaps` 和 `db.query.matchMaps`
-
-### Added
-- **weapon-names 别名映射测试**：新增 `src/lib/demo/weapon-names.test.ts` 覆盖 13 个映射和 fallthrough 场景
-
```

## v1.27.5

```diff
--- 原文
+++ 候选
@@ -1,5 +1,6 @@

 ### Added
+
 - **赛后详情页布局重构**：将 Demo 面板从地图 Tab 内抽取到 MVP 下方独立区域，自带地图切换 Tab，用户无需展开地图即可查看 Demo 数据
 - **多账号 Steam ID 别名绑定系统**：新增 `user_steam_aliases` 表，管理员可在 Demos 页面直接绑定未关联用户的 Steam ID 至注册选手，自动回填历史数据
 - **Demo 排行榜差分指标**：新增 Entry%（首杀胜率）和 AWP%（AWP 击杀占比）列；残局胜率改为 1v1% 更有实际意义
@@ -12,20 +13,18 @@
 - **PlayerWeaponBreakdown 击杀条**：新增进度条可视化，直观显示武器击杀分布

 ### Changed
+
 - **DemoPlayerStatsTable 上下排列**：A/B 队从左右并排改为上下布局，列数不受限
 - **隐藏 Demo 空列**：Utility(Plant/Defuse)、Entry/Trade(Trade K/D)、Highlight(Wallbang 等)全空时自动隐藏
 - **Demo 面板 UI 优化**：Kill Feed 卡片式 + 限高滚动、武器别名、PlayerEntryStats 汇总卡片

 ### Fixed
+
 - **PRISM 狙击维度畸变**：无狙击信号选手直接置 0（非百分位排名）；全等值返回 50
 - **Stats 页默认排序**：`ratingPro`(全 null) → `RR`
 - **选手主页 RWS/WE/ratingPro 归零**：OCR 专属查询回填，Demo 图不影响
-- **KAST 数据翻倍(**×100)**：修复聚合层多余的乘法
-- **HS 爆头数→爆头率(%)**：语义更正
+- **KAST 数据翻倍**：修复聚合层多余的乘法
+- **HS 爆头数 → 爆头率(%)**：语义更正
 - **选手列表双行**：PlayerStatsTable 补充 `source` 过滤
 - **Kill Feed 布局**：改为卡片+限高滚动
 - **toolkit 图标误用**：移除 🔧 emoji
-
-### Fixed
-- **批量导入 OCR 确认弹窗阻塞**：每张已有 OCR 数据的图导入前都会返回 OCR 确认提示，批量导入模式下 24 个文件因此静默失败；改为自动传入 `confirmOverwriteOcr: true`，跳过逐条确认弹窗（OCR 数据保留不删除，只是 `active_stat_source` 切到 demo）
-
```

## v1.26.2

```diff
--- 原文
+++ 候选
@@ -1,6 +1,8 @@

 ### Fixed
+
 - **Stats 页面 500 错误**：修复 `season-demo-stats.ts` 中 4 个函数对 `db.execute()` 返回结果未解构 `rows`，直接调用 `.map()` 报 `(intermediate value).map is not a function`
 - **Demo 导入页面 BO1 不显示**：移除 `isNotNull(matchMaps.scoreA)` 过滤，使排位赛阶段 BP 产出的无比分地图记录也能展示
-- **公开页面移除 OCR/Demo 导入**：从比赛详情页移除管理员可见的 OCR/Demo 导入面板，统一放在后台比赛管理行（AdminMatchRow 直接嵌入 DemoImportPanel）
+### Changed

+- OCR 与 Demo 导入从公开比赛详情移至后台比赛管理。
```

## v1.26.0

```diff
--- 原文
+++ 候选
@@ -1,63 +1,17 @@

 ### Added
-- **集成测试覆盖**：新增 `tests/integration/db/demo-pipeline.test.ts`（12 tests），使用真实 example zip 驱动 parseDemoPackage→schema 验证→toMatchPlayerStat 转换→batchInsert 分片逻辑全管道验证
+
+- 新增 Demo 导入、校验与数据回填，支持按导入批次追踪明细。
+- 新增选手数据、回合时间线、击杀记录、经济曲线、残局、热力图及武器、首杀、道具统计；队伍页展示半场胜率和风格，赛季数据页增加武器榜。
+- 增加系统推荐 MVP，OCR 面板按赛季配置显示录入字段。

 ### Fixed
-- **依赖安全升级**：next@15.5.15→15.5.18（修复 4 个高严重性 CVE，含 Middleware 绕过、DoS、缓存投毒、RSC 破坏）；drizzle-orm@0.43.1→0.45.2（修复 SQL 注入漏洞）
-- **CSS 变量补充**：新增 5 个缺失的 CSS 变量 — `bg-mid`/`bg-secondary`/`border-subtle`/`fg-muted`/`surface-raised`，修复暗色模式下 Demo 模块渲染异常
-- **a11y 键盘可访问性**：`DemoHeatmap` 模式切换按钮组添加 `role=radio`/`aria-checked`/`onKeyDown` 键盘支持
-- **DemoEconomyChart 渲染精度**：最后一个柱状图宽度改用等比例 `xScale` 间隔而非 `CHART_W / series.length`
-- **match 详情页错误边界**：新增 `loading.tsx`（骨架屏）和 `error.tsx`（重试按钮），修复慢网络/后端错误时空白页问题
-- **空 Demo 数据引导**：根据 `isSeasonAdmin` 显示差异提示（管理员→「请在上方导入 Demo」/ 普通用户→「可联系管理员导入」）
-- **契约 E 修复**：player-demo-stats 查询补充 `activeStatSource` 过滤条件
-- **getDemoDetail 错误处理**：改用已注册的错误码 `ErrorCode.INTERNAL_ERROR`，统一错误响应格式
+
+- 修复暗色模式下 Demo 模块显示异常，支持键盘切换热力图模式，并改善经济图、空数据提示和英文标签。
+- 比赛详情在加载和出错时显示骨架屏或重试入口。
+- 修复 Demo 与 OCR 数据来源过滤及回填，避免重复统计、误删或空导入改变数据来源；改善大批量导入和并发保存。
+- 修正首杀率、武器爆头率、道具伤害和队伍经济统计，并避免武器统计遗漏击杀。

 ### Security
-- 依赖安全审计：漏洞总数 19→5（高严重性 8→0），5 个中等严重性均为间接依赖 uuid@9.0.1 通过 brackets-manager 引入，等待上游修复

-### Added
-- **Demo 导入体系**：完整的 demo 导入、校验、解包、数据回填流程（Zod schema + Server Action + ZIP 解包校验）
-- **Demo 明细数据查询**：14 张明细表 schema 定义 + 查询层，支持导入批次追踪
-- **Demo 数据展示面板**：
-  - `DemoPlayerStatsTable` — 选手 demo 数据汇总表
-  - `DemoRoundTimeline` — 回合时间线展示
-  - `DemoKillFeed` — 击杀 Feed 时间线
-  - `DemoEconomyChart` — 经济曲线（含经济类型背景色块）
-  - `DemoClutchList` — 残局复盘列表
-  - `PlayerKillHeatmap` — 击杀热力图（含地图坐标变换）
-  - `PlayerWeaponBreakdown` — 选手武器偏好与命中率
-  - `PlayerEntryStats` — 首杀倾向分析
-  - `PlayerClutchStats` — 残局能力统计
-  - `PlayerUtilityStats` — 道具效用统计
-  - `EconomyConversionPanel` — 经济转化率
-- **队伍 Demo 分析**：`TeamHalfSideStats`（T/CT 半场胜率）、`TeamStyleProfile`（队伍风格画像）
-- **赛季 Demo Leaderboard**：`WeaponLeaderboard` + `season-demo-stats` 聚合层
-- **MVP 系统**：系统推荐 MVP 纯函数、按赛季 rankMetric 排序、StatProfile 类型体系
-- **OCR 面板**：按赛季 inputFields 动态渲染列
-
-### Fixed
-- **Hive 分支合并修复**：`team-demo-stats` 列名修正（clutchWinCount→vsXxxWonCount）、Panel `title`→`label` 统一、`activeStatSource` 查询路径修复
-- **首次击杀率计算修复**：`firstKillRate` 分母从 `totalClutchPlayed` 改为 `totalFirstKills + totalFirstDeaths`
-- **WeaponKillRow 重复声明合并**：`season-demo-stats.ts` 同名 interface 修复
-- **WeaponLeaderboard**：`hsPercent` 排序改用 `getSortValue` 函数 + `Panel label` 修复
-- **PlayerUtilityStats**：类型修复 + `avgUtilityDamagePerRound` 列名修正
-- **UI 一致性**：所有英文标签统一规范
-- **空数据兜底**：各组件均含 `null`/空数组保护
-- **PG 参数溢出**：批量 insert 改为 `batchInsert()` 分块插入，防止 18k+ rows 触发 PG `max_parameters=65535` 限制
-- **batchInsert 安全上限**：chunk size 从 3000 降为 1000，修复 25 列表 3000 行/批时 75000 params 溢出
-- **并发安全**：`matchPlayerStats` 回填从 `DELETE+INSERT` 改为 `ON CONFLICT DO UPDATE` 消除幽灵删除竞争
-- **契约 E 违反**：`savePlayerStats` delete 改为仅清 `source=manual_ocr`，保护 `demo_import` 来源
-- **空导入 activeStatSource**：仅 `stats.length > 0` 时设置 `activeStatSource=demo_import`
-- **getDemoDetail try/catch**：8 路并行 `Promise.all` 增加错误兜底
-- **season-demo-stats 重复字段**：`DemoLeaderboardData` 去掉 `clutchWinRateVal`/`utilityPerRound` 冗余
-- **season-demo-stats INNER JOIN**：`getSeasonWeaponStats` 改为 `LEFT JOIN` 防止丢击杀
-- **demo 表缺索引**：14 张表新增 `(importBatchId, mapId)` 复合索引
-- **空热力图 UX**：`DemoHeatmap` 无数据时显示占位文本
-- **CSS 变量补充**：添加缺失的 `--color-bg-subtle` CSS 变量
-- **样式主题一致性**：`DemoImportPanel` 按钮样式统一
-- **WeaponLeaderboard**：补回 `"use client"` 声明
-- **未使用导入删除**：移除未使用的 `DemoHeatmap` 导入
-
-### Changed
-- **README 更新**：新增 Demo 模块功能描述与技术栈说明
-
+- 更新 Next.js 15.5.18 与 Drizzle ORM 0.45.2，修复中间件绕过、拒绝服务、缓存投毒、RSC 缓存和 SQL 注入问题。当时依赖审计从 19 项降至 5 项，高危从 8 项降至零；剩余五项为 brackets-manager 引入的 uuid 间接依赖中危漏洞，等待上游修复。
```

## v1.25.2

```diff
--- 原文
+++ 候选
@@ -1,14 +1,14 @@

 ### Added
+
 - **BO1 启用整场汇总**：已结束的 BO1 比赛现在也显示整场汇总 Tab，与其他赛制一致

 ### Changed
+
 - **单图数据列扩展为完整 10 列**：PlayerStatsTable 从旧 6 列（选手/K/D/A/ADR/Rating）扩展为完整 10 列（图数/Rating/ADR/K/D/A/HS%/FK/残局），复用 MatchSummaryStats 组件

 ### Fixed
+
 - **BP pick 选边改为对手视角**：A pick 图 → B 选边（而非 A 选边），匹配 CS2 标准 BP 流程
 - **BP decider 支持选边方及 side 录入**：图三现在可以指定哪支队选边及选哪边，公开页面正确显示起始边
-- **移除 SideSelect 重复代码**：pick 与 decider 的 side 选择器提取为共用组件
-- **移除 PlayerStatsTable 闲置 matchId 参数**：重构后不再需要内部查询 matches 表
 - **选边 "自动" → "未选择"**：避免误导（不存在自动逻辑）
-
```

## v1.24.0

```diff
--- 原文
+++ 候选
@@ -1,12 +1,13 @@

 ### Added
+
 - **排行榜按赛季阶段筛选**：数据统计页新增 Stage 筛选 Tab，多阶段赛季可按阶段查看选手数据

 ### Changed
+
 - **去除最少 3 图门槛**：排行榜不再过滤低图数选手，全量展示
-- **统一数据计算模块**：新建 `src/lib/stats/` 作为全项目统计聚合入口，替换全项目散落的计算逻辑

 ### Fixed
+
 - **ADR 改为回合加权平均**：修复各页面对 ADR 使用简单平均（mean of means）导致的统计偏差
 - **HS% 改为击杀数加权平均**：修复多图统计时 HS% 计算偏差
-
```

## v1.23.0

```diff
--- 原文
+++ 候选
@@ -1,10 +1,11 @@

 ### Added
-- **弃赛系统**：新增 `forfeitMatch` action，管理员可在赛程页对 scheduled / in_progress 比赛判负弃赛；弃赛方选择后按格式写入标准比分（BO1 13:0 / BO3 2:0 / BO5 3:0）并推进 bracket；`MatchStatusBadge` 弃赛场次显示"弃赛"而非"已结束"；`matches` 表新增 `is_forfeit` 列（需执行 `pnpm db:push`）
+
+- **弃赛系统**：新增 `forfeitMatch` action，管理员可在赛程页对 scheduled / in_progress 比赛判负弃赛；弃赛方选择后按格式写入标准比分（BO1 13:0 / BO3 2:0 / BO5 3:0）并推进 bracket；`MatchStatusBadge` 弃赛场次显示"弃赛"而非"已结束"；新增弃赛记录字段
 - **逐图比分修正**：新增 `correctMapScore` action，赛后可修改已录入的单图回合数，大比分自动重算；后台赛程页有逐图记录时以逐图修改入口替换旧的直接改大比分入口

 ### Changed
+
 - **逐图录入绑定 format**：`MapByMapInput` 改为在 BO3 / BO5 格式比赛进行时展示，不再限于淘汰赛阶段
 - **MapByMapInput UX**：BP 已记录选边时不再重复展示选边下拉框；比分输入框上方新增队伍名标签；决胜图选边标签统一为"{队伍名} 起始边"
 - **图三 OCR 过滤**：BO3 系列赛 2:0 结束后，BP 预占的第三图占位行不再出现在 OCR 录入面板
-
```

## v1.20.5

```diff
--- 原文
+++ 候选
@@ -1,5 +1,4 @@

 ### Fixed
+
 - **DB Pool 重建后重试查询**：连接失败重建 Pool 后自动重试当次查询，并发重建合并去重，避免冷启动首请求 Load failed
-- **CI type-check**：修复 Proxy 类型循环引用与 `pool.query` 重载签名不兼容，确保无增量缓存 CI 环境通过
-
```

## v1.20.3

```diff
--- 原文
+++ 候选
@@ -1,10 +1,4 @@

 ### Changed
-- **项目文档瘦身**：重写 README 为长期维护入口，新增 `docs/README.md` 与 `docs/code-map.md`，将历史设计交付物和过程材料归档到 `docs/archive/`
-- **大文件拆分**：拆分比赛详情页、首页与报名表单的大块展示组件，提取比赛详情、赛果、阵容与时间协商相关纯规则
-- **工程手册同步**：更新 CLAUDE.md / AGENTS.md 组件清单与发布约束，扩展组件清单校验脚本覆盖首页组件

-### Added
-- **关键规则测试**：补充比赛详情统计、赛果规则、首页导航规则与报名表单工具测试
-- **TODO 测试清理**：将 roster、scheduling、round-robin 中的测试 TODO 替换为可执行测试
-
+- 整理项目文档，拆分首页、比赛详情和报名表单，并补充关键规则测试。
```

## v1.20.2

```diff
--- 原文
+++ 候选
@@ -1,5 +1,8 @@

 ### Fixed
-- **队伍详情页选手行移动端布局**：手机端选手行改为竖排，数据行加 flex-wrap 窄屏自动折行，地图芯片与位置标签手机横排
-- **Vercel Speed Insights**：引入 `@vercel/speed-insights` 性能监控

+- 修复队伍详情页选手行在手机上的布局，数据可在窄屏自动换行。
+
+### Added
+
+- 接入 Vercel Speed Insights 性能监测。
```

## v1.19.0

```diff
--- 原文
+++ 候选
@@ -1,28 +1,20 @@

 ### Added
-- **六维雷达图系统（Hexagon）**：基于赛季赛事统计的 Z-score 标准化，计算六维能力评分（火力/破局/多杀/残局/协同/稳定），含完整单元测试（265 行）
-- **PlayerRadarChart 组件**：SVG 六边形雷达图，支持多人叠加对比、轴标签、单人数值标注及图例
-- **选手个人页六维卡片**：跨赛季六维能力展示
-- **队伍详情页六维对比**：队内所有成员六维雷达图叠加对比
-- **比赛详情页六维对比**：双方出场阵容六维能力雷达图（新增至赛后数据面板）
-- **排行榜六维综合评分列**：StatsLeaderboard 新增六维综合评分排序
+
+- 基于赛季统计新增火力、破局、多杀、残局、协同和稳定六维评分；个人页展示跨赛季能力，队伍和比赛页支持多人对比，排行榜可按综合评分排序。
 - **Cloudflare Turnstile 验证码**：注册页集成，`appearance=interaction-only` 仅在需要时触发验证挑战，服务端强制校验
 - **忘记密码 / 重置密码页**：`/forgot-password`、`/reset-password` 完整流程
 - **BP 赛后补录**：`finished` 比赛在管理后台"数据录入"区新增「录入 BP」入口；无 match_maps 记录时自动建立，解锁 OCR 面板

 ### Changed
+
 - **BP 流程强制顺序**：`in_progress` 状态下，`recordMatchResult`（非淘汰赛）和 `recordMapResult`（淘汰赛逐图）均强制校验 BP 已存在，否则拒绝录分
 - **BO3/BO5 逐图录入重构**：BP 保存后自动创建 match_maps 预占行；`recordMapResult` 改为 UPDATE 预占行填入比分（不再 INSERT），彻底消除"地图已存在"冲突
 - **MapByMapInput BP 引导模式**：有 BP 预占序列时，地图名和 pick 方只读展示，管理员只需填起始边和回合数
 - **VetoInputDialog 交互优化**：队伍选择改为 A / B 切换按钮（告别每步下拉菜单）；finished 状态下显示赛后补录提示条
+- 比赛、队伍及选手页面并行读取六维数据，减少串行等待。

 ### Fixed
+
 - **MVP 投票 createdAt 空值**：`createdAt` 为 null 时不再静默放行，明确返回"账号状态异常"错误
 - **Turnstile siteKey 缺失提示**：环境变量未配置时给出明确错误，不再静默失败
-
-### Refactored
-- **PlayerRadarChart 颜色预解析**：颜色计算从多边形渲染和图例中提取到一次 map，消除重复推导
-- **hexagon.ts n=0 判断提升**：将空数组检查提至统计循环外，避免无效迭代
-- **TurnstileWidget URL 提取**：重复脚本 URL 提取为常量
-- **比赛/队伍/选手页并发优化**：`getSeasonHexagonScores` 加入 Phase 3 `Promise.all`，消除串行等待
-
```

## v1.18.1

```diff
--- 原文
+++ 候选
@@ -1,16 +1,14 @@

 ### Fixed
+
 - **数据统计 KPR 修正**：从场均击杀 `sum(kills)/count(maps)` 改为每回合击杀 `sum(kills)/sum(rounds)`，与 CS2 标准 KPR 口径一致
 - **ADR / HS% 加权平均**：从简单 `avg()` 改为回合加权 `sum(metric × rounds)/sum(rounds)`，消除不同图回合数差异导致的偏差
 - **首杀 / 残局改每回合**：标签 "首杀/图"→"FKPR"、"残局/图"→"CPR"，计算从 `sum/count(maps)` 改为 `sum/sum(rounds)`
 - **阵容对比 FK 一致化**：`buildLineupsPlayers` 的 FK 同步改为 FKPR（每回合首杀），标签统一为 "FKPR"
-- **雷达图颜色解耦**：`MapPoolRadarChart` 硬编码 hex 替换为 `--color-accent` / `--color-accent-b` CSS 设计 token
 - **赛后内容隐藏**：比赛结束后隐藏赛季综合对比、地图池雷达图、历史交锋、阵容对比、赛前名单段落
 - **雷达图图例**：从 SVG 内移到卡片底部 HTML 布局，纵向排列不再重合
-- **MVP 次数口径**：从总票数修正为单场获奖次数，增加持久化缓存

 ### Changed
-- **SQL 聚合提取**：stats 页 `weightedAvg(col)` / `perRoundRate(col)` 两个 helper，sortColumn 和 SELECT 共用单一定义
+
 - **排序默认值统一**：无数据项 `ELSE NULL`（排到末尾），不再用 `ELSE 0`（会与 0 值混淆）
 - **BO1/BO3/BO5 回合数兼容**：`COALESCE(mm.score_a + mm.score_b, m.score_a + m.score_b)`，map 级比分优先，BO1 fallback 到 match 级
-
```

## v1.18.0

```diff
--- 原文
+++ 候选
@@ -1,5 +1,6 @@

 ### Added
+
 - **比赛详情页 — 赛季综合对比**：Hero 下方显示双方赛季战绩（胜负/胜率/Rating/ADR/K/D），较高值高亮标记
 - **比赛详情页 — 地图池雷达图**：纯 SVG 七边形雷达图，Win%/Pick%/Ban% 三态切换，同轴对比两队数据
 - **比赛详情页 — 历史交锋**：显示两队赛季内交手记录（近 10 场），含胜负汇总和每场比分链接
@@ -7,22 +8,18 @@
 - **比赛详情页 — 整场汇总 Tab**：BO3/BO5 系列赛第一个 Tab，所有上场选手跨图聚合数据（K/D/A/HS%/Rating 等）
 - **比赛详情页 — 比赛时间显示**：Hero 下方显示赛前计划时间或赛后完成时间（CST 格式）
 - **管理端 — 完成时间编辑**：`updateMatchCompletedAt` Server Action，已结束比赛可在折叠区修改 `completed_at`（datetime-local 控件 + 清除按钮）
-- **设计 token — Accent B 族**：`--color-accent-b` / `-b-soft` / `-b-edge` / `-b-fg`，统一团队 B / 对比实体 accent 色

 ### Changed
+
 - **数据统计排行榜重构**：新增全部 10 种排序（Rating/ADR/K/D/KPR/HS%/WE/RWS/首杀/残局/场次），数据驱动 `ColDef[]` 表格渲染
 - **队伍详情页重构**：综合数据改为 2×4 网格（出场/胜/负/胜率 + Rating/ADR/K/D/WE）；阵容行内嵌选手赛季数据（地图数/Rating/ADR/K/D）；替补显示地图偏好；删除"位置最佳"区块；重排段落顺序
 - **MVP 投票布局**：候选卡片从 `grid-cols-2 sm:grid-cols-4` 改为固定 `grid-cols-2`（2×2 布局）
 - **MatchCard 风格**：从卡片网格改为行列表，增大垂直间距（`space-y-2` → `space-y-3`）
 - **BP 面板显示条件**：VetoView 仅在比赛开始后（非 scheduled）显示，赛前不展示空 BP 面板
+- 减少首发选手赛季数据的数据库查询。

 ### Fixed
+
 - **数据统计 SQL 口径**：`positionFilter` 改用原始字符串 `sr.primary_position`，修复 Drizzle schema 对象展开为表名与别名冲突
 - **K/D 计算**：从前端 `avg/avg` 改为 SQL 层 `sum(kills)/sum(deaths)`，修复统计口径
 - **`computeRecord` 平局逻辑**：平局不再误计为负（`else` → `else if`）
-
-### Refactored
-- **Pick/Ban 统计合并**：`getTeamPickStats` 和 `getTeamBanStats` 合并共享 `getTeamVetoActionStats` 实现（60 行重复 → 一行委托）
-- **DB 查询精简**：首发选手赛季数据从 `teamRawStats` 内存过滤，省 2 次 `matchPlayerStats` 查询；赛季比赛查询提取 `getSeasonFinishedMatches` 辅助
-- **硬编码颜色清零**：全站 30+ 处裸 hex 值替换为 CSS 变量（`StatusPill`/`StatusBanner`/`EmptyState`/`ErrorState`/`InlineConfirm` + 5 个新赛程组件）
-
```

## v1.17.0

```diff
--- 原文
+++ 候选
@@ -1,16 +1,13 @@

 ### Added
+
 - **比赛比分修正**：管理员可对已完成比赛进行比分修正（`correctMatchScore` Server Action），操作写入 audit log；仅修正数字，不影响胜负判定和 bracket 晋级结果
 - **数据录入校验**：玩家数据保存前校验数值范围（HS%/RWS 0–100、ADR 0–300、Rating 0.01–5.0；计数类字段仅校验非负），超范围格高亮为红色、阻止确认
 - **清除数据**：管理员可一键清除某张地图的所有玩家统计数据（InlineConfirm 二次确认，写 audit log）

 ### Fixed
+
 - **CS2 回合数合法性校验**：BO1 及 BO3/BO5 单图录入时，校验胜者回合数须满足 `13 + 3k`（13、16、19、22…），覆盖 MR12 正常局 + 任意轮加时，取代原来的硬编码数组
 - **赛后面板已完成比赛排序**：已完成比赛按 `completedAt` 降序排列，最近完成的显示最前
 - **「生成正赛」按钮误显**：`canGeneratePlayoff` 改为基于全量比赛数据判断，不再受界面筛选影响
 - **数据统计页崩溃**：`db.execute` 原始 SQL 返回 PostgreSQL `numeric` 为字符串，修正为显式 `Number()` 转换
-
-### Chore
-- 组件文件统一 PascalCase 命名（layout/ + rivalhub/ 共 21 个文件重命名）
-- `check-claude-md.sh` 改为以磁盘文件为真实来源，无需维护硬编码列表
-
```

## v1.16.1

```diff
--- 原文
+++ 候选
@@ -1,26 +1,14 @@

 ### Added
-- **选手名全站可点击**：队伍列表（TeamCard 首发/替补名）、队伍详情（阵容首发/替补/队内联系方式、每位置最佳）、比赛赛前名单（MatchRosterView 两队首发/替补）、比赛赛后数据表（PlayerStatsTable）、MVP 投票结果页，选手名均链接到 `/players/[userId]`
-- **比赛详情页队伍名可点击**：Hero 区双方队伍名链接到队伍详情页
-- **管理员下载队伍头像**：队伍详情页 Logo 下方显示「下载头像」按钮，仅 admin 可见且有 logo 时出现
-- `formatCSTDateTime()` 格式化函数（CST 月日+时间，如 "5月18日 19:30"）
+
+- 队伍、比赛和投票页面的选手名称可进入个人主页；比赛详情的队伍名称可进入队伍页。
+- 管理员可下载队伍头像。

 ### Changed
-- **比赛时间显示日期+具体时间**：MatchCard 和赛季首页 NEXT MATCHES 从仅日期（"5月18日"）改为日期+时间（"5月18日 19:30"）
-- **赛季子页面统一垂直间距**：4 个页面（赛季首页 / draft / captains / register）父容器改为 `space-y-*` 统一间距，消除各区块 ad-hoc `mb-*`/`mt-*`
-- **赛季首页 STANDINGS 视觉对齐**：右侧积分榜从裸 div 改为 `<Panel label="STANDINGS · TOP 4">` 包裹，与左侧 NEXT MATCHES 视觉对称
-- **StatsLeaderboard 筛选改用 `Btn` 组件**：排序 Tab 和位置筛选从手动 `<a>` 改为 `<Btn small ghost asChild>`，全站按钮风格统一
-- **3 组件 shadcn Card → rivalhub Panel**：MatchMvpVote / CaptainVotingPanel / StatsLeaderboard 统一使用 Panel 组件
-- **admin matches 页提取 `AdminMatchRow` 组件**：消除排位赛/正赛 ~200 行重复 JSX，净减 153 行；统一 VetoInputDialog 可见性（scheduled + in_progress 均显示）；清理 10+ 不再使用的 import
+
+- 赛程和赛季首页展示具体比赛时间，统一页面间距、积分榜和筛选控件样式。
+- 管理后台在待进行及进行中的比赛均提供 BP 录入入口。

 ### Fixed
-- `tailwind.config.ts` 删除 6 个无效 token 映射（`bg-base` / `bg-elevated` / `bg-overlay` / `text-primary` / `text-secondary` / `text-muted`），均无代码引用
-- `TeamCard` 未定义 token `--color-bg-subtle` → `--color-panel-low`
-- 3 处 `var(--primary)` → `var(--color-accent)`（StandingsTable / MapByMapInput / StatsLeaderboard），token 一致性
-- `MatchMvpVote` 圆角 `rounded-lg` → `rounded-sm`，与全站 `--radius: 3px` 一致
-- `Btn` / `Panel` 补显式 `import React`，修复 vitest 环境 `React is not defined`
-- 队伍详情页 `checkAdminSession()` 重复解密 iron-session cookie，改为复用 `getUserSession()` 结果
-- `TeamMemberData` / `RosterData` 类型三处重复定义 → 统一从 `AdminMatchRow` 导出
-- `AdminMatchRow` match.status/format 从 `string` 改为联合类型，移除 6 处类型断言
-- `completedMaps`/`finishedMaps` 映射逻辑在 admin matches 页两处复制粘贴 → 提取 `mapCompletedMaps()`/`mapFinishedMaps()` 辅助函数

+- 修复队伍卡片和赛程、统计组件的主题颜色显示，并减少队伍详情的重复会话读取。
```

## v1.16.0

```diff
--- 原文
+++ 候选
@@ -1,24 +1,11 @@

 ### Added
-- **UI Optimization v2 — 全站视觉增强**：首页三态动态 Hero（registration/voting/playing 渐变底色 + 网格背景纹理）；首页三层导航（Tier1 accent 卡片 / Tier2 grid-cols-4 / Tier3 ghost 按钮）；首页归档赛季区块
-- **PhaseStep 组件重写**：水平连接线布局，24×24 方形图标，步骤居中对齐；已完成段连接线变绿色
-- **赛季页双栏布局**：playing 状态展示 NEXT MATCHES + STANDINGS 双列；非 playing 状态降级为 Quick Links
-- **Panel 组件增强**：新增 `hoverable` / `teamColor` prop；`label` 为字符串时 CardHeader 始终应用 mono 样式
-- **`--color-info` token 系列**：新增 info / info-soft / info-edge 语义色（蓝色辅助标注）
-- **地图胜率颜色编码**：≥ 60% 绿色 / ≤ 40% 红色 / 中间段默认前景色
-- **首页投票排行卡片化**：grid 三列布局（排名 / 候选人 / 票数），第一名 accent 边框高亮
-- **管理后台 Season 卡片**：直接展示快捷操作按钮，无需跳转
+
+- 首页按报名、投票和比赛阶段展示不同主题，增加归档赛季入口和导航层级；赛季页展示近期比赛与积分榜。
+- 队伍页新增地图胜率与禁图率表现面板，胜率达到 60% 显示绿色、低于或等于 40% 显示红色；后台赛季卡片提供快捷操作。
+- 首页投票排行改用卡片展示，赛事步骤显示进度和连接线。

 ### Changed
-- **设计 token 体系**：全站字体更新为 Geist + JetBrains Mono + Noto Sans SC；新增 tracking 系列 token
-- **在线人数计数器**移至 Header 右侧，Tab 下划线样式精简
-- **赛季页**：新增 `getStandings` 共享函数，积分榜数据与 STANDINGS 面板对齐

-### Fixed
-- **admin 赛程**：`in_progress` 卡片左侧 3px accent 竖线标识；操作区改用 `<details>` 折叠，默认收起
-- `--color-fg-muted`（未定义 token）修复为 `--color-fg-dim`
-- admin 赛程 className 拼接改用 `cn()` 工具函数，消除无效 template literal
-- **全站 hardcoded Tailwind 颜色替换为 design tokens**：MatchTimeNegotiation/MatchRosterView/MatchRosterForm/TimeProposalHistory/SwissBracket/MatchStatusBadge/StandingsTable 等 30+ 组件统一使用 `--color-ok`/`--color-danger`/`--color-warn`/`--color-info` token 体系
-- `--color-yellow`/`--color-red`/`--color-surface-muted` 等无效 token 全部修复
-- CLAUDE.md 组件清单与实际文件同步，补充 `scripts/check-claude-md.sh` 校验脚本
-
+- 更新全站字体和页面样式，在线人数移至顶部导航右侧。
+- 后台赛程突出进行中的比赛，并默认折叠操作区。
```

## v1.15.1

```diff
--- 原文
+++ 候选
@@ -1,7 +1,12 @@
+
+### Added
+
+- 接入 Vercel Analytics。

 ### Fixed
-- **MVP 次数统计修正**：选手个人页 MVP 计数从「总票数」改为「单场 MVP 获奖次数」；新增 `matches.mvp_winner_user_id` 持久化缓存，避免每次页面访问遍历全表投票记录；UI 标签改为「单场MVP」

-### Added
-- `ensureMvpWinner(matchId)` — 投票截止后首次访问比赛页时自动锁定 MVP 胜者（幂等）
+- **MVP 次数统计修正**：选手个人页 MVP 计数从「总票数」改为「单场 MVP 获奖次数」；新增 `matches.mvp_winner_user_id` 持久化缓存，避免每次页面访问遍历全表投票记录；UI 标签改为「单场 MVP」

+### Changed
+
+- 投票截止后首次访问比赛页时自动锁定 MVP 胜者，重复访问不会重复处理。
```

## v1.15.0

```diff
--- 原文
+++ 候选
@@ -1,19 +1,16 @@

 ### Added
+
 - **MVP 投票重构**：候选人由全部选手改为 Rating 前 4 名；候选人大卡展示完整数据（K/D/A/ADR/RWS/HS%/FK/MK/残局/Rating/WE）；多地图数据智能聚合（击杀类求和、场均类取均值、HS% 按击杀加权）；比赛结束 24 小时后自动截止投票并展示最终 MVP
-- **赛程管理队伍筛选**：AdminMatchFilter 新增队伍下拉筛选；赛程按「进行中→已排期(越近越靠前)→已完成→已取消」排序
+- **赛程管理队伍筛选**：AdminMatchFilter 新增队伍下拉筛选；赛程按「进行中 → 已排期(越近越靠前)→ 已完成 → 已取消」排序
 - **地图结果表格** PlayerStatsTable 新增 HS%/FK/MK/残局列
-- `sumNums` / `avgNums` / `weightedAvgNums` 通用聚合函数（`src/lib/utils/stats.ts`）
-- `MVP_DEADLINE_MS` 共享常量 + `getMatchPlayerOptions` / `getMatchVetoSteps` action
-- **管理后台比赛详情增加队伍筛选** + 按开赛时间排序

 ### Changed
+
 - **BP 录入流程优化**：BP 仅在比赛「进行中」时可用；打开对话框自动回填已保存数据（不再每次重置）
 - **OCR 面板视图/编辑双模式**：已有数据时显示只读表格 +「重新录入」按钮；挂载时自动加载已保存数据
-- **管理后台比赛列表增加队伍筛选** + 按开赛时间排序

 ### Fixed
+
 - **管理后台 OCR「暂无数据」**：公开页已有数据但管理后台显示空白的 bug
 - **BP 对话框错误处理**：异步加载失败不再卡 loading
-- **StatsOCRPanel useEffect**：加 cleanup 标志防止卸载后 setState
-
```

## v1.14.3

```diff
--- 原文
+++ 候选
@@ -1,12 +1,12 @@

 ### Added
-- **OCR 面板始终可见**：不再依赖识别结果才显示编辑表格，新增「添加行」按钮支持纯手动录入
+
+- OCR 面板始终显示编辑表格，支持手动添加选手行。

 ### Fixed
-- **OCR 大截图序列化崩溃**：extractStatsFromScreenshot 参数装箱，修复 React Flight 对数组内大字符串按 `.length` 计入 arraySizeLimit（1e6）导致的 "Maximum array nesting exceeded" 错误
-- **Server Action 数组序列化**：savePlayerStats / saveVetoSteps / submitMatchRoster / updateMatchRoster 数组参数统一包在对象中，避免 Next.js 序列化限制
-- **OCR 调试日志恢复**：移除过度的 DEBUG gate，日志恢复无条件输出以便生产排查
+
+- 修复大截图和名单、BP、统计数组提交时可能触发的序列化错误，并恢复 OCR 排查日志。

 ### Changed
-- **数据库连接切 Transaction Pooler**：端口 5432 → 6543，`prepare: false`，连接池 max 1 → 3

+- 数据库连接改用 Transaction Pooler，端口由 5432 调整为 6543，关闭 prepared statements 并将连接池上限由 1 调整为 3。
```

## v1.14.2

```diff
--- 原文
+++ 候选
@@ -1,11 +1,11 @@

 ### Fixed
+
 - **OCR 模型切换**：PaddleOCR-VL-1.5 / DeepSeek-OCR 均无法正确理解记分板表格，切换为 Qwen3-VL-8B-Instruct
 - **OCR 兼容多种 JSON 格式**：手动提取 players 数组，兼容直接数组 / `{players}` / `{data:{players}}` 三种 LLM 返回格式
 - **OCR 下拉仅显示两队队员**：从全赛季选手缩小为本场比赛两队成员（≤10 人），排除已被其他行匹配的玩家
 - **OnlineCounter 容错**：`touchSession` 和 API 调用失败时静默跳过，不再阻塞页面渲染

 ### Changed
+
 - **OCR 调试日志 gated**：`console.error` 改为 `DEBUG` 门控 `console.log/warn`，仅 dev 或 `OCR_DEBUG=true` 时输出
-- **Code review 清理**：提取 `extractPlayersArray` helper，`useMemo(Set)` 优化下拉过滤 O(n²) → O(n)
-
```

## v1.14.1

```diff
--- 原文
+++ 候选
@@ -1,6 +1,7 @@

 ### Fixed
+
 - **OCR 校验彻底放宽**：顶层仅校验数组结构（不再因单行缺字段整批丢弃），行级仅要求玩家名称非空，数值字段自动转换（`"15"` → `15`、`"N/A"` → `null`），移除所有范围上限
-- **赛程总览显示比赛时间**：MatchCard 已排期显示日期、未排期显示「未排期」
-- **队伍详情页补全**：新增「历史战绩」列表（比分/BO1·BO3/阶段/详情链接），调整顺序为阵容→即将进行→历史战绩
+### Added

+- 赛程总览展示比赛日期和未排期状态；队伍详情新增历史战绩与比赛链接。
```

## v1.14.0

```diff
--- 原文
+++ 候选
@@ -1,16 +1,14 @@

 ### Added
+
 - **在线人数统计**：`user_sessions` 表 + `OnlineCounter` 组件，每 2 分钟心跳，5 分钟内有活动的用户计为在线
 - **赛程总览子 Tab**：排位赛/正赛内分「待进行」「已结束」子 Tab，已排期比赛按时间由近及远排序
-- **BP 选边归属修正**：decider 步骤选边由对方选择时正确翻转 Team A 起始边
-- **OCR 逐行宽松解析**：单行校验失败跳过而非整批丢弃，兼容不同格式截图
 - **名单 2 小时窗口锁定**：距开赛 >2h 自由提交/修改，<2h 锁定，玩家按钮同步禁用

 ### Fixed
-- **BP 录入放开 in_progress**：saveVetoSteps 允许 in_progress 状态，标准流程「开始→BP→比分」
+
+- 修正决胜图选边归属，并让 OCR 在单行校验失败时保留其他有效行。
+
+- **BP 录入放开 in_progress**：saveVetoSteps 允许 in_progress 状态，标准流程「开始 →BP→ 比分」
 - **VetoInputDialog 双 Tab 面板同步**：排位赛和正赛都可见
 - **名单 UI 状态修正**：StatusPill "finished" 绿色误导 → 纯文字 "已提交"，倒计时文案加 2h 锁定警告
-
-### Changed
-- **Simplify 审查修复**：预索引 teamMembersByTeam（O(1) 查表）、移除冗余 new Date()、提取 resolveTeamASide helper
-
```

## v1.13.1

```diff
--- 原文
+++ 候选
@@ -1,14 +1,14 @@

 ### Added
+
 - **开赛自动填名单**：点「开始比赛」时自动为两队取前 5 人作为默认首发（若队长未提交）
 - **队长名单时间提示**：比赛详情页显示距开赛剩余时间、2 小时内锁警告、裁判检查提醒
 - **时间协商名单提醒**：队长未提交名单时显示黄色警告条「请先提交赛前名单」

 ### Fixed
+
 - **删除放开**：`deleteMatch` 移除 status 限制，所有非 bracket 比赛均可删除
 - **后台布局优化**：AdminRosterDialog/VetoInputDialog 同行排列 + 每场比赛底部「查看公开页 ↗」链接
 - **Drizzle 关系查询崩溃**：`VetoView` 和 admin roster 查询改用 `db.select()` 绕过 `buildRelationalQueryWithoutPK`
-- **TOCTOU 竞态**：`recordMapResult` 地图重复检查移入事务内部
 - **hasSubmittedRoster 默认值**：从 `true` 改为 `false`，忘记传 prop 时不会静默隐藏名单提醒
 - **auto-fill 确定性**：默认队员按 `joinedAt` 排序，移除未用变量
-
```

## v1.13.0

```diff
--- 原文
+++ 候选
@@ -1,23 +1,11 @@

 ### Added
-- **BO1 地图记录**：MapByMapInput 扩展 bo1 格式，recordMapResult 解除 BO1 限制，BO1 从 scheduled 自动推进到 in_progress
-- **BP 选图流程**：match_veto_steps 表 + saveVetoSteps Server Action + VetoInputDialog（管理员录入 Dialog，BO1/BO3/BO5 模板） + VetoView（HLTV 风格纵向展示，ban 红 / pick 绿 / decider 黄）
-- **管理员名单管理**：updateMatchRoster action + AdminRosterDialog（复选框选择 5 首发 + 2 替补，首发排序）
-- **比赛详情页 OCR 入口**：已完图下方对管理员显示 StatsOCRPanel（OCR 数据录入）
-- **比赛详情页分图 Tab 切换**：地图结果从纵向列表改为 Tab 切换，支持地图结构预展示 + BO1 fallback 展示系列总分
-- **比赛删除功能**：deleteMatch Server Action + DeleteMatchButton（InlineConfirm 二次确认，级联删除 BP/地图/名单数据，禁删 bracket 生成比赛）
+
+- BO1 支持逐图记录并从待进行进入比赛；比赛详情按地图切换结果并展示地图计划。
+- 管理员可按 BO1、BO3、BO5 模板录入 BP，查看正式选图过程，并管理五名首发和两名替补。
+- 比赛详情已结束地图下提供管理员 OCR 录入入口；管理员可确认删除非淘汰赛生成的比赛及关联数据。

 ### Fixed
-- **recordMapResult 状态准入**：scheduled 仅 BO1 可用，BO3/BO5 必须 in_progress（防止跳过开始比赛步骤）
-- **BO1 fallback**：使用 `match.format` 替代硬编码 "BO1"
-- **BP 服务端校验**：地图名/队伍/去重/图池合法性校验，防止绕过客户端直接调 API
-- **TOCTOU 竞态**：recordMapResult 地图重复检查移入事务内部
-- **side 列类型**：match_veto_steps.side 从 text 改为 sideEnum
-- **VETO_STEP_COUNT**：常量对齐实际 buildTemplate 步骤数（统一 7 步）
-- **_journal.json**：补齐 0011-0017 缺失迁移条目

-### Changed
-- **消除重复**：提取 SIDE_LABELS（4 处→1）、getMaxMaps()（2 处→1）、validateTeamMembers()（2 处→1）
-- **移除 orphan**：MatchDetail.tsx（已被内联 server component 替代）
-- **清理 JSX 注释**：移除叙述性注释
-
+- BO3/BO5 必须开始比赛后才能逐图录分；BP 保存校验地图、队伍、重复选择和赛事图池。
+- 将地图重复检查纳入事务，修复并发录分竞态；补齐缺失的迁移记录。
```

## v1.10.1

```diff
--- 原文
+++ 候选
@@ -1,5 +1,4 @@

 ### Fixed
+
 - **选秀预览模式时机修正**：从 registration/voting 阶段改为 drafting 未激活时展示（此时队伍已组建），非 drafting 恢复简单提示
-- **PLAYER_INFO_FIELDS 导入异常**：`as const` 常量从 `"use client"` 文件移至独立模块，修复 Server Component 中 `map is not a function` 运行时错误
-
```

## v1.10.0

```diff
--- 原文
+++ 候选
@@ -1,9 +1,14 @@

 ### Added
+
 - **选秀预览模式**：选秀页在非 drafting 状态展示只读选手池，队长可提前查看选手信息（含风格/备注/经历 hover 卡片）研究阵容
 - **选手个人页信息增强**：`/players/[userId]` 新增"选手自述"区块，展示风格、备注、比赛经历

 ### Changed
+
 - **自动选人优先级升级**：从单一 peakRating 改为 5 级排序（peakRank → peakRating → currentRank → currentRating → registrationId），并优先填补队伍完全空缺的位置
-- **sortByRank 排序扩展**：支持可选 currentRank / currentRating 字段，队长面板和选手池排序自动受益
+- **sortByRank 排序扩展**：支持可选 currentRank / currentRating 字段，队长面板和选手池排序自动受益。

+### Fixed
+
+- 修复选手个人页信息字段在服务端渲染时的导入错误。
```

## v1.9.0

```diff
--- 原文
+++ 候选
@@ -1,10 +1,8 @@

 ### Added
+
 - **选秀选手悬停信息卡片**：选手行末尾新增 info 图标，hover 弹出风格/备注/比赛经历；仅在有内容时显示图标，不增加视觉噪音；支持 PlayerPool 观众页和 CaptainDraftPanel 队长面板

 ### Changed
+
 - **菜单"个人信息"重命名**：右上角下拉"修改昵称"→"个人信息"，与 `/settings` 页面标题对齐
-
-### Refactored
-- **DraftPlayerRow 类型统一**：删除 `CaptainDraftPlayer` 重复接口，统一使用 `DraftPlayerRow`
-
```

## v1.7.3

```diff
--- 原文
+++ 候选
@@ -1,4 +1,5 @@

 ### Fixed
-- 数据排行页 `sortColumn` 使用 Drizzle 列引用解析为全表名，与 SQL 别名 `mps` 冲突导致 Postgres `42P01` 错误

+- 修复数据排行榜排序时的数据库查询错误。
+- Steam 头像读取增加超时保护和缓存更新，减少过期头像链接显示失败。
```

## v1.7.1

```diff
--- 原文
+++ 候选
@@ -1,5 +1,6 @@

 ### Fixed
+
 - Header 头像过期 CDN 链接显示浏览器蓝色问号：AvatarButton 增加 onError 回退 + Header 服务端增加 `getSteamAvatar()` 实时拉取回退（与选手页统一）
 - Header mobile menu 关闭重开时 imgError 状态重置导致重复加载失败图片
 - 选手名单页位置筛选项仅含 3 个中文标签，改为全部 5 个 positionValues 英文标签（IGL / AWPer / Opener / Closer / Anchor）
@@ -7,6 +8,5 @@
 - 赛季导航 `hasPlayers` 计数比较增加 `Number()` 包裹，防 bigint→string 类型失效

 ### Changed
+
 - 注册页位置标签切换 `positionLabel()` 替代内联 `POSITION_LABELS[].en`
-- 提取 `resolveAvatarUrl()` 共享函数到 `steam.ts`，消除 Header 与选手页重复
-
```

## v1.7.0

```diff
--- 原文
+++ 候选
@@ -1,8 +1,8 @@

 ### Added
+
 - **选手名单页** `/[seasonSlug]/players`：展示已审核通过的报名选手，支持按位置筛选，卡片展示段位/Rating/所属队伍
 - **赛季导航**「选手」入口（按 approved 报名数 > 0 条件渲染，遵循 capability 门控）
-- **`getDisplayName()` 工具函数**：统一展示名称派生（displayName > perfectName > steamName > email），全站替代 `steamName ?? "未知选手"`
 - **display_name 系统**：users 表新增 `display_name` 字段，设置页支持修改昵称，Header 未设置时橙色提示
 - **选秀队长面板重构**：按段位+Rt 排序统一列表（替代旧的分列布局），满员位置灰显禁用，新增队长阵容摘要可折叠面板
 - **选秀观众端增强**：pick 通知 Banner 3 秒淡出动画，选手池统一排序
@@ -10,14 +10,11 @@
 - `public/favicon.ico`：静态 favicon 防止路由被 `[seasonSlug]` 吞噬

 ### Fixed
+
 - 统计页 `db.execute()` 返回 `QueryResult { rows }` 对象直接当数组迭代 bug（与 1.6.1 队伍详情页同类问题）
 - DraftLiveRoom 通知双重触发（Realtime INSERT + completedPicks 竞态）
 - DraftLiveRoom `positionLabel(steamName)` 参数错误

 ### Changed
-- `positionLabel` 6 文件重复定义提取为共享函数
-- `sortByRank` 提取为泛型工具函数 `src/lib/utils/rank.ts`
-- 并行化队伍详情页 roster + matches 查询（`Promise.all`）
-- `POS_ABBR` 移入 `registration.ts` 与位置常量共处
-- layout.tsx season 查询用 `React.cache()` 去重

+- 减少队伍详情与赛季导航的重复读取。
```

## v1.4.1

```diff
--- 原文
+++ 候选
@@ -1,14 +1,14 @@

 ### Fixed
+
 - 下拉菜单项间距不均与内容区背景透明问题
 - 个人主页 Steam 头像加载失败（新增 `avatars.steamstatic.com` 到 Next.js remotePatterns）

 ### Changed
+
 - 全站用户名显示统一为 `steamName`（回退 `email`）：Header 下拉菜单、管理后台用户列表/设置页、审计日志操作人列、玩家主页
 - 审计日志操作人列从原始 ID 改为可读名称（actorNameMap）
 - 玩家主页数据增强：新增 MVP 票数、RWS、HS%、首杀、多杀、残局等统计
 - 报名记录卡片重设计为紧凑两行布局，补 `peakWe`
 - 新增 `perfectName` 显示
-- 提取 `wAvg`/`sAvg` 工具函数并添加单元测试（8 case）
 - 玩家主页报名/个人数据查询并行化（`Promise.all`）
-
```

## v1.4.0

```diff
--- 原文
+++ 候选
@@ -1,15 +1,16 @@

 ### Added
+
 - 管理后台操作日志浏览页面：新增 `AuditLogTable` 与 `/admin/logs`，支持查看审计事件、操作者、目标与元数据。
-- Server Actions 单元测试基础设施：新增 session mock、fixture、audit helper，并覆盖 auth、admin、captains、register、seasons、teams 等核心 actions。

 ### Changed
+
 - 报名页显示当前用户报名状态；审核通过前允许自行修改并重新回到待审核，审核通过后锁定。
 - 管理后台报名审核列表按提交时间升序展示，优先处理更早报名的选手。
 - “等待名单”文案统一调整为“候补名单”，并更新报名状态机文档。
 - 多个管理与用户操作补齐 audit_log 写入。

 ### Fixed
+
 - 头像菜单新增“我的主页”入口，修复登录用户无法从右上角进入个人主页的问题。
 - “撤销通过”现在回到待审核，而不是误标为已拒绝。
-
```

## v1.3.2

```diff
--- 原文
+++ 候选
@@ -1,7 +1,4 @@

 ### Changed
-- README、CLAUDE.md、AGENTS.md 版本号同步至 1.3.2
-- CI workflow：`pnpm tsc --noEmit` → `pnpm type-check`（包含 Next route typegen）
-- Cron workflow：curl 加 `-fsS` flag，接口返回非 200 时 step 失败
-- CLAUDE.md 版本号规范：明确 `npm version` 同步生成 tag，移除"合并后打 tag"表述

+- 同步项目版本与文档，并调整 CI 类型检查和定时任务的失败判定。
```

## v1.3.0

```diff
--- 原文
+++ 候选
@@ -1,17 +1,18 @@

 ### Added
+
 - 队伍图标上传：`TeamLogoUpload` 组件 + `uploadTeamLogo` Server Action + Supabase Storage `team-logos` bucket（公开，1 MB / jpg+png+webp）
 - 管理后台报名草稿查看：`DraftRegistrationTable` 展示邮箱、Steam 昵称、位置、段位、最后保存时间
 - 修改密码功能：`changeUserPassword` Server Action（验证原密码 + Supabase Admin API 更新）+ `/settings/password` 页面
 - `revokeUserAdminRole` Server Action：super_admin 可撤销其他管理员权限（写 audit_log）
-- 共享常量配置：`src/lib/config/upload-limits.ts` / `auth-config.ts`

 ### Changed
+
 - `MatchRosterForm` 视觉重设计：PosChip 位置标签、CSS 变量卡片样式、StatusPill 锁定态
 - 管理员用户列表改为查询 `users` 表（role ≠ "user"），正确展示所有管理员
 - `teams` 表新增 `logo_url` 列（nullable）
 - Header：super_admin 隐藏邀请码入口；所有已登录用户新增修改密码入口

 ### Fixed
+
 - 上传失败回退竞态：`lastConfirmedUrlRef` 替代 stale prop 快照
-
```
