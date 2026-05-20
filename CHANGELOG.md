# Changelog

All notable changes to RivalHub are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.20.1] - 2026-05-20

### Fixed
- **移动端布局**：首页 Next Match 区块右侧溢出修复（stage + 时间改为右侧竖排）；MatchCard badges 行加 flex-wrap 避免窄屏换行溢出；TeamCard 队名加 break-words、选手名加 truncate
- **MatchCard 对战对称**：TeamA 队名改为右对齐，vs / 比分居中，布局对称
- **队伍页六维雷达图**：改为取上场最多的前 5 名队员（原为首发标记），更准确反映实际出场情况

## [1.20.0] - 2026-05-20

### Added
- **MKPR /100r 指标**：数据排行榜新增多杀率列与排序 Tab，选手个人页同步改为 per-round 口径，与 FKPR/CPR 保持一致
- **选秀回顾**：选秀结束后 `/[seasonSlug]/draft` 保留完整选人记录，以只读模式展示队伍阵容与逐回合 pick 历史
- **用户管理——所有用户 Tab**：管理后台新增普通用户列表，含 4 项统计卡片（总注册/参赛/仅注册/近 30 天）、名字/邮箱搜索、全部/参赛/仅注册筛选；优化管理员列表为表格布局

### Fixed
- **积分榜平局判定顺序**：调整为 胜场 → 净胜回合差 → H2H → 总胜回合数 → 选秀顺位
- **队名溢出截断**：赛程卡片（MatchCard）与首页 Next Match 区块队名长时正确显示省略号

## [1.19.2] - 2026-05-20

### Fixed
- **选手页与 H2H FKPR/CPR/KPR 口径统一**：选手页生涯总计从场均改为 per-round 率，与排行榜一致；MatchLineupsH2H FKPR 改为 ×100 显示

### Changed
- **六维雷达图权重优化**：每维主指标权重提升（FKPR 0.65 / MKPR 0.70 / CPR 0.70 / APR 0.45），少死分权重提升至 0.35
- **Z-score 缩放系数调整**：乘数 15 → 22，拉开分数分布使顶尖选手能达到满分

## [1.19.1] - 2026-05-20

### Fixed
- **排行榜 FKPR/CPR 显示精度**：SQL 层 `round(..., 2)` 导致 ×100 后小数位永为 `.0`，改为 `round(..., 4)` 恢复有意义的 1 位小数显示

## [1.19.0] - 2026-05-20

### Added
- **六维雷达图系统（Hexagon）**：基于赛季赛事统计的 Z-score 标准化，计算六维能力评分（火力/破局/多杀/残局/协同/稳定），含完整单元测试（265 行）
- **PlayerRadarChart 组件**：SVG 六边形雷达图，支持多人叠加对比、轴标签、单人数值标注及图例
- **选手个人页六维卡片**：跨赛季六维能力展示
- **队伍详情页六维对比**：队内所有成员六维雷达图叠加对比
- **比赛详情页六维对比**：双方出场阵容六维能力雷达图（新增至赛后数据面板）
- **排行榜六维综合评分列**：StatsLeaderboard 新增六维综合评分排序
- **Cloudflare Turnstile 验证码**：注册页集成，`appearance=interaction-only` 仅在需要时触发验证挑战，服务端强制校验
- **忘记密码 / 重置密码页**：`/forgot-password`、`/reset-password` 完整流程
- **BP 赛后补录**：`finished` 比赛在管理后台"数据录入"区新增「录入 BP」入口；无 match_maps 记录时自动建立，解锁 OCR 面板

### Changed
- **BP 流程强制顺序**：`in_progress` 状态下，`recordMatchResult`（非淘汰赛）和 `recordMapResult`（淘汰赛逐图）均强制校验 BP 已存在，否则拒绝录分
- **BO3/BO5 逐图录入重构**：BP 保存后自动创建 match_maps 预占行；`recordMapResult` 改为 UPDATE 预占行填入比分（不再 INSERT），彻底消除"地图已存在"冲突
- **MapByMapInput BP 引导模式**：有 BP 预占序列时，地图名和 pick 方只读展示，管理员只需填起始边和回合数
- **VetoInputDialog 交互优化**：队伍选择改为 A / B 切换按钮（告别每步下拉菜单）；finished 状态下显示赛后补录提示条

### Fixed
- **MVP 投票 createdAt 空值**：`createdAt` 为 null 时不再静默放行，明确返回"账号状态异常"错误
- **Turnstile siteKey 缺失提示**：环境变量未配置时给出明确错误，不再静默失败

### Refactored
- **PlayerRadarChart 颜色预解析**：颜色计算从多边形渲染和图例中提取到一次 map，消除重复推导
- **hexagon.ts n=0 判断提升**：将空数组检查提至统计循环外，避免无效迭代
- **TurnstileWidget URL 提取**：重复脚本 URL 提取为常量
- **比赛/队伍/选手页并发优化**：`getSeasonHexagonScores` 加入 Phase 3 `Promise.all`，消除串行等待

## [1.18.1] - 2026-05-19

### Fixed
- **数据统计 KPR 修正**：从场均击杀 `sum(kills)/count(maps)` 改为每回合击杀 `sum(kills)/sum(rounds)`，与 CS2 标准 KPR 口径一致
- **ADR / HS% 加权平均**：从简单 `avg()` 改为回合加权 `sum(metric × rounds)/sum(rounds)`，消除不同图回合数差异导致的偏差
- **首杀 / 残局改每回合**：标签 "首杀/图"→"FKPR"、"残局/图"→"CPR"，计算从 `sum/count(maps)` 改为 `sum/sum(rounds)`
- **阵容对比 FK 一致化**：`buildLineupsPlayers` 的 FK 同步改为 FKPR（每回合首杀），标签统一为 "FKPR"
- **雷达图颜色解耦**：`MapPoolRadarChart` 硬编码 hex 替换为 `--color-accent` / `--color-accent-b` CSS 设计 token
- **赛后内容隐藏**：比赛结束后隐藏赛季综合对比、地图池雷达图、历史交锋、阵容对比、赛前名单段落
- **雷达图图例**：从 SVG 内移到卡片底部 HTML 布局，纵向排列不再重合
- **MVP 次数口径**：从总票数修正为单场获奖次数，增加持久化缓存

