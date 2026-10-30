# 1.21–1.30 逐版证据

对照历史日志、Release 快照和版本区间提交；修改内容进一步核实代码或对应提交。原文所列版本日期保留，不把 Release 页面晚创建时间当作原发布时间。

`v1.26.1` 指向 `d5cf53c4`（1.30.1，package 版本为 1.30.1）；当时 1.26.1 版本提交为 `f04fac913dfd152d92eb968d5c279cbe69b88252`，其为 `v1.26.2` 的祖先。两条比较链接改以该提交为界，标签不移动。1.23.1 的提交说明写 120 秒，但代码 diff 为 180 秒，保留代码所证实的 180 秒。

## 1.30.2

- 无 tag / Release；当时的版本提交为 [d90a66a0](https://github.com/Starfie1d1272/RivalHub/commit/d90a66a0e3371a1f9723359de384b66450074c47)，日期沿用原日志。
- 快照无 Release，不创建。

## 1.30.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.30.0...v1.30.1)：d5cf53c4 release: v1.30.1 (#215)；1adcc628 fix: maps 数双倍计数去重（OCR+Demo 双录） (#214)；57b364f0 fix: filter source=manual_ocr to prevent OCR+demo double-counting in leaderboard and player page (#213)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.30.1)：有正文候选，待独立审阅。

## 1.30.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.29.0...v1.30.0)：489ab5c3 refactor: 移除 Demo 导入回归无-demo 主线 + 引入 changeset (v1.30.0) (#212)；505313c1 docs: clarify external pilot readiness (#211)；e9de2a70 v1.29.0（含 v1.28.2）: rating/demo 迁移外部包 + 排行榜排序 + RR 多 steam 合并 (#210)；8b33a05a fix: min(uuid) → min(uuid::text)，修复 Postgres UUID 类型不支持 min() 聚合 (#209)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.30.0)：有正文候选，待独立审阅。

## 1.29.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.28.2...v1.29.0)：b8098087 fix: 构建配置支持外部 TS 源码包；0823b7fd chore: 覆盖率 lines 阈值 27% → 26%；f08869c0 1.29.0；3f69e032 docs: 同步文档至 v1.29.0 — AGENTS.md；a6148d16 docs: CHANGELOG 1.29.0；b86f754a refactor: rating/demo 模块迁移至外部包；aa92d739 feat: add weights/* to exports map for JSON direct import；4c4d73a8 fix: 排行榜 Advanced/Demo 视图多列排序失效；1df094bf fix: CI 构建失败 — 回退 rival-rating 外部依赖为本地文件。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.29.0)：有正文候选，待独立审阅。

## 1.28.2

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.28.1...v1.28.2)：e01b5bc5 1.28.2；d1664cc9 docs: 同步文档至 v1.28.2 — CLAUDE.md/AGENTS.md/README.md；86765684 docs: CHANGELOG 1.28.2；dd36969a Revert "docs: CHANGELOG 1.28.2"；eebaf81c docs: CHANGELOG 1.28.2；5d914e6e docs: 记录 rival-rating 接入方式与权重更新流程；c47fb28f chore: 切换 rival-rating 为 github: 协议 + transpilePackages；b6772360 feat: 接入 @rivalhub/rival-rating 外部仓库；509175b5 fix: 赛前能力雷达修复 + 排行榜 Rating Pro 排序修复；e94e1e97 fix: getOcrAveragesBySeason 引用了未 JOIN 的 seasons 表导致 500；43a83c30 fix: RR 重算按 userId 合并多 steamId64，修复换号导致的数据分裂；22f089e2 Merge main into dev；d8ddf320 fix: min(uuid) → min(uuid::text)，Postgres 不支持 UUID 类型的 min() 聚合；4b68600a fix: vec3 Zod schema 允许 null 坐标值，配合 NaN 清洗修复导入全链路；99ab15c8 fix: JSON.parse 前清洗 NaN/Infinity，修复 demo 导入 JSON 解析失败；7de61153 fix: 清洗导入坐标中的 NaN → null，避免 JSON 序列化失败；b75942a5 fix: force 模式下 DELETE ANY(array) 语法错误 — 改用 sql.join 避免 Postgres malformed array literal；f3b50b3f Merge branch 'main' into dev — resolve v1.28.1 conflicts。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.28.2)：原文与日志核对后保留。

