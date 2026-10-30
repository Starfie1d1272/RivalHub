# 1.0–1.20 逐版证据

对照原 Release、历史日志及版本区间提交；修改和遗漏依据具体版本提交。1.0.0 至 1.2.0 的日志条目没有 GitHub Release，未新建。

1.10.0 的 tag 指向 `ad9f7f3f`，其中包含原日志误放在 1.10.1 的选手页导入修复；1.18.1 的 MVP 次数说明重复 1.15.1 的 `f1057ad4`，该区间没有此改动。1.15.1 的 Analytics、1.16.0 的队伍地图面板及 1.7.3 的头像修复由区间提交补齐。

## 1.20.5

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.20.4...v1.20.5)：c8217d85 fix: DB 日志降噪 + OCR API 超时保护和响应日志；e85286aa 1.20.5；d8857e35 docs: CHANGELOG 1.20.5。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.20.5)：有正文候选，待独立审阅。

## 1.20.4

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.20.3...v1.20.4)：966ca757 fix: pool 重建后重试查询，防止冷启动首请求 Load failed；f90ca1c1 fix: 修复 db/client Proxy 类型错误，确保无增量缓存的 CI 环境通过；885f66cc fix: 修复 DB 类型循环引用导致 CI type-check 失败；aa4afc8f 1.20.4；7b48659c fix: OCR 静默失败修复 + Vercel 冷启动 DB 连接自愈。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.20.4)：有正文候选，待独立审阅。

## 1.20.3

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.20.2...v1.20.3)：a88eca21 1.20.3；2e8fd31c refactor: 精简文档并拆分大文件。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.20.3)：有正文候选，待独立审阅。

## 1.20.2

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.20.1...v1.20.2)：418b79ef 1.20.2；58185c6f docs: CHANGELOG 1.20.2；9468d339 fix: 队伍详情页选手行移动端布局修复；257f2417 chore: add Vercel Speed Insights。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.20.2)：有正文候选，待独立审阅。

## 1.20.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.20.0...v1.20.1)：e91ef2a5 1.20.1；61d75ed4 docs: CHANGELOG 1.20.1；0c60ead6 fix: 移动端布局修复 + MatchCard 对战对称 + 六维取上场前5。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.20.1)：原文与日志核对后保留。

## 1.20.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.19.2...v1.20.0)：5fabfd1a 1.20.0；e0ebca04 docs: 同步文档至 v1.20.0 — CLAUDE.md 版本号与组件清单；8364fa4d docs: CHANGELOG 1.20.0；6fa9d9f2 fix: 积分榜平局顺序调整为净胜→H2H→总胜回合；修复赛程卡片和首页队名截断溢出；5f9f259b chore: 清理未使用的 sAvg 导入和自解释注释；5ac2e956 feat: 用户管理页新增所有用户 Tab——统计卡片、搜索、参赛筛选、优化管理员列表样式；37eb0779 fix: 选秀回顾页显示完整选人记录——只读模式不再隐藏 pick 历史；8cdf5f07 feat: 选秀结束后保留完整选人记录——以只读模式展示选秀回顾；93e61ce9 feat: 新增 MKPR /100r 指标——数据排行榜与选手页同步展示多杀率；d0164d76 docs: 重排 CHANGELOG compare 链接为严格倒序。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.20.0)：原文与日志核对后保留。

## 1.19.2

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.19.1...v1.19.2)：dc756d38 1.19.2；1aac9e24 docs: 更新 CHANGELOG v1.19.2；507b8870 refactor: Z-score 乘数 20 → 22，微调拉满概率；4e7babb5 refactor: 优化六维雷达图权重与 Z-score 缩放系数；9fa96eed fix: 统一选手页和 H2H 的 FKPR/CPR/KPR 为 per-round 口径。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.19.2)：原文与日志核对后保留。

