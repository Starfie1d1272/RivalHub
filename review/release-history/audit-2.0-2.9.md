# 2.0–2.9 逐版证据

对照原 Release 与日志，并核查 Git 版本区间和受影响提交。早期 release 使用 squash 或分支合流；first-parent 提交名仅作为索引，不能单凭 ancestry 推断变更不存在。RC 版本特别对照各 tag 本身的提交差异，保留原版边界，不推断是否上线。

## 2.9.7

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.9.6...v2.9.7)：172996bc chore(release): 发布 v2.9.7；a7f20103 fix(release): 接受 Vercel canonical alias readback。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.9.7)：有正文候选，待独立审阅。

## 2.9.6

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.9.5...v2.9.6)：bf884d5e chore(release): 发布 v2.9.6；686ea174 fix(release): 收口 Release routing 状态机 (#661)；742e5cc3 feat(admin): 新增平台运营概览 (#659)。
- 快照无 Release，不创建。

## 2.9.5

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.9.4...v2.9.5)：97770604 chore(release): 发布 v2.9.5；c8ccca44 fix(dak): 收口 Demo Evidence correctness (#655)；6d68dc70 feat(dak): 补齐阶段积分榜与 bracket 投影 (#654)；d43c2d70 fix(admin): 收口管理端运营视图 presentation (#651)；15316aff fix(seasons): 修复已开放赛事时间保存误判 (#650)；a79a6dd2 chore(deps): bump actions/download-artifact from 4.2.1 to 8.0.1 (#647)；b9b02e6a fix(ui): 收口页脚、教育重提与页面宽度 (#649)；d7f6c56f fix(test): 收口 React / Vitest flaky detection 与异步交互确定性 (#648)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.9.5)：原文与日志核对后保留。

## 2.9.4

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.9.3...v2.9.4)：8146e623 chore(release): 发布 2.9.4 (#646)；1b452117 feat(integration): 接入 DAK Demo Evidence V1 (#641)；4fadb98d feat(demo-evidence): 落地 V1 contract 与真实 golden fixtures (#640)；cbaa3bef docs: 冻结 Demo Evidence V1 架构决策 (#639)；e4e0ea7d fix(release): 传递回滚部署身份 (#634)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.9.4)：原文与日志核对后保留。

## 2.9.3

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.9.2...v2.9.3)：8d19e811 release: v2.9.3 (#633)；29479406 feat(my): 收口个人工作区与角色适配 (#631)；85e2ed46 fix(player-identity): 收口公开选手头像契约 (#632)；3e3561cb fix(presentation): 收口人物身份与 Major 实力参考展示 (#629)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.9.3)：原文与日志核对后保留。

## 2.9.2

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.9.1...v2.9.2)：e04746c9 release: v2.9.2；7e30f8b1 fix(audit): 保留删除目标历史语义；e5fbe4ff fix(ci): 通过 Vercel API 解析 canonical deployment (#625)；81a47b7a fix(ci): 使用项目级 Vercel 凭据完成 release promotion (#624)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.9.2)：有正文候选，待独立审阅。

## 2.9.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.9.0...v2.9.1)：2e943f2e release: v2.9.1；0bec7aae refactor(audit): 收口审计事件写入契约 (#622)；64858e19 fix(registration): 收紧完美战队 ID 写入；66aa1b43 fix(major): 修正实力摘要语义与 5E 标识；1dcc4718 chore(tooling): 禁止 pnpm 检查命令隐式改写 lockfile (#619)；b36d12ca feat(public): 重组公共赛事浏览与档案体验 (Refs #452) (#611)；e4d7879c fix(preview): 补齐 team-logos bootstrap 与安全 phase 诊断 (#618)；14ab4f9f fix(preview): 脱敏 Team membership 结束原因 (#617)；e83f585c fix(preview): 固定公开 Preview persona 密码；3d38fdde feat(preview): 建立脱敏镜像预览 (#614)；2c3bf899 ci(release): 收敛 CI/CD 发布链路与 exact-SHA release gate (#604)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.9.1)：原文与日志核对后保留。

## 2.9.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.8.4...v2.9.0)：ab0ef447 release: v2.9.0 (#602)；7cb0da11 fix(education): 修复材料查看空白页 (#601)；ac5f8be1 fix(register): 修复换队后旧赛事确认被隐藏 (#600)；9e1c033b feat(ops): 建立公告、赛事信息与反馈入口 (#596)；d2db3132 ci: 按风险分层重构 Evidence Planner，收窄 System / FULL critical path；8243e088 fix(registration): 补齐审核通过后选手自助退赛 (#595)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.9.0)：原文与日志核对后保留。

## 2.8.4

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.8.3...v2.8.4)：6cb6dd4d release: v2.8.4 (#593)；7d17082b test: 稳定移动端公开发现历史导航 (#592)；1aac4367 feat: 收口报名、招募与玩家头像体验 (#591)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.8.4)：原文与日志核对后保留。

## 2.8.3

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.8.2...v2.8.3)：7824a535 release: v2.8.3 (#590)；c353bb0e fix(schema): 删除 Release N 旧 stage owner (#585)；202bcdaf fix(ops): 收敛灾备保留与恢复边界 (#589)；c425bbbb feat(ops): 建立 production 灾难恢复契约 (#577)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.8.3)：原文与日志核对后保留。

## 2.8.2

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.8.1...v2.8.2)：967df554 fix(release): 修复受保护部署 smoke (#584)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.8.2)：原文与日志核对后保留。

## 2.8.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.8.0...v2.8.1)：9d30e314 fix(release): 修复 v2.8.1 历史迁移 (#583)。
- 快照无 Release，不创建。

## 2.8.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.7.8...v2.8.0)：760d9cda release: 发布 v2.8.0 (#582)；814f6ff6 fix(ops): 固化 production release identity bootstrap (#581)；ae38bba0 fix(layout): 收口全站页面布局 ownership (#580)；a17a9f84 feat(matches): 收口阶段运行时归属 (#575)；7dbdddc8 chore(architecture): 将架构边界纳入可执行静态契约 (#576)。
- 快照无 Release，不创建。

## 2.7.8

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.7.7...v2.7.8)：e249ff42 chore(release): 发布 v2.7.8 (#574)；65513b36 fix: 修复生产调度与报名撤回截止边界 (#573)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.7.8)：原文与日志核对后保留。

## 2.7.7

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.7.6...v2.7.7)：79a5c483 chore(release): 发布 v2.7.7 (#567)；0b72a03e fix(registration): 收口报名期阻塞与撤回语义 (#566)；3d1ece5a ci(test): 收口测试证据与 CI critical path (#562)；efb41116 feat(education): 补齐教育认证 fallback (#558)；7fd5fffe feat(major): 接通公开参赛对象展示；b67393bd fix(scheduler): 修复业务关键 Cron 调度漂移。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.7.7)：原文与日志核对后保留。

## 2.7.6

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.7.5...v2.7.6)：6c2425de release: 发布 2.7.6 (#553)；e29abeae fix(teams): 统一赛事队伍公开详情展示 (#551)；55169426 feat(major): 增加候选队伍实时实力参考 (#549)；c69947dd fix(profile): 修复长期选手自述归属 (#550)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.7.6)：原文与日志核对后保留。

## 2.7.5

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.7.4...v2.7.5)：4cd81716 release: 发布 2.7.5；0cde9232 fix(admin): 收口报名审核与身份运营回归 (#546)；b3f23c96 ci: 分离 PR metadata 校验 (#544)；c05add1e ci: 收紧 changed-surface gate 与 CI 等待策略。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.7.5)：有正文候选，待独立审阅。

## 2.7.4

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.7.3...v2.7.4)：cad85865 release: 发布 2.7.4 (#530)；92cb0fc0 fix(major): 收口报名开放前的公开与操作边界 (#529)；29884b59 docs(release): 补充 CHANGELOG 整理门禁 (#520)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.7.4)：原文与日志核对后保留。

## 2.7.3

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.7.2...v2.7.3)：c5e10eee release: 发布 2.7.3；77c866fc fix(auth): 修复第二邮箱 OTP 类型识别 (#518)；e3555f9b docs(release): 收敛发布流程与 Agent 残留 (#516)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.7.3)：原文与日志核对后保留。

## 2.7.2

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.7.1...v2.7.2)：a38af224 release: v2.7.2 (#515)；13150c31 fix(seasons): 修复报名排期保存与展示 (#513)；78b555b7 docs(release): 收敛发布流程与 tag 约束 (#509)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.7.2)：原文与日志核对后保留。

## 2.7.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.7.0...v2.7.1)：fc50cbdd release: v2.7.1；2fd32df9 fix(major): 收口赛前运营台术语。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.7.1)：原文与日志核对后保留。

## 2.7.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.6.1...v2.7.0)：e6eadf64 release: 准备 v2.7.0 (#503)；d70f09a5 feat(identity): 建立 canonical 用户身份与安全归并 (#500)；220d30a1 feat(competitive): 新增跨平台换算策略管理 (#501)；c47058f6 refactor(season): 收口 capability contract 与历史兼容 owner (#502)；d60c9a26 fix(lint): 恢复 React Hooks 诊断 (#499)；b1e0b6f1 refactor(maintenance): 收口升级后的兼容残留 (#498)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.7.0)：有正文候选，待独立审阅。

## 2.6.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.6.0...v2.6.1)：b5a9af3e release: 准备 v2.6.1；17cf8fe9 ci(dependabot): 暂停 npm 版本更新 (#494)；fb3d6f06 chore(tooling): 升级 pnpm 到 12.3.4 (#492)；583af466 chore(deps): 升级 Zod 到 4.5.4 (#491)；e6d9ac66 chore(deps): 升级 jsdom 到 30.0.1 (#490)；e8e42319 chore(deps): 升级 Vitest 到 5.0.0 (#489)；52d27726 chore(deps): 升级 Changesets 到 3.0.2 (#488)；e496ba27 chore(deps): 升级 TypeScript 到 6.0.3 (#487)；ac473506 chore(deps): 升级 ESLint 到 10.10.0 (#486)；72e81d27 chore(deps): 升级 iron-session 到 9.0.1 (#485)；261671b0 chore(deps): 升级 Vercel CLI (#484)；62c9fe09 chore(deps): 升级 Playwright (#483)；029518cd chore(deps): 刷新 Supabase JS (#481)；253ccb58 chore(deps): 刷新低风险依赖；8a86ad02 docs: 收口 2.6 后的核心文档体系 (#478)；70e7416c docs: 修正 CHANGELOG 版本引用顺序 (#477)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.6.1)：有正文候选，待独立审阅。

## 2.6.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.5.0...v2.6.0)：5790a4f2 release: v2.6.0 (#476)；a9cf1759 feat(admin): 统一高价值运营列表的查询与分页体验 (#475)；d9bd20bb feat(teams): 统一队伍目录与组队大厅发现体验 (#474)；58d0e20b feat(ui): 建立统一列表查询基础并重构教育审核队列。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.6.0)：原文与日志核对后保留。

## 2.5.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.4.1...v2.5.0)：1a9b115f release: v2.5.0；be2ebbcd docs(ui): 记录 dense visual baseline 延后条件；ad31b2ae feat(ui): 补齐 UI 视觉基线与治理；7e478051 fix(match): 修复淘汰赛 Bracket 节点键盘不可达；b52c6023 fix(match): 修复比赛详情地图标签移动端横向溢出；31880726 fix(ui): 修复移动端全局导航展开布局；403e6a2c fix(season): 收口赛事首页报名 CTA 状态；7fd85265 fix(match): 收口 BP 读取状态与移动端 Dialog 布局；ac281048 feat(major): 统一 Perfect / 5E 等效竞技证据择高；f55dd13b ci: 强制统一 PR 标题格式；870f9cc9 feat(ui): 完成 #449A Foundation Core (#460)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.5.0)：有正文候选，待独立审阅。

## 2.4.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.4.0...v2.4.1)：a3638776 release: v2.4.1；799c4632 fix(admin): 修复 Major 赛事工作区生产概览渲染错误 (#451)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.4.1)：原文与日志核对后保留。

## 2.4.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.3.0...v2.4.0)：83a38565 release: v2.4.0 (#450)；0c2bd037 feat(major): 完成 #368 阶段 4 种子建议与最终种子收口 (#448)；c510be7e feat(admin): 收敛 Major 赛前参赛队选择 (#447)；47d0f567 feat(admin): 拆分比赛总览与单场工作台 (#446)；bf6078d0 feat(admin): 重构赛事设置分区 (#445)；036c674b chore(deps): 删除过期 PostCSS override (#444)；69995e66 feat(admin): 重构单届赛事工作区 (#443)；f7c45f0b feat: 建立生产级结构化可观测性与敏感日志治理 (#440)；5aa249ca feat(seasons): 启用社区奖赛事能力 (#442)；94515909 feat(admin): 重构全局赛事目录与首页主赛事选择 (#441)；0c1b46f7 docs: 重构 README、文档入口及拆分 operations 指南 (#438)；ae617f6b fix(release): 兼容 immutable release 重试 (#437)；ed24423a chore: 收敛 single-main 分支合约 (#436)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.4.0)：原文与日志核对后保留。

## 2.3.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.2.4...v2.3.0)：3d7fd2c3 Merge pull request #435 from Starfie1d1272/starfie1d/release/v2.3.0。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.3.0)：原文与日志核对后保留。

## 2.2.4

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.2.3...v2.2.4)：a4596c3a Merge pull request #415 from Starfie1d1272/starfie1d/release/v2.2.4。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.2.4)：原文与日志核对后保留。