## 1.28.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.28.0...v1.28.1)：27de963f 1.28.1；a755d278 docs: 同步文档至 v1.28.1 — AGENTS.md 版本号；10fa5007 docs: CHANGELOG 1.28.1；4cb70192 fix: 修复 v1.28.0 生产错误 — SQL GROUP BY / Server-Client 边界 / 批量导入覆盖；1fee2647 Merge branch 'main' into dev — resolve v1.27.8 conflicts。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.28.1)：原文与日志核对后保留。

## 1.28.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.27.8...v1.28.0)：b56210b4 docs: 同步文档至 v1.28.0 — CHANGELOG compare link + AGENTS.md 版本号；bb02c078 1.28.0；25fdbf79 feat: 数据面板重构 — 武器榜重设计 / Entry 面板 / 经济图例 / 风格分析迁移 / 八维雷达 / Demo 进阶卡片 / 颜色规范化；7749305b fix: bindSteamAlias 补全 match_player_stats 回填 + demo tab 优化；165c1824 fix: Stats 排行榜分组逻辑修复。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.28.0)：有正文候选，待独立审阅。

## 1.27.8

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.27.7...v1.27.8)：861fab65 Merge remote-tracking branch 'origin/main' into dev；f874a797 1.27.8；2096222e docs: 同步文档至 v1.27.8 — AGENTS.md；a3ddb9e4 docs: CHANGELOG 1.27.8；36d335b1 fix: COALESCE(uuid, text) 类型不匹配导致 Stats 500；d6ae2844 chore: 降低覆盖率 lines 阈值至 27%（新增功能代码无测试覆盖）。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.27.8)：原文与日志核对后保留。

## 1.27.7

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.27.6...v1.27.7)：e4bd9da0 1.27.7；821c716b docs: 同步文档至 v1.27.7 — AGENTS.md；c918d0ad docs: CHANGELOG 1.27.7；5f5431cb feat(demo): 导入支持 force 覆盖模式（跳过查重，先删旧数据再导入）；eb9ba2b4 fix(demo): 经济分类最终版 — full优先、eco加equip限制、semi兜底；23cf5ce7 fix(demo): 经济回填优先级修复 — 平手时eco优先而非full；82c3a020 fix(demo): 排行榜GROUP BY按userId合并同名选手，不同steamId/游戏名不分裂；1462d209 fix(demo): 经济回填改为直接读 economies.type，不再依赖 start_money；4daba783 fix(demo): 武器榜链接路径404、GROUP BY去steam_id64、m4a1_silencer别名；80765ca5 fix(demo): 排行榜GROUP BY去掉dp.steam_id64，绑定后同名选手正确合并。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.27.7)：原文与日志核对后保留。

## 1.27.6

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.27.5...v1.27.6)：5015de1f 1.27.6；68552a3a docs: 同步文档至 v1.27.6 — AGENTS.md；79f83597 docs: CHANGELOG 1.27.6；bd813deb fix(db): stats页OCR fallback引用需用MIN()包裹以通过GROUP BY约束；af8fac80 test(demo): weapon-names 别名映射测试覆盖；1c266c0a fix(test): PlayerStatsTable mock 补全 matchMaps 和 db.query.matchMaps；d561a034 fix(test): PlayerStatsTable mock 补全 statSourceEnum 导出。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.27.6)：有正文候选，待独立审阅。