## 1.19.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.19.0...v1.19.1)：d970bd2a 1.19.1；316866a1 docs: 更新 CHANGELOG v1.19.1；3ecbde07 fix: 修复排行榜 FKPR/CPR 显示精度——SQL round(2) → round(4)；1e88239c chore: 优化 CI 构建缓存与类型检查流程；bb83c1df docs: 补全 CHANGELOG compare 链接（v1.18.0 / v1.18.1 / v1.19.0）；b73c948d docs: 移除 CHANGELOG 中重复的 [1.18.0] 条目。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.19.1)：原文与日志核对后保留。

## 1.19.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.18.1...v1.19.0)：ab55b62d 1.19.0；d001f3bb docs: 更新 CHANGELOG v1.19.0；b07d0623 Merge pull request #158 from Starfie1d1272/feat/issue157-hexagon-auth。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.19.0)：有正文候选，待独立审阅。

## 1.18.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.18.0...v1.18.1)：0f9ba3e3 1.18.1；0cd7442f fix: KPR/ADR/HS%/FK/Clutch 改为回合加权 + 雷达图颜色解耦 + 赛后隐藏内容；c9a3aee7 Merge branch 'main' into dev；bd8be8d0 fix: 雷达图图例移出 SVG 到卡片底部，纵向排列不重合；daedb908 fix: 赛后隐藏对比段落 + 雷达图图例移至左下角。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.18.1)：有正文候选，待独立审阅。

## 1.18.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.17.1...v1.18.0)：62b27faa 1.18.0；445cb035 docs: 更新 CHANGELOG v1.18.0；5f0d21c6 refactor: 消除冗余查询、合并重复函数、硬编码颜色替换为 design token；16337b1b feat: 重构比赛详情页——赛季对比、雷达图、H2H、阵容对比、整场汇总；2c81cdf6 refactor: 重构队伍页布局与数据展示；d718a682 feat: 重构数据统计排行榜——补全全部字段并修复 SQL 口径问题；8c3327b2 refactor: replace match card grid with flat row list style；51aa1058 fix: increase match card spacing from space-y-2 to space-y-3。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.18.0)：有正文候选，待独立审阅。

## 1.17.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.17.0...v1.17.1)：380cc3d8 fix: update test fixtures de_train → de_overpass to match new map pool；0bd56012 1.17.1；71a6f900 docs: 同步文档至 v1.17.1 — CLAUDE.md/AGENTS.md；357ac8ff docs: CHANGELOG 1.17.1；221a00ee fix: replace de_train with de_overpass in DEFAULT_CS2_MAP_POOL；7767182b fix: use season registrationConfig.mapPool instead of hardcoded DEFAULT_CS2_MAP_POOL on team page；413ead99 fix: show completed_at time on finished matches, sort done matches by completion time desc。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.17.1)：原文与日志核对后保留。

## 1.17.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.16.1...v1.17.0)：b82e0184 docs: CHANGELOG 1.17.0 补录后续修复与功能；d0214457 fix: relax stat validation ranges — no upper limit on counts, wider adr/rating bounds；7b513b4d feat: stats validation (range check + clear button)；f867d688 fix: stats page crash (numeric→string coercion) + add auth/ to component registry；37cac28c fix: canGeneratePlayoff unaffected by UI filters + simplify check script + document PascalCase convention；ca644d66 chore: rename component files to PascalCase (layout/ + rivalhub/)；3527fb73 chore: refactor check-claude-md.sh — filesystem-driven, no hardcoded list；44bea9a4 1.17.0；9973c84e docs: 同步文档至 v1.17.0 — CLAUDE.md 补 AdminMatchRow，更新组件数量至 28；0a4f0e08 docs: CHANGELOG 1.17.0；83160e93 feat: match score correction for finished matches + CS2 round score validation；23956bfd test: add date utility tests to meet coverage threshold。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.17.0)：有正文候选，待独立审阅。

## 1.16.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.16.0...v1.16.1)：9f55d965 1.16.1；5478da7c chore: v1.16.1 — layout consistency, token cleanup, player name links。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.16.1)：有正文候选，待独立审阅。

