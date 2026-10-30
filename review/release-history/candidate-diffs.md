# Release 正文候选差异（未完成）

仅列出已有候选改动的 11 个 Release。所有候选需独立复核；原文及 metadata 见快照，余下版本仍未审阅。

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
@@ -1,10 +1,9 @@

-### Major Changes
+### Added

-- RivalHub 2.0 RC：引入 capability 驱动的 Major 赛事运营闭环，并收拢正式 production cutover 所需的 Auth、报名、赛程与数据完整性能力。
+- RivalHub 2.0 候选版引入 Major 赛事运营能力，并完善认证、报名、赛程与数据完整性。

-### Patch Changes
+### Changed

-- dabc985: 新增 fail-closed 的 Local Supabase 开发入口，隔离旧远程数据库配置并验证 Drizzle migration、Auth、Storage 与 Data API 默认拒绝策略。
-- ed1f9cb: Team 报名与含 Swiss 赛季在完整运营闭环落地前保持 fail closed，避免误用个人报名和自动状态迁移。
-
+- 新增隔离旧远程数据库配置的本地 Supabase 开发入口，并验证迁移、认证、存储与数据 API 默认拒绝策略。
+- 队伍报名与含 Swiss 阶段的赛季在完整运营闭环落地前保持关闭，避免误用个人报名和自动状态迁移。
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