## 1.27.5

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.27.4...v1.27.5)：ebea6398 1.27.5；0ac30148 docs: 同步文档至 v1.27.5 — AGENTS.md；963e4425 docs: CHANGELOG 1.27.5；40c37daf feat(demo): 赛后详情页布局重构+武器别名+八维英文+PlayerStatsTable上下排列+隐藏空列+EntryWeapon UI优化；aced3b1a fix(demo): full经济阈值调整至4000（AK+甲+投掷物起步）；51565ab9 feat(demo): 经济类型回填系统 + 清理HLTV死代码；24271403 feat(demo): Demo排行榜新增Entry%和AWP%列，AWP击杀率从demo_kills计算；7b62e062 feat(demo): 多账号 steamId 别名绑定系统 — DB schema、server actions、admin UI；a3bc3ca9 feat(demo): Stats页OCR fallback、1v1%/2K/3K列、TeamHalfSideStats/StyleProfile接入赛季风格分析；6a40cd86 fix(prism): 狙击维度无信号时为0而非50，ratingPro/rws/we统一回填OCR行；8885429d fix(demo): PRISM 狙击100、Stats默认排序改RR、选手主页RWS/WE回填OCR行、移除冗余DemoClutchList；ca5f1cd8 fix(demo): 修复 KAST ×100、HS 改爆头率、双行选手、热力图坐标、Kill Feed 布局；ba7dbf0e docs: 同步文档至 v1.27.4 — AGENTS.md。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.27.5)：有正文候选，待独立审阅。

## 1.27.4

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.27.3...v1.27.4)：e96604d6 1.27.4；8bcf0384 docs: CHANGELOG 1.27.4；03fec362 fix(batch-import): 批量导入自动确认 OCR 覆盖，跳过逐条确认弹窗；cac32655 fix(batch-import): 失败时 console.error + 行内显示错误信息；f1e2a873 docs: 同步文档至 v1.27.3 — AGENTS.md。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.27.4)：原文与日志核对后保留。

## 1.27.3

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.27.2...v1.27.3)：6c07d312 1.27.3；f0fbaf4d docs: CHANGELOG 1.27.3；75d6f994 fix(demo): schemaVersion 兼容 cs2-demo-format/1.0；0aca9f24 fix(batch-import): users.steam_id64 → steam64 修正列名；2486e7bf docs: 同步文档至 v1.27.2 — AGENTS.md。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.27.3)：原文与日志核对后保留。

## 1.27.2

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.27.1...v1.27.2)：d43771f4 1.27.2；b888a2bc docs: CHANGELOG 1.27.2；fc082444 fix(batch-import): 新增 players.json steamId 队伍模糊匹配作为最终 fallback；392bbd69 docs: 同步文档至 v1.27.1 — AGENTS.md。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.27.2)：原文与日志核对后保留。

## 1.27.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.27.0...v1.27.1)：fcb20284 1.27.1；5c75a5d0 docs: CHANGELOG 1.27.1；893cb743 fix(batch-import): 修正文件名日期匹配 + cs2-demo-format teamName 读取路径。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.27.1)：原文与日志核对后保留。

## 1.27.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.26.2...v1.27.0)：227a7e6f feat(display): RR门面评分体系 + 全站数据展示重构；ee8f8624 feat(display): add RR to leaderboard+player page; fix ratingPro pollution；db551745 fix(build): remove .js extensions from imports in to-rr-indicators；cbd2215c 1.27.0；4653a527 docs: 同步文档至 v1.27.0 — AGENTS.md；54e3e494 docs: CHANGELOG 1.27.0；eb0a7052 fix(scheduling): fix auto-accept race condition and display inconsistency；659f6e7e feat(demo): batch zip import with auto map-matching；045e6fc3 fix(demo): add rounds field to playerStatsRowSchema；826106f6 fix(demo): filter warmup data and fix totalRounds override in RR adapter。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.27.0)：原文与日志核对后保留。

## 1.26.2

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/f04fac913dfd152d92eb968d5c279cbe69b88252...v1.26.2)：ad2ba79e 1.26.2；1a913ed7 fix: 修复 Stats 500 错误、Demo 导入页 BO1 显示、公开页移除 OCR/Demo 导入；e332a896 docs: 同步文档至 v1.26.2 — AGENTS.md 版本号；7b9d1419 docs: CHANGELOG v1.26.2；84301588 docs: CHANGELOG v1.26.1 — 修复 compare 链接；AGENTS.md 版本同步；91ac8270 fix: 测试同步 multiKills 口径和 rounds 字段变更 —— CI 修复。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.26.2)：有正文候选，待独立审阅。