## 1.16.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.15.1...v1.16.0)：e541fbcd chore: lower coverage threshold to 28% + update CHANGELOG for token fixes；dbf7a290 docs: add CLAUDE.md component verification to release workflow；915e1dea chore: add CLAUDE.md component verification script；1e7c49fd docs: sync CLAUDE.md component list with actual codebase；047f8113 fix: replace remaining emerald/amber hardcoded colors with design tokens；82a94ba8 fix: replace hardcoded Tailwind colors with design tokens across 21 files；b690824e fix: replace invalid tokens + hardcoded Tailwind colors in match pre-game components；130be06b docs: fix CHANGELOG compare links — consolidate into one ordered block；0a9271c8 1.16.0；a7117d42 docs: 同步文档至 v1.16.0 — CLAUDE.md；6882cd40 docs: CHANGELOG 1.16.0；bca4c98b docs: sync ui-design + CLAUDE.md for UI optimization v2 (PhaseStep, hero 3-state, admin matches)；f4c59f3c Merge pull request #144 from Starfie1d1272/feat/ui-optimization-v2；1ae57f36 feat: add team map performance panel with win rate and ban rate (#142)；8cc8db10 refactor: extract MatchTabsSection component, remove ~50 lines duplicate JSX (#125)；dcaf2dea refactor: add MatchStatus/MatchFormat type guards, eliminate inline casts (#126)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.16.0)：有正文候选，待独立审阅。

## 1.15.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.15.0...v1.15.1)：119db721 1.15.1；f1057ad4 fix: MVP 次数从总票数修正为单场获奖次数 + 持久化缓存；9429f27a feat: add Vercel Analytics。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.15.1)：有正文候选，待独立审阅。

## 1.15.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.14.3...v1.15.0)：3f1d75d9 1.15.0；6eee258c feat: MVP 投票重构 + 赛程管理优化 — Rating 前4候选人/大卡/跨图聚合/24h截止；BP仅in_progress/自动回填；OCR面板只读/编辑双模式；AdminMatchFilter队伍筛选+时间排序。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.15.0)：有正文候选，待独立审阅。

## 1.14.3

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.14.2...v1.14.3)：7e6c8f2b chore(release): bump version to v1.14.3；eb9503e5 docs: 更新 CHANGELOG v1.14.3 + 补齐比较链接 + 同步版本号至 CLAUDE.md；f403615e fix: extractStatsFromScreenshot 参数装箱，修复大截图触发 React Flight arraySizeLimit；b7ad1e92 Merge branch 'main' into dev；66729045 fix: 所有 Server Action 数组参数包在对象中，彻底解决序列化限制；2a46e584 Merge branch 'main' into dev；062ead26 fix: savePlayerStats 数组包在对象中，避免 Next.js Server Action 序列化限制；f802ac27 feat: OCR 面板始终可见 + 手动添加行 + OCR 日志无条件输出；6a3f0c62 fix: OCR 日志恢复无条件输出（移除 DEBUG gate）；b8a153b9 Merge pull request #136 from Starfie1d1272/dev；ae5a7601 Merge pull request #135 from Starfie1d1272/dev；d4202a41 Merge pull request #134 from Starfie1d1272/dev。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.14.3)：有正文候选，待独立审阅。