### Changed
- **SQL 聚合提取**：stats 页 `weightedAvg(col)` / `perRoundRate(col)` 两个 helper，sortColumn 和 SELECT 共用单一定义
- **排序默认值统一**：无数据项 `ELSE NULL`（排到末尾），不再用 `ELSE 0`（会与 0 值混淆）
- **BO1/BO3/BO5 回合数兼容**：`COALESCE(mm.score_a + mm.score_b, m.score_a + m.score_b)`，map 级比分优先，BO1 fallback 到 match 级

## [1.18.0] - 2026-05-19

### Added
- **比赛详情页 — 赛季综合对比**：Hero 下方显示双方赛季战绩（胜负/胜率/Rating/ADR/K/D），较高值高亮标记
- **比赛详情页 — 地图池雷达图**：纯 SVG 七边形雷达图，Win%/Pick%/Ban% 三态切换，同轴对比两队数据
- **比赛详情页 — 历史交锋**：显示两队赛季内交手记录（近 10 场），含胜负汇总和每场比分链接
- **比赛详情页 — 阵容对比**：HLTV 风格五人 H2H 比较器，点击切换选手，Rating/ADR/K/D/HS%/FK/WE 条形对比
- **比赛详情页 — 整场汇总 Tab**：BO3/BO5 系列赛第一个 Tab，所有上场选手跨图聚合数据（K/D/A/HS%/Rating 等）
- **比赛详情页 — 比赛时间显示**：Hero 下方显示赛前计划时间或赛后完成时间（CST 格式）
- **管理端 — 完成时间编辑**：`updateMatchCompletedAt` Server Action，已结束比赛可在折叠区修改 `completed_at`（datetime-local 控件 + 清除按钮）
- **设计 token — Accent B 族**：`--color-accent-b` / `-b-soft` / `-b-edge` / `-b-fg`，统一团队 B / 对比实体 accent 色

### Changed
- **数据统计排行榜重构**：新增全部 10 种排序（Rating/ADR/K/D/KPR/HS%/WE/RWS/首杀/残局/场次），数据驱动 `ColDef[]` 表格渲染
- **队伍详情页重构**：综合数据改为 2×4 网格（出场/胜/负/胜率 + Rating/ADR/K/D/WE）；阵容行内嵌选手赛季数据（地图数/Rating/ADR/K/D）；替补显示地图偏好；删除"位置最佳"区块；重排段落顺序
- **MVP 投票布局**：候选卡片从 `grid-cols-2 sm:grid-cols-4` 改为固定 `grid-cols-2`（2×2 布局）
- **MatchCard 风格**：从卡片网格改为行列表，增大垂直间距（`space-y-2` → `space-y-3`）
- **BP 面板显示条件**：VetoView 仅在比赛开始后（非 scheduled）显示，赛前不展示空 BP 面板

### Fixed
- **数据统计 SQL 口径**：`positionFilter` 改用原始字符串 `sr.primary_position`，修复 Drizzle schema 对象展开为表名与别名冲突
- **K/D 计算**：从前端 `avg/avg` 改为 SQL 层 `sum(kills)/sum(deaths)`，修复统计口径
- **`computeRecord` 平局逻辑**：平局不再误计为负（`else` → `else if`）

### Refactored
- **Pick/Ban 统计合并**：`getTeamPickStats` 和 `getTeamBanStats` 合并共享 `getTeamVetoActionStats` 实现（60 行重复 → 一行委托）
- **DB 查询精简**：首发选手赛季数据从 `teamRawStats` 内存过滤，省 2 次 `matchPlayerStats` 查询；赛季比赛查询提取 `getSeasonFinishedMatches` 辅助
- **硬编码颜色清零**：全站 30+ 处裸 hex 值替换为 CSS 变量（`StatusPill`/`StatusBanner`/`EmptyState`/`ErrorState`/`InlineConfirm` + 5 个新赛程组件）

## [1.17.1] - 2026-05-19

### Fixed
- **已结束比赛时间显示**：赛程页"已结束"标签页现在显示比赛完成时间（`completed_at`，无则回退到 `scheduled_at`）
- **已结束比赛排序**：已结束比赛改为按完成时间从近到远降序排列
- **队伍页地图池**：地图胜率/ban 率表格改用赛季 `registrationConfig.mapPool`，不再硬编码 `DEFAULT_CS2_MAP_POOL`
- **默认地图池**：`DEFAULT_CS2_MAP_POOL` 将 `de_train` 更新为 `de_overpass`（当前赛季活跃图池）

## [1.17.0] - 2026-05-19

### Added
- **比赛比分修正**：管理员可对已完成比赛进行比分修正（`correctMatchScore` Server Action），操作写入 audit log；仅修正数字，不影响胜负判定和 bracket 晋级结果
- **数据录入校验**：玩家数据保存前校验数值范围（HS%/RWS 0–100、ADR 0–300、Rating 0.01–5.0；计数类字段仅校验非负），超范围格高亮为红色、阻止确认
- **清除数据**：管理员可一键清除某张地图的所有玩家统计数据（InlineConfirm 二次确认，写 audit log）

### Fixed
- **CS2 回合数合法性校验**：BO1 及 BO3/BO5 单图录入时，校验胜者回合数须满足 `13 + 3k`（13、16、19、22…），覆盖 MR12 正常局 + 任意轮加时，取代原来的硬编码数组
- **赛后面板已完成比赛排序**：已完成比赛按 `completedAt` 降序排列，最近完成的显示最前
- **「生成正赛」按钮误显**：`canGeneratePlayoff` 改为基于全量比赛数据判断，不再受界面筛选影响
- **数据统计页崩溃**：`db.execute` 原始 SQL 返回 PostgreSQL `numeric` 为字符串，修正为显式 `Number()` 转换

### Chore
- 组件文件统一 PascalCase 命名（layout/ + rivalhub/ 共 21 个文件重命名）
- `check-claude-md.sh` 改为以磁盘文件为真实来源，无需维护硬编码列表

## [1.16.1] - 2026-05-18

### Added
- **选手名全站可点击**：队伍列表（TeamCard 首发/替补名）、队伍详情（阵容首发/替补/队内联系方式、每位置最佳）、比赛赛前名单（MatchRosterView 两队首发/替补）、比赛赛后数据表（PlayerStatsTable）、MVP 投票结果页，选手名均链接到 `/players/[userId]`
- **比赛详情页队伍名可点击**：Hero 区双方队伍名链接到队伍详情页
- **管理员下载队伍头像**：队伍详情页 Logo 下方显示「下载头像」按钮，仅 admin 可见且有 logo 时出现
- `formatCSTDateTime()` 格式化函数（CST 月日+时间，如 "5月18日 19:30"）

