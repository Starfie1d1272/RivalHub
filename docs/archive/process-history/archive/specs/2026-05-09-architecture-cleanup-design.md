# Architecture Cleanup — Design Spec

**Date**: 2026-05-09  
**Scope**: 前端架构精简 + 导航完善，为 P8（选秀）交接做准备  
**Approach**: 按层分 4 个 PR，依序合并

---

## 背景与目标

当前代码库存在三类结构性问题：

1. **展示常量多处重复定义**，类型权威定义（`types/`）和实际使用点（页面/组件）之间有多份副本
2. **入口层仍用 Mock 数据**，首页/赛季首页/Header 尚未接入 DB，与已完成的子页面脱节
3. **导航体系不完整**，Header 缺少登录入口，赛季内无二级导航，后台鉴权散点式

目标：不改业务语义，在不触碰 P8 功能之前把地基收干净，让同学能在一个结构清晰的代码库上实现选秀功能。

---

## PR1：统一展示常量

### 赛季状态

**权威来源**：`src/types/season.ts`

改动：
- 在 `src/types/season.ts` 新增 `SEASON_STATUS_TONE` 映射（`SeasonStatus → 'live' | 'soon' | 'done'`）
- 提取 `StatusDot` 组件到 `src/components/ui/status-dot.tsx`，消费上述两个映射
- 删除以下 4 处重复定义（`STATUS_CONFIG` / `STATUS_LABEL`）：
  - `src/app/page.tsx`
  - `src/app/seasons/page.tsx`
  - `src/app/[seasonSlug]/page.tsx`
  - `src/components/layout/header.tsx`

### 位置标签

**权威来源**：`src/lib/config/registration-defaults.ts`（含 cn / en / full 三种格式）  
**派生入口**：`src/lib/validators/registration.ts`（`POSITION_LABELS`）  

改动：
- 删除以下 4 处局部重新定义，统一 `import { POSITION_LABELS } from "@/lib/validators/registration"`：
  - `src/app/players/[userId]/page.tsx`（简化版 Record）
  - `src/app/[seasonSlug]/teams/[teamId]/page.tsx`（简化版 Record）
  - `src/components/teams/TeamGrid.tsx`
  - `src/components/teams/TeamCard.tsx`
- `src/types/registration.ts` 的 `POSITION_LABELS` 直接改为 re-export：`export { POSITION_LABELS } from "@/lib/validators/registration"`，删除自己的局部定义（避免与 `registration-defaults` 产生第三份副本）

### 位置排序

**权威来源**：`src/types/season.ts`（`CS2_POSITIONS` 变为导出 export）

改动：
- 导出 `CS2_POSITIONS`
- 删除 `src/app/[seasonSlug]/teams/page.tsx` 和 `src/app/[seasonSlug]/teams/[teamId]/page.tsx` 中的 2 处 `POSITION_ORDER` 重复，改为 `import { CS2_POSITIONS } from "@/types/season"`

### Match / Registration 状态标签

- `MatchStatusBadge.tsx` 和 `MatchDetail.tsx` 各自的 `STATUS_LABELS` 改为 `import { MATCH_STATUS_LABELS } from "@/types/match"`
- `RegistrationReviewList.tsx` 的 `STATUS_LABELS` 改为 `import { REGISTRATION_STATUS_LABELS } from "@/types/registration"`

---

## PR2：Mock 数据替换为 DB 查询

**依赖**：PR1

### `src/app/page.tsx`（首页）

- 改为 RSC，DB 查询 `status NOT IN ('archived')` 的赛季
- 继续分为 featured（第一个活跃赛季）和 others
- `FeaturedSeasonCard` / `CompactSeasonCard` 消费 DB 类型，使用 `StatusDot` + `SEASON_STATUS_LABELS`

### `src/app/[seasonSlug]/page.tsx`（赛季首页）

- 移除 `MOCK_SEASONS`，直接从 DB 查询（layout 已查过但不传 children，页面独立查一次，成本可接受）
- quick links 根据 capability 过滤：

| 入口 | 条件 |
|------|------|
| 立即报名 | 始终显示 |
| 队长投票 | `season.hasCaptainVoting === true` |
| 选秀 | `season.hasDraft === true` |
| 队伍阵容 | 始终显示 |
| 赛程对决 | `season.qualifierFormat !== null \|\| season.playoffFormat !== null` |

