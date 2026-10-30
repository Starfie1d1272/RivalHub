# 2.10–2.18 逐版证据

对照日志、Release 快照与 Git 区间的 first-parent 提交；对改动项进一步检查提交。保留 2.14 安全与验收限制、2.15.3 现场验收及 2.16–2.17 reader/publisher 与迁移边界。2.13.0 快照无 Release，不新建。

## 2.18.3

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.18.2...v2.18.3)：5277c04b fix(telemetry): 修复浏览器发送并发布 2.18.3 (#984)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.18.3)：有正文候选，待独立审阅。

## 2.18.2

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.18.1...v2.18.2)：cb7da23d release: 2.18.2。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.18.2)：有正文候选，待独立审阅。

## 2.18.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.18.0...v2.18.1)：9574a2b3 release: 2.18.1；a70fdcbe fix(qualification): 保留资料修正后的有效特批并解除席位确认误拦截；95efdc1d chore(deps): bump actions/cache from 5.1.0 to 6.1.0 (#936)；c4a11bd3 chore(telemetry): 补齐接收端部署准备与真实链路验收 (#978)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.18.1)：有正文候选，待独立审阅。

## 2.18.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.17.6...v2.18.0)：f9fc6ee0 release: 准备 2.18.0 版本 (#977)；0d4f5feb feat(telemetry): 增加全站产品基线与账号会话排障 (#976)；a1051ea7 docs(product): 整理独立重设计前的产品现状基线 (#975)；4ca5f800 docs(agents): 明确自主执行与任务交付边界 (#974)；e190d247 fix(stats): 修正指标语义绑定并统一展示名称 (#973)；3beaae72 chore(stats): 清理无消费者的统计 helper 与转导出 (#972)；874d0223 test(veto): 按地图身份比较拒绝操作前后完整事实 (#971)；65ac635e chore(knip): 移除已有产品调用的赛果显式根 (#970)；1d380275 chore(date): 清理无消费者的日期工具导出 (#969)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.18.0)：原文与日志核对后保留。

