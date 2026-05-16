# RivalHub · Claude Code 工程手册

## 项目概述

RivalHub 是开源电竞赛事管理平台，通过 capability 驱动的多赛事模型支持各类赛制（选秀联赛、公开赛、杯赛等）的全流程运营：报名 → 审核 → 队长投票 → 蛇形选秀 → 队伍展示 → 赛程 + Bracket 视图 → 部署。

当前阶段：**v1.10.1，站点部署在 `match.starfie1d.top`。v2 赛制引擎（StageExecutor + 5 个 executor + entrySeeds 种子轮空 + finalFormat 决赛 BO5）代码已就绪，待 2026 NJU Major 赛季开始时启用。**

## 版本路线图

| 版本 | 目标赛事 | 关键能力 |
|---|---|---|
| **v1** | 2026 NJU Rivals（春季赛） | 8 队选秀联赛全流程：报名→投票→选秀→排位赛→双败淘汰 |
| **v2** | 2026 NJU Major（秋季赛） | 32 队公开赛：3 轮瑞士轮 + 单败淘汰，种子+BU分配对 |
| **v3** | 泛用赛事平台 | 多游戏、多赛制可配置，任何赛制组合均可表达 |

v1 目标：2026 NJU Rivals 能正常运行。v2 目标：2026 NJU Major 的所有适配和准备工作。

### 版本号规范（Semver）

`package.json` 中的版本号遵循 semver（`MAJOR.MINOR.PATCH`）。v1.0.0 起按正式发布节奏管理：

| 层级 | 触发条件 | 示例 |
|---|---|---|
| **PATCH** `1.0.Y` | Bug 修复、文案修正、类型补丁、小重构 | `1.0.0` → `1.0.1` 修复显示错位 |
| **MINOR** `1.Y.0` | 新功能、新表/迁移、新页面/路由、向后兼容的能力扩展 | `1.0.0` → `1.1.0` 新增运营工具 |
| **MAJOR** `X.0.0` | 破坏性 schema / API / 赛制模型变更 | `1.x` → `2.0.0` |

**每次 dev → main 合并必须递增版本号**，由合并者判断层级。

**禁止手动修改 `package.json` 中的 version 字段。** 必须使用 `npm version <patch|minor|major>`，它会同步更新 `package.json` 并创建 `vX.Y.Z` tag：

```bash
npm version patch    # 1.3.1 → 1.3.2（同步打 tag v1.3.2）
npm version minor    # 1.3.2 → 1.4.0
npm version major    # 1.4.0 → 2.0.0
```

**push 时必须带 tag**：`npm version` 只创建本地 tag，普通 `git push` 不会推送。GitHub Release workflow（`.github/workflows/release.yml`）由 `v*` tag 触发，tag 不到远程就不会发布。

```bash
git push origin dev --follow-tags    # ✅ 推送提交并带上本地 tag
git push origin v1.6.0               # 或单独推 tag
```

每次 main 合并都需经过 `pnpm type-check` + `pnpm test` + `pnpm build` 全绿。

---

## 技术栈速查

| 层 | 选型 |
|---|---|
| 框架 | Next.js 15 App Router + TypeScript strict |
| 样式 | Tailwind CSS v4 + shadcn/ui |
| 数据库 | Supabase Postgres + Auth + Realtime + Storage |
| ORM | Drizzle ORM |
| 表单 | React Hook Form + Zod（中文校验消息） |
| 鉴权 | Supabase Auth（email+password；生产关闭邮件确认，不依赖 Magic Link）+ iron-session（双 Cookie：`rivalhub-session` 全用户 + `rivalhub-admin` root 紧急） |
| 定时任务 | GitHub Actions 每分钟调用 `/api/cron/draft-timeout`（选秀超时自动 pick）+ `/api/cron/check-registration-deadline`（报名截止/满员自动推进）+ `/api/cron/match-time-auto-award`（比赛时间协商截止自动裁定） |
| Bracket 渲染 | `brackets-manager` + `brackets-viewer`（经 `lib/bracket/` 适配层访问） |
| 单元/集成测试 | Vitest + React Testing Library + jsdom |
| E2E 测试 | Playwright |
| 包管理 | pnpm |
| 部署 | Vercel |