## 1.26.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.26.0...f04fac913dfd152d92eb968d5c279cbe69b88252)：f04fac91 release: v1.26.1；6e40c966 docs: CHANGELOG v1.26.1 — demo 体系修复汇总；42f291d7 style: UI 色彩清理——将 Demo/赛队组件硬编码调色板全换为 CSS 变量；723ca9ff fix(admin/demos): 修复「已导入」badge 永不显示的 bug，改用 mapId 而非 matchId 查 demoImports；9c2b1d78 fix(demo): team-demo-stats 加 use server，改 Drizzle ORM 查成员，修复 ecoRows 列名和 teamId 过滤，包裹 ok()/fail()；76ac073b fix(demo): season-demo-stats FKPR 改用真实回合数（JOIN demo_rounds），去掉硬编码 *24；8f012bf9 fix: 修复主榜双重计入过滤 + 六维图 demo 维度数据填充与权重重归一化；02067e2a fix(demo): player-demo-stats 修复 mapRounds 假分母，删除 mapCount 死代码，PlayerStatRow 加 rounds 字段；92e4d325 fix(demo-import): 补全 ratingPro/verifiedByAdmin 回填，修复 revalidatePath 路径，清理 JSON.parse(JSON.stringify)；77a79f7a feat(demo): 新增 HLTV Rating 2.0 计算模块，修复 multiKills 漏算 2K。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.26.1)：有正文候选，待独立审阅。

