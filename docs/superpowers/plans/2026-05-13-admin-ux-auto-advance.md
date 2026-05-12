# 管理后台 UX 补全 + 报名自动推进 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修正报名容量口径（位置=提交数，Total=通过数）、实现审批满/截止自动推进 registration→voting、补全管理后台赛季子页导航

**Architecture:** 三个独立模块，互不阻塞。模块一改 register.ts + page.tsx；模块二新建 transitions.ts + cron route + 嵌入 admin.ts；模块三新建 SeasonSubNav 组件 + 微调 layout 和 sidebar

**Tech Stack:** Next.js 15 App Router, Drizzle ORM, TypeScript strict, Vercel Cron

---

## 文件结构

| 文件 | 职责 | 操作 |
|---|---|---|
| `src/actions/register.ts` | 加 `getApprovedCount()`；`submitRegistration` maxTotal 检查改为仅统计 approved | 修改 |
| `src/app/[seasonSlug]/register/page.tsx` | Total 行改用 `getApprovedCount()`，标签改 `Approved` | 修改 |
| `src/actions/transitions.ts` | `maybeAdvanceFromRegistration(tx, seasonId)` — 唯一推进逻辑 | 新建 |
| `src/actions/admin.ts` | `reviewRegistration` 审批通过后调用 `maybeAdvanceFromRegistration` | 修改 |
| `src/app/api/cron/check-registration-deadline/route.ts` | Cron endpoint：每分钟检查过期，调用推进逻辑 | 新建 |
| `src/components/admin/SeasonSubNav.tsx` | 赛季子页顶部 tab 导航条 | 新建 |
| `src/app/admin/[seasonSlug]/layout.tsx` | 引入 SeasonSubNav | 修改 |
| `src/components/admin/AdminSidebar.tsx` | "概览" → "赛季管理" | 修改 |

---

### Task 1: 容量 — 新增 `getApprovedCount()` 并修复提交上限检查

**Files:**
- Modify: `src/actions/register.ts:203-210, 267-284`

- [ ] **Step 1: 在 `submitRegistration` 中修改 maxTotal 检查为仅统计 approved**

定位 `src/actions/register.ts:203-210`，将：

```typescript
// 5. 全局总报名人数上限检查
const [totalCount] = await db
  .select({ count: count() })
  .from(seasonRegistrations)
  .where(eq(seasonRegistrations.seasonId, data.seasonId));
if (Number(totalCount?.count ?? 0) >= registrationConfig.maxTotal) {
  throw new AppError(ErrorCode.REGISTRATION_FULL, ERROR_MESSAGES.REGISTRATION_FULL);
}
```

改为：

```typescript
// 5. 全局总报名人数上限检查（仅统计已通过，被拒/候补不占名额）
const [totalCount] = await db
  .select({ count: count() })
  .from(seasonRegistrations)
  .where(
    and(
      eq(seasonRegistrations.seasonId, data.seasonId),
      eq(seasonRegistrations.status, "approved"),
    ),
  );
if (Number(totalCount?.count ?? 0) >= registrationConfig.maxTotal) {
  throw new AppError(ErrorCode.REGISTRATION_FULL, ERROR_MESSAGES.REGISTRATION_FULL);
}
```

`and` 已从 `drizzle-orm` 导入。

- [ ] **Step 2: 新增 `getApprovedCount()` 函数**

在 `getPositionCounts` 之后（`register.ts` 末尾）添加：

```typescript
/** 查询某赛季已通过审批的总人数 */
export async function getApprovedCount(seasonId: string): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(seasonRegistrations)
    .where(
      and(
        eq(seasonRegistrations.seasonId, seasonId),
        eq(seasonRegistrations.status, "approved"),
      ),
    );
  return Number(row?.count ?? 0);
}
```

- [ ] **Step 3: 类型检查**

```bash
pnpm tsc --noEmit
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/actions/register.ts
git commit -m "fix: maxTotal 检查改为仅统计 approved，新增 getApprovedCount()"
```

---

### Task 2: 容量 — 报名页 Total 行改为 `Approved: X / 56`

**Files:**
- Modify: `src/app/[seasonSlug]/register/page.tsx:61-73, 127-134`

- [ ] **Step 1: 导入 `getApprovedCount` 并用其替换 Total 数据**