### Changed
- **比赛时间显示日期+具体时间**：MatchCard 和赛季首页 NEXT MATCHES 从仅日期（"5月18日"）改为日期+时间（"5月18日 19:30"）
- **赛季子页面统一垂直间距**：4 个页面（赛季首页 / draft / captains / register）父容器改为 `space-y-*` 统一间距，消除各区块 ad-hoc `mb-*`/`mt-*`
- **赛季首页 STANDINGS 视觉对齐**：右侧积分榜从裸 div 改为 `<Panel label="STANDINGS · TOP 4">` 包裹，与左侧 NEXT MATCHES 视觉对称
- **StatsLeaderboard 筛选改用 `Btn` 组件**：排序 Tab 和位置筛选从手动 `<a>` 改为 `<Btn small ghost asChild>`，全站按钮风格统一
- **3 组件 shadcn Card → rivalhub Panel**：MatchMvpVote / CaptainVotingPanel / StatsLeaderboard 统一使用 Panel 组件
- **admin matches 页提取 `AdminMatchRow` 组件**：消除排位赛/正赛 ~200 行重复 JSX，净减 153 行；统一 VetoInputDialog 可见性（scheduled + in_progress 均显示）；清理 10+ 不再使用的 import

### Fixed
- `tailwind.config.ts` 删除 6 个无效 token 映射（`bg-base` / `bg-elevated` / `bg-overlay` / `text-primary` / `text-secondary` / `text-muted`），均无代码引用
- `TeamCard` 未定义 token `--color-bg-subtle` → `--color-panel-low`
- 3 处 `var(--primary)` → `var(--color-accent)`（StandingsTable / MapByMapInput / StatsLeaderboard），token 一致性
- `MatchMvpVote` 圆角 `rounded-lg` → `rounded-sm`，与全站 `--radius: 3px` 一致
- `Btn` / `Panel` 补显式 `import React`，修复 vitest 环境 `React is not defined`
- 队伍详情页 `checkAdminSession()` 重复解密 iron-session cookie，改为复用 `getUserSession()` 结果
- `TeamMemberData` / `RosterData` 类型三处重复定义 → 统一从 `AdminMatchRow` 导出
- `AdminMatchRow` match.status/format 从 `string` 改为联合类型，移除 6 处类型断言
- `completedMaps`/`finishedMaps` 映射逻辑在 admin matches 页两处复制粘贴 → 提取 `mapCompletedMaps()`/`mapFinishedMaps()` 辅助函数

## [1.16.0] - 2026-05-18

### Added
- **UI Optimization v2 — 全站视觉增强**：首页三态动态 Hero（registration/voting/playing 渐变底色 + 网格背景纹理）；首页三层导航（Tier1 accent 卡片 / Tier2 grid-cols-4 / Tier3 ghost 按钮）；首页归档赛季区块
- **PhaseStep 组件重写**：水平连接线布局，24×24 方形图标，步骤居中对齐；已完成段连接线变绿色
- **赛季页双栏布局**：playing 状态展示 NEXT MATCHES + STANDINGS 双列；非 playing 状态降级为 Quick Links
- **Panel 组件增强**：新增 `hoverable` / `teamColor` prop；`label` 为字符串时 CardHeader 始终应用 mono 样式
- **`--color-info` token 系列**：新增 info / info-soft / info-edge 语义色（蓝色辅助标注）
- **地图胜率颜色编码**：≥ 60% 绿色 / ≤ 40% 红色 / 中间段默认前景色
- **首页投票排行卡片化**：grid 三列布局（排名 / 候选人 / 票数），第一名 accent 边框高亮
- **管理后台 Season 卡片**：直接展示快捷操作按钮，无需跳转

### Changed
- **设计 token 体系**：全站字体更新为 Geist + JetBrains Mono + Noto Sans SC；新增 tracking 系列 token
- **在线人数计数器**移至 Header 右侧，Tab 下划线样式精简
- **赛季页**：新增 `getStandings` 共享函数，积分榜数据与 STANDINGS 面板对齐

### Fixed
- **admin 赛程**：`in_progress` 卡片左侧 3px accent 竖线标识；操作区改用 `<details>` 折叠，默认收起
- `--color-fg-muted`（未定义 token）修复为 `--color-fg-dim`
- admin 赛程 className 拼接改用 `cn()` 工具函数，消除无效 template literal
- **全站 hardcoded Tailwind 颜色替换为 design tokens**：MatchTimeNegotiation/MatchRosterView/MatchRosterForm/TimeProposalHistory/SwissBracket/MatchStatusBadge/StandingsTable 等 30+ 组件统一使用 `--color-ok`/`--color-danger`/`--color-warn`/`--color-info` token 体系
- `--color-yellow`/`--color-red`/`--color-surface-muted` 等无效 token 全部修复
- CLAUDE.md 组件清单与实际文件同步，补充 `scripts/check-claude-md.sh` 校验脚本

## [1.15.1] - 2026-05-18

### Fixed
- **MVP 次数统计修正**：选手个人页 MVP 计数从「总票数」改为「单场 MVP 获奖次数」；新增 `matches.mvp_winner_user_id` 持久化缓存，避免每次页面访问遍历全表投票记录；UI 标签改为「单场MVP」

### Added
- `ensureMvpWinner(matchId)` — 投票截止后首次访问比赛页时自动锁定 MVP 胜者（幂等）

## [1.15.0] - 2026-05-18

### Added
- **MVP 投票重构**：候选人由全部选手改为 Rating 前 4 名；候选人大卡展示完整数据（K/D/A/ADR/RWS/HS%/FK/MK/残局/Rating/WE）；多地图数据智能聚合（击杀类求和、场均类取均值、HS% 按击杀加权）；比赛结束 24 小时后自动截止投票并展示最终 MVP
- **赛程管理队伍筛选**：AdminMatchFilter 新增队伍下拉筛选；赛程按「进行中→已排期(越近越靠前)→已完成→已取消」排序
- **地图结果表格** PlayerStatsTable 新增 HS%/FK/MK/残局列
- `sumNums` / `avgNums` / `weightedAvgNums` 通用聚合函数（`src/lib/utils/stats.ts`）
- `MVP_DEADLINE_MS` 共享常量 + `getMatchPlayerOptions` / `getMatchVetoSteps` action
- **管理后台比赛详情增加队伍筛选** + 按开赛时间排序