## 1.26.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.25.6...v1.26.0)：09b26a65 chore: 统一版本号 v1.26.0（去掉goal_mode误推的v1.26.1/v1.26.2变更）；c06dcb77 docs: AGENTS.md 版本号同步至 v1.26.2；1a83b0e6 release: v1.26.2 — CHANGELOG版本号修正 + npm version 1.26.2；c40c5fd7 chore(v1.26.0): 合并依赖升级/CSS变量/经济图/loading&error/空数据引导, 去@next/bundle-analyzer, 统一版本号；ae5db3c2 fix: 修复集成测试TS类型错误—移除MatchPlayerStatRow不存在的mapId断言；aa828962 docs: CHANGELOG v1.26.2 — 追加集成测试条目；a7dc4593 test: add integration tests for demo data pipeline；c90775d3 fix(ux): 添加暂无Demo数据引导提示+AGENTS.md版本号同步至v1.26.2；1716e9fc chore: trigger CI for PR#190 v1.26.2；2b2c1ebd chore: v1.26.2；53245bcc docs: CHANGELOG v1.26.2；cc9c8439 fix(ux): 添加match详情页的loading.tsx和error.tsx；fdef7a1f fix(render): DemoEconomyChart最后一个rect宽度改用等比xScale间隔而非CHART_W/series.length；9853e594 fix(a11y): DemoHeatmap mode按钮组添加role=radio/aria-checked/onKeyDown键盘支持；a4abbd6c fix(css): 添加5个缺失的CSS变量 — bg-mid/bg-secondary/border-subtle/fg-muted/surface-raised；13853112 release: v1.26.1 — 依赖安全升级 + 契约E/错误处理修复；714b16a2 fix(deps): upgrade next@15.5.18 & drizzle-orm@0.45.2 to fix 13 CVEs；bf3a1d76 fix: 契约E — player-demo-stats 查询补充 activeStatSource 过滤条件；ba9e2cc2 fix: getDemoDetail try/catch 改用已注册的错误码 ErrorCode.INTERNAL_ERROR；23fe70a3 release: v1.26.0 — Demo 导入体系与选手统计面板；534d3159 docs: AGENTS.md 版本号 v1.26.1→v1.26.0；d01f41cd fix: AGENTS.md 版本号回退修复 v1.26.0→v1.26.1（第13轮 git add -A 意外引入）；12376822 docs: 合并 v1.26.1 CHANGELOG 到 v1.26.0，清理版本号；d10ab2a6 docs: CHANGELOG 更新 v1.26.1 第2轮审查修复（try/catch/契约E/索引/UX）；c3901baa fix(demo): 第2轮审查修复 — getDemoDetail try/catch包裹, 契约E保护(player-stats.ts仅清OCR来源), 空热力图UX, 8表复合索引, demo-import无数据保护, README文档更新；47d5ce2e docs: CHANGELOG 追加 batchInsert 安全上限修正；ba0ecd4d fix(batch-insert): CHUNK_SIZE 3000→1000防止demoPlayerStats(25列)溢出PG 65535参数限制；6b75c076 1.26.1；70c05cb6 fix(demo): PG参数溢出修复+batchInsert安全分块+并发UPSERT安全；c260cd6b docs: 同步文档至 v1.26.1 — AGENTS.md；0e11182c docs: CHANGELOG 1.26.1；ca345f5f Merge branch 'main' into dev；1ae4f87d fix(css): 添加缺失的 --color-bg-subtle CSS 变量，修复 6+ 个组件的透明背景；65367c9e fix(code-review): 样式主题一致性与DemoImportPanel增强；94efd129 release: v1.26.0 — Demo 导入体系与选手统计面板；7b68678d fix(code-review): 修复WeaponLeaderboard缺use-client、Panel label统一、code-map新增组件映射；d5550335 feat(demo): Task15 B2 - 选手utility贡献统计；f0c8330a fix: PlayerUtilityStats 类型修复 — label prop + avgUtilityDamagePerRound 列名；0419eb87 chore: 删除孤立的 utility-stats.test.ts（对应模块从未合入）；95da23c7 fix: 修复 season-demo-stats.ts WeaponKillRow 重复声明合并 + WeaponLeaderboard title→label + hsPercent sort；af216e79 feat(demo): Task14 B2 - 残局能力 PlayerClutchStats；ff5bb82e Merge branch 'feat/demo-frontend-team' into dev；25108573 Merge branch 'feat/demo-frontend-stats' into dev；84e9f239 fix: 修复 Hive 分支 TS 类型错误 — team-demo-stats 列名/Panel title→label/activeStatSource；b11828be Merge branch 'feat/demo-frontend-player' into dev；5bd2256c feat(demo): 经济转化率 EconomyConversion；29f3cee9 feat: 经济曲线增加经济类型背景色块区分；a11c38d2 fix: 补全 8 张职业图 radar 底图与真实标定值；6b4bb251 fix: 添加 playerNameMap 显示游戏内昵称而非 steamId64；d84ec08e fix: UI 一致性与 label 英文化修复；96668208 docs: 更新代码地图加入 demo 相关入口；b439ba15 feat: demo 残局复盘列表；018942b5 feat: demo 经济曲线；76a2b194 feat: demo 击杀 Feed 时间线；23d7993f feat: 比赛地图页接入 demo 明细与热力图；a1f0f8d6 feat: demo 回合时间线展示；8c699573 feat: demo 静态热力图组件；a945d6fd feat: demo 详细 player-stats 展示表；6179220c feat: demo 明细数据查询；feee4c34 feat: 地图 radar 标定与世界坐标变换；5f41f29e fix: 导出 DemoStatInput 接口供 action 使用；d5748bbc feat: demo 导入生效来源标记与 OCR 冲突二次确认；16513b93 feat: 后台 demo 导入上传面板；3088b23c feat: demo 导出包导入 Server Action；3a86e54f feat: demo zip 解包与校验；716e449e feat: demo player-stats 回填 match_player_stats 公共列；ac50b221 feat: demo 玩家 SteamID 映射纯函数；98b25874 feat: demo 导出包 Zod 校验 schema；0e6a6443 feat: 新增 demo 导入 14 张明细表 schema；9de5e090 Merge branch 'feat/multiplatform-stat-abstraction' into dev；989c4d75 chore: check-claude-md.sh 改为 noop，组件清单已迁移至 CodeGraph。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.26.0)：有正文候选，待独立审阅。