在 `register/page.tsx:7` 的 import 行中，`getPositionCounts` 后面加 `getApprovedCount`：

```typescript
import { getPositionCounts, getApprovedCount } from "@/actions/register";
```

将 `page.tsx:61-63` 中：

```typescript
const positionCounts = await getPositionCounts(season.id);
const regConfig = normalizeRegistrationConfig(season.registrationConfig);
const maxPerPos = regConfig.maxPerPosition;
```

改为：

```typescript
const positionCounts = await getPositionCounts(season.id);
const approvedCount = await getApprovedCount(season.id);
const regConfig = normalizeRegistrationConfig(season.registrationConfig);
const maxPerPos = regConfig.maxPerPosition;
```

删除 `page.tsx:72-73`：

```typescript
const totalApproved = capacityEntries.reduce((sum, e) => sum + e.cur, 0);
const maxTotal = regConfig.maxTotal;
```

- [ ] **Step 2: 修改 Total 行 JSX**

将 `page.tsx:127-134` 中：

```typescript
<div className="flex justify-between items-center pt-2" style={{ borderTop: "1px solid var(--color-border)" }}>
  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-fg-dim)", fontFamily: "var(--font-display)" }}>
    Total
  </span>
  <span className="font-bold" style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--color-fg)" }}>
    {totalApproved} / {maxTotal}
  </span>
</div>
```

改为：

```typescript
<div className="flex justify-between items-center pt-2" style={{ borderTop: "1px solid var(--color-border)" }}>
  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-fg-dim)", fontFamily: "var(--font-display)" }}>
    Approved
  </span>
  <span className="font-bold" style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--color-fg)" }}>
    {approvedCount} / {regConfig.maxTotal}
  </span>
</div>
```

- [ ] **Step 3: 类型检查**

```bash
pnpm tsc --noEmit
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/[seasonSlug]/register/page.tsx
git commit -m "feat: 报名页 Total 行改为 Approved 标签，统计口径改为仅审批通过"
```

---

### Task 3: 自动推进 — 新建 `src/actions/transitions.ts`

**Files:**
- Create: `src/actions/transitions.ts`

- [ ] **Step 1: 创建 transitions.ts**

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { eq, count, and } from "drizzle-orm";
import { seasons, seasonRegistrations, auditLogs } from "@/db/schema";
import { normalizeRegistrationConfig } from "@/types/season";

type TxDb = Parameters<Parameters<typeof import("@/db/client").db.transaction>[0]>[0];

async function getApprovedCountInTx(tx: TxDb, seasonId: string): Promise<number> {
  const [row] = await tx
    .select({ count: count() })
    .from(seasonRegistrations)
    .where(
      and(
        eq(seasonRegistrations.seasonId, seasonId),
        eq(seasonRegistrations.status, "approved"),
      ),
    );
  return Number(row?.count ?? 0);
}

/**
 * 如果条件满足（通过数满 / 截止过期），自动推进 registration → 下一状态。
 * 必须在事务中调用——审批场景用外层的 tx，cron 场景自己包 transaction。
 */