## 2.2.3

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.2.2...v2.2.3)：2425610a Merge pull request #402 from Starfie1d1272/starfie1d/release/v2.2.3-clean；23f61bbd Merge pull request #388 from Starfie1d1272/dependabot/npm_and_yarn/testing-library/jest-dom-7.0.1；644528b3 Merge pull request #386 from Starfie1d1272/dependabot/npm_and_yarn/lucide-react-1.37.0；7fd93936 Merge pull request #385 from Starfie1d1272/dependabot/npm_and_yarn/development-minor-patch-55bf0fc937；953604d4 Merge pull request #383 from Starfie1d1272/dependabot/npm_and_yarn/production-minor-patch-1e2018a88b。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.2.3)：原文与日志核对后保留。

## 2.2.2

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.2.1...v2.2.2)：a11394fd Merge pull request #382 from Starfie1d1272/starfie1d/release/v2.2.2。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.2.2)：原文与日志核对后保留。

## 2.2.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.2.0...v2.2.1)：95552198 Merge pull request #374 from Starfie1d1272/starfie1d/release/v2.2.1。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.2.1)：原文与日志核对后保留。

## 2.2.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.1.0...v2.2.0)：8112d008 Merge pull request #361 from Starfie1d1272/starfie1d/release/v2.2.0。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.2.0)：原文与日志核对后保留。