## 1.25.6

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.25.5...v1.25.6)：85a166e0 1.25.6；f5570ff1 docs: 同步文档至 v1.25.6 — AGENTS.md；2873d06f docs: CHANGELOG 1.25.6；0377be80 fix: 双败淘汰决赛 finalFormat 覆写只作用于总决赛。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.25.6)：原文与日志核对后保留。

## 1.25.5

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.25.4...v1.25.5)：8b50a261 1.25.5；f73c8b9c docs: 同步文档至 v1.25.5 — AGENTS.md；d30ab789 docs: CHANGELOG 1.25.5；a19d5c4c feat: 自动采纳提议时页面轮询刷新 + 公开显示自动采纳提示。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.25.5)：原文与日志核对后保留。

## 1.25.4

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.25.3...v1.25.4)：9733896d 1.25.4；e8eeb0ec docs: 同步文档至 v1.25.4 — AGENTS.md；cee568b0 docs: CHANGELOG 1.25.4；b2977520 fix: 设定比赛时间时联动清理 pending 提议，防止幽灵提议卡在即将自动采纳。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.25.4)：原文与日志核对后保留。

## 1.25.3

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.25.2...v1.25.3)：bc7c7983 1.25.3；65b67a85 docs: 同步文档至 v1.25.3 — AGENTS.md；f28e74eb docs: CHANGELOG 1.25.3；7cc055e9 fix: 移除重复的「查看对阵图」导航按钮 + 数据汇总表列统一缩写并按逻辑重排；c2339dab fix: advanceMatch 在 manager 修改后快照 prevResolved，修复 bracket 比赛不自动创建。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.25.3)：原文与日志核对后保留。

## 1.25.2

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.25.1...v1.25.2)：2ecd1887 1.25.2；26c166b8 docs: 同步文档至 v1.25.2 — AGENTS.md；7e7d3325 docs: CHANGELOG 1.25.2；306ace99 fix: BP 选边逻辑修复 — pick 方对手选边 + decider 可选选边方；2de6be2f feat: BO1 启用整场汇总 + 单图数据列扩展为完整 10 列。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.25.2)：有正文候选，待独立审阅。

## 1.25.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.25.0...v1.25.1)：9ed0b59c 1.25.1；b0ad986a docs: 同步文档至 v1.25.1 — AGENTS.md；574bbfe3 docs: CHANGELOG 1.25.1；a8af7b19 fix: 公开页面赛程状态正确显示"待进行"vs"待排期"。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.25.1)：原文与日志核对后保留。

## 1.25.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.24.0...v1.25.0)：2e9046ec 1.25.0；d9d861a6 docs: CHANGELOG 1.25.0；f62276ec chore: gitignore 忽略 .codegraph/ 和 .cursor/；2dd86543 refactor: 代码合规 + 赛季状态迁移 + 文档全面精简。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.25.0)：有正文候选，待独立审阅。

## 1.24.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.23.7...v1.24.0)：026320b1 1.24.0；ab4b8d18 docs: 同步文档至 v1.24.0 — AGENTS.md；f7f5c21d docs: CHANGELOG 1.24.0；0d824a85 docs: CLAUDE.md 改为单行引用 AGENTS.md，消除重复维护；7dc5d441 docs: code-map 补登 src/lib/stats/ 统计模块入口；d84233f0 feat: 排行榜按赛季阶段筛选 + 去除最少图数门槛；bc7484ae refactor: 新建 src/lib/stats/ 统计计算模块，统一替换全项目数据聚合逻辑；a01e1467 docs: CLAUDE.md/AGENTS.md 瘦身 68%（674→226 行），组件清单迁至 docs/code-map.md。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.24.0)：有正文候选，待独立审阅。

## 1.23.7

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.23.6...v1.23.7)：577282a8 1.23.7；d6a40bf5 docs: 同步文档至 v1.23.7 — CLAUDE.md/AGENTS.md；6f63c27a fix: pick 率分母剔除 BO1 + 管理员"参赛过"补漏 + 队伍页新增 pick 率列；33b151d2 docs: 发版规范精简为引用 release.md 避免重复；ec2bb1c3 docs: CHANGELOG compare 链接提醒加入发版规范。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.23.7)：原文与日志核对后保留。