### Changed
- **BP 录入流程优化**：BP 仅在比赛「进行中」时可用；打开对话框自动回填已保存数据（不再每次重置）
- **OCR 面板视图/编辑双模式**：已有数据时显示只读表格 +「重新录入」按钮；挂载时自动加载已保存数据
- **管理后台比赛列表增加队伍筛选** + 按开赛时间排序

### Fixed
- **管理后台 OCR「暂无数据」**：公开页已有数据但管理后台显示空白的 bug
- **BP 对话框错误处理**：异步加载失败不再卡 loading
- **StatsOCRPanel useEffect**：加 cleanup 标志防止卸载后 setState

## [1.14.3] - 2026-05-17

### Added
- **OCR 面板始终可见**：不再依赖识别结果才显示编辑表格，新增「添加行」按钮支持纯手动录入

### Fixed
- **OCR 大截图序列化崩溃**：extractStatsFromScreenshot 参数装箱，修复 React Flight 对数组内大字符串按 `.length` 计入 arraySizeLimit（1e6）导致的 "Maximum array nesting exceeded" 错误
- **Server Action 数组序列化**：savePlayerStats / saveVetoSteps / submitMatchRoster / updateMatchRoster 数组参数统一包在对象中，避免 Next.js 序列化限制
- **OCR 调试日志恢复**：移除过度的 DEBUG gate，日志恢复无条件输出以便生产排查

### Changed
- **数据库连接切 Transaction Pooler**：端口 5432 → 6543，`prepare: false`，连接池 max 1 → 3

## [1.14.2] - 2026-05-17

### Fixed
- **OCR 模型切换**：PaddleOCR-VL-1.5 / DeepSeek-OCR 均无法正确理解记分板表格，切换为 Qwen3-VL-8B-Instruct
- **OCR 兼容多种 JSON 格式**：手动提取 players 数组，兼容直接数组 / `{players}` / `{data:{players}}` 三种 LLM 返回格式
- **OCR 下拉仅显示两队队员**：从全赛季选手缩小为本场比赛两队成员（≤10 人），排除已被其他行匹配的玩家
- **OnlineCounter 容错**：`touchSession` 和 API 调用失败时静默跳过，不再阻塞页面渲染

### Changed
- **OCR 调试日志 gated**：`console.error` 改为 `DEBUG` 门控 `console.log/warn`，仅 dev 或 `OCR_DEBUG=true` 时输出
- **Code review 清理**：提取 `extractPlayersArray` helper，`useMemo(Set)` 优化下拉过滤 O(n²) → O(n)

## [1.14.1] - 2026-05-17

### Fixed
- **OCR 校验彻底放宽**：顶层仅校验数组结构（不再因单行缺字段整批丢弃），行级仅要求玩家名称非空，数值字段自动转换（`"15"` → `15`、`"N/A"` → `null`），移除所有范围上限
- **赛程总览显示比赛时间**：MatchCard 已排期显示日期、未排期显示「未排期」
- **队伍详情页补全**：新增「历史战绩」列表（比分/BO1·BO3/阶段/详情链接），调整顺序为阵容→即将进行→历史战绩

## [1.14.0] - 2026-05-17

### Added
- **在线人数统计**：`user_sessions` 表 + `OnlineCounter` 组件，每 2 分钟心跳，5 分钟内有活动的用户计为在线
- **赛程总览子 Tab**：排位赛/正赛内分「待进行」「已结束」子 Tab，已排期比赛按时间由近及远排序
- **BP 选边归属修正**：decider 步骤选边由对方选择时正确翻转 Team A 起始边
- **OCR 逐行宽松解析**：单行校验失败跳过而非整批丢弃，兼容不同格式截图
- **名单 2 小时窗口锁定**：距开赛 >2h 自由提交/修改，<2h 锁定，玩家按钮同步禁用

### Fixed
- **BP 录入放开 in_progress**：saveVetoSteps 允许 in_progress 状态，标准流程「开始→BP→比分」
- **VetoInputDialog 双 Tab 面板同步**：排位赛和正赛都可见
- **名单 UI 状态修正**：StatusPill "finished" 绿色误导 → 纯文字 "已提交"，倒计时文案加 2h 锁定警告

### Changed
- **Simplify 审查修复**：预索引 teamMembersByTeam（O(1) 查表）、移除冗余 new Date()、提取 resolveTeamASide helper

## [1.13.1] - 2026-05-17

### Added
- **开赛自动填名单**：点「开始比赛」时自动为两队取前 5 人作为默认首发（若队长未提交）
- **队长名单时间提示**：比赛详情页显示距开赛剩余时间、2 小时内锁警告、裁判检查提醒
- **时间协商名单提醒**：队长未提交名单时显示黄色警告条「请先提交赛前名单」

### Fixed
- **删除放开**：`deleteMatch` 移除 status 限制，所有非 bracket 比赛均可删除
- **后台布局优化**：AdminRosterDialog/VetoInputDialog 同行排列 + 每场比赛底部「查看公开页 ↗」链接
- **Drizzle 关系查询崩溃**：`VetoView` 和 admin roster 查询改用 `db.select()` 绕过 `buildRelationalQueryWithoutPK`
- **TOCTOU 竞态**：`recordMapResult` 地图重复检查移入事务内部
- **hasSubmittedRoster 默认值**：从 `true` 改为 `false`，忘记传 prop 时不会静默隐藏名单提醒
- **auto-fill 确定性**：默认队员按 `joinedAt` 排序，移除未用变量

## [1.13.0] - 2026-05-17

### Added
- **BO1 地图记录**：MapByMapInput 扩展 bo1 格式，recordMapResult 解除 BO1 限制，BO1 从 scheduled 自动推进到 in_progress
- **BP 选图流程**：match_veto_steps 表 + saveVetoSteps Server Action + VetoInputDialog（管理员录入 Dialog，BO1/BO3/BO5 模板） + VetoView（HLTV 风格纵向展示，ban 红 / pick 绿 / decider 黄）
- **管理员名单管理**：updateMatchRoster action + AdminRosterDialog（复选框选择 5 首发 + 2 替补，首发排序）
- **比赛详情页 OCR 入口**：已完图下方对管理员显示 StatsOCRPanel（OCR 数据录入）
- **比赛详情页分图 Tab 切换**：地图结果从纵向列表改为 Tab 切换，支持地图结构预展示 + BO1 fallback 展示系列总分
- **比赛删除功能**：deleteMatch Server Action + DeleteMatchButton（InlineConfirm 二次确认，级联删除 BP/地图/名单数据，禁删 bracket 生成比赛）

