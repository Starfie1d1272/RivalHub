# 2.19–2.24 逐版证据

对照日志、Release 快照与 first-parent Git 提交；针对改动检查相关提交。Git 区间是版本差异证据，不推断生产状态。2.24.3 Release 含无 tag 的 2.24.2；2.21.13 区间含 2.21.12 版本提交，不能称其单独上线。

## 2.24.16

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.24.15...v2.24.16)：9ea4e695 release: 发布 2.24.16 (#1220)；2f57a427 chore(observability): 归因比赛详情与赛事目录 (#1219)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.24.16)：原文与日志核对后保留。

## 2.24.15

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.24.14...v2.24.15)：e64d88b0 release: 发布 2.24.15 (#1218)；911d40a3 perf(stats): 共享阵容比较的全局人口 (#1216)；3ada12d4 perf(bet): 收窄公共支持度读取 (#1215)；c5703227 perf(mizar): 减少重复读取名单数据 (#1214)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.24.15)：候选有正文改动，待独立审阅。

## 2.24.14

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.24.13...v2.24.14)：2de00b1d chore(release): v2.24.14 (#1217)；1c45b042 feat(observability): 按逻辑字节分析数据库流量 (#1213)；56b23fc5 ci(release): 并行构建与恢复测试 (#1211)；9e663b45 revert(ci): 恢复 180 秒执行预算门禁 (#1210)；d76b3218 ci(release): 移除 Vercel 生产发布路径 (#1209)；c0e1f2f5 ci: 将执行耗时预算改为报告 (#1208)；6fd01583 fix(preview): 更新迁库后的镜像目标 (#1207)；0da48de7 docs(ops): 精简发布与迁库记录 (#1206)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.24.14)：原文与日志核对后保留。

## 2.24.13

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.24.12...v2.24.13)：f7ebfb1e fix(release): 允许旧版首页故障时部署 (#1205)；cc8e0cbb release: 整理 v2.24.13 迁库后续修复 (#1204)；e58bd60e fix(ops): 恢复迁库实时连接与归因发送 (#1203)；faee348f release: 准备 v2.24.13 数据迁移与流量归因 (#1202)；f5868a71 fix(ops): 切换迁库目标与存储地址 (#1201)；53d7bb54 feat(observability): 增加数据库查询来源聚合 (#1198)；c7820dba fix(ci): 等待已终止子进程退出 (#1199)；ed6cbfe3 docs: 补充迁库凭据与创建入口 (#1200)；2ad3637c docs: 补充 Storage 受限时的迁库取件流程 (#1197)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.24.13)：候选有正文改动，待独立审阅。

## 2.24.12

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.24.11...v2.24.12)：37d16e37 release: v2.24.12 (#1196)；52ca8fab fix: 仅在解说开播时显示站内播放器 (#1195)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.24.12)：原文与日志核对后保留。

## 2.24.11

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.24.10...v2.24.11)：595ea4b2 release: v2.24.11 (#1193)；6d8ace36 fix: 提高持久主机实时接收并发 (#1192)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.24.11)：原文与日志核对后保留。

## 2.24.10

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.24.9...v2.24.10)：3f43d65e release: v2.24.10 (#1191)；ca2b2de5 refactor(observability): 停用外部遥测并保留本地诊断 (#1190)；64a1d3a4 fix(db): 补齐临时计分板镜像脱敏分类 (#1189)；0988d859 build(deps): 更新 react-hook-form 并保持遥测依赖一致 (#1177)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.24.10)：原文与日志核对后保留。

## 2.24.9

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.24.8...v2.24.9)：797d8bb7 release: v2.24.9 (#1188)；bb26739f feat: display provisional post-map scoreboard (#1178)；0a4cb43f test: 精简重复测试与历史测量入口 (#1187)；daf1015c ci: 简化计时依赖与重复性能采样 (#1186)；1a1b6739 test: 精简重复浏览器验证与一次性采样 (#1185)；f9c84832 test: 清理一次性基准与实现耦合断言 (#1184)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.24.9)：原文与日志核对后保留。

## 2.24.8

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.24.7...v2.24.8)：cbdfd50a release: 补充 v2.24.8 发布流程说明 (#1182)；1d978a8e fix(ci): 精确识别已消费 Changeset (#1183)；4d5fe4c2 chore(release): 清理多余诊断和人工清单 (#1181)；430ba1ea ci(release): 增加只读写入者诊断 (#1180)；60857c2e release: 准备 v2.24.8 管理与恢复补丁 (#1179)；0099686b test(capacity): 增加隔离业务并发实验 (#1175)；2e1e871b fix(recovery): 分离数据验证与放流就绪 (#1176)；ca84db8b feat(ops): 展示服务健康证据覆盖 (#1172)；8953ef7c fix: 区分名单调整草稿与审核补正 (#1171)；d943a678 feat(major): 在比赛页推进 Play-in (#1170)；5616ceee fix(major): 移除赛前重复阻塞提示 (#1169)；df4a0e80 build(deps): 更新生产依赖并保持 OTel 兼容 (#1174)；c3202dcd build(deps): bump @hookform/resolvers from 5.9.2 to 6.0.0 (#1157)；2926359a build(deps-dev): bump the development-minor-patch group across 1 directory with 3 updates (#1167)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.24.8)：原文与日志核对后保留。

## 2.24.7

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.24.6...v2.24.7)：bacac926 release: 准备 v2.24.7 OCR 模型与失败诊断补丁 (#1166)；87d04bba fix(ocr): 切换 27B 并补齐生成失败诊断 (#1165)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.24.7)：原文与日志核对后保留。

## 2.24.6

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.24.5...v2.24.6)：7a1326bf release: 准备 v2.24.6 读取成本与遥测概况补丁 (#1164)；e0617c91 feat(telemetry): 用图形概览呈现使用与体验信号 (#1163)；d39e491a feat(ops): 增加离线消费者安全计量与隔离对账 fixture (#1160)；743452ba feat(observability): 补齐统计填充与读取资源分母 (#1161)；3ca5b115 test(mizar): 清理赛程读取规模 fixture 避免调度串扰 (#1162)；5b3f0f3f feat(mizar): 返回授权账号与解说认领赛程并固定读取成本 (#1159)；531b9581 perf(bet): 按最新结算收窄开放盘口候选 (#1158)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.24.6)：原文与日志核对后保留。

## 2.24.5

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.24.4...v2.24.5)：235b1d97 release: 准备 v2.24.5 长窗口超时补丁 (#1154)；9520eb3c fix(telemetry): 统一长窗口十五秒请求与响应体截止 (#1153)；5c3126ed perf(telemetry): 减少长窗口历史读取往返与重复处理 (#1152)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.24.5)：原文与日志核对后保留。

## 2.24.4

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.24.3...v2.24.4)：24770995 release: 准备 v2.24.4 统一优化与解说更正修复 (#1151)；7a1d1876 fix(ci): 限制失败制品读取与脱敏工作量 (#1150)；63a416f3 test(observability): 准备隔离 production HTTP 组合资源驱动 (#1148)；2535a53d fix(telemetry): 启用第二版任务与独立需求计时 (#1149)；1bdb32ca fix(bet): 分离竞猜与预测任务确认和结果呈现 (#1146)；08c5ac0c perf(bet): 重叠公共统计与新鲜私有快照读取 (#1137)；594457bf fix(telemetry): 展示长窗口覆盖与独立任务口径 (#1147)；a1c6deb4 fix(teams): 修复目录时钟预渲染边界并保留预取 (#1132)；974dfb96 fix(live): 补齐阶段观测与 BP 恢复任务确认 (#1136)；5b38e723 fix(players): 拆分公开档案等待并接入共享资源观测 (#1135)；8b7c8a8e fix(telemetry): 提供滚动长窗口汇总并限制缓存字节 (#1142)；1d94b0be fix(telemetry): 兼容任务截断与按需就绪分组 (#1139)；d027e8b7 test(e2e): 为教育人工审核超时增加阶段证据 (#1143)；f07fc1bd fix(admin): 赛事 Logo 控件在交互就绪后启用 (#1144)；6abe2af1 fix(auth): 旧页面账号操作提示主动更新 (#1145)；98e94c33 refactor(auth): 提供版本错配与邮箱草稿恢复适配 (#1141)；6f60b37b fix(telemetry): 同步任务回执并隔离需求与呈现阶段 (#1140)；2d162d20 perf(observability): 补齐真实进程资源与连接池分布观测 (#1138)；9c519474 fix(telemetry): 修复趋势图 SVG 标题水合不一致 (#1133)；fd96b155 fix(telemetry): 按字节分批并停止永久坏批重试 (#1131)；d39bc8ff fix(telemetry): 提供任务 v2 兼容测量合同 (#1130)；ed978ce1 fix(postmatch): 允许超管独立确认已重开的解说名单更正 (#1129)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.24.4)：原文与日志核对后保留。

## 2.24.3

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.24.1...v2.24.3)：1ec1f818 release: 发布 v2.24.3 OCR 稳定性优化 (#1128)；4667465c fix(ocr): 调整采样参数并识别输出截断 (#1127)；4f4b7c63 release: v2.24.2 (#1126)；eb7db1f4 docs: 将正常 PR 默认交付状态改为 Ready (#1125)；543f63f5 fix(matches): 恢复赛中管理员解说管理入口 (#1124)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.24.3)：原文与日志核对后保留。

## 2.24.2

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.24.1...4f4b7c6357579d5141fc2d777a8bc6794cf62def)：4f4b7c63 release: v2.24.2 (#1126)；eb7db1f4 docs: 将正常 PR 默认交付状态改为 Ready (#1125)；543f63f5 fix(matches): 恢复赛中管理员解说管理入口 (#1124)。
- 快照无 Release，不创建。

## 2.24.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.23.2...v2.24.1)：8ec5d245 release: v2.24.1 (#1123)；80feaad2 fix(telemetry): 修复多维长期趋势的容量与查询截断 (#1122)；f9b773e3 release: v2.24.0 (#1121)；773194b5 feat(telemetry): 完善任务体验、趋势比较与长期聚合 (#1120)；addfe337 fix(preview): 排除生产 BP 与计分运行记录 (#1119)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.24.1)：原文与日志核对后保留。

## 2.23.2

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.23.1...v2.23.2)：5462237f release: v2.23.2 (#1118)；9afad632 perf(db): 统一进程内数据库运行时所有者 (#1117)；4f10b8d7 test(admin): 补齐辅助延迟与遥测上限浏览器证据 (#1116)；0eae6be1 fix(release): 排空数据库写者后再发布或回滚 (#1101)；fd47f800 fix(ci): 仅在隔离 E2E 中关闭开发渲染指示器 (#1115)；12496361 perf(account): 为设置和报名补真实流式边界与有界验收 (#1111)；3830c046 fix(admin): 补齐目录加载边界与关键后台即时验收 (#1112)；b9dd5bee fix(ci): 按浏览器场景成本拆分系统验收矩阵 (#1114)；e8c6ddcc perf(bp): 复用同请求授权与赛事归属并验证完整 HTTP 减量 (#1108)；ac2c6a6d perf(admin): 社区奖先读摘要并按需授权详情与候选 (#1113)；4bbe270f perf(awards): 提供后台摘要与按奖项详情边界 (#1106)；7c33cb3f fix(matches): 补齐名单录像与排期回应的授权状态核对 (#1110)；52570803 perf(telemetry): 合并后台分析并发 miss 并保持授权边界 (#1105)；bcc5b04c perf(observability): 避免 Linux 部署请求 Vercel 指标入口 (#1104)；cd5a7361 perf(admin): 策略目录只读摘要并按需授权详情 (#1109)；28f0a74c perf(admin): 按需授权读取待处理 Demo 详细核对 (#1102)；4380f41d perf(admin): 缩窄历史前驱并并行读取独立后台资料 (#1107)；e412b493 perf(admin): 共享赛务与解说的全局活动比赛事实 (#1103)；6644de76 perf(admin): 缩窄队长排名并一次分组策略引用 (#1100)；4c02f556 feat(ocr): 为计分板提交增加持久回执与内容版本校验 (#1091)；d2c94b31 perf(admin): 后台列表分页并接入有界摘要读取 (#1094)；72d5f30c perf(stats): 合并选手总体和按图战绩聚合 (#1095)；6cb8c982 perf(teams): 接入长期档案跨赛事比赛事实批次 (#1099)；88d4e15f perf(teams): 批量读取跨赛事公开比赛事实 (#1097)；6867f234 perf(playin): 提供复用完整冻结校验的单场战绩读取 (#1096)；125dbc9d fix(locking): 统一赛事写入锁顺序并批量保护预测事实 (#1093)；0faf3a61 feat(db): 增加 OCR 原子提交回执迁移 0098 (#1098)；c0d49610 perf(bp): 修复交互恢复和 Mizar 心跳死锁 (#1084)；67d279c5 perf(bet): 稳定竞猜页加载完成时提示布局 (#1092)；4a68ba3d docs(predictions): 明确私有读取与准入结算边界 (#1090)；7b619d2b perf(public): 缩减公开页面读取并按阶段加载赛程 (#1088)；49c6c7fd perf(cache): 按 BP 事实收敛失效并保留支持率硬刷新 (#1089)；051ab5c7 perf(stats): 按视图读取统计并缩短档案分析等待 (#1087)；7f1b9d5a perf(account): 精简资格读取并恢复 OCR 与长操作状态 (#1085)；06d0ea50 perf(admin): 收敛后台读取与按需展示边界 (#1083)；d58ab7c4 perf(predictions): 收窄 BET 读取并拆分准入与结算 (#1086)；6697cb5c perf(telemetry): 补齐连接分母与内容就绪关联合同 (#1082)；4ebecf5d perf: 优化空闲连接复用与赛事页面读取 (#1081)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.23.2)：原文与日志核对后保留。

## 2.23.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.23.0...v2.23.1)：b26f04de release: v2.23.1 (#1080)；39e8a02e perf(matches): 优化 BP 交互与公共页面数据库等待 (#1078)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.23.1)：原文与日志核对后保留。

## 2.23.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.22.1...v2.23.0)：e8ac681f release: v2.23.0 (#1079)；8300f718 feat(telemetry): 重设计后台遥测分析与联动筛选 (#1077)；f581cd2c perf(release): 分层复用生产运行时与依赖传输 (#1076)；1a8edf71 perf(mizar): 减少 LIVE 每帧凭据授权往返 (#1074)；eb9034cb fix(ci): 主动终止超出剩余执行预算的命令 (#1075)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.23.0)：原文与日志核对后保留。

## 2.22.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.22.0...v2.22.1)：a4ee273f release: v2.22.1 (#1073)；83dc695e perf(mizar): 合并 LIVE 授权往返以适配跨区数据库 (#1072)；a457951f perf(veto): 减少 BP 房间只读轮询往返 (#1071)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.22.1)：原文与日志核对后保留。

## 2.22.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.21.13...v2.22.0)：196f5ddd release: v2.22.0 (#1067)；4a4c9c7c fix(bet): 完善完赛卡片比分支持率与个人结果 (#1069)；e504edba fix(telemetry): 支持独立面板只读密钥 (#1068)；4b45acba fix(bet): 按正式 BP 结果结算未打满系列赛 (#1070)；dfc81e00 feat(operations): 增加独立日志容量策略和只读量测 (#1064)；cd010833 perf(presence): 优化自托管在线人数心跳与计数 (#1063)；4d5bb759 feat(telemetry): 新增超级管理员遥测分析面板 (#1066)；d7e66feb feat(telemetry): 补充 CLS 与访问环境粗分类 (#1065)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.22.0)：原文与日志核对后保留。

## 2.21.13

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.21.11...v2.21.13)：006ff019 release: 发布 2.21.13 自托管遥测续签修复 (#1062)；55f0251d fix(telemetry): 修复自托管反向代理后的票据续签 (#1061)；1acc84dc release: 发布 2.21.12 性能与遥测优化 (#1060)；6f6c9903 feat(postmatch): 支持每位解说多条回放与分组展示 (#1059)；88e06cb4 feat(ops): 展示自托管进程与连接池诊断快照 (#1058)；bc30d809 feat(telemetry): 为 Cloudflare 补充页面性能与导航耗时 (#1057)；239f2a88 perf(stats): 按当前视图拆分统计中心交互代码 (#1056)；4b503f83 perf(bet): 复用三类排行榜的总体读取 (#1055)；47f31ec2 perf(pages): 复用阶段事实并并行独立页面读取 (#1054)；9f707056 perf(db): 复用常驻主机连接并补充查询诊断 (#1053)；893624fe fix(bet): 批量读取结算输入以缩短统计保存等待 (#1052)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.21.13)：候选有正文改动，待独立审阅。

## 2.21.11

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.21.10...v2.21.11)：df3541f8 release: 发布 2.21.11 OCR 识别优化 (#1051)；47179582 fix(ocr): 缩短记分板识别等待并校验紧凑表格 (#1050)；c1f706dc ci(release): 默认部署 Linux 并保留 Vercel 回退路径 (#1049)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.21.11)：候选有正文改动，待独立审阅。

## 2.21.10

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.21.9...v2.21.10)：30eb5e3a release: 发布 2.21.10 Mizar 换图同步修复 (#1048)；61632095 fix(mizar): 衔接刷新后的比赛资料版本 (#1047)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.21.10)：原文与日志核对后保留。

## 2.21.9

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.21.8...v2.21.9)：c7b25bac release: 迁移 Supabase 新组织并发布 v2.21.9 (#1046)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.21.9)：原文与日志核对后保留。

## 2.21.8

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.21.7...v2.21.8)：4bcb92b6 release: 发布 v2.21.8 (#1045)；e33a2c64 perf(bet): 跨用户缓存公共竞猜统计 (#1044)；d2c2a915 build(standby): 部署 Preview 备用应用并准备应急切换 (#1043)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.21.8)：原文与日志核对后保留。

## 2.21.7

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.21.6...v2.21.7)：3eb800bc chore(release): v2.21.7 (#1042)；27cf4bd0 perf(bet): 合并竞猜轮询并限定单场与账户读取 (#1041)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.21.7)：原文与日志核对后保留。

## 2.21.6

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.21.5...v2.21.6)：10b554eb chore(release): v2.21.6 (#1040)；2cbc9f54 fix(admin): 整理现有赛务待办组件的信息层级 (#1039)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.21.6)：候选有正文改动，待独立审阅。

## 2.21.5

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.21.4...v2.21.5)：bfadb31f chore(release): v2.21.5 (#1038)；ec03fb64 fix(pickem): 提交即时计分并修正币框与截止提示 (#1037)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.21.5)：候选有正文改动，待独立审阅。

## 2.21.4

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.21.3...v2.21.4)：fa160777 chore(release): v2.21.4 (#1036)；7823e5f9 feat(pickem): add coin achievement workbench and scouting links (#1035)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.21.4)：候选有正文改动，待独立审阅。

## 2.21.3

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.21.2...v2.21.3)：32f34bca release: 发布 v2.21.3 (#1034)；4b6c431b fix(data): 统一赛事统计并清理测试赛泄露 (#1033)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.21.3)：候选有正文改动，待独立审阅。

## 2.21.2

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.21.1...v2.21.2)：a9761fcb release: 发布 v2.21.2 (#1032)；817e7ec8 fix(predictions): 赛程自然展开并独立停靠预测单 (#1031)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.21.2)：原文与日志核对后保留。

## 2.21.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.21.0...v2.21.1)：b420495e release: 发布 v2.21.1 (#1030)；6ecd0784 fix(predictions): 对齐五轮推演布局并支持直接保存 PickEm 草稿 (#1029)；bab780ef fix(registration): 衔接转队后的参赛确认与名单调整 (#1028)；05cf1ae5 fix(major): 管理员可在保存种子前撤回最终名单冻结 (#1027)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.21.1)：原文与日志核对后保留。

## 2.21.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.20.0...v2.21.0)：310f672e release: 发布 v2.21.0 (#1024)；5e77b375 feat(history): 补齐公开纪律与赛事历史展示 (#1016)；8724ec48 fix(deps): 更新开发依赖并修复报名页请求时渲染 (#1021)；53aa94ae chore(deps): bump the production-minor-patch group across 1 directory with 18 updates (#1023)；d2d02398 fix(deps): 避免精确补丁包阻塞常规依赖更新 (#1022)；6fcd51ad feat(stats): 扩展 4K/Ace 纪录与可追溯事件目录 (#1015)；59193963 ci(deps): 关联锁文件策略并刷新 Dependabot 检查 (#1019)；43f3c3bf fix(deps): 修复全局冻结配置阻塞 Dependabot 更新 (#1018)；602128b4 fix(ci): 持续同步 main 依赖图并恢复 npm 更新 (#1017)；4d34b3ab fix(auth): 将重置邮件提示绑定到已提交邮箱 (#1013)；8c14e9eb fix(ocr): 区分响应读取失败与 JSON 格式错误 (#1012)；b14fd424 fix(demo): 区分解析异常与数据校验失败 (#1011)；1f1f17d3 fix(preview): 补齐社区奖镜像策略与迁移兼容 (#1010)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.21.0)：原文与日志核对后保留。

## 2.20.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.19.4...v2.20.0)：7a60044c release: v2.20.0 (#1009)；e8e15db5 feat(matches): 新增赛前阵容与选手关键数据对照 (#1008)；fd80bcd9 feat(teams): 新增成员生涯打法三组散点图 (#1003)；a7fdef3e fix(observability): 隔离附加上下文读取失败并保留原错误 (#1007)；cbd6d5f1 fix(ui): 显示赛况刷新失败并恢复在线人数状态 (#1006)；1f14556f fix(auth): 补全密码异常恢复的核查与事务审计 (#1005)；4439def2 feat(community-awards): 支持多人获奖、候选核验与分阶段结奖 (#1004)；a355a5ba fix(observability): 补齐 Steam 与存储失败安全原因 (#1002)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.20.0)：原文与日志核对后保留。

## 2.19.4

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.19.3...v2.19.4)：57c3cd9d release: 2.19.4 (#999)；11a995b9 fix(admin): 汇总待处理报名并重算正赛实时参考 (#998)；705c295f fix(bet): 独立开放冠军与赛事击杀王竞猜 (#996)；45a2f767 fix(major): 恢复淘汰选手与队长自主转会 (#997)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.19.4)：候选有正文改动，待独立审阅。

## 2.19.3

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.19.2...v2.19.3)：c485bd24 release: 2.19.3 (#995)；cd9ebcc8 fix(bet): 兼容提前冠军盘口并开放赛事级参与 (#994)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.19.3)：原文与日志核对后保留。

## 2.19.2

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.19.1...v2.19.2)：fa4e560a release: 2.19.2 (#993)；ccbedfca fix(stats): 修复补正队伍详情页加载失败 (#992)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.19.2)：原文与日志核对后保留。

## 2.19.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.19.0...v2.19.1)：d1f4df08 release: 2.19.1 (#991)；e0a1678b fix(rosters): 保留名单调整中的正式参赛展示 (#990)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.19.1)：原文与日志核对后保留。

## 2.19.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.18.3...v2.19.0)：77d1e770 docs(changelog): 修正新版 compare 链接顺序 (#989)；8be7a9e5 chore(release): 2.19.0 (#988)；09b185bd fix(telemetry): 识别新版后台工作范围 (#987)；de54969d feat(admin): 按赛事工作范围重组管理后台 (#985)；1435cff7 chore(deps): bump pnpm/setup from 3.0.0 to 3.1.1 (#986)；c164c938 feat(ui): 整合桌面赛事体验并打磨逐页工作区 (#944)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.19.0)：候选有正文改动，待独立审阅。

## 2.25.0（并行新增）

- [版本区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.24.16...v2.25.0)：85a37d7a、ec529953、29617563、d26a1f81、8b9fe217；对应 Mizar 播出统计、数据库下行归因与首页备案入口。
- 标签指向 85a37d7ac094812c062034ad894b4cdf0fa50d51；正式 Release 已创建，原文和 metadata 已补充快照；正文与该版本日志一致，候选保留原文。
