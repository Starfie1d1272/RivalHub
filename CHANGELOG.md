# Changelog

All notable changes to RivalHub are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