### Fixed
- **recordMapResult 状态准入**：scheduled 仅 BO1 可用，BO3/BO5 必须 in_progress（防止跳过开始比赛步骤）
- **BO1 fallback**：使用 `match.format` 替代硬编码 "BO1"
- **BP 服务端校验**：地图名/队伍/去重/图池合法性校验，防止绕过客户端直接调 API
- **TOCTOU 竞态**：recordMapResult 地图重复检查移入事务内部
- **side 列类型**：match_veto_steps.side 从 text 改为 sideEnum
- **VETO_STEP_COUNT**：常量对齐实际 buildTemplate 步骤数（统一 7 步）
- **_journal.json**：补齐 0011-0017 缺失迁移条目

### Changed
- **消除重复**：提取 SIDE_LABELS（4 处→1）、getMaxMaps()（2 处→1）、validateTeamMembers()（2 处→1）
- **移除 orphan**：MatchDetail.tsx（已被内联 server component 替代）
- **清理 JSX 注释**：移除叙述性注释

## [1.12.0] - 2026-05-17

### Added
- **管理员快捷入口**：公开页面（赛季首页/赛程/选秀/队伍）对管理员显示齿轮图标入口，直接跳转到对应后台管理页面
- **赛程队伍筛选**：赛程总览页支持按队伍筛选比赛（`?team=teamId`），管理员后台支持按阶段/状态筛选
- **队伍详情即将进行的比赛**：`/[seasonSlug]/teams/[teamId]` 展示该队 scheduled/in_progress 状态的比赛列表
- **后台新增比赛**：管理后台赛程页新增「新增比赛」Dialog 表单，支持选择队伍/阶段/赛制创建比赛
- **系统设置 OCR Key**：管理员设置页展示 `SILICONFLOW_API_KEY` 配置状态（有/无）
- **单场比赛队伍头像**：`MatchDetail` 展示双方队伍 logo，无 logo 时 fallback 为圆形首字母

### Fixed
- **shadcn/Tailwind v4 颜色桥接**：`@theme` 块补充 shadcn CSS 变量映射，修复按钮/Tab 颜色不渲染
- **Grand Final 赛制**：双败决赛从 `double`（两场 Grand Final）改为 `simple`（单场 BO5）
- **Bracket BYE→TBD**：brackets-viewer 中未确定对手从 "BYE" 改为 "TBD"
- **选秀状态文案**：区分「选秀已结束」（playing/finished）与「选秀尚未开放」，不再一律显示"尚未开放"
- **近期对决链接**：赛季首页 NEXT MATCHES 链接从赛程列表页改为具体比赛详情页
- **状态标签措辞**：`scheduled` 从"已排期"改为"待进行"，与"待定"（时间未定）语义区分
- **赛季导航间距**：SeasonNav 与 Stat 四格之间添加间距
- **UI 增强**：赛程总览排位赛/正赛 Tab 样式增强（可见边框+背景）；"开始比赛"按钮加 InlineConfirm 二次确认
- **auto-pick tiebreaker**：段位相同时从随机 UUID 改为 `createdAt` 报名时间比较
- **Cron 调度修正**：GitHub Actions 从 `* * * * *` 改为 `*/5 * * * *`，避免隐性限流导致实际 1 小时才执行一次

## [1.11.0] - 2026-05-16

### Added
- **队长面板选手搜索框**：支持按选手名模糊搜索，可与位置筛选联合使用
- **超时自动选人提示**：队长轮次时显示 auto-pick 候选人及优先级规则说明
- **双段位/Rating 显示**：同时展示历史最高段位+当前赛季段位，Rating 不同时并列显示

### Fixed
- **位置标签统一**：TeamDraftGrid 位置标识从中文混合改为统一英文（IGL/AWPer/Opener/Closer/Anchor）
- **观众 refresh debounce**：DraftLiveRoom 3s 节流防止 Realtime+轮询突发连接池压力

## [1.10.1] - 2026-05-16

### Fixed
- **选秀预览模式时机修正**：从 registration/voting 阶段改为 drafting 未激活时展示（此时队伍已组建），非 drafting 恢复简单提示
- **PLAYER_INFO_FIELDS 导入异常**：`as const` 常量从 `"use client"` 文件移至独立模块，修复 Server Component 中 `map is not a function` 运行时错误

## [1.10.0] - 2026-05-16

### Added
- **选秀预览模式**：选秀页在非 drafting 状态展示只读选手池，队长可提前查看选手信息（含风格/备注/经历 hover 卡片）研究阵容
- **选手个人页信息增强**：`/players/[userId]` 新增"选手自述"区块，展示风格、备注、比赛经历

### Changed
- **自动选人优先级升级**：从单一 peakRating 改为 5 级排序（peakRank → peakRating → currentRank → currentRating → registrationId），并优先填补队伍完全空缺的位置
- **sortByRank 排序扩展**：支持可选 currentRank / currentRating 字段，队长面板和选手池排序自动受益

## [1.9.0] - 2026-05-16

### Added
- **选秀选手悬停信息卡片**：选手行末尾新增 info 图标，hover 弹出风格/备注/比赛经历；仅在有内容时显示图标，不增加视觉噪音；支持 PlayerPool 观众页和 CaptainDraftPanel 队长面板

### Changed
- **菜单"个人信息"重命名**：右上角下拉"修改昵称"→"个人信息"，与 `/settings` 页面标题对齐

### Refactored
- **DraftPlayerRow 类型统一**：删除 `CaptainDraftPlayer` 重复接口，统一使用 `DraftPlayerRow`

## [1.8.0] - 2026-05-16