## 1.14.2

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.14.1...v1.14.2)：e655b807 1.14.2；bf5615a3 docs: CHANGELOG v1.14.2；1c08d732 refactor: code review 清理 — memoize OCR 下拉过滤 + 提取 helper + gated debug logs；6582bb6b fix: OCR 下拉仅显示两队队员 + 排除已匹配 + OnlineCounter 容错；63e1b1bc Merge pull request #133 from Starfie1d1272/dev；eeba728f Merge pull request #132 from Starfie1d1272/dev；df448442 Merge pull request #131 from Starfie1d1272/dev；84e717d9 fix: OCR 提示词重写 — 明确表格行列布局、列顺序、跳过标题行、10 行强制提取；75fa5205 Merge pull request #130 from Starfie1d1272/dev；f352c861 debug: OCR 添加模型原始返回和解析结果日志，定位 players 数组缺失根因；9a1a42b5 Merge pull request #129 from Starfie1d1272/dev；717c3813 fix: OCR 顶层解析兼容 LLM 外层包装 — 直接数组/{players}/{data:{players}} 三种格式；72b25adf Merge pull request #128 from Starfie1d1272/dev；7e75afcd Merge pull request #127 from Starfie1d1272/dev；ae1c5bca Merge pull request #124 from Starfie1d1272/dev；57cf0f9d Merge pull request #123 from Starfie1d1272/dev；adedbbbf Merge pull request #122 from Starfie1d1272/dev；d6cfb4e9 Merge pull request #121 from Starfie1d1272/dev；dd5c69c6 Merge pull request #120 from Starfie1d1272/dev；54d61269 Merge pull request #119 from Starfie1d1272/dev；ec74c928 Merge pull request #118 from Starfie1d1272/dev；fc9d02c3 Merge pull request #117 from Starfie1d1272/dev；85dca3aa Merge pull request #116 from Starfie1d1272/dev；3c3caf61 Merge pull request #111 from Starfie1d1272/dev；266cdb97 Merge pull request #110 from Starfie1d1272/dev；4a2a75e0 Merge pull request #109 from Starfie1d1272/dev；da4074b1 Merge pull request #108 from Starfie1d1272/dev；39bd57ff Merge pull request #107 from Starfie1d1272/dev；77fa19f4 Merge pull request #106 from Starfie1d1272/dev；a4a711ce Merge pull request #105 from Starfie1d1272/dev；09348ed1 Merge pull request #104 from Starfie1d1272/dev；7d5e37b8 Merge pull request #103 from Starfie1d1272/dev；40ebd0b3 Merge pull request #102 from Starfie1d1272/dev；2671a942 Merge pull request #101 from Starfie1d1272/dev；4432d8f6 Merge pull request #100 from Starfie1d1272/dev；def6de4f Merge pull request #99 from Starfie1d1272/dev；28743244 Merge pull request #98 from Starfie1d1272/dev；6f495480 Merge pull request #96 from Starfie1d1272/dev；2374e39e Merge pull request #95 from Starfie1d1272/dev；36812a03 Merge pull request #94 from Starfie1d1272/dev；0348426c Merge pull request #93 from Starfie1d1272/dev；ebccb529 Merge pull request #91 from Starfie1d1272/dev；d4887156 Merge pull request #86 from Starfie1d1272/dev。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.14.2)：有正文候选，待独立审阅。

## 1.14.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.14.0...v1.14.1)：7c4b1867 1.14.1；73b68523 fix: OCR 校验彻底放宽 + 赛程时间显示 + 队伍页历史战绩。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.14.1)：有正文候选，待独立审阅。

## 1.14.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.13.1...v1.14.0)：a52bbb5f 1.14.0；b36b82b4 docs: CHANGELOG v1.14.0；a469de77 chore: simplify 审查修复 — 预索引/挂载守卫/移除冗余/提取 helper；a5fa72b8 fix: BP decider 选边归属修正 + OCR 逐行宽松解析；8e50b9aa feat: 公开赛程页 — 待进行/已结束子 Tab + 按开赛时间排序；83a90141 fix: 名单倒计时文案加 2h 锁定警告；c0a1b40d fix: 名单提交改为仅 2h 窗口锁定，允许窗口外自由修改重提交；b300656f fix: MatchRosterForm — StatusPill 绿色'已完成'改成'已提交'文案 + 去掉误导性绿色 pill；2c9b74a7 fix: BP 录入允许 in_progress 状态 + 双 Tab 面板同步更新。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.14.0)：有正文候选，待独立审阅。

## 1.13.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.13.0...v1.13.1)：4947ef84 1.13.1；454479fe docs: CHANGELOG v1.13.1 — hotfix 合集；7d026908 fix: 已取消比赛不显示孤立的 Separator；edcb860e fix: validateTeamMembers 按 ID 过滤避免加载全队成员；6db2825a fix: auto-fill 名单查询加 orderBy + 移除未用变量 + 修正注释 + 批量查询优化；9b018494 fix: hasSubmittedRoster 默认值改为 false（缺失时不隐藏名单提醒）；351b1ea0 feat: 开赛自动填名单 + 队长名单提交时间提示 + 时间协商名单提醒；440faed3 fix: 删除放开所有非 bracket 比赛 + 后台赛程页布局优化 + 公开页链接；cbbe2a83 docs: v1.13.0 知识同步 — 版本号/新表/组件清单/deployment 排错流程；78d5bac3 fix: admin matches roster 查询绕过 Drizzle 关系构建器，避免 buildRelationalQueryWithoutPK 崩溃；b85c90ce fix: VetoView 改用 db.select() 绕过 Drizzle 关系查询构建器。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.13.1)：有正文候选，待独立审阅。

