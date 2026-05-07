# 多赛事抽象

## 设计原则

**day-1 强制到位**：v1 只实现 Rivals 业务，但所有代码结构必须支持多赛事，禁止在任何业务代码中硬编码赛季 ID 或 slug。

---

## Capability 驱动（核心）

多赛事的功能差异不通过 `season.kind` 判断，而是通过 `seasons` 表上的 capability 字段控制：

| 字段 | 类型 | Rivals 默认 | Major 默认 | 说明 |
|---|---|---|---|---|
| `registrationMode` | `solo \| team` | `solo` | `team` | 个人报名 vs 队伍报名 |
| `hasCaptainVoting` | `boolean` | `true` | `false` | 是否有队长投票环节 |
| `hasDraft` | `boolean` | `true` | `false` | 是否有蛇形选秀 |
| `bracketType` | `double_elim \| ...` | `double_elim` | `double_elim` | Bracket 类型 |
| `teamSize` | `integer` | `7` | `5` | 每队人数 |
| `starterCount` | `integer` | `5` | `5` | 首发人数 |

**这意味着**：未来新增娱乐赛、All-Star 赛、1v1 赛等，只需在数据库里配置一行不同的 capability，不需要修改任何业务代码。

```typescript
// ❌ 禁止
if (season.kind === "rivals") { showDraftPage() }

// ✅ 正确
if (season.hasDraft) { showDraftPage() }
```

---

## `seasonSlug` 路由解析

所有公开页面和管理后台均以 `[seasonSlug]` 为路由前缀：

```
/rivals-2026-spring/register      → Rivals 2026 Spring 报名
/major-2026-autumn/register       → Major 2026 Autumn 报名（v1 占位）
/admin/rivals-2026-spring/registrations → 管理后台审核
```

每个 `[seasonSlug]` layout 负责：
1. 从 DB 查询 `seasons WHERE slug = seasonSlug`（服务端，可 cache）
2. 验证 slug 存在，否则 `notFound()`
3. 注入 `--season-primary` CSS 变量（来自 `seasons.theme_color`）
4. 将 season 对象通过 React Context 传递给子组件（避免重复查询）

---

## Capability 决定的功能差异

| 功能点 | capability 判断 | Rivals | Major |
|---|---|---|---|
| 报名表单类型 | `registrationMode` | `solo`（个人） | `team`（队伍，v2） |
| 队长投票入口 | `hasCaptainVoting` | `true` | `false` |
| 蛇形选秀入口 | `hasDraft` | `true` | `false` |
| Bracket 视图 | `bracketType !== null` | `double_elim` | `double_elim` |

**v1 代码中 capability 检查的位置**（统一用 `lib/utils/season.ts` 的工具函数）：
- `[seasonSlug]/draft/page.tsx`：`if (!showDraft(season)) return <ComingSoon />`
- `[seasonSlug]/draft/captain/page.tsx`：同上
- `[seasonSlug]/captains/page.tsx`：`if (!showCaptainVoting(season)) return <ComingSoon />`

---

## 赛季主题色

每个赛季有独立的 `theme_color` 十六进制值：

| 赛季 | 主题色 | 用途 |
|---|---|---|
| NJU Rivals 2026 Spring | `#f97316`（橙色） | 按钮/强调/Header 边框 |
| NJU Major 2026 Autumn | `#ef4444`（红色） | 同上 |

注入方式（赛季 layout.tsx）：
```tsx
<div style={{ "--season-primary": season.themeColor } as CSSProperties}>
  {children}
</div>
```

CSS 中统一引用 `var(--season-primary)` 而非硬编码颜色。

---

## Major 占位赛季（v1）

种子数据中创建 Major 2026 Autumn 占位行（status = `draft`），使路由结构 `/major-2026-autumn/...` 合法。

v1 所有 Major 页面渲染统一占位组件：
```tsx
// src/components/ui/coming-soon.tsx
export function ComingSoon({ seasonName }: { seasonName: string }) {
  return (
    <div className="text-center py-32">
      <h2>{seasonName}</h2>
      <p>敬请期待</p>
    </div>
  );
}
```

---

## Header 多赛季导航

Header 从 DB 查询所有非 `archived` 赛季，动态渲染导航链接：
- Rivals 2026 Spring（status = playing/registration/...）→ 正常链接
- Major 2026 Autumn（status = draft）→ 显示"敬请期待"角标，链接可点击但页面显示占位

```tsx
// 伪代码
const seasons = await getAllPublishedSeasons(); // 不含 archived
return (
  <nav>
    {seasons.map(s => (
      <Link key={s.slug} href={`/${s.slug}`}>
        {s.name}
        {s.status === "draft" && <Badge>敬请期待</Badge>}
      </Link>
    ))}
  </nav>
);
```

---

## v2 扩展点

Major 赛事差异化实装时需要修改的模块：
1. `src/lib/validators/registration.ts`：新增 Major 专用字段（外校标志、学院）
2. `src/actions/register.ts`：按 `season.registrationMode` 分支校验逻辑（不用 kind）
3. `src/app/[seasonSlug]/register/page.tsx`：按 `registrationMode` 渲染不同表单
4. Major 自由组队相关页面（新增路由，无需破坏现有 Rivals 路由）
5. `docs/season-abstraction.md` 更新差异表格