### Added
- **个人信息设置页**：`/settings` 扩展为完整个人信息表单，支持自助修改 displayName / perfectName / steamName / steam64 / steamProfileUrl / QQ / 学号，全站实时生效
- **时间协商 UI 重构**：显示所有 pending 提议（不再只显示第一条）；双方队长均可随时提议新时间；每条提议显示 24h 自动采纳倒计时
- **时间提议 24h 超时自动采纳**：cron 新增逻辑，单条提议超过 24h 未被对方回应则自动采纳（独立于 deadline 裁定机制）
- **批量设置比赛截止时间**：管理后台赛程页新增「批量设置截止时间」面板，按 stage / round / entryRound 分组一键设置，解决单循环多场逐一设置负担
- **选手列表页副位置**：卡片显示副位置；位置筛选改为"主/副位置 OR 匹配"，筛选某位置时副位置也该位置的选手同步出现
- **选秀围观页 PlayerPool 副位置**：桌面/移动端均显示副位置标签；位置筛选同步支持副位置匹配

### Fixed
- 投票阶段可撤回误审批：`approved→rejected` / `approved→pending` 允许 voting 阶段操作；已被选秀选中的选手禁止撤回

## [1.7.4] - 2026-05-16

### Fixed
- 审计日志 `actorId` 为 `"system"` 等非 UUID 字符串时触发 Postgres `22P02` 类型转换错误

### Added
- 审计日志目标列可读名称解析：按 targetType 批量查询对应表，显示用户名/赛季名/队名/比赛对阵等（替代截断 UUID）
- 审计日志 40+ action 中文别名映射，hover 显示原始字符串
- 操作类型筛选改为 `<optgroup>` 分组下拉菜单（管理/报名/投票/选秀/赛程/赛季/队伍/用户）

### Changed
- CLAUDE.md、README.md、docs/architecture.md 同步至 v1.7.4：补齐 actions 目录索引、cron 端点

## [1.7.3] - 2026-05-16

### Fixed
- 数据排行页 `sortColumn` 使用 Drizzle 列引用解析为全表名，与 SQL 别名 `mps` 冲突导致 Postgres `42P01` 错误

## [1.7.2] - 2026-05-16

### Fixed
- 全站统一 `getDisplayName()` 消除所有 `steamName` 裸显示：选手页、Header、队长投票/确认、选秀直播/网格、比赛名单/表单、管理员列表/审核/设置、审计日志、队伍阵容卡片（19 文件，约 20 处）
- 数据层查询同步扩展 `displayName` + `perfectName` 列（captains / draft / captain confirm / audit / admin registrations）
- `resolveAvatarUrl` 改为优先从 Steam API 拉取最新头像，DB 缓存兜底，解决过期 CDN 链接客户端 onError 不触发的边缘情况
- 赛季首页 `quickLinks` 快捷导航补「选手名单」卡片入口（v1.7.0 新增 /players 页面时遗漏）

## [1.7.1] - 2026-05-15

### Fixed
- Header 头像过期 CDN 链接显示浏览器蓝色问号：AvatarButton 增加 onError 回退 + Header 服务端增加 `getSteamAvatar()` 实时拉取回退（与选手页统一）
- Header mobile menu 关闭重开时 imgError 状态重置导致重复加载失败图片
- 选手名单页位置筛选项仅含 3 个中文标签，改为全部 5 个 positionValues 英文标签（IGL / AWPer / Opener / Closer / Anchor）
- 选手名单卡片 Position 标签改为英文 `positionLabel()`
- 赛季导航 `hasPlayers` 计数比较增加 `Number()` 包裹，防 bigint→string 类型失效

### Changed
- 注册页位置标签切换 `positionLabel()` 替代内联 `POSITION_LABELS[].en`
- 提取 `resolveAvatarUrl()` 共享函数到 `steam.ts`，消除 Header 与选手页重复

## [1.7.0] - 2026-05-15

### Added
- **选手名单页** `/[seasonSlug]/players`：展示已审核通过的报名选手，支持按位置筛选，卡片展示段位/Rating/所属队伍
- **赛季导航**「选手」入口（按 approved 报名数 > 0 条件渲染，遵循 capability 门控）
- **`getDisplayName()` 工具函数**：统一展示名称派生（displayName > perfectName > steamName > email），全站替代 `steamName ?? "未知选手"`
- **display_name 系统**：users 表新增 `display_name` 字段，设置页支持修改昵称，Header 未设置时橙色提示
- **选秀队长面板重构**：按段位+Rt 排序统一列表（替代旧的分列布局），满员位置灰显禁用，新增队长阵容摘要可折叠面板
- **选秀观众端增强**：pick 通知 Banner 3 秒淡出动画，选手池统一排序
- **队伍联系方式**：同队成员可见 QQ 与邮箱（仅队伍详情页渲染）
- `public/favicon.ico`：静态 favicon 防止路由被 `[seasonSlug]` 吞噬

### Fixed
- 统计页 `db.execute()` 返回 `QueryResult { rows }` 对象直接当数组迭代 bug（与 1.6.1 队伍详情页同类问题）
- DraftLiveRoom 通知双重触发（Realtime INSERT + completedPicks 竞态）
- DraftLiveRoom `positionLabel(steamName)` 参数错误

### Changed
- `positionLabel` 6 文件重复定义提取为共享函数
- `sortByRank` 提取为泛型工具函数 `src/lib/utils/rank.ts`
- 并行化队伍详情页 roster + matches 查询（`Promise.all`）
- `POS_ABBR` 移入 `registration.ts` 与位置常量共处
- layout.tsx season 查询用 `React.cache()` 去重

## [1.6.1] - 2026-05-15

### Fixed
- 队伍详情页 `db.execute()` 返回类型错误：未取 `.rows` 直接当数组迭代，无比赛数据时 500 报错

### Added
- 队长投票页：候选人卡片新增最高分段（Peak A+/S 等）与 RT 双字段展示
- 投票页说明：选秀第一轮逆向进行（排位最后的最先选人），引导按实力投票
- 确认队长二次弹窗：点击按钮后弹出不可撤销警告 + 队长名单确认，防误触
- 确认队长服务端校验：至少 3 票才允许确认，投票不足时返回 `VOTING_MINIMUM_NOT_MET`

## [1.6.0] - 2026-05-15

### Added
- 赛季首页：playing 阶段展示 NEXT MATCHES 面板（近 4 场未完赛比赛，含队名/时间/阶段）
- 赛季首页：底部四格 Stat 统计条（队伍数 / 已批准选手数 / 比赛进度 / 当前阶段）
- 首页 CURRENT SEASON 面板：补充队伍数 / 选手数 / 赛季阶段三栏 MiniStat
- 新增 `ScrollHint` 组件，横向滚动容器左右渐变遮罩，提示用户可滑动