## 1.13.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.12.0...v1.13.0)：dfd3fb61 1.13.0；df1c1bc8 docs: CHANGELOG v1.13.0 — 比赛模块深度补齐；1f2db208 refactor: 提取 validateTeamMembers 消除 roster 验证重复；891db8f2 refactor: 提取 SIDE_LABELS + getMaxMaps 消除重复；3c4a6624 fix: recordMapResult TOCTOU + saveVetoSteps 死代码 guard；cad6d27e fix: match_veto_steps.side 列改用 sideEnum 替代 text；b65c5b75 fix: VETO_STEP_COUNT 常量对齐实际 buildTemplate 步骤数；29deed9e feat: 比赛删除功能 — deleteMatch action + DeleteMatchButton（二次确认+级联删除）；d4f9985e chore: 移除 orphaned MatchDetail 组件（已被内联 server component 替代）；40528448 feat: 比赛详情页分图 Tab 切换 + 地图结构预展示 + BO1 fallback；5153be4d feat: 管理员名单管理 — updateMatchRoster action + AdminRosterDialog；1869ee6d fix: saveVetoSteps 服务端输入校验（地图/队伍/去重/图池）+ 批量 insert + 消除冗余查询；5cf15ce4 feat: BP 选图流程 — veto_steps 表、管理员录入 Dialog、HLTV 纵向展示组件；0d23acd9 feat: 比赛详情页 admin 可见 OCR 录入入口（每张已完图下方）；ce240d9b fix: BO1 fallback 展示使用 match.format 替代硬编码 'BO1'；75d32aa1 fix: recordMapResult 状态准入限制 — scheduled 仅 BO1 可用，BO3/BO5 必须 in_progress；1a511aa5 feat: BO1 地图记录支持 — MapByMapInput 扩展 bo1，recordMapResult 解除 BO1 限制。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.13.0)：有正文候选，待独立审阅。

## 1.12.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.11.0...v1.12.0)：3e006427 refactor: 代码审查清理 — 消除重复常量、并行化查询、事件委托、删除冗余注释；cec03b78 消除 MATCH_FORMAT_LABELS/STAGE_LABELS 重复定义，统一从 @/types/match 导入；252f67bb 1.12.0；5ab2e9cd docs: CHANGELOG v1.11.1 → v1.12.0（minor bump，含新功能）；9d306349 docs: 移除 CHANGELOG 中不存在的 CS2 段位更新条目；46a3bbbc docs: 同步 v1.11.0 后 22 个 commit 的 CHANGELOG，更新 README 版本号与 cron 描述；9110aa15 fix(cron): GitHub Actions 调度间隔从每分钟改为每5分钟，避免隐性限流导致实际1小时才执行一次；e82f2386 fix(draft): auto-pick 同段位 tiebreaker 改用报名时间而非随机 UUID；be3182a9 fix(theme): 桥接 shadcn CSS 变量到 Tailwind v4 @theme，修复按钮/Tab 颜色不渲染；39d0baf0 feat(admin): 后台赛程页新增「新增比赛」表单与阶段/状态筛选；7fdffea5 fix(matches): "开始比赛"按钮添加 InlineConfirm 二次确认；7960a662 feat(ui): 公开页面添加管理员快捷入口按钮；100d5fa5 style(matches): 赛程总览 Tab 样式增强；920935ca feat(teams): 队伍详情页展示即将进行的比赛；65ae93ec fix(matches): 将 scheduled 状态标签从"已排期"改为"待进行"；13073217 feat(matches): 单场比赛页添加队伍头像显示；21eca13e feat(matches): 赛程页新增按队伍筛选功能；aecb657c feat(admin): 系统设置添加 SiliconFlow OCR API Key 配置项；6eb52970 fix(home): 赛季导航与 Stat 四格之间添加间距；f62d4112 fix(draft): 区分选秀已结束与尚未开放的状态文案；43d8b258 fix(bracket): Bracket 视图中 BYE 文本替换为 TBD；c7779af4 fix(home): 近期对决链接跳转到具体比赛详情页；91dc1ed7 fix(bracket): Grand Final 改为 simple，双败决赛只打一场 BO5；767b67c2 revert(draft): 回滚 CaptainDraftPanel 调试修改，恢复原始 canSubmit/readonly 逻辑；08693485 feat(draft): 选秀页新增「进入队长选人面板」入口链接；ebb13e11 fix(draft): 移除队长面板 PlayerInfoPopover 减少视觉干扰；2ed42835 fix(draft): pick 按钮始终可见、可点击，不再受 readonly/canSubmit 条件隐藏；a3b102c0 fix(draft): 蛇形选秀第一轮改为反序（后位先选）；29aefda6 fix: autoPickCandidate 解析为完整 DraftPlayerRow 修复 TS2559。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.12.0)：原文与日志核对后保留。