## 2.17.6

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.17.5...v2.17.6)：a474b6e4 release: v2.17.6 (#968)；15f58aad fix(matches): BO1 可信单图结果展示回合比分 (#967)；1b579c6c ci: 隔离系列比分更正浏览器证据 (#965)；f60ca968 fix(mizar): 名单异常时展示实时数据并隔离正式赛果 (#964)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.17.6)：有正文候选，待独立审阅。

## 2.17.5

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.17.4...v2.17.5)：8700a7c2 release: v2.17.5 (#963)；97e99e0b perf(seasons): 收敛公开赛事首页与目录读取 (#962)；eabeac34 fix(cron): 避免 watchdog 重试确定性失败 (#961)；cc34dd9e perf(postmatch): 避免赛后资料操作驱逐公开统计缓存 (#960)；8334baaa perf(cache): 公共读模型复用共享远程缓存 (#959)；9f4edefe perf(major): 按消费集合减少公开名单读放大 (#958)；04a97a6d perf(stats): 按详情消费者缩小事实投影 (#957)；550b106d fix(veto): 无变化的 BP 协调不再驱逐缓存 (#955)；69fc5e9b perf(mizar): 减少赛程与制播文档读取负载 (#956)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.17.5)：原文与日志核对后保留。

## 2.17.4

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.17.3...v2.17.4)：71bba39b chore(release): prepare v2.17.4 (#954)；3ce9a734 perf(stats): 缩窄选手基准统计投影读取 (#950)；db4d44ea fix(matches): 消除排期弹窗重复页面轮询 (#952)；1ceb48b4 ci(preview): 仅含迁移的发布触发额外镜像刷新 (#953)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.17.4)：有正文候选，待独立审阅。

## 2.17.3

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.17.2...v2.17.3)：98794fa0 release: v2.17.3 (#951)；262c9420 fix(egress): 减少制播头像与赛事人数概览的数据库读放大 (#949)；1f73b6eb docs(security): 修正生命周期文档的已退役证据引用 (#948)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.17.3)：有正文候选，待独立审阅。

## 2.17.2

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.17.1...v2.17.2)：257f0e9a chore(release): v2.17.2 (#947)；28b42b37 test(security): 恢复三条独有安全脱敏保护 (#946)；658d9cf3 test: 收敛长期测试并保留迁移结算权限边界 (#942)；e78f0668 fix(team): 就绪后开放队伍创建表单 (#945)；5cbddfd5 fix(bet): 就绪后开放管理确认与竞猜交互入口 (#943)；95bc1ea8 refactor: 收敛重复校验并修正测试等待与文档漂移 (#940)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.17.2)：有正文候选，待独立审阅。

## 2.17.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.17.0...v2.17.1)：4ac1ab3b chore(release): v2.17.1 (#939)；ba6e33a1 fix(bet): 恢复紧凑卡片与上下分区参与弹窗 (#937)；eae411d5 fix(predictions): 分离命中次数榜与命中率榜资格 (#938)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.17.1)：原文与日志核对后保留。

## 2.17.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.16.0...v2.17.0)：65ac4686 release: 准备 v2.17.0 低保与 BO3 三图市场 (#935)；09b2b032 feat(bet): 准备有限低保与 BO3 地图盘口第二阶段 publisher (#928)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.17.0)：原文与日志核对后保留。

## 2.16.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.15.12...v2.16.0)：a6dd1c52 release: 准备 v2.16.0 兼容读取与免费预测 (#934)；5dbb5608 fix(veto): 首阶段隔离申诉关闭写入并约束回退能力 (#932)；fc089799 fix(predictions): 开放合法 Play-in 免费预测 (#933)；c4558007 ci: 将 FULL PostgreSQL 有界分为两片 (#931)；9f65a259 fix(bet): 防止兼容 worker 在 BO3 更正后补旧 BP 池 (#930)；2300557b fix(bet): 准备低保 reader 首发并关闭领取写入 (#929)；bc49a4ae fix(demo): 区分目标失效与读取系统故障 (#924)；a057d3ee fix(auth): 修正原密码验证与最终事务失败恢复指引 (#927)；e8179ad3 fix(matches): 区分默认首发等待与系统故障并接通恢复 (#922)；1fc38238 ci: 合并 FULL 短检查以减少 runner 竞争 (#926)；96082151 feat(bet): 整合免费预测、低保与统一竞猜入口 (#920)；2a734eb2 fix(bet): 先兼容有限低保账本流水 (#917)；1f963ea7 feat(bet): 准备 BO3 三图多赢家市场兼容 reader (#918)；403e5882 fix(live): 连接期间回显经核验的公开上一帧 (#916)；e9f3e112 fix(auth): 区分账号服务故障与凭据拒绝 (#915)；a38aaf1b fix(dak): 保留集成异常并明确提交后恢复路径 (#913)；33a8c378 fix(observability): 保留后台批次失败的原始原因 (#914)；4d59884a fix(live): 复用短暂导航中的单场实时连接 (#910)；296e35db fix(auth): 将会话过期时钟延后到真实请求 (#908)；b188b57f fix(observability): 关联错误排查编号与请求日志 (#907)；02163b6e fix(ci): 只读校验完整 pnpm 依赖图及直接根节点 (#906)；5e3805f5 fix(education): 阻止到期材料读取并明确数据生命周期 (#905)；a01fd1f3 fix(veto): 正式开赛后收尾技术申诉并明确参与指引 (#902)；b455832b fix(audit): 明确 Mizar 机器身份并兼容历史记录 (#900)；6a7fd5cc fix(ocr): 合并补传截图与已有 Demo 选手 (#899)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.16.0)：原文与日志核对后保留。

## 2.15.12

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.15.11...v2.15.12)：c9b29ba0 release: 准备 v2.15.12 赛前单图积分预测 (#897)；b19e0993 fix(bet): 赛前开放单图总回合积分预测 (#892)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.15.12)：原文与日志核对后保留。

## 2.15.11

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.15.10...v2.15.11)：9680d220 release: 准备 v2.15.11 网站修复与竞猜兼容 (#896)；a9e5b650 fix(bet): 先兼容图序盘口并锁定已决系列剩余图 (#895)；613a6d38 fix(demo): 保留审核检查项与失败关联编号 (#894)；b0312dd5 fix(matches): 简化赛后名单与 BP 截图操作 (#893)；a79821f1 fix(demo): 按有效首发统一赛后证据版本 (#891)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.15.11)：原文与日志核对后保留。

## 2.15.10

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.15.9...v2.15.10)：9ba3be61 release: 准备 v2.15.10 (#889)；81487455 fix(matches): 展示双方 BET 积分支持率 (#890)；13268290 fix(ui): 修复审计与赛后确认的窄屏布局 (#888)；1216899c fix(demo): 保留 QA 警告详情与能力降级依据 (#887)；a027c0b2 fix(audit): 补齐机器来源、操作详情与错误关联诊断 (#886)；ee6cadb5 fix(admin): 补齐比赛总览赛后待办与本人优先展示 (#882)；177515c2 fix(matches): 补齐正式 Swiss 比赛入口并移除重复表 (#880)；3a8a501d fix(seasons): 统一正式阶段目录与 Play-in 比赛入口 (#885)；6202af7b fix: connect Mizar and Uploader downloads with installer fallback (#881)；f9717874 fix(matches): 去除统计表明确的所属队名前缀 (#879)；263e450a fix(mizar): 修复 PLAY-IN 实时订阅与投递拒收诊断 (#873)；9303df13 fix(ocr): 区分上游故障并保留安全排查信息 (#872)；7abae9d1 fix(matches): 整理建房指引并突出赛后回放入口 (#874)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.15.10)：有正文候选，待独立审阅。

## 2.15.9

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.15.8...v2.15.9)：c13f72e9 chore(release): v2.15.9 (#867)；caed83bc fix(matches): 补齐排期交接授权与调度事务边界 (#866)；a09d4258 fix(matches): 明确队长 BP 禁用与选取操作 (#865)；54385a80 fix(matches): 已结束测试赛隐藏重复结束操作 (#864)；e2adb384 fix(admin): 增加比赛赛务待办与负责人联系 (#863)；765f68a6 fix(matches): 修复 Play-in 队长赛务与排期边界 (#862)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.15.9)：原文与日志核对后保留。

## 2.15.8

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.15.7...v2.15.8)：da1318c1 release: 发布 v2.15.8 (#855)；228071c1 fix(commentary): 修复超级管理员认领队列为空 (#854)；d2c28dfd test(e2e): 修复邀请流程重复导航导致的 CI 超时 (#853)；87b56c6e fix(fonts): 修复中文字体编译失败及 LIVE 误报超时 (#852)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.15.8)：有正文候选，待独立审阅。

## 2.15.7

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.15.6...v2.15.7)：56163453 release: 发布 v2.15.7 解说取消认领补丁 (#851)；e3bd823c fix(commentary): 支持赛前取消本人解说认领 (#850)；960120cb perf(ci): 将完整必需回归压缩到三分钟以内 (#841)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.15.7)：原文与日志核对后保留。

## 2.15.6

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.15.5...v2.15.6)：ddcf128c release: 发布 v2.15.6 修复首发选择入口 (#849)；7d597f1d fix(matches): 恢复队长首次选择本场首发入口 (#848)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.15.6)：原文与日志核对后保留。

## 2.15.5

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.15.4...v2.15.5)：1b82fa75 release: 发布 v2.15.5 修复选项框滚动 (#847)；fa35be72 fix(ui): 修复公共选项框长列表滚动 (#846)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.15.5)：原文与日志核对后保留。

## 2.15.4

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.15.3...v2.15.4)：279ce1bb release: 发布 v2.15.4 修复版本 (#845)；af5185ea fix(matches): 直通正赛队伍可直接创建测试赛 (#844)；617f6c9c fix(predictions): 调整比赛跳转入口并修复赛程换行 (#843)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.15.4)：原文与日志核对后保留。

## 2.15.3

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.15.2...v2.15.3)：09575257 release: 发布 v2.15.3 测试赛与比赛执行重构 (#842)；aa318be2 feat(matches): 支持赛事全生命周期测试赛并隔离正式事实 (#840)；4e44e846 ci(testing): 收敛测试债务并修复 affected CI 可信度 (#839)；a3669cda fix(nav): 恢复活跃赛事入口并精简赛事页导航 (#838)；b733c0b5 refactor(matches): 解耦比赛执行与赛事政策 (#836)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.15.3)：原文与日志核对后保留。

## 2.15.2

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.15.1...v2.15.2)：d966cff1 release: 发布 v2.15.2 (#837)；f565ad1a fix(navigation): 统一全站队伍与选手资料入口 (#834)；2366bf09 fix(matches): 修复第二名解说自助认领入口 (#835)；fc08313b chore(deps): 更新项目依赖至最新稳定版本 (#829)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.15.2)：原文与日志核对后保留。

## 2.15.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.15.0...v2.15.1)：ce04d915 release: 发布 v2.15.1 (#827)；abea11e6 fix: 修复报名与 Swiss 展示并补齐 BET 账户体验 (#826)；3d8f4e62 fix(preview): 修复脱敏镜像非空字段与状态约束 (#823)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.15.1)：原文与日志核对后保留。

## 2.15.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.14.4...v2.15.0)：d8f6e65b release: 发布 v2.15.0 赛事推演与独立竞猜平台 (#822)；5481bdb8 feat(bet): 落地独立赛事积分盘口与事实驱动生命周期 (#821)；3306d848 feat(predictions): 本地推演、多视图对阵与赛制自动驱动 Pick’Em (#820)；ade73690 chore(deps): 更新稳定版依赖 (#819)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.15.0)：原文与日志核对后保留。

## 2.14.4

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.14.3...v2.14.4)：c6e870e1 release: 发布 v2.14.4 (#818)；831119a7 fix(major): 修复未定级 S 段推荐与总览缩放 (#817)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.14.4)：原文与日志核对后保留。

## 2.14.3

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.14.2...v2.14.3)：f401b09d release: 发布 v2.14.3 (#816)；2af674c4 fix(competitive): 收口竞技最高事实与综合实力排名表 (#815)；4dcae883 fix(release): 保留迁移连接的显式 TLS 校验 (#812)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.14.3)：原文与日志核对后保留。

## 2.14.2

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.14.1...v2.14.2)：fae040da release: 发布 v2.14.2 (#811)；9abba60d fix(major): 补齐 Play-in 资格校验与共享预排名草稿 (#810)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.14.2)：原文与日志核对后保留。

## 2.14.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.14.0...v2.14.1)：7fa45351 chore(release): 发布 2.14.1 (#805)；a885135a fix(auth): 收口 Hosted Supabase 现代 API key 契约 (#804)；76639337 fix(db): 统一远程 PostgreSQL 证书与主机校验 (#803)；91053bbf fix(preview): reset application broadcast policy before replay (#802)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.14.1)：原文与日志核对后保留。

## 2.14.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.13.4...v2.14.0)：58525cf1 chore(release): 2.14.0 (#801)；ca519e74 fix(deployment): relocate Supabase production and preview projects (#800)；6f29273b feat(match-admin): 增加进行中系列赛果更正与整场恢复 (#799)；502cb9c0 feat(stats): 统一平台数据中心、Records 与 Insights (#798)；7db01e67 feat(event-logo): 补齐赛事 Logo 上传更换与公共复用 (#797)；dd415892 chore(deps): 升级稳定依赖并统一锁文件流程 (#796)；c0ca946f feat(match-admin): 完善自动与人工赛务及赛后收尾 (#772)；1b117d01 feat(matches): 完成公开比赛实时展示与桌面布局 (#792)；d0aa254b fix(mizar): 消除同步多源 LIVE 饥饿并保留有界授权事务 (#793)；716214ac fix(auth): 阻止并发登录恢复已撤销备用凭据 (#795)；7b75b671 fix(auth): 撤销应用会话并联动改密找回与账号归并 (#794)；45219bf8 fix(auth): 兼容新版 Supabase API key 并隔离环境凭据 (#791)；c7de35ef fix(stats): 统一概览与表格的动态样本资格 (#790)；84b74e1f fix(stats): 为投影检查与后台修复建立有界扫描 (#789)；057cb9b9 perf(cache): 收紧邀请失效并共享公开目录 (#788)；8f2ad1a3 fix(db): 禁止重放执行结果不明的查询 (#787)；f6ce6bf7 perf(stats): 持久化统计投影并降低数据库出站流量 (#779)；af91fafb fix(observability): 降低定时任务 trace 成本并补齐最终故障信号 (#778)；d5ebfc7a fix(ops): 补齐历史审计动作并修复导航验收与备份诊断 (#776)；96cb6093 fix(dak): 显式协商判负事实并保留旧客户端兼容 (#775)；205f68ec fix(audit): 补全历史操作与安全人名上下文 (#773)；16a1d424 fix(scheduler): 按实际生产版本规划定时任务兜底 (#774)；9178220c feat(matches): 收敛 Public Match Detail PRE / POST (#771)；d1db4fe7 feat(mizar): 落地 Mizar 后端机器接口、数据源权威与实时投递边界 (#770)；c997c9dc feat(matches): 落地 Scoreboard / OCR / DAK 生命周期与字段级所有权 (#769)；ff6e6440 feat(matches): 落地 Match Runtime Foundation 领域基础 (#768)；d63d14df chore(deps): bump pnpm/setup from 2.1.0 to 3.0.0 (#765)；37685cf6 refactor(predictions): 重构观赛预测工作台与读取负载 (#763)；4947c7c9 feat(predictions): 增加完整赛事推演、独立 Pick’Em 与积分预测 (#578)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.14.0)：原文与日志核对后保留。

## 2.13.4

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.13.3...v2.13.4)：9ea505e3 chore(release): 发布 2.13.4 (#762)；8e5d83b9 fix(prestart): 恢复未定级队伍系统参考 (#761)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.13.4)：原文与日志核对后保留。

## 2.13.3

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.13.2...v2.13.3)：5d45e2d7 chore(release): 发布 2.13.3 (#760)；721a672e fix(prestart): 收口排名工作台验收问题 (#759)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.13.3)：原文与日志核对后保留。

## 2.13.2

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.13.1...v2.13.2)：91cb208c chore(release): 发布 2.13.2 (#758)；094f3415 fix(major): 收口赛前阶段的时间配置 (#757)；943b5969 feat(major): 重组赛前工作区与排名决策 (#756)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.13.2)：原文与日志核对后保留。

## 2.13.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.13.0...v2.13.1)：052854ab chore(release): 发布 2.13.1 (#754)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.13.1)：原文与日志核对后保留。

## 2.13.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.12.3...v2.13.0)：cd18fb17 chore(release): 发布 2.13.0 (#753)；d2ecfe6f feat(rules): 发布 NJU Major 统一赛事规则 v1.1 (#752)；d905d286 feat(match): add online veto room (#751)。
- 快照无 Release，不创建。

## 2.12.3

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.12.2...v2.12.3)：c80f5df5 chore(release): 发布 2.12.3 (#750)；3b6e9dc5 fix(register): 收口队伍报名资格检查与资料补全 UX (#749)；aa432584 feat(major): 增加独立 Qualification Play-in 流程 (#746)；c9adb004 fix(steam): 清理已停用的 legacy profile 列 (#745)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.12.3)：原文与日志核对后保留。

## 2.12.2

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.12.1...v2.12.2)：6dc9d0dd chore(release): 发布 2.12.2 (#744)；12e4f06f feat(steam): 收口 Steam profile contract 并补齐官方资料投影 (#742)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.12.2)：原文与日志核对后保留。

## 2.12.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.12.0...v2.12.1)：dbeb4d3e chore(release): 发布 2.12.1 (#741)；8635173c fix(teams): 收敛赛事队伍公共页信息层级 (#740)；e94c4b2d fix: 收口组队意向状态与 scheduler watchdog (#739)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.12.1)：原文与日志核对后保留。

## 2.12.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.11.0...v2.12.0)：5f6c6f99 chore(release): 发布 2.12.0 (#735)；44efd940 fix(db): 串行化事务查询 (#733)；76a10673 fix(readiness): 修复参赛资料与组队上下文语义 (#734)；e48c0006 feat: rebuild Team public profile analytics (#716) (#727)；676f5f28 fix(scheduler): gate idle Vercel dispatches (#731)；44b23e18 chore: make Vercel previews on-demand (#730)；1db4d826 feat(players): 重构竞技表现画像 (#726)；e5fb0f9b refactor(players): 重组选手主页信息层级 (#724)；66e01443 feat(players): 选手主页接入全量生涯统计 (#722)；24b15db1 fix(stats): 收口赛事统计 metric help 入口 (#721)；957f6dd6 feat(major): 支持 24 队 managed profile (#720)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.12.0)：有正文候选，待独立审阅。

## 2.11.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.10.7...v2.11.0)：c79a5340 chore(release): 发布 v2.11.0 (#718)；110dc3e3 perf(cache): 收口公开请求与缓存边界 (#717)；49cad210 feat(stats): 落地赛事统计中心 (#711)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.11.0)：有正文候选，待独立审阅。

## 2.10.7

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.10.6...v2.10.7)：ccdcb8ed chore(release): 发布 v2.10.7；cea34101 fix(demo): 传播身份重检并区分实际出场差异 (#707)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.10.7)：原文与日志核对后保留。

## 2.10.6

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.10.5...v2.10.6)：b9d63e26 chore(release): 发布 v2.10.6 (#706)；abc27bd6 fix(demo): 收口身份复核与错误关联撤销流程 (#705)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.10.6)：原文与日志核对后保留。

## 2.10.5

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.10.4...v2.10.5)：629becf8 chore(release): 发布 v2.10.5；3e8b2f60 fix(release): 冻结重试 operator identity (#702)；4b795f06 fix(demo): 收口比赛 Steam 身份裁决与赛后确认闭环 (#701)；94649fe4 fix(ui): 收口 Product Language Boundary (#700)；61e46c67 feat(admin): 统一选手身份下钻与联系方式 (#699)；465370bd fix(preview): 修复 mirror schema skew 与安全诊断 (#698)；a7e979e1 fix(identity): 修正账号归并赛事名单预检与用户文案 (#693)；31865e81 fix(release): 修复 Steam backfill 参数转发 (#695)；10b92f84 fix(release): retry 时使用 workflow operator；2939415a fix(release): 恢复 PG17 rehearsal 的唯一 owner；74babd04 fix(release): 启动本地迁移回放数据库。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.10.5)：有正文候选，待独立审阅。

## 2.10.4

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.10.3...v2.10.4)：ffd17289 chore(release): 发布 v2.10.4；b8da8377 feat(identity): 收口 Steam 官方资料与 Steam64 身份；c82a9bd1 fix(team): 恢复私有 QQ 联系链路。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.10.4)：有正文候选，待独立审阅。

