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
+- 更新 Next.js 15.5.18 与 Drizzle ORM 0.45.2，修复所列高危依赖漏洞及 SQL 注入问题。当时审计仍有五项通过 brackets-manager 引入的 uuid 间接依赖中危漏洞，等待上游修复。
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
@@ -1,5 +1,6 @@

 ### Added
+
 - **六维雷达图系统（Hexagon）**：基于赛季赛事统计的 Z-score 标准化，计算六维能力评分（火力/破局/多杀/残局/协同/稳定），含完整单元测试（265 行）
 - **PlayerRadarChart 组件**：SVG 六边形雷达图，支持多人叠加对比、轴标签、单人数值标注及图例
 - **选手个人页六维卡片**：跨赛季六维能力展示
@@ -11,18 +12,14 @@
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
@@ -10,19 +11,16 @@
 - **设计 token — Accent B 族**：`--color-accent-b` / `-b-soft` / `-b-edge` / `-b-fg`，统一团队 B / 对比实体 accent 色

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