## 1.11.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.10.1...v1.11.0)：c1892f0c 1.11.0；2a28ca46 docs: 同步文档至 v1.11.0 — CLAUDE.md/AGENTS.md；10b57fa2 docs: CHANGELOG 1.11.0；b156fad3 feat(draft): 队长面板增强 — 搜索框/双段位/auto-pick提示/debounce/位置标签统一。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.11.0)：原文与日志核对后保留。

## 1.10.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.10.0...v1.10.1)：ff025ad7 1.10.1；ba39db8c docs: 同步文档至 v1.10.1 — CLAUDE.md/AGENTS.md/README.md；55fb1b1e docs: CHANGELOG 1.10.1；9b580ea0 fix: 预览模式改为 drafting 未激活时展示，非 drafting 恢复简单提示。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.10.1)：有正文候选，待独立审阅。

## 1.10.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.9.0...v1.10.0)：ad9f7f3f fix: PLAYER_INFO_FIELDS 从 use client 文件移至独立模块，修复 Server Component 导入异常；4c5e6f95 1.10.0；bb57fab1 docs: 同步文档至 v1.10.0 — CLAUDE.md/AGENTS.md/README.md；cd132f21 docs: CHANGELOG 1.10.0；def9b9c2 feat: 选秀自动选人5级优先级 + 空位置优先 + 选秀预览模式 + 选手页信息增强；acd5e470 docs: release skill 增加 Step 9 创建 dev→main PR；8a060c9c docs: 同步文档至 v1.9.0 — CLAUDE.md/AGENTS.md + release skill 增加文档同步步骤。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.10.0)：有正文候选，待独立审阅。

## 1.9.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.8.0...v1.9.0)：5e60252e 1.9.0；3bf3d015 docs: CHANGELOG 1.9.0；be5af67f feat: 选秀选手悬停信息卡片 + 个人信息菜单重命名 + 类型统一；38d0b758 chore: release skill + CHANGELOG 1.8.0 compare 链接 + .gitignore 开放 .claude/skills；dad364e8 docs: 同步 v1.8.0 文档 — CLAUDE.md/AGENTS.md/README.md/state-machines.md。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.9.0)：有正文候选，待独立审阅。

## 1.8.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.7.4...v1.8.0)：dfdabd0c refactor: simplify review 修复 — TZ 解析、死代码删除、循环并发化；ca6769ad 1.8.0；edfbba55 feat: 副位置展示/筛选、个人信息设置页、时间协商优化、批量截止时间；17354172 docs: CHANGELOG 1.8.0；c6e6f99f fix: captain_vote targetId 实际是 candidateRegistrationId，改为按 registration 解析。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.8.0)：原文与日志核对后保留。