## 2.1.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.0.3...v2.1.0)：91e01b8f Merge pull request #347 from Starfie1d1272/dev。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.1.0)：原文与日志核对后保留。

## 2.0.3

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.0.2...v2.0.3)：4a826f51 Merge pull request #331 from Starfie1d1272/release/v2.0.3-main；1e5b4ac9 Merge pull request #324 from Starfie1d1272/fix/release-vercel-probe。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.0.3)：原文与日志核对后保留。

## 2.0.2

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.0.1...v2.0.2)：5ae164cb Merge pull request #323 from Starfie1d1272/chore/reconcile-main-dev-history；c1df15e2 Merge pull request #322 from Starfie1d1272/fix/release-runner-db-credential；0bc0246c release: v2.0.2 (#320)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.0.2)：原文与日志核对后保留。

## 2.0.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.0.0...v2.0.1)：fc3ef79f release: v2.0.1 (#315)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.0.1)：原文与日志核对后保留。

## 2.0.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.0.0-rc.4...v2.0.0)：95b9786e release: v2.0.0 (#306)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.0.0)：原文与日志核对后保留。

## 2.0.0-rc.4

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.0.0-rc.3...v2.0.0-rc.4)：683cd40d release: v2.0.0-rc.4 (#264)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.0.0-rc.4)：有正文候选，待独立审阅。

## 2.0.0-rc.3

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.0.0-rc.2...v2.0.0-rc.3)：d2be2746 release: v2.0.0-rc.3；19f64fbf fix(privacy): close public payload and auth navigation boundaries；8c38df8e chore(sync): reconcile rc2 release base into dev；14775183 chore(sync): reconcile rc2 release base into dev；881207d6 fix: harden auth failure recovery (#258)；ce77b4b6 chore(sync): reconcile rc1 release base into dev；b1117a9f fix(auth): clarify legacy admin bootstrap entry (#256)；014e127b chore(release): prepare v2.0.0-rc.0；3704a69f chore(sync): reconcile main changes into dev；975fd881 fix(auth): close out RC owner bootstrap and cancellation path (#253)；241ddef6 fix(db): revoke public data api grants；b068f0f9 feat(major): complete legacy migration closeout；037cee65 feat: polish registration and participant UX (#252)；dabc985f feat(major): integrate RivalHub 2.0 tournament lifecycle；b6348d8b feat(major): build opening plan preview (#232)；20e832f8 fix(major): decouple Swiss pairing from stage format (#231)；4d395164 fix(major): unify standard Major preset (#227)；01e561de Merge pull request #230 from Starfie1d1272/fix/actions-node-runtime；7ac12ee9 Merge pull request #229 from Starfie1d1272/fix/lint-baseline-cleanup；903b0867 Merge pull request #228 from Starfie1d1272/fix/eslint-cli；54323f98 feat(matches): support multi-stage tournament views (#224)；a5e99bc9 feat(major): derive playoff and final placements (#222)；ed1f9cb0 fix: fail closed unsupported tournament flows (#223)；52fee98f feat: add deterministic Major Swiss domain core (#221)；54516acf test: 降低 Vitest 运行开销——默认 node 环境，仅 DOM 测试保留 jsdom (#220)；68807baa chore: reset Drizzle migration baseline for 2.0 (#219)；210107f6 feat: add canonical team identity bridge (#218)；78f051d3 docs: define dev integration workflow (#217)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.0.0-rc.3)：有正文候选，待独立审阅。

## 2.0.0-rc.2

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.0.0-rc.1...v2.0.0-rc.2)：7c4dfceb release: v2.0.0-rc.2 (#259)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.0.0-rc.2)：有正文候选，待独立审阅。

## 2.0.0-rc.1

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v2.0.0-rc.0...v2.0.0-rc.1)：b7561dc1 release: v2.0.0-rc.1 (#257)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.0.0-rc.1)：有正文候选，待独立审阅。

## 2.0.0-rc.0

- [Git 区间](https://github.com/Starfie1d1272/RivalHub/compare/v1.30.1...v2.0.0-rc.0)：9b567a39 release: v2.0.0-rc.0 (#255)；a275af7f chore(deps-dev): bump postcss to 8.5.23 (#237)；ca80c3bd chore(deps): bump next from 15.5.15 to 15.5.21 (#235)；57838cad ci: add dependabot config for github-actions (#236)；02b33ece ci: pin actions to SHAs + explicit permissions (#233)；8f94b6cc Revise capability status table in README (#226)；d90a66a0 fix: harden production integrity for v1.30.2 (#216)。
- [Release](https://github.com/Starfie1d1272/RivalHub/releases/tag/v2.0.0-rc.0)：有正文候选，待独立审阅。
