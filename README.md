# RivalHub

> 开源电竞赛事管理平台 — 报名 · 选秀 · 赛程一体化

## 版本路线图

| 版本 | 目标赛事 | 关键能力 | 分支 |
|---|---|---|---|
| **v1** | 2026 NJU Rivals（春季赛） | 8 队选秀联赛全流程 | `main` / `dev` |
| **v2** | 2026 NJU Major（秋季赛） | 32 队公开赛：3 轮瑞士轮 + 单败淘汰（BO3，决赛 BO5） | `v2` |
| **v3** | 泛用赛事平台 | 多游戏、多赛制可配置 | `v3` |

v1 聚焦 NJU Rivals 选秀联赛全流程。v2 赛制引擎（Swiss / GSL / SingleElim + StageExecutor v2）已在 `dev` 预落地。

## 功能概览

| 功能 | 说明 | 状态 |
|---|---|---|
| 多赛事抽象 | capability 驱动多赛事共存，路由前缀 `/[seasonSlug]/` | ✅ 架构就绪 |
| 玩家报名 | Zod 校验、位置满员检测、NJUBox 截图链接、Magic Link 邮件 | ✅ Phase 4 |
| 管理员审核 | 通过 / 拒绝 / 等待名单 + audit log + 邀请码管理 + 管理员账户管理 | ✅ Phase 5 |
| 队长投票 | 全体选手投票，Realtime 票数，得票前 8 名为队长 | ✅ Phase 6 |
| 蛇形选秀直播间 | Realtime 围观，倒计时，剩余选手池 | ✅ Phase 7 |
| 队长选秀面板 | 事务行锁、幂等 pick、超时 Cron 自动递补 | ✅ Phase 8 |
| 队伍展示 | 阵容按位置排版，首发/替补分区，队长 badge | ✅ Phase 9 |
| 赛程管理 | 比赛详情 + 地图结果 + 管理员录分 / 取消 | ✅ Phase 10 |
| Bracket 视图 | `brackets-manager` 双败/单败淘汰图，bracket 节点↔比赛详情双向跳转 | ✅ Phase 11 |
| 平台配置化 | `stagePlan`/`registrationConfig` JSONB，StageExecutor 框架（5 个 executor），Admin 赛季管理 UI | ✅ Phase 11 |
| 赛制引擎 v2 | Swiss (Buchholz+slide) / GSL Group (蛇形分配) / Single Elim (bye+季军赛) + entrySeeds 种子轮空 + finalFormat 决赛 BO5 | ✅ dev |
| 玩家数据 OCR | 管理员上传完美平台记分板截图 → SiliconFlow Qwen-VL 识别 → 人工审核确认 → 写入数据库 | ✅ Phase 11.5 |
| 玩家数据展示 | 比赛数据表 + MVP 投票 + 选手跨赛季聚合 + 赛季排行榜 + 队伍统计卡片 | ✅ Phase 11.5 |
| 部署上线 | Vercel + 自定义域名 + Cron + E2E 验证 | 🔄 Phase 12 |

## 技术栈

- **框架**：Next.js 15 App Router + TypeScript strict
- **样式**：Tailwind CSS v4 + shadcn/ui
- **数据库**：Supabase Postgres + Auth + Realtime + Storage
- **ORM**：Drizzle ORM
- **部署**：Vercel

## 本地启动

### 前置条件

- Node.js ≥ 22（见 `.nvmrc`）
- pnpm 11（由 `package.json` 的 `packageManager` 字段锁定）
- Supabase 账号（Phase 2+ 需要）

### 步骤

```bash
# 1. 安装依赖
pnpm install

# 2. 复制环境变量模板
cp .env.example .env.local
# 编辑 .env.local，填入 Supabase URL / keys 等

# 3. 初始化数据库（Phase 2+ 需要真实 Supabase 项目）
pnpm db:push
pnpm seed   # 自动创建根管理员 RivalHub_root / RivalHub_password

# 4. 启动开发服务器
pnpm dev
# → http://localhost:3000
```

Phase 1 本地前端验证成功时，`http://localhost:3000` 首页应显示 `RivalHub`。

### Phase 1 仅验证脚手架（无需真实数据库）

```bash
pnpm install
pnpm tsc --noEmit     # 类型检查通过
pnpm build            # 构建通过
pnpm test             # hello-world 测试通过
pnpm db:generate      # 离线生成迁移 SQL（不连接 DB）
```

## 环境变量

见 `.env.example` — 所有变量均有说明注释。

## 部署（Vercel）

> 详细配置见 **[docs/deployment.md](docs/deployment.md)**——Session Pooler 连接、环境变量清单、常见问题。

1. 在 Vercel 导入仓库（`main` 分支），配置所有环境变量。
2. `vercel.json` 已配置 Cron Job，部署后自动生效。
3. 数据库迁移通过 Drizzle 或 Supabase Dashboard 执行。
4. 绑定自定义域名，更新 `NEXT_PUBLIC_APP_URL`。

## 文档索引

| 文档 | 说明 |
|---|---|
| `PHASES.md` | 12 阶段开发路线图 |
| `docs/architecture.md` | 整体架构与模块边界 |
| `docs/data-model.md` | ER 图 + 字段定义 |
| `docs/auth-and-permissions.md` | 鉴权流程与 RLS 策略 |
| `docs/draft-flow.md` | 蛇形选秀状态机与并发安全 |
| `docs/registration-flow.md` | 报名表单与截图直传 |
| `docs/season-abstraction.md` | 多赛事抽象设计 |
| `docs/ui-design.md` | 页面级视觉设计与 ASCII 线框 |
| `docs/ui-tokens.md` | 设计 tokens（色板/字体/间距） |
| `docs/testing.md` | 测试策略与配置 |
| `docs/deployment.md` | Vercel 部署注意事项 |
| `docs/superpowers/specs/` | v2 赛制设计文档（Swiss / StageFramework / CS2 赛事调研） |
| `CLAUDE.md` | 面向 Claude Code 的工程手册 |

## 贡献指南

### 分支工作流

- **日常工作分支是 `dev`**
- 文档、配置、小修复 → 直接 push `dev`
- 功能开发 → 从 `dev` 开分支（`feat/xxx`）→ PR 合回 `dev`
- 阶段里程碑 → `dev` → `main` PR
- **版本分支** `v2` / `v3` 受 GitHub 规则保护（禁删除），合并后保留

### 开发规范

1. 在 `PHASES.md` 中找到对应阶段，阅读 `docs/` 相关文档后再动手。
2. 每个 Server Action 必须有对应的 Zod 校验和 audit log（admin 操作）。
3. PR 标题格式：`[phase-N] 简短描述`，附带通过的 `pnpm tsc --noEmit` 和 `pnpm test`。