---

## 架构原则（必须遵守）

1. **业务逻辑全部走 Server Actions**，仅 Cron 触发用 API Route。
2. **多赛事抽象 day-1 到位**：所有赛事相关表含 `season_id` 外键，路由前缀 `/[seasonSlug]/...`，禁止硬编码赛季 ID 或 slug。
3. **不做物化计数**：位置满员等聚合靠 `COUNT GROUP BY`，页面加载时由 Server Component 一次性渲染；提交时服务端再做一次校验。Realtime 仅用于下方白名单的三张表，禁止订阅 `season_registrations`。
4. **Server Components 为主**，仅 Realtime 订阅 / 表单 / 倒计时等局部标注 `"use client"`。
5. **选秀并发安全**：Postgres 事务 + `SELECT ... FOR UPDATE` 行锁，`client_request_id` 幂等，8 步全在同一事务（见 `docs/draft-flow.md`）。
6. **所有管理操作写 audit_logs**，不允许跳过。
7. **时间统一存 UTC**，展示层转换为 Asia/Shanghai。

---

## 三条硬性禁令

### ❌ 禁止用 `season.kind` 做功能分支

```typescript
// ❌ 绝对禁止——这是 if 地狱的起点
if (season.kind === "联赛") { ... }
if (season.kind === "杯赛") { ... }

// ✅ 正确——读 capability 字段
if (season.hasDraft) { ... }
if (season.hasCaptainVoting) { ... }
if (season.registrationMode === "solo") { ... }
```

`season.kind` 是自由文本标记，仅用于界面展示和筛选。所有功能门控必须读 capability 字段。
新增赛事类型时，只需在数据库里配置 capability，不改业务代码。

### ❌ 禁止在事务外广播 Realtime

```typescript
// ❌ 错误——commit 前广播，客户端可能看到回滚后的幽灵数据
await db.transaction(async (tx) => {
  await tx.insert(draftPicks)...;
  supabase.channel(...).send(...);  // ← 不允许
});

// ✅ 正确——commit 成功后再广播
await db.transaction(async (tx) => { ... });
await supabase.channel(...).send(...);  // ← commit 后
```

### ❌ 禁止直接 import brackets-manager

```typescript
// ❌ 全站耦合第三方库
import { BracketsManager } from "brackets-manager";

// ✅ 经过适配层
import { generateBracket, advanceMatch } from "@/lib/bracket";
```

---

## Realtime 是高成本能力，不是默认能力

**应该用 Realtime 的表（仅这三张）：**

| 表 | 场景 |
|---|---|
| `draft_state` | 选秀围观页 + 队长面板的轮次/倒计时更新 |
| `draft_picks` | 选秀围观页新 pick 动画 |
| `captain_votes` | 投票页实时票数（可选，也可轮询） |

**不应该用 Realtime 的表：**
`registrations`、`teams`、`team_members`、`matches`、`users`、`audit_logs`、`admin_users`、`admin_invites`

禁止 `supabase.channel("*")` 或订阅上面列表以外的表。

---

## 状态机

所有实体的合法状态迁移规则见 `docs/state-machines.md`。
修改任何状态转换逻辑前，必须先更新该文档。

---

## Server Action 返回规范

所有 Server Action 必须返回 `ActionResult<T>`（见 `src/types/action.ts`），禁止抛出异常给客户端、禁止返回原始值。

```typescript
// ✅ 正确
import { ok, fail } from "@/types/action";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";

export async function submitRegistration(input: RegistrationFormData) {
  try {
    const id = await db.transaction(...);
    return ok({ id });
  } catch (e) {
    if (e instanceof AppError) {
      return fail({ code: e.code, message: e.message });
    }
    return fail({ code: ErrorCode.INTERNAL_ERROR, message: ERROR_MESSAGES.INTERNAL_ERROR });
  }
}

// ❌ 禁止
return { ok: true };          // 字段名不统一
throw new Error("...");        // 直接抛给客户端
return null;                   // 成功/失败语义不明
```