### `src/app/seasons/page.tsx`（历史赛季）

- 改为 RSC，DB 查询所有赛季，按 `createdAt DESC` 排序
- 使用统一 `StatusDot` + `SEASON_STATUS_LABELS`

---

## PR3：Header 用户区域 + 登录入口

**依赖**：PR2

### 架构拆分

当前 `header.tsx` 是纯 client component（`usePathname` + mobile state）。拆为：

- **`HeaderServer`**（Server Component，位置不变 `components/layout/header.tsx`）：
  - 查 DB 获取赛季列表（`status NOT IN ('archived', 'draft')`，只展示公开赛季）
  - 调用 `getUserSession()` 获取登录状态
  - 将数据作为 props 传给 `HeaderClient`

- **`HeaderClient`**（Client Component，`components/layout/header-client.tsx`）：
  - 接收 `seasons`、`session | null` 作为 props
  - 负责导航高亮（`usePathname`）、mobile menu state、用户区域渲染

### 用户区域行为

| 状态 | 显示内容 |
|------|---------|
| 未登录 | "登录"按钮 → `/login` |
| 已登录，`role === 'user'` | 邮箱缩写头像 + 下拉：使用邀请码（→ `/invite`）、退出登录 |
| 已登录，`role !== 'user'`（管理员） | 邮箱缩写头像 + 下拉：管理后台（→ `/admin`）、使用邀请码、退出登录 |

下拉菜单使用 `shadcn DropdownMenu`（已在项目中 add 过则复用，否则 `pnpm dlx shadcn@latest add dropdown-menu`）。

退出登录调用已有的 `logoutUser()` Server Action，成功后 `router.push("/")` 并 toast 提示。

---

## PR4：赛季二级导航 + admin 鉴权统一

**依赖**：无（可与 PR2/PR3 并行开发，最后合并）

### 赛季 tab 导航

在 `src/app/[seasonSlug]/layout.tsx` 中新增 `SeasonNav` Client Component（`components/layout/season-nav.tsx`）。

Layout 负责：
- 查 DB 获取 season（已有）
- 提取 `{ slug, name, hasCaptainVoting, hasDraft, qualifierFormat, playoffFormat }` 作为 props 传给 `SeasonNav`

`SeasonNav` 负责：
- 用 `usePathname` 计算 active 项
- 根据 capability 决定渲染哪些 tab

导航项定义：

| Tab 文案 | 路径 | 显示条件 |
|---------|------|---------|
| 首页 | `/{slug}` | 始终 |
| 报名 | `/{slug}/register` | 始终 |
| 队长投票 | `/{slug}/captains` | `hasCaptainVoting` |
| 选秀 | `/{slug}/draft` | `hasDraft` |
| 队伍 | `/{slug}/teams` | 始终 |
| 赛程 | `/{slug}/matches` | `qualifierFormat \|\| playoffFormat` |

样式：横向 tab 条，active 项用 `--season-primary` 颜色下划线高亮（复用已有的 CSS 变量）。

面包屑：layout 中保留"首页 > 赛季名"面包屑，tab 导航在面包屑下方。子页面不再需要自己补面包屑层级，tab 已提供定位上下文。

### admin layout 统一鉴权

**`src/app/admin/layout.tsx`**（从空壳改为鉴权入口）：

```
checkAdminSession()
  → null: redirect("/admin/login")
  → session: render <AdminNav email={session.email} /> + {children}
```

影响范围：
- `admin/page.tsx`：移除 `checkAdminSession() + redirect`（由 layout 覆盖），移除 `<AdminNav />` 渲染（layout 已统一渲染）
- `admin/settings/page.tsx`：同上
- `admin/[seasonSlug]/layout.tsx`：移除 `<AdminNav />` 渲染，保留 `requireSeasonAdmin` 细粒度检查（admin layout 提供 `any admin` 保护，这里确保 `season-level` 权限）
- `admin/invites/page.tsx`、`admin/users/page.tsx`：保留 `requireSuperAdmin`（更高权限，layout 不做替代）

---

## 约束

- 不改任何业务逻辑、不改 DB schema、不改 Server Actions
- 不引入新的 npm 包（仅可能 add shadcn 组件）
- 不改动 P8 相关文件（`actions/draft.ts`、`components/draft/`）
- 每个 PR 可独立部署，不依赖后续 PR 的内容