### Fixed
- `CaptainVotingPanel`：移动端（< md）切换为候选人卡片列表（票数进度条 + 投票按钮），桌面端保留原表格布局
- `TeamDraftGrid`：移动端（< md）改为手风琴列表，当前选秀队自动展开，其余可点击折叠展开
- 选秀状态栏 `borderRight` inline style 改为 `md:border-r`，2 列时不再贴边
- `globals.css` `--font-sans` / `--font-display` 改为引用 `var(--font-geist)`，修复 next/font 哈希后字体回退问题
- `tailwind.config.ts` 清理残留 `--font-inter` 引用，统一为 `var(--font-geist)`
- 首页容器内边距 `px-9` → `px-4 lg:px-9`，375px 设备多出 40px 内容空间
- Header 移动端菜单监听 `pathname` 变化自动关闭，覆盖浏览器前进/后退场景

### Changed
- `SeasonNav` tab 导航应用 `ScrollHint`，多 tab 横向滑动时显示渐变遮罩
- 赛季首页 Phase Tracker 应用 `ScrollHint`
- 队长投票页、报名页标题统一为 Eyebrow + Title + Sub 模式（mono 小标 + 大标题 + 副标题）

## [1.5.0] - 2026-05-15

### Added
- 核心用户流程移动端适配：报名、投票、选秀、赛程查看 7 个组件/页面响应式布局

### Fixed
- 首页 Hero 两栏布局移动端溢出，改为响应式堆叠 + 标题字号缩小
- 赛季首页阶段流程图移动端裁切，改为 flex 横向滑动 + 桌面端等宽
- 队伍详情页移动端布局：战绩/数据 grid 响应式折行，阵容行 truncate 防溢出，地图/对阵表格 overflow-x-auto
- 首页导航 tiles `repeat(4,1fr)` 硬编码 grid → Tailwind `grid-cols-2 lg:grid-cols-4`
- 首页历史赛季 `repeat(3,1fr)` 硬编码 grid → `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`
- Footer 移动端：版权信息与链接竖排堆叠 + 居中
- MatchCard 移动端：队伍名与标签竖排堆叠，队名字号缩小

## [1.4.1] - 2026-05-14

### Fixed
- 下拉菜单项间距不均与内容区背景透明问题
- 个人主页 Steam 头像加载失败（新增 `avatars.steamstatic.com` 到 Next.js remotePatterns）

### Changed
- 全站用户名显示统一为 `steamName`（回退 `email`）：Header 下拉菜单、管理后台用户列表/设置页、审计日志操作人列、玩家主页
- 审计日志操作人列从原始 ID 改为可读名称（actorNameMap）
- 玩家主页数据增强：新增 MVP 票数、RWS、HS%、首杀、多杀、残局等统计
- 报名记录卡片重设计为紧凑两行布局，补 `peakWe`
- 新增 `perfectName` 显示
- 提取 `wAvg`/`sAvg` 工具函数并添加单元测试（8 case）
- 玩家主页报名/个人数据查询并行化（`Promise.all`）

## [1.4.0] - 2026-05-14

### Added
- 管理后台操作日志浏览页面：新增 `AuditLogTable` 与 `/admin/logs`，支持查看审计事件、操作者、目标与元数据。
- Server Actions 单元测试基础设施：新增 session mock、fixture、audit helper，并覆盖 auth、admin、captains、register、seasons、teams 等核心 actions。

### Changed
- 报名页显示当前用户报名状态；审核通过前允许自行修改并重新回到待审核，审核通过后锁定。
- 管理后台报名审核列表按提交时间升序展示，优先处理更早报名的选手。
- “等待名单”文案统一调整为“候补名单”，并更新报名状态机文档。
- 多个管理与用户操作补齐 audit_log 写入。

### Fixed
- 头像菜单新增“我的主页”入口，修复登录用户无法从右上角进入个人主页的问题。
- “撤销通过”现在回到待审核，而不是误标为已拒绝。

## [1.3.2] - 2026-05-14

### Changed
- README、CLAUDE.md、AGENTS.md 版本号同步至 1.3.2
- CI workflow：`pnpm tsc --noEmit` → `pnpm type-check`（包含 Next route typegen）
- Cron workflow：curl 加 `-fsS` flag，接口返回非 200 时 step 失败
- CLAUDE.md 版本号规范：明确 `npm version` 同步生成 tag，移除"合并后打 tag"表述

## [1.3.1] - 2026-05-14

### Fixed
- 管理后台选秀控制/赛程管理页面崩溃：`teams` 表缺 `logo_url` 列导致 Postgres 查询报错（补迁移 `0015_team_logo_url.sql`）

## [1.3.0] - 2026-05-14

### Added
- 队伍图标上传：`TeamLogoUpload` 组件 + `uploadTeamLogo` Server Action + Supabase Storage `team-logos` bucket（公开，1 MB / jpg+png+webp）
- 管理后台报名草稿查看：`DraftRegistrationTable` 展示邮箱、Steam 昵称、位置、段位、最后保存时间
- 修改密码功能：`changeUserPassword` Server Action（验证原密码 + Supabase Admin API 更新）+ `/settings/password` 页面
- `revokeUserAdminRole` Server Action：super_admin 可撤销其他管理员权限（写 audit_log）
- 共享常量配置：`src/lib/config/upload-limits.ts` / `auth-config.ts`

### Changed
- `MatchRosterForm` 视觉重设计：PosChip 位置标签、CSS 变量卡片样式、StatusPill 锁定态
- 管理员用户列表改为查询 `users` 表（role ≠ "user"），正确展示所有管理员
- `teams` 表新增 `logo_url` 列（nullable）
- Header：super_admin 隐藏邀请码入口；所有已登录用户新增修改密码入口

### Fixed
- 上传失败回退竞态：`lastConfirmedUrlRef` 替代 stale prop 快照

## [1.2.0] - 2026-05-13

### Added
- 报名地图熟练度：赛季图池配置 + 每图 5 档熟练度（不会/认路/能打/熟练/强图）
- Steam 头像缓存（`users.avatar_url`，Header 不再每次调 Steam API）
- 比赛时间协商截止自动裁定（`autoAwardMatchTime` + Cron API）
- 队长修改队伍名称（`TeamNameForm` + `updateTeamName`）
- 选秀池 + 队长面板选手主页链接（`/players/[userId]`）