错误码统一定义在 `src/lib/errors.ts` 的 `ErrorCode` 中，新增错误必须先添加到那里。

---

## 缓存策略（Next.js 15）

| 路由类型 | 缓存策略 | 触发刷新 |
|---|---|---|
| `/[seasonSlug]/draft/**` | `force-dynamic` | 不缓存（实时性强） |
| `/[seasonSlug]/draft/captain` | `force-dynamic` | 同上 |
| `/admin/**` | `force-dynamic` | 不缓存 |
| `/[seasonSlug]/register` | `force-dynamic` | 报名提交后 `revalidatePath` |
| `/[seasonSlug]/captains` | RSC 默认 + Realtime | 投票变化时 `revalidatePath` |
| `/[seasonSlug]/teams` | RSC 默认（赛季进入 playing 后基本不变） | 选秀完成/logo 上传时 `revalidatePath` |
| `/[seasonSlug]/matches/**` | RSC 默认 | 录入比分时 `revalidatePath` |
| `/rules` | 静态 | 完整规则书（9 章，Tactical Grid 排版） |

**约束**：
- `force-dynamic` 只在选秀和后台路由使用，避免全站不缓存导致 RSC 退化
- `revalidatePath` 在 Server Action 成功后调用，传入具体路径，不要 `revalidatePath("/")`
- 不引入 Redis；Supabase + Next.js 默认缓存足够

---

## 目录索引

```
src/
├── app/              # Next.js App Router 路由
│   ├── [seasonSlug]/ # 公开赛季页面（注册/投票/选秀/队伍/赛程/数据统计）
│   ├── players/       # 选手主页（跨赛季战绩 + 个人数据）
│   ├── login/         # 邮箱+密码登录 / 注册页
│   ├── settings/     # 用户设置（个人信息 + 修改密码）
│   ├── invite/       # 邀请码提权页（?code=xxx）
│   ├── auth/callback # Supabase Auth 回调兼容入口（生产不依赖邮件确认）
│   ├── admin/        # 管理员后台（rivalhub-session / rivalhub-admin 保护）
│   └── api/cron/     # Cron API Route（当前由 GitHub Actions 触发）
├── actions/          # Server Actions（所有业务逻辑入口）
│   ├── account.ts    # 用户账号（修改密码、个人信息 updateProfile）
│   ├── admin.ts      # 管理员操作（审核/邀请码/撤销权限）
│   ├── auth.ts       # 邮箱+密码注册/登录/退出
│   ├── captains.ts   # 队长投票
│   ├── draft/        # 选秀（state / picks / queries）
│   ├── matches/      # 赛程（schedule / results / roster）
│   ├── register.ts   # 报名提交
│   ├── seasons.ts    # 赛季 CRUD（create/update/delete/publish）
│   └── teams.ts      # 队伍（修改队名/上传图标）
├── db/
│   ├── schema/       # Drizzle 表定义（18 张表）
│   ├── client.ts     # Drizzle client 单例（pg Pool，错误处理 + 超时配置）
│   └── seed.ts       # 种子数据（赛季 + 根管理员 RivalHub_root）
├── lib/
│   ├── auth/         # session.ts（双 Cookie iron-session）+ supabase.ts
│   ├── bracket/      # brackets-manager 适配层（禁止绕过）
│   ├── formats/       # StageExecutor 接口 + 赛制执行器（round-robin/double-elim/single-elim/swiss/gsl-group）+ _shared 工具
│   ├── config/       # 共享常量配置（报名默认值/上传限制/密码约束/队伍配置）
│   ├── realtime/     # Supabase Realtime 订阅辅助
│   ├── validators/   # Zod schema（registration / vote / match）
│   └── utils/        # date（UTC/CST）+ season（capability 工具）+ password（scrypt）+ cn
├── components/
│   ├── layout/       # Header / Footer
│   ├── ui/           # shadcn 组件（按需 add，已覆盖 button/input/badge/card/skeleton/select）
│   ├── rivalhub/     # Tactical Grid 组件（15 个：Panel/Btn/Field/Marker/Stat/MiniStat/
│   │                 #   StatusBanner/InlineConfirm/EmptyState/ErrorState/Skeleton/Spinner/
│   │                 #   TeamBadge/PosChip/StatusPill/ScrollHint）
│   ├── settings/     # 用户设置组件（ProfileForm / ChangePasswordForm）
│   ├── register/     # 报名业务组件
│   ├── admin/        # 管理后台业务组件（AdminSidebar 侧边栏 + 统一 layout）
│   ├── draft/        # 选秀业务组件
│   ├── captains/     # 队长投票业务组件
│   ├── teams/        # 队伍展示业务组件
│   └── matches/      # 赛程 / bracket 业务组件
└── types/            # 共享 TypeScript 类型
```