## 1.7.4

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.7.3...v1.7.4)：c00ab195 1.7.4；1f928f0b docs: CHANGELOG 1.7.4 + 全站文档同步至 v1.7.4；dd6ebbf7 feat: 审计日志可读性增强 — 目标名称解析 + action 中文别名 + 分组下拉筛选。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.7.4)：原文与日志核对后保留。

## 1.7.3

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.7.2...v1.7.3)：759969cb 1.7.3；859eb77a docs: CHANGELOG 1.7.3 — 数据排行页 SQL 别名修复；ef4e3d7d fix: 数据排行页 ORDER BY 引用全表名导致 42P01 错误；b2eb0a20 fix: Steam 头像增加超时保护 + 回写 DB 缓存，消除过期 CDN 链接导致的蓝色问号。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.7.3)：有正文候选，待独立审阅。

## 1.7.2

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.7.1...v1.7.2)：8f888234 1.7.2；db19bd85 docs: CHANGELOG 1.7.2 — 全站 getDisplayName + 首页入口 + 头像优先拉新；2e594b86 fix: 赛季首页快捷导航补选手名单入口 + 头像优先从 Steam 实时拉取；69fe6401 fix: 全站统一 getDisplayName() — 消除所有 steamName 裸显示。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.7.2)：原文与日志核对后保留。

## 1.7.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.7.0...v1.7.1)：ac5be56c 1.7.1；4fb0f19e docs: CHANGELOG 1.7.1 — 头像回退 + 位置标签英文 / 重复消除；d83c1814 refactor: 消除头像/位置标签代码重复 — /simplify 审查修复；888b3adf fix: Header 头像加载与选手页统一 — 增加 getSteamAvatar 实时回退；4f7d333a fix: 头像破损回退 + 选手名单 5 位置英文筛选 + count() 类型安全；4c150af7 chore: 修复 release workflow changelog 提取 + README 更新至 1.7.0。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.7.1)：有正文候选，待独立审阅。

## 1.7.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.6.1...v1.7.0)：ed3523fa docs: 更新 CHANGELOG 1.7.0 完整范围；5ed98e93 chore: 代码清理 — 删除 WHAT 注释 + FILTER_ALL 常量 + POS_ABBR 移入 shared + layout React.cache；2f771bca refactor: 提取 positionLabel/sortByRank 共享函数 + 修复 DraftLiveRoom 竞态；e8950a42 feat: v1.7.0 增强 — display_name 系统 + 选秀 UI 重构 + 联系方式；fdaf26b1 1.7.0；5f6fd25f feat: v1.7.0 — 选手名单页 + displayName 工具 + 基础设施修复。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.7.0)：有正文候选，待独立审阅。

## 1.6.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.6.0...v1.6.1)：2f0ec1e2 1.6.1；40419072 fix: 修复队伍详情页 500 报错 + 队长投票展示增强与确认防护；a591a3f1 ci: read CHANGELOG from main in release workflow；a7ca8765 docs: note --follow-tags requirement for npm version push；a57b6274 docs: relocate v1 todos to issue #87 + README microedits；50debaea chore: simplify project structure；18738495 docs: sync v1.6.0 — ScrollHint, mobile layouts, NEXT MATCHES, Stat quad；e87982f4 refactor: simplify season page queries and date formatting；3ab83792 chore: bump version to 1.6.0, update CHANGELOG。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.6.1)：原文与日志核对后保留。

## 1.6.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.5.0...v1.6.0)：3164dd73 1.6.0；48652501 feat: P2 设计还原 — NEXT MATCHES 面板 + Stat 四格 + 首页 CURRENT SEASON 统计数据；11d80b82 feat: design audit v1.5.0 优化 — 移动端适配 + 设计还原（12 文件）；4db1e3f4 feat: design audit v1.5.0 优化 — 移动端适配 + ScrollHint + 字体变量修复；c50ad4dd fix: ACTION_CATEGORIES 加 captains 向后兼容别名；85f48122 fix: 补全剩余选手页面移动端适配 + 代码质量修复；d74fce93 docs: 补 1.5.0 changelog；4f0ba5d1 fix: 首页 + 赛季首页移动端布局修复。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.6.0)：原文与日志核对后保留。