### Changed
- 报名强制登录：未登录访问 `/register` → redirect `/login`，两条注册路径统一
- 密码字段从报名表单移除，统一走 `/login` 认证
- 报名截图链接改为选填
- 分支策略简化：删除 v2/v3 版本分支，dev 重置到 main

### Removed
- Magic Link 邮件功能（生产关闭邮件确认，不依赖 Supabase 邮件）

## [1.1.2] - 2026-05-13

### Fixed
- 报名草稿恢复逻辑修正
- 品牌图标接入

### Changed
- 许可证 MIT → AGPLv3

## [1.1.1] - 2026-05-13

### Fixed
- PhaseTracker 英文标签显示
- 报名草稿恢复提示优化
- 版本号显示修正

## [1.1.0] - 2026-05-13

### Added
- 动态 PhaseTracker：从 `stagePlan` 读取阶段进度，自动高亮当前阶段
- 报名草稿自动恢复（`registration_drafts` 表 + localStorage 兜底）
- 错误参考文档（`docs/error-reference.md`）

### Fixed
- 时区显示问题（统一 UTC 存储 + Asia/Shanghai 展示）
- 首页空赛季列表不崩溃
- 报名表单多项交互细节

## [1.0.2] - 2026-05-13

### Fixed
- 邀请码使用异常
- 版本号显示与 semver 策略

### Changed
- SQL 查询 filter 逻辑下沉到数据库层
- 统一使用 EmptyState 组件

## [1.0.0] - 2026-05-13

### Added
- 完整 8 队选秀联赛全流程：报名 → 审核 → 队长投票 → 蛇形选秀 → 队伍展示 → 赛程 + Bracket → 比分录入
- Tactical Grid 设计系统全站迁移（14 个组件 + CSS tokens + shadcn 覆盖）
- 管理后台完整功能：报名审核、邀请码管理、管理员列表、赛季管理
- 选手数据展示：跨赛季聚合、赛季排行榜、MVP 投票、比赛数据表
- 规则书站内渲染（9 章内容）
- Supabase Auth email+password + iron-session 双 Cookie 鉴权
- GitHub Actions Cron（选秀超时 + 报名截止自动推进）
- Vercel + Supabase 生产部署

[1.20.0]: https://github.com/Starfie1d1272/RivalHub/compare/v1.19.2...v1.20.0
[1.19.2]: https://github.com/Starfie1d1272/RivalHub/compare/v1.19.1...v1.19.2
[1.19.1]: https://github.com/Starfie1d1272/RivalHub/compare/v1.19.0...v1.19.1
[1.19.0]: https://github.com/Starfie1d1272/RivalHub/compare/v1.18.1...v1.19.0
[1.18.1]: https://github.com/Starfie1d1272/RivalHub/compare/v1.18.0...v1.18.1
[1.18.0]: https://github.com/Starfie1d1272/RivalHub/compare/v1.17.1...v1.18.0
[1.17.1]: https://github.com/Starfie1d1272/RivalHub/compare/v1.17.0...v1.17.1
[1.17.0]: https://github.com/Starfie1d1272/RivalHub/compare/v1.16.1...v1.17.0
[1.16.1]: https://github.com/Starfie1d1272/RivalHub/compare/v1.16.0...v1.16.1
[1.16.0]: https://github.com/Starfie1d1272/RivalHub/compare/v1.15.1...v1.16.0
[1.15.1]: https://github.com/Starfie1d1272/RivalHub/compare/v1.15.0...v1.15.1
[1.15.0]: https://github.com/Starfie1d1272/RivalHub/compare/v1.14.3...v1.15.0
[1.14.3]: https://github.com/Starfie1d1272/RivalHub/compare/v1.14.2...v1.14.3
[1.14.2]: https://github.com/Starfie1d1272/RivalHub/compare/v1.14.1...v1.14.2
[1.14.1]: https://github.com/Starfie1d1272/RivalHub/compare/v1.14.0...v1.14.1
[1.14.0]: https://github.com/Starfie1d1272/RivalHub/compare/v1.13.1...v1.14.0
[1.13.1]: https://github.com/Starfie1d1272/RivalHub/compare/v1.13.0...v1.13.1
[1.13.0]: https://github.com/Starfie1d1272/RivalHub/compare/v1.12.0...v1.13.0
[1.12.0]: https://github.com/Starfie1d1272/RivalHub/compare/v1.11.0...v1.12.0
[1.11.0]: https://github.com/Starfie1d1272/RivalHub/compare/v1.10.1...v1.11.0
[1.10.1]: https://github.com/Starfie1d1272/RivalHub/compare/v1.10.0...v1.10.1
[1.10.0]: https://github.com/Starfie1d1272/RivalHub/compare/v1.9.0...v1.10.0
[1.9.0]: https://github.com/Starfie1d1272/RivalHub/compare/v1.8.0...v1.9.0
[1.8.0]: https://github.com/Starfie1d1272/RivalHub/compare/v1.7.4...v1.8.0
[1.7.4]: https://github.com/Starfie1d1272/RivalHub/compare/v1.7.3...v1.7.4
[1.7.3]: https://github.com/Starfie1d1272/RivalHub/compare/v1.7.2...v1.7.3
[1.7.2]: https://github.com/Starfie1d1272/RivalHub/compare/v1.7.1...v1.7.2
[1.7.1]: https://github.com/Starfie1d1272/RivalHub/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/Starfie1d1272/RivalHub/compare/v1.6.1...v1.7.0
[1.6.1]: https://github.com/Starfie1d1272/RivalHub/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/Starfie1d1272/RivalHub/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/Starfie1d1272/RivalHub/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/Starfie1d1272/RivalHub/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/Starfie1d1272/RivalHub/compare/v1.3.2...v1.4.0
[1.3.2]: https://github.com/Starfie1d1272/RivalHub/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/Starfie1d1272/RivalHub/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/Starfie1d1272/RivalHub/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/Starfie1d1272/RivalHub/compare/v1.1.2...v1.2.0
[1.1.2]: https://github.com/Starfie1d1272/RivalHub/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/Starfie1d1272/RivalHub/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/Starfie1d1272/RivalHub/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/Starfie1d1272/RivalHub/compare/v1.0.0...v1.0.2
[1.0.0]: https://github.com/Starfie1d1272/RivalHub/compare/v0.3.0...v1.0.0