export async function maybeAdvanceFromRegistration(
  tx: TxDb,
  seasonId: string,
): Promise<void> {
  const season = await tx.query.seasons.findFirst({
    where: eq(seasons.id, seasonId),
  });
  if (!season || season.status !== "registration") return;

  const registrationConfig = normalizeRegistrationConfig(season.registrationConfig);
  const approvedCount = await getApprovedCountInTx(tx, seasonId);
  const full = approvedCount >= registrationConfig.maxTotal;

  const deadlinePassed =
    season.registrationDeadline != null &&
    new Date(season.registrationDeadline).getTime() <= Date.now();

  if (!full && !deadlinePassed) return;

  // 无队长投票的赛季直接跳到 playing
  const nextStatus = season.hasCaptainVoting ? ("voting" as const) : ("playing" as const);

  await tx
    .update(seasons)
    .set({ status: nextStatus, updatedAt: new Date() })
    .where(eq(seasons.id, seasonId));

  await tx.insert(auditLogs).values({
    seasonId,
    action: "season.auto_advance",
    actorId: "system",
    targetId: seasonId,
    targetType: "season",
    meta: {
      from: "registration",
      to: nextStatus,
      reason: full ? "capacity_reached" : "deadline_passed",
      approvedCount,
      maxTotal: registrationConfig.maxTotal,
      deadline: season.registrationDeadline?.toISOString() ?? null,
    },
  });

  revalidatePath(`/${season.slug}`);
  revalidatePath(`/admin/${season.slug}/registrations`);
}
```

- [ ] **Step 2: 类型检查**

```bash
pnpm tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/actions/transitions.ts
git commit -m "feat: 新增 maybeAdvanceFromRegistration 自动推进逻辑"
```

---

### Task 4: 自动推进 — 审批通过后触发

**Files:**
- Modify: `src/actions/admin.ts:197-216`

- [ ] **Step 1: 在 reviewRegistration 事务内调用 maybeAdvanceFromRegistration**

在 `admin.ts` 顶部加 import：

```typescript
import { maybeAdvanceFromRegistration } from "@/actions/transitions";
```

在 `reviewRegistration` 的事务内，audit_log insert 之后、事务结束之前（`admin.ts:215` 之后）添加：

```typescript
      // 审批通过后检查是否满足自动推进条件
      if (targetStatus === "approved") {
        await maybeAdvanceFromRegistration(tx, reg.seasonId);
      }
```

完整上下文——`src/actions/admin.ts:215` 的 `});` 之前插入，即 audit_logs insert 后：

```typescript
      await tx.insert(auditLogs).values({
        seasonId: reg.seasonId,
        action: `registration.${targetStatus}`,
        // ... 保持不变
      });

      // 审批通过后检查是否满足自动推进条件
      if (targetStatus === "approved") {
        await maybeAdvanceFromRegistration(tx, reg.seasonId);
      }
    }); // ← 事务结束
```

- [ ] **Step 2: 类型检查**

```bash
pnpm tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/actions/admin.ts
git commit -m "feat: 审批通过后自动检查并推进赛季状态"
```

---

### Task 5: 自动推进 — Cron 定时检查截止时间

**Files:**
- Create: `src/app/api/cron/check-registration-deadline/route.ts`

- [ ] **Step 1: 创建 cron route**

```typescript
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { maybeAdvanceFromRegistration } from "@/actions/transitions";

// Vercel Cron 每分钟触发
// 安全：Authorization: Bearer ${CRON_SECRET}
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const activeSeasons = await db
    .select({ id: seasons.id })
    .from(seasons)
    .where(eq(seasons.status, "registration"));

  let advanced = 0;
  let skipped = 0;

  for (const s of activeSeasons) {
    await db.transaction(async (tx) => {
      // maybeAdvanceFromRegistration 内部做二次检查（status + 条件）
      await maybeAdvanceFromRegistration(tx, s.id);
    });
    advanced++;
  }

  skipped = activeSeasons.length - advanced;

  return NextResponse.json({ ok: true, advanced, skipped });
}
```

- [ ] **Step 2: 类型检查**

```bash
pnpm tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/check-registration-deadline/route.ts
git commit -m "feat: 新增 cron endpoint 检查报名截止自动推进"
```

部署后需在 Vercel Dashboard → Settings → Cron Jobs 添加：
- Schedule: `* * * * *`（每分钟）
- Path: `/api/cron/check-registration-deadline`

---

### Task 6: 后台导航 — 新建 SeasonSubNav 组件

**Files:**
- Create: `src/components/admin/SeasonSubNav.tsx`

- [ ] **Step 1: 创建 SeasonSubNav 组件**

```typescript
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface Tab {
  label: string;
  href: string;
  show: boolean;
}

