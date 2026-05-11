# 多赛事抽象

## 设计原则

**day-1 强制到位**：所有代码结构必须支持多赛事，禁止在任何业务代码中硬编码赛季 ID 或 slug。

---

## Capability 驱动（核心）

多赛事的功能差异不通过 `season.kind` 判断，而是通过 `seasons` 表上的 capability 字段控制：

| 字段 | 类型 | 选秀联赛预设 | 公开赛预设 | 说明 |
|---|---|---|---|---|
| `registrationMode` | `solo \| team` | `solo` | `team` | 个人报名 vs 队伍报名 |
| `hasCaptainVoting` | `boolean` | `true` | `false` | 是否有队长投票环节 |
| `hasDraft` | `boolean` | `true` | `false` | 是否有蛇形选秀 |
| `stagePlan` | `StagePlan` | `round_robin -> double_elim` | `round_robin -> double_elim` | 多阶段赛制计划，`matches.stage` 存阶段 `key` |
| `registrationConfig` | `RegistrationConfig` | Rivals 默认报名规则 | Rivals 默认报名规则 | 身份类型、段位门槛、位置上限、截图数量 |
| `minTeamSize` | `integer` | `7` | `5` | 每队最少人数 |
| `maxTeamSize` | `integer` | `7` | `9` | 每队最多人数 |
| `starterCount` | `integer` | `5` | `5` | 首发人数 |
| `teamRegistrationConfig` | `TeamRegistrationConfig` | `{}` | MAJOR_TEAM_CONFIG | 队伍报名配置（身份/学校约束、位置分配、队伍管理权限） |
| `positions` | `text[]` | `["igl","awper","opener","closer","anchor"]` | `["igl","awper","opener","closer","anchor"]` | 该赛季可用位置列表（Team 模式下可选填） |

**为什么使用 stagePlan**：有些赛事可能仅有排位赛、仅有正赛，或有多个 Swiss / Playoff 阶段。用 `stagePlan` 的阶段数组统一描述，业务代码读取稳定的 `stage.key`，展示使用可变的 `stage.name`。

**这意味着**：新增娱乐赛、All-Star 赛、1v1 赛等，只需在数据库里配置一行不同的 capability，不需要修改任何业务代码。

```typescript
// ❌ 禁止
if (season.kind === "联赛") { showDraftPage() }

// ✅ 正确
if (season.hasDraft) { showDraftPage() }
```

---

## `season.kind` 的定位

`kind` 是自由文本字段，仅用于界面展示和筛选分类。部署者可以自定义任意值（"联赛"、"杯赛"、"表演赛"、"league"、"cup" 等），不需要修改 schema。

**业务逻辑绝不能读取 `kind` 做功能分支。**

---

## 位置系统（`positions` 字段）

每个赛季通过 `positions` 数组列定义该赛季可用的位置标识符。报名时 Server Action 从 `season.positions` 读取合法值做 Zod 校验。

默认值为 CS2 五位置：`["igl", "awper", "opener", "closer", "anchor"]`。

不同游戏的赛事可以配置不同的位置列表（如 LOL 的 "top", "jungle", "mid", "adc", "support"），无需修改代码。

---

## `seasonSlug` 路由解析

所有公开页面和管理后台均以 `[seasonSlug]` 为路由前缀：

```
/spring-2026-league/register         → 春季选秀联赛报名
/autumn-2026-open/register           → 秋季公开赛报名
/admin/spring-2026-league/registrations → 管理后台审核
```

每个 `[seasonSlug]` layout 负责：
1. 从 DB 查询 `seasons WHERE slug = seasonSlug`（服务端，可 cache）
2. 验证 slug 存在，否则 `notFound()`
3. 注入 `--season-primary` CSS 变量（来自 `seasons.theme_color`）
4. 将 season 对象通过 React Context 传递给子组件（避免重复查询）

---

## Capability 决定的功能差异

| 功能点 | capability 判断 | 选秀联赛 | 公开赛 |
|---|---|---|---|
| 报名表单类型 | `registrationMode` | `solo`（个人） | `team`（队伍） |
| 队长投票入口 | `hasCaptainVoting` | `true` | `false` |
| 蛇形选秀入口 | `hasDraft` | `true` | `false` |
| 排位赛展示 | `showQualifier(season)` | `round_robin` | `round_robin` |
| Bracket 视图 | `showPlayoffBracket(season)` | `double_elim` | `double_elim` |

**代码中 capability 检查的位置**（统一用 `lib/utils/season.ts` 的工具函数）：
- `[seasonSlug]/draft/page.tsx`：`if (!showDraft(season)) return <ComingSoon />`
- `[seasonSlug]/draft/captain/page.tsx`：同上
- `[seasonSlug]/captains/page.tsx`：`if (!showCaptainVoting(season)) return <ComingSoon />`

---

## 赛季主题色

每个赛季有独立的 `theme_color` 十六进制值，通过 layout 动态注入 CSS 变量：

```tsx
<div style={{ "--season-primary": season.themeColor } as CSSProperties}>
  {children}
</div>
```

CSS 中统一引用 `var(--season-primary)` 而非硬编码颜色。

---

## Header 多赛季导航

Header 从 DB 查询所有非 `archived` 赛季，动态渲染导航链接：

```tsx
const seasons = await getAllPublishedSeasons();
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

## Capability 预设

`src/types/season.ts` 提供两个内置预设，通过 `CAPABILITY_PRESETS` 索引访问：

| 预设名 | 说明 |
|---|---|
| `draft-league` | 选秀联赛（个人报名 → 投票 → 选秀 → 循环赛 + 双败） |
| `open-tournament` | 公开赛（队伍报名 → 循环赛 + 双败） |

部署者可以基于预设创建赛季，也可以完全自定义每个 capability 字段。

---

## v2 扩展点

未来功能扩展时需要修改的模块：
1. `src/lib/validators/registration.ts`：按 `season.registrationMode` 加载不同的 Zod schema
2. `src/actions/register.ts`：按 `season.registrationMode` 分支校验逻辑（不用 kind）
3. `src/app/[seasonSlug]/register/page.tsx`：按 `registrationMode` 渲染不同表单
4. 自由组队模式相关页面（新增路由，不破坏现有选秀联赛路由）
5. 多游戏位置列表：只需在创建赛季时配置 `positions` 字段