## 1.23.6

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.23.5...v1.23.6)：cdb0931a 1.23.6；e6857a7b fix: 数据统计页昵称碎片化 + 个人页出场统计 + 比赛结算 orphan map 清理；e56e62a6 docs: 补全 CHANGELOG compare 链接 v1.23.0~v1.23.5。
- 快照无 Release，不创建。

## 1.23.5

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.23.4...v1.23.5)：e0cf4ba1 1.23.5；3279b835 fix: 弃赛状态显示修复 + 比赛排期状态标签区分。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.23.5)：原文与日志核对后保留。

## 1.23.4

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.23.3...v1.23.4)：dcceafa6 1.23.4；31e7307b fix: bracket LB minor round 标签错误 + 赛程 Tab 默认选中当前赛段。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.23.4)：原文与日志核对后保留。

## 1.23.3

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.23.2...v1.23.3)：f80faf7d 1.23.3；cfad6375 fix: OCR 录入昵称改为只读并与 users.perfectName 强制同步。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.23.3)：原文与日志核对后保留。

## 1.23.2

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.23.1...v1.23.2)：56f1696c 1.23.2；ad242578 docs: CHANGELOG 1.23.2；00e4f1c4 refactor: 整场汇总面板 UI 重构，两队分卡 + 项目设计 token 统一；49e78267 fix: MVP 投票爆头率取平均后小数溢出，加 toFixed(0)；5abfe039 fix: 公开赛程页 2:0 后不再显示未进行比赛的图三 tab；42283a0b fix: syncBracketMatches 按 (bracketNodeId, stage) 复合键匹配已有比赛；1858a00b fix: syncBracketMatches 同时修正队伍映射错误的已有比赛；a4f65721 fix: db retry 改用新 Pool 的 query，修复冷启动后重试仍打到 localhost。
- 快照无 Release，不创建。

## 1.23.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.23.0...v1.23.1)：08fe0a74 1.23.1；2275c89b docs: CHANGELOG 1.23.1；3cc7887a fix: OCR 请求超时从 60s 延长到 120s；97ffa922 fix: bracket 比赛创建时用参与者名称查队伍，修复 ID-index 映射错误；5fe5e051 test: 更新 assertMatchTransition 测试，scheduled→finished 为弃赛合法迁移。
- 快照无 Release，不创建。

## 1.23.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.22.1...v1.23.0)：3eeebd0f 1.23.0；ad59b6d2 feat: 弃赛系统 + 逐图比分修正 + MapByMapInput UX 优化；5424bda5 docs: CHANGELOG 1.23.0；828c67fd docs: 补齐 CHANGELOG compare 链接 v1.21.1–v1.22.1。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.23.0)：有正文候选，待独立审阅。

## 1.22.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.22.0...v1.22.1)：66d09ce5 1.22.1；caf73eac docs: CHANGELOG 1.22.1；10aa3c78 fix: OCR 未匹配用户高亮提示并阻止保存。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.22.1)：原文与日志核对后保留。

## 1.22.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.21.1...v1.22.0)：6fe43186 1.22.0；cbbb128b fix: bracket 显示/跳转 + 正赛阶段协商规则。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.22.0)：原文与日志核对后保留。

## 1.21.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.21.0...v1.21.1)：0e6614bc 1.21.1；e89d8130 fix: 手动创建排位赛后允许生成正赛；e5548238 docs: add demo export handoff。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.21.1)：原文与日志核对后保留。

## 1.21.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.20.5...v1.21.0)：da8af60b 1.21.0；b5ceb0b4 docs: CHANGELOG 1.21.0；3097805c fix: address season directory review findings；e24b4ede feat: optimize season directories and stats leaderboard；b6388c9a docs: add season directory UI optimization design。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v1.21.0)：原文与日志核对后保留。