export function SeasonSubNav({
  seasonSlug,
  hasCaptainVoting,
  hasDraft,
  hasMatches,
  showSettings,
}: {
  seasonSlug: string;
  hasCaptainVoting: boolean;
  hasDraft: boolean;
  hasMatches: boolean;
  showSettings: boolean;
}) {
  const pathname = usePathname();

  const tabs: Tab[] = [
    { label: "报名审核", href: `/admin/${seasonSlug}/registrations`, show: true },
    { label: "队长确认", href: `/admin/${seasonSlug}/captains`, show: hasCaptainVoting },
    { label: "选秀控制", href: `/admin/${seasonSlug}/draft`, show: hasDraft },
    { label: "赛程管理", href: `/admin/${seasonSlug}/matches`, show: hasMatches },
    { label: "赛季设置", href: `/admin/${seasonSlug}/settings`, show: showSettings },
  ].filter((t) => t.show);

  return (
    <nav
      className="flex gap-0 mb-6"
      style={{ borderBottom: "2px solid var(--color-border)" }}
    >
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="transition-colors"
            style={{
              padding: "10px 18px",
              borderBottom: active ? "2px solid var(--color-accent)" : "2px solid transparent",
              marginBottom: "-2px",
              fontWeight: active ? 600 : 500,
              fontSize: 13,
              color: active ? "var(--color-fg)" : "var(--color-fg-mid)",
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: 类型检查**

```bash
pnpm tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/SeasonSubNav.tsx
git commit -m "feat: 新增 SeasonSubNav 赛季子页导航组件"
```

---

### Task 7: 后台导航 — 在 season layout 中引入 SeasonSubNav

**Files:**
- Modify: `src/app/admin/[seasonSlug]/layout.tsx`

- [ ] **Step 1: 扩展 layout 查询以获取 capability 字段**

将 `src/app/admin/[seasonSlug]/layout.tsx:16-19` 的：

```typescript
const season = await db.query.seasons.findFirst({
  where: eq(seasons.slug, seasonSlug),
  columns: { id: true },
});
```

改为：

```typescript
const season = await db.query.seasons.findFirst({
  where: eq(seasons.slug, seasonSlug),
  columns: {
    id: true,
    hasCaptainVoting: true,
    hasDraft: true,
    stagePlan: true,
    status: true,
  },
});
```

- [ ] **Step 2: 导入 SeasonSubNav 并渲染**

在 `layout.tsx` 顶部加 import：

```typescript
import { SeasonSubNav } from "@/components/admin/SeasonSubNav";
```

将 return 部分从：

```typescript
return <>{children}</>;
```

改为：

```typescript
const hasMatches = (season.stagePlan as unknown[])?.length > 0;
const isSuperAdmin = admin.role === "super_admin";

return (
  <div className="container mx-auto px-4 py-8 max-w-6xl">
    <SeasonSubNav
      seasonSlug={seasonSlug}
      hasCaptainVoting={season.hasCaptainVoting}
      hasDraft={season.hasDraft}
      hasMatches={hasMatches}
      showSettings={isSuperAdmin}
    />
    {children}
  </div>
);
```

注意：`admin` 来自 `requireSeasonAdmin(season.id)` 的返回值，需要确认其类型含 `role` 字段。查看 `admin.ts:22` 可知 `admin` 包含 `{ role: "admin" | "super_admin" }`。

- [ ] **Step 3: 类型检查**

```bash
pnpm tsc --noEmit
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/[seasonSlug]/layout.tsx
git commit -m "feat: 赛季管理子页引入 SeasonSubNav 导航 tabs"
```

---

### Task 8: 后台导航 — 侧边栏标签修正

**Files:**
- Modify: `src/components/admin/AdminSidebar.tsx:10`

- [ ] **Step 1: "概览" → "赛季管理"**

将 `AdminSidebar.tsx:10` 的：

```typescript
{ href: "/admin", label: "概览" },
```

改为：

```typescript
{ href: "/admin", label: "赛季管理" },
```

路由不变（仍然是 `/admin`）。

- [ ] **Step 2: 类型检查**

```bash
pnpm tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/AdminSidebar.tsx
git commit -m "feat: 侧边栏概览→赛季管理，标签更明确"
```

---

### Task 9: 全量验证

- [ ] **Step 1: 运行类型检查**

```bash
pnpm tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 2: 运行测试**

```bash
pnpm test --run
```
Expected: All pass.

- [ ] **Step 3: 构建检查**

```bash
pnpm build
```
Expected: Build succeeds.

---

## 自审

- [x] Spec 覆盖：容量口径（Task 1-2）、自动推进（Task 3-5）、后台导航（Task 6-8）全部对应
- [x] 无占位符：所有 Task 包含完整代码和命令
- [x] 类型一致性：`TxDb` 类型在 Task 3 定义，Task 4 复用；`SeasonSubNav` props 在 Task 6 定义，Task 7 匹配