---

## 常用命令

```bash
pnpm dev               # 启动开发服务器
pnpm build             # 生产构建
pnpm tsc --noEmit      # 类型检查
pnpm lint              # ESLint

pnpm db:generate       # drizzle-kit generate（生成迁移 SQL，不执行）
pnpm db:push           # drizzle-kit push（推送到 Supabase，仅阶段2+使用）
pnpm db:studio         # Drizzle Studio

pnpm test              # Vitest 单元 + 集成测试
pnpm test:e2e          # Playwright E2E 测试
pnpm seed              # 运行种子脚本（阶段2+ 有真实 DB 后使用）
```

---

## 其他约束提醒

- **禁止跳过 audit_log**：任何 admin action（审核、确认队长、录入比分）都必须写 audit_logs。
- **禁止物化计数字段**：如 `position_count`、`vote_count` 等字段不在 schema 里，靠查询聚合。
- **禁止在 Server Action 外写 DB 逻辑**：页面文件只做数据读取（RSC fetch），写操作必须是 Server Action。
- **shadcn 组件按需 add**：`pnpm dlx shadcn@latest add button`，不要手工写 shadcn 组件。

---

## 分支管理

**日常工作分支是 `dev`**，`main` 仅通过 PR 合入用于生产部署。

| 场景 | 做法 |
|---|---|
| 小修复、联调、配置 | 直接 push `dev` |
| 功能开发 | 从 `dev` 开功能分支 → PR 合回 `dev` |
| 紧急线上修复（hotfix） | 从 `main` 开 hotfix 分支 → PR 合回 `main` → **cherry-pick 到 `dev`** |
| 阶段里程碑 | `dev` → `main` PR（打 tag + 部署生产） |

- `main`：生产分支，受保护（禁 force push + 禁删除），仅通过 PR 合入，不直接 push
- `dev`：日常集成分支，受保护（禁 force push + 禁删除），直推用于快速迭代
- v2/v3 版本分支：**不常驻维护**，对应版本开始开发时从当时 `main` 创建
- 功能分支命名：`feat/`（新功能）、`fix/`（修复）、`hotfix/`（紧急修复）、`docs/`（文档）、`refactor/`（重构）、`chore/`（配置/依赖）

---

## 进度与参考文档

| 文档 | 内容 |
|---|---|
| `CHANGELOG.md` | 版本发布记录（Keep a Changelog 格式） |
| `docs/state-machines.md` | 所有实体状态机（必读） |
| `docs/draft-flow.md` | 选秀事务边界与并发安全（必读） |
| `docs/data-integrity.md` | DB 与应用层约束分工、Storage bucket、soft delete 策略（必读） |
| `docs/architecture.md` | 整体架构与模块边界 |
| `docs/data-model.md` | ER 图 + 字段定义 |
| `docs/season-abstraction.md` | capability 驱动的多赛事设计 |
| `docs/auth-and-permissions.md` | 鉴权流程、能力×角色矩阵、RLS 策略 |
| `docs/registration-flow.md` | 报名表单与截图直传 |
| `docs/ui-design.md` | 页面级视觉设计 |
| `docs/ui-tokens.md` | 设计 tokens |
| `docs/testing.md` | 测试策略 |
| `docs/deployment.md` | Vercel 部署注意事项（Session Pooler 配置） |