## 1.5.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.4.1...v1.5.0)：d7edceb5 1.5.0；b5d8d4be feat: 核心用户流程移动端适配（报名/投票/选秀/赛程）；f87e9a09 docs: 补 1.4.1 changelog。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.5.0)：原文与日志核对后保留。

## 1.4.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.4.0...v1.4.1)：8e9cdf36 1.4.1；e3d5af46 fix: 下拉菜单/头像修复 + 用户名统一 + 玩家主页数据增强。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.4.1)：有正文候选，待独立审阅。

## 1.4.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.3.2...v1.4.0)：32dfc7a9 chore: bump to 1.4.0；4db9caf4 fix: 修复报名开放期状态与审核流；2b246442 feat: 测试基础设施 + 核心 Server Actions 单元测试 (#89)；f333d006 feat: 补全审计日志 + 操作日志浏览页面 (#88)；d499fa74 Merge branch 'main' into dev — 解决 CHANGELOG + package.json 冲突。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.4.0)：有正文候选，待独立审阅。

## 1.3.2

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.3.1...v1.3.2)：d4461685 chore: bump to 1.3.2 — 版本号同步 + CI/Cron 工作流修正 + 文档清理；3d451390 docs: cherry-pick v1.3.1 hotfix entry to dev CHANGELOG；89196ed3 fix: add missing team_logo_url migration — production crash on admin draft/matches pages。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.3.2)：有正文候选，待独立审阅。

## 1.3.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.3.0...v1.3.1)：4ae22bd2 1.3.1；5e6541b7 docs: add v1.3.1 hotfix entry to CHANGELOG；22485257 fix: add missing team_logo_url migration — production crash on admin draft/matches pages；de4ed551 Merge pull request #84 from Starfie1d1272/dev；33b793f6 发布 v1.2.0 — 报名强制登录 + 地图偏好 + Steam 头像缓存 (#79)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.3.1)：原文与日志核对后保留。

## 1.3.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.2.0...v1.3.0)：72031bc1 1.3.0；67ae6498 Merge pull request #83 from Starfie1d1272/feat/issue74-p1-completion；cdc02c72 Merge pull request #82 from Starfie1d1272/feat/simplify-pr80-81。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.3.0)：有正文候选，待独立审阅。

## 1.2.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.1.2...v1.2.0)：33b793f6 发布 v1.2.0 — 报名强制登录 + 地图偏好 + Steam 头像缓存 (#79)；42bd7edf Merge pull request #77 from Starfie1d1272/codex/fix-draft-brand-assets。
- 快照无 Release，不创建。

## 1.1.2

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.1.1...v1.1.2)：0826b28e fix:报名草稿恢复与品牌图标接入-1.1.2；28b5a068 fix: 替换为完整的 AGPL-3.0 许可证文本；4dd1f1ce chore: MIT → AGPLv3 许可证更换 + README 更新至 1.1.1。
- 快照无 Release，不创建。

## 1.1.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.1.0...v1.1.1)：4d41ad46 fix: PhaseTracker 英文标签 + 报名草稿恢复提示优化 (1.1.1)；40b06056 feat: dynamic PhaseTracker, timezone fixes, registration polish + admin UX & auto-advance。
- 快照无 Release，不创建。

## 1.1.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.0.2...v1.1.0)：8269b1ff 1.1.0；3a6c8870 feat: dynamic PhaseTracker from stagePlan, timezone fixes, registration UI polish。
- 快照无 Release，不创建。

## 1.0.2

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.0.0...v1.0.2)：bcaf7f57 Merge pull request #71 from Starfie1d1272/chore/1.0.2；de87d7f3 Merge pull request #70 from Starfie1d1272/fix/empty-homepage。
- 快照无 Release，不创建。

## 1.0.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v0.3.0...v1.0.0)：f051dc96 Merge pull request #69 from Starfie1d1272/codex/release-1.0.0；210f46f0 Merge pull request #68 from Starfie1d1272/dev。
- 快照无 Release，不创建。