## 2.10.3

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.10.2...v2.10.3)：3bae17dc chore(release): 发布 v2.10.3；4e0ea6ac fix(demo): 对齐 Stable/3 teamkill 武器校验口径 (#682)；1cda3ba9 fix(release): 持久化 workflow 起始时间。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.10.3)：原文与日志核对后保留。

## 2.10.2

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.10.1...v2.10.2)：e339abc8 chore(release): 发布 v2.10.2；6262bee3 fix(ui): 修复列表搜索 hydration 前输入丢失 (#678)；2efef1ba feat(release): 落地 Issue637 风险分层发布快路径 (#675)；c7939e8e fix(dak): 切换 Demo Evidence semantic profile 到 /3 (#676)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.10.2)：原文与日志核对后保留。

## 2.10.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.10.0...v2.10.1)：04204d25 chore(release): 发布 v2.10.1；5b498622 fix(dak): 对齐 Demo Evidence 自杀武器汇总语义 (#672)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.10.1)：原文与日志核对后保留。

## 2.10.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.9.7...v2.10.0)：f9a52eee chore(release): 发布 v2.10.0；73ce53cb fix(dak): 收口 Demo Evidence semantic profile 到 /2 (#670)；0a378a40 feat(admin): 收口赛事报名与运营展示，固化生产版本基线 (#669)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.10.0)：原文与日志核对后保留。
