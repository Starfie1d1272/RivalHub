# Phase 11.5: 玩家数据展示 · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 OCR 已入库的 `match_player_stats` 数据在用户端展示——比赛详情数据表、单场 MVP 投票、选手跨赛季聚合、赛季排行榜、队伍聚合统计。

**Architecture:** 全部 Server Component 直读 DB，仅 MVP 投票按钮为 Client Component。新表 `match_mvp_votes` 存投票记录。排行榜通过 URL searchParams 驱动排序/筛选。

**Tech Stack:** Next.js 15 Server Components, Drizzle ORM, Tailwind CSS v4, shadcn/ui, Zod

---

## File Map

```
新增:
  src/app/[seasonSlug]/stats/page.tsx          — 赛季排行榜页面
  src/components/matches/PlayerStatsTable.tsx   — 单图10人数据表 (Server)
  src/components/matches/MatchMvpVote.tsx       — MVP投票区 (Client)
  src/components/matches/StatsLeaderboard.tsx   — 排行榜表格 (Server)
  src/db/schema/mvp-votes.ts                   — match_mvp_votes 表定义
  tests/unit/components/matches/PlayerStatsTable.test.tsx
  tests/unit/components/matches/StatsLeaderboard.test.tsx

修改:
  src/db/schema/index.ts                       — 加 mvp-votes export
  src/actions/player-stats.ts                  — 加 castMatchMvpVote + getMatchMvpResults
  src/app/[seasonSlug]/matches/[matchId]/page.tsx  — 加 PlayerStatsTable + MatchMvpVote
  src/app/players/[userId]/page.tsx            — 加个人数据section
  src/app/[seasonSlug]/teams/[teamId]/page.tsx — 加队伍统计卡片
  src/lib/utils/season.ts                      — 加 showStats capability
  src/components/layout/season-nav.tsx         — 加「数据统计」链接
  src/app/[seasonSlug]/page.tsx                — QuickLinks 加数据统计
```

---

### Task 1: match_mvp_votes 表

**Files:**
- Create: `src/db/schema/mvp-votes.ts`
- Modify: `src/db/schema/index.ts`

- [ ] **Step 1: 创建 schema 文件**

```typescript
// src/db/schema/mvp-votes.ts
import { pgTable, uuid, text, timestamp, unique } from "drizzle-orm/pg-core";
import { matches } from "./matches";
import { users } from "./users";

export const matchMvpVotes = pgTable("match_mvp_votes", {
  id: uuid("id").primaryKey().defaultRandom(),
  matchId: uuid("match_id").notNull().references(() => matches.id),
  playerUserId: uuid("player_user_id").references(() => users.id),
  playerName: text("player_name").notNull(),
  voterUserId: uuid("voter_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqVoterPerMatch: unique().on(t.matchId, t.voterUserId),
}));

export type MatchMvpVote = typeof matchMvpVotes.$inferSelect;
export type NewMatchMvpVote = typeof matchMvpVotes.$inferInsert;
```

- [ ] **Step 2: 在 index.ts 加 export**

在 `src/db/schema/index.ts` 末尾加一行:

```typescript
export * from "./mvp-votes";
```

- [ ] **Step 3: 推送迁移**

```bash
pnpm db:push
```

- [ ] **Step 4: 验证 TypeScript 编译**

```bash
pnpm tsc --noEmit
```
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/db/schema/mvp-votes.ts src/db/schema/index.ts
git commit -m "feat(db): add match_mvp_votes table for per-match MVP voting"
```

---

### Task 2: castMatchMvpVote + getMatchMvpResults actions

**Files:**
- Modify: `src/actions/player-stats.ts`

- [ ] **Step 1: 在文件顶部加 import**

在现有 imports 之后添加:

```typescript
import { matchMvpVotes } from "@/db/schema/mvp-votes";
import { requireAuth } from "@/lib/auth/session";
```

- [ ] **Step 2: 在文件末尾添加 castMatchMvpVote**

```typescript
export async function castMatchMvpVote(
  matchId: string,
  playerUserId: string | null,
  playerName: string,
) {
  try {
    const session = await requireAuth();
    if (!session?.userId) {
      return fail({ code: ErrorCode.UNAUTHORIZED, message: "请先登录" });
    }

    const match = await db.query.matches.findFirst({
      where: eq(matches.id, matchId),
    });
    if (!match) throw new AppError(ErrorCode.MATCH_NOT_FOUND, ERROR_MESSAGES.MATCH_NOT_FOUND);
    if (match.status !== "finished") {
      return fail({ code: ErrorCode.MATCH_INVALID_TRANSITION, message: "比赛尚未结束" });
    }

    await db.insert(matchMvpVotes).values({
      matchId,
      playerUserId: playerUserId ?? undefined,
      playerName,
      voterUserId: session.userId,
    });

    revalidatePath(`/${match.seasonId}/matches/${matchId}`);
    return ok(undefined);
  } catch (e) {
    if (e instanceof AppError) return fail({ code: e.code, message: e.message });
    // PG unique violation → 已投过票
    if (e instanceof Error && e.message.includes("uniq_voter_per_match")) {
      return fail({ code: ErrorCode.VOTE_DUPLICATE, message: "您已为本场比赛投过 MVP 票" });
    }
    console.error("[castMatchMvpVote]", e);
    return fail({ code: ErrorCode.INTERNAL_ERROR, message: ERROR_MESSAGES.INTERNAL_ERROR });
  }
}
```

- [ ] **Step 3: 添加 getMatchMvpResults**

```typescript
export async function getMatchMvpResults(matchId: string) {
  const votes = await db
    .select({
      playerUserId: matchMvpVotes.playerUserId,
      playerName: matchMvpVotes.playerName,
      count: sql<number>`count(*)::int`,
    })
    .from(matchMvpVotes)
    .where(eq(matchMvpVotes.matchId, matchId))
    .groupBy(matchMvpVotes.playerUserId, matchMvpVotes.playerName)
    .orderBy((t) => desc(t.count));

  return votes;
}
```

需要新增的 import:
```typescript
import { desc, sql } from "drizzle-orm";
```

- [ ] **Step 4: 验证编译**

```bash
pnpm tsc --noEmit
```
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/actions/player-stats.ts
git commit -m "feat(mvp): add castMatchMvpVote and getMatchMvpResults server actions"
```

---

### Task 3: PlayerStatsTable 组件

**Files:**
- Create: `src/components/matches/PlayerStatsTable.tsx`

- [ ] **Step 1: 创建组件**

```typescript
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { matchPlayerStats } from "@/db/schema/player-stats";
import { teamMembers } from "@/db/schema/teams";
import { seasonRegistrations } from "@/db/schema/registrations";
import { users } from "@/db/schema/users";

interface PlayerStatsTableProps {
  matchId: string;
  mapId: string;
}

async function getStatsGroupedByTeam(mapId: string, matchId: string) {
  const stats = await db.query.matchPlayerStats.findMany({
    where: eq(matchPlayerStats.mapId, mapId),
    orderBy: (t, { desc }) => [desc(t.ratingPro)],
  });

  if (stats.length === 0) return { teamA: [], teamB: [] };

  // 获取本场比赛的两队队伍ID
  const match = await db.query.matches.findFirst({
    where: eq(matchPlayerStats.mapId, mapId),
    columns: { teamAId: true, teamBId: true },
  });
  // 这里 mapId 查不到 match，需要额外传 matchId
  const matchData = await db.query.matches.findFirst({
    where: (m, { eq }) => eq(m.id, matchId),
    columns: { teamAId: true, teamBId: true },
  });
  if (!matchData) return { teamA: stats.slice(0, 5), teamB: stats.slice(5) };

  // 通过 userId → registration → teamMember 确定归属
  const userIds = stats.map((s) => s.userId).filter(Boolean) as string[];
  const registrations = userIds.length
    ? await db.query.seasonRegistrations.findMany({
        where: (t, { inArray, and, eq }) =>
          and(inArray(t.userId, userIds), eq(t.seasonId, match?.seasonId ?? "")),
        columns: { id: true, userId: true },
      })
    : [];
  const regIds = registrations.map((r) => r.id);
  const memberships = regIds.length
    ? await db.query.teamMembers.findMany({
        where: (t, { inArray, or, and }) =>
          and(
            inArray(t.registrationId, regIds),
            // 只拉本场比赛两队
            or(
              eq(t.teamId, matchData.teamAId),
              eq(t.teamId, matchData.teamBId),
            ),
          ),
        columns: { registrationId: true, teamId: true },
      })
    : [];

  const userIdToTeam = new Map<string, string>();
  for (const reg of registrations) {
    const mship = memberships.find((m) => m.registrationId === reg.id);
    if (mship) userIdToTeam.set(reg.userId, mship.teamId);
  }

  const teamA = stats.filter((s) => s.userId && userIdToTeam.get(s.userId) === matchData.teamAId);
  const teamB = stats.filter((s) => s.userId && userIdToTeam.get(s.userId) === matchData.teamBId);

  // 未匹配到队伍的放回对应侧（fallback: 前半给A，后半给B）
  const unmatched = stats.filter((s) => !s.userId || !userIdToTeam.has(s.userId));
  const half = Math.ceil(unmatched.length / 2);

  return {
    teamA: [...teamA, ...unmatched.slice(0, half)],
    teamB: [...teamB, ...unmatched.slice(half)],
  };
}

export async function PlayerStatsTable({ matchId, mapId }: PlayerStatsTableProps) {
  const { teamA, teamB } = await getStatsGroupedByTeam(mapId, matchId);

  if (teamA.length === 0 && teamB.length === 0) {
    return (
      <p className="text-xs text-[var(--text-muted)] py-2">
        暂无玩家数据
      </p>
    );
  }

  const cols = ["选手", "K", "D", "A", "ADR", "Rating"];

  return (
    <div className="grid grid-cols-2 gap-3 mt-2">
      <StatTeamBlock label="Team A" players={teamA} cols={cols} />
      <StatTeamBlock label="Team B" players={teamB} cols={cols} />
    </div>
  );
}

function StatTeamBlock({
  label,
  players,
  cols,
}: {
  label: string;
  players: Awaited<ReturnType<typeof getStatsGroupedByTeam>>["teamA"];
  cols: string[];
}) {
  return (
    <div className="rounded-md bg-[var(--bg-overlay)] p-3">
      <p className="text-[11px] text-[var(--text-secondary)] mb-2 font-medium">
        {label}
      </p>
      <div
        className="grid gap-x-2 gap-y-1 text-xs"
        style={{ gridTemplateColumns: `1.5fr repeat(${cols.length - 1}, 1fr)` }}
      >
        {cols.map((c) => (
          <span key={c} className="text-[var(--text-muted)] text-[10px]">
            {c}
          </span>
        ))}
        {players.map((p) => (
          <PlayerStatRow key={p.id} stat={p} />
        ))}
      </div>
    </div>
  );
}

function PlayerStatRow({
  stat,
}: {
  stat: Awaited<ReturnType<typeof getStatsGroupedByTeam>>["teamA"][number];
}) {
  return (
    <>
      <span className="text-[var(--text-primary)] truncate">
        {stat.perfectName}
      </span>
      <span className="tabular-nums text-[var(--text-primary)]">
        {stat.kills ?? "—"}
      </span>
      <span className="tabular-nums text-[var(--text-primary)]">
        {stat.deaths ?? "—"}
      </span>
      <span className="tabular-nums text-[var(--text-primary)]">
        {stat.assists ?? "—"}
      </span>
      <span className="tabular-nums text-[var(--text-secondary)]">
        {stat.adr != null ? stat.adr.toFixed(1) : "—"}
      </span>
      <span
        className="tabular-nums font-semibold"
        style={{
          color:
            stat.ratingPro != null && stat.ratingPro >= 1.2
              ? "var(--season-primary)"
              : "var(--text-primary)",
        }}
      >
        {stat.ratingPro != null ? stat.ratingPro.toFixed(2) : "—"}
      </span>
    </>
  );
}
```

- [ ] **Step 2: 验证编译**

```bash
pnpm tsc --noEmit
```
Expected: No errors. Fix any type issues.

- [ ] **Step 3: Commit**

```bash
git add src/components/matches/PlayerStatsTable.tsx
git commit -m "feat: add PlayerStatsTable component for per-map stats"
```

---

### Task 4: 比赛详情页集成 PlayerStatsTable

**Files:**
- Modify: `src/app/[seasonSlug]/matches/[matchId]/page.tsx`

- [ ] **Step 1: 加 import**

```typescript
import { PlayerStatsTable } from "@/components/matches/PlayerStatsTable";
```

- [ ] **Step 2: 在每张地图卡片内加数据表**

找到 `{maps.map((map) => (...))}` 循环，在每个 `<Card key={map.id}>` 内的比分行后面（`</div>` 之前），添加:

```tsx
{match.status === "finished" && (
  <PlayerStatsTable matchId={match.id} mapId={map.id} />
)}
```

具体位置是 `{map.scoreA !== null && map.scoreB !== null && (...)}` 的 `</div>` 和 `</Card>` 之间。

- [ ] **Step 3: 验证编译 + 运行测试**

```bash
pnpm tsc --noEmit
pnpm vitest run
```
Expected: TypeScript no errors, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/\[seasonSlug\]/matches/\[matchId\]/page.tsx
git commit -m "feat: embed PlayerStatsTable in match detail page"
```

---

### Task 5: MatchMvpVote 组件

**Files:**
- Create: `src/components/matches/MatchMvpVote.tsx`

- [ ] **Step 1: 创建 Client Component**

```typescript
"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { castMatchMvpVote } from "@/actions/player-stats";
import type { PlayerRowOCR } from "@/lib/ocr";

interface MvpCandidate {
  userId: string | null;
  perfectName: string;
  ratingPro: number | null;
  voteCount: number;
}

interface MatchMvpVoteProps {
  matchId: string;
  candidates: MvpCandidate[];
  currentVotes: { playerUserId: string | null; playerName: string; count: number }[];
  userVotedPlayerName: string | null;
}

export function MatchMvpVote({
  matchId,
  candidates,
  currentVotes,
  userVotedPlayerName,
}: MatchMvpVoteProps) {
  const [optimisticVotes, setOptimisticVotes] = useState(currentVotes);
  const [votedName, setVotedName] = useState(userVotedPlayerName);
  const [isPending, startTransition] = useTransition();

  async function handleVote(playerUserId: string | null, playerName: string) {
    if (votedName) return;
    startTransition(async () => {
      const result = await castMatchMvpVote(matchId, playerUserId, playerName);
      if (result.success) {
        setVotedName(playerName);
        // 乐观更新票数
        setOptimisticVotes((prev) =>
          prev.map((v) =>
            v.playerName === playerName
              ? { ...v, count: v.count + 1 }
              : v
          )
        );
      }
    });
  }

  const leading = optimisticVotes.length > 0
    ? optimisticVotes.reduce((a, b) => (a.count > b.count ? a : b))
    : null;

  const sorted = [...candidates].sort(
    (a, b) => (b.ratingPro ?? 0) - (a.ratingPro ?? 0)
  );

  return (
    <Card className="p-5 space-y-4 border-[var(--border)]">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-[var(--text-primary)]">
          本场 MVP 投票
        </h3>
        {votedName && (
          <span className="text-xs text-[var(--text-secondary)]">
            你已投票: <span className="text-[var(--primary)]">{votedName}</span>
          </span>
        )}
        {leading && (
          <span className="text-xs text-[var(--text-secondary)]">
            当前领先:{" "}
            <span className="text-[var(--season-primary)] font-semibold">
              {leading.playerName} ({leading.count} 票)
            </span>
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        {sorted.map((c) => {
          const v = optimisticVotes.find(
            (x) => x.playerName === c.perfectName
          );
          const count = v?.count ?? 0;
          const isVoted = votedName === c.perfectName;

          return (
            <button
              key={c.perfectName}
              disabled={!!votedName || isPending}
              onClick={() => handleVote(c.userId, c.perfectName)}
              className={`flex items-center justify-between rounded-md p-2.5 text-left transition-colors ${
                isVoted
                  ? "bg-[rgba(var(--season-primary-rgb),0.12)] ring-1 ring-inset ring-[var(--season-primary)]"
                  : votedName
                  ? "bg-[var(--bg-overlay)] cursor-not-allowed"
                  : "bg-[var(--bg-overlay)] hover:bg-[var(--bg-elevated)] cursor-pointer"
              }`}
            >
              <span className="text-[var(--text-primary)]">
                {c.perfectName}
                <span className="text-[11px] text-[var(--text-muted)] ml-1.5">
                  ({c.ratingPro?.toFixed(2) ?? "—"})
                </span>
              </span>
              <span
                className={`tabular-nums text-xs font-semibold ${
                  isVoted ? "text-[var(--season-primary)]" : "text-[var(--text-secondary)]"
                }`}
              >
                {count} 票
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: 验证编译**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/matches/MatchMvpVote.tsx
git commit -m "feat: add MatchMvpVote client component for per-match MVP voting"
```

---

### Task 6: 比赛详情页集成 MVP 投票

**Files:**
- Modify: `src/app/[seasonSlug]/matches/[matchId]/page.tsx`

- [ ] **Step 1: 页面层获取 MVP 数据**

页面是 Server Component，在 `const maps = await Promise.all([...])` 之后，新增 MVP 数据查询:

```typescript
// ── MVP 投票数据 ──────────────────────────────────────────────
let mvpCandidates: {
  userId: string | null;
  perfectName: string;
  ratingPro: number | null;
}[] = [];
let mvpVoteResults: Awaited<ReturnType<typeof getMatchMvpResults>> = [];
let userVoted: string | null = null;

if (match.status === "finished") {
  // 聚合本场所有选手的最高 Rating（去重按 perfectName + userId）
  const allStats = (
    await Promise.all(
      maps.map((m) =>
        db.query.matchPlayerStats.findMany({
          where: eq(matchPlayerStats.mapId, m.id),
        })
      )
    )
  ).flat();

  const seen = new Set<string>();
  mvpCandidates = allStats
    .filter((s) => {
      const key = s.userId ?? s.perfectName;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((s) => ({
      userId: s.userId,
      perfectName: s.perfectName,
      ratingPro: s.ratingPro,
    }));

  // 当前票数
  const { getMatchMvpResults } = await import("@/actions/player-stats");
  mvpVoteResults = await getMatchMvpResults(match.id);

  // 当前用户是否已投票
  const { cookies } = await import("next/headers");
  const sessionCookie = (await cookies()).get("rivalhub-session");
  if (sessionCookie) {
    const { getIronSession } = await import("iron-session");
    // 从 session 读当前用户，再查 votes 表
    const { getUserSession } = await import("@/lib/auth/session");
    const userSession = await getUserSession();
    if (userSession?.userId) {
      const existingVote = await db.query.matchMvpVotes.findFirst({
        where: and(
          eq(matchMvpVotes.matchId, match.id),
          eq(matchMvpVotes.voterUserId, userSession.userId),
        ),
      });
      if (existingVote) userVoted = existingVote.playerName;
    }
  }
}
```

需要的额外 imports:
```typescript
import { matchPlayerStats } from "@/db/schema/player-stats";
import { matchMvpVotes } from "@/db/schema/mvp-votes";
import { MatchMvpVote } from "@/components/matches/MatchMvpVote";
```

- [ ] **Step 2: 在地图循环之后加 MVP 区**

在地图结果 section 结束后（`</section>` 之后），`</div>` 之前，添加:

```tsx
{/* MVP 投票 */}
{isFinished && mvpCandidates.length > 0 && (
  <MatchMvpVote
    matchId={match.id}
    candidates={mvpCandidates}
    currentVotes={mvpVoteResults}
    userVotedPlayerName={userVoted}
  />
)}
```

- [ ] **Step 3: 验证编译**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/app/\[seasonSlug\]/matches/\[matchId\]/page.tsx
git commit -m "feat: integrate MVP voting into match detail page"
```

---

### Task 7: 选手个人统计聚合（跨赛季）

**Files:**
- Modify: `src/app/players/[userId]/page.tsx`

- [ ] **Step 1: 在页面中添加 stats 查询**

在现有 `const latestReg = ...` 之后，`return (...)` 之前，添加:

```typescript
// ── 个人数据统计（跨赛季）─────────────────────────────────────
const playerStats = await db
  .select({
    seasonName: seasons.name,
    seasonSlug: seasons.slug,
    seasonCreatedAt: seasons.createdAt,
    maps: sql<number>`count(distinct ${matchPlayerStats.mapId})::int`,
    avgKills: sql<number>`round(avg(${matchPlayerStats.kills})::numeric, 1)`,
    avgDeaths: sql<number>`round(avg(${matchPlayerStats.deaths})::numeric, 1)`,
    avgAssists: sql<number>`round(avg(${matchPlayerStats.assists})::numeric, 1)`,
    avgRating: sql<number>`round(avg(${matchPlayerStats.ratingPro})::numeric, 2)`,
    avgAdr: sql<number>`round(avg(${matchPlayerStats.adr})::numeric, 1)`,
    avgWe: sql<number>`round(avg(${matchPlayerStats.we})::numeric, 1)`,
    avgHs: sql<number>`round(avg(${matchPlayerStats.hsPercent})::numeric, 0)`,
    totalKills: sql<number>`sum(${matchPlayerStats.kills})::int`,
    totalDeaths: sql<number>`sum(${matchPlayerStats.deaths})::int`,
  })
  .from(matchPlayerStats)
  .innerJoin(matches, eq(matchPlayerStats.matchId, matches.id))
  .innerJoin(seasons, eq(matches.seasonId, seasons.id))
  .where(
    and(
      eq(matchPlayerStats.userId, userId),
      sql`${matchPlayerStats.verifiedByAdmin} IS NOT NULL`,
    )
  )
  .groupBy(seasons.id, seasons.name, seasons.slug, seasons.createdAt)
  .orderBy(asc(seasons.createdAt));
```

额外 import:
```typescript
import { matchPlayerStats } from "@/db/schema/player-stats";
import { sql } from "drizzle-orm";
```

- [ ] **Step 2: 添加展示 UI**

在「职业生涯战绩」section 之后、「赛季记录」section 之前，插入:

```tsx
{/* 个人数据 */}
{playerStats.length > 0 && (
  <section className="space-y-3">
    <h2 className="text-base font-semibold text-[var(--text-primary)]">
      个人数据
    </h2>

    {/* 生涯总计 */}
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[var(--primary)]">
          生涯总计
        </Badge>
        <span className="text-xs text-[var(--text-secondary)]">
          {playerStats.reduce((s, x) => s + x.maps, 0)} 图
        </span>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-center">
        {[
          {
            label: "Rating",
            value: (
              playerStats.reduce((s, x) => s + x.avgRating * x.maps, 0) /
              playerStats.reduce((s, x) => s + x.maps, 0)
            ).toFixed(2),
          },
          {
            label: "ADR",
            value: (
              playerStats.reduce((s, x) => s + x.avgAdr * x.maps, 0) /
              playerStats.reduce((s, x) => s + x.maps, 0)
            ).toFixed(1),
          },
          {
            label: "K/D",
            value:
              playerStats.reduce((s, x) => s + x.totalKills, 0) > 0 &&
              playerStats.reduce((s, x) => s + x.totalDeaths, 0) > 0
                ? (
                    playerStats.reduce((s, x) => s + x.totalKills, 0) /
                    playerStats.reduce((s, x) => s + x.totalDeaths, 0)
                  ).toFixed(2)
                : "—",
          },
          {
            label: "WE",
            value: (
              playerStats.reduce((s, x) => s + x.avgWe * x.maps, 0) /
              playerStats.reduce((s, x) => s + x.maps, 0)
            ).toFixed(1),
          },
          {
            label: "场均击杀",
            value: (
              playerStats.reduce((s, x) => s + x.totalKills, 0) /
              playerStats.reduce((s, x) => s + x.maps, 0)
            ).toFixed(1),
          },
          {
            label: "HS%",
            value: Math.round(
              playerStats.reduce((s, x) => s + x.avgHs * x.maps, 0) /
                playerStats.reduce((s, x) => s + x.maps, 0)
            ) + "%",
          },
        ].map(({ label, value }) => (
          <div key={label}>
            <p className="text-lg font-bold text-[var(--text-primary)]">
              {value}
            </p>
            <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
              {label}
            </p>
          </div>
        ))}
      </div>
    </Card>

    {/* 按赛季分组 */}
    {[...playerStats].reverse().map((ps) => (
      <Card key={ps.seasonSlug} className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Link
            href={`/${ps.seasonSlug}/stats`}
            className="text-sm font-semibold text-[var(--text-primary)] hover:text-[var(--primary)] transition-colors"
          >
            {ps.seasonName}
          </Link>
          <span className="text-[11px] text-[var(--text-muted)]">
            {ps.maps} 图 · 场均 {ps.avgKills}-{ps.avgDeaths}-{ps.avgAssists}
          </span>
        </div>
        <div className="flex gap-4 text-xs text-[var(--text-secondary)]">
          <span>
            Rating{" "}
            <span className="text-[var(--primary)] font-semibold">
              {ps.avgRating}
            </span>
          </span>
          <span>
            ADR{" "}
            <span className="text-[var(--text-primary)]">{ps.avgAdr}</span>
          </span>
          <span>
            K/D{" "}
            <span className="text-[var(--text-primary)]">
              {ps.avgDeaths > 0
                ? (ps.totalKills / ps.totalDeaths).toFixed(2)
                : "—"}
            </span>
          </span>
          <span>
            WE{" "}
            <span className="text-[var(--text-primary)]">{ps.avgWe}</span>
          </span>
        </div>
      </Card>
    ))}
  </section>
)}
```

- [ ] **Step 3: 验证编译**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/app/players/\[userId\]/page.tsx
git commit -m "feat: add cross-season player stats aggregation to profile"
```

---

### Task 8: showStats capability + SeasonNav 入口

**Files:**
- Modify: `src/lib/utils/season.ts`
- Modify: `src/components/layout/season-nav.tsx`
- Modify: `src/app/[seasonSlug]/page.tsx`

- [ ] **Step 1: 添加 showStats**

在 `src/lib/utils/season.ts` 末尾添加:

```typescript
/** 是否展示数据统计入口（赛季 playing 或 finished 时有比赛数据可看） */
export function showStats(season: Season): boolean {
  return season.status === "playing" || season.status === "finished" || season.status === "archived";
}
```

- [ ] **Step 2: SeasonNav 加链接**

在 `src/components/layout/season-nav.tsx`:

Props 加 `hasStats: boolean`:
```typescript
interface SeasonNavProps {
  slug: string;
  hasCaptainVoting: boolean;
  hasDraft: boolean;
  hasMatches: boolean;
  hasStats: boolean;
}
```

在 `items` 数组的 matches 项之后加:
```typescript
...(hasStats ? [{ label: "数据统计", href: `/${slug}/stats` }] : []),
```

- [ ] **Step 3: SeasonLayout 传参**

`src/app/[seasonSlug]/layout.tsx` 需要把 `showStats(season)` 传给 `SeasonNav`。

在 layout 中添加:
```typescript
import { showStats } from "@/lib/utils/season";
```

在渲染 `<SeasonNav>` 处加 `hasStats={showStats(season)}`。

- [ ] **Step 4: 赛季首页 QuickLinks 加入口**

在 `src/app/[seasonSlug]/page.tsx`:

加 import:
```typescript
import { BarChart3 } from "lucide-react";
import { showStats } from "@/lib/utils/season";
```

在 quickLinks 数组末尾添加:
```typescript
{
  href: `/${seasonSlug}/stats`,
  label: "数据统计",
  description: "赛季排行榜与个人数据",
  icon: BarChart3,
  show: showStats(season),
},
```

- [ ] **Step 5: 验证编译**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/utils/season.ts src/components/layout/season-nav.tsx src/app/\[seasonSlug\]/layout.tsx src/app/\[seasonSlug\]/page.tsx
git commit -m "feat: add showStats capability and nav entry for season stats page"
```

---

### Task 9: 赛季排行榜页面

**Files:**
- Create: `src/app/[seasonSlug]/stats/page.tsx`
- Create: `src/components/matches/StatsLeaderboard.tsx`

- [ ] **Step 1: 创建 StatsLeaderboard 组件**

```typescript
// src/components/matches/StatsLeaderboard.tsx
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { POSITION_LABELS } from "@/lib/validators/registration";

interface LeaderboardRow {
  userId: string | null;
  perfectName: string;
  position: string | null;
  teamName: string | null;
  teamId: string | null;
  maps: number;
  avgRating: number;
  avgAdr: number;
  avgKills: number;
  avgDeaths: number;
  avgWe: number;
}

interface StatsLeaderboardProps {
  rows: LeaderboardRow[];
  sort: string;
  position: string;
  seasonSlug: string;
}

const SORT_OPTIONS = [
  { key: "rating", label: "Rating" },
  { key: "adr", label: "ADR" },
  { key: "kd", label: "K/D" },
  { key: "we", label: "WE" },
  { key: "kpr", label: "KPR" },
  { key: "maps", label: "场次" },
];

const POSITIONS = [
  { key: "", label: "全部位置" },
  { key: "igl", label: "IGL" },
  { key: "awper", label: "AWPer" },
  { key: "opener", label: "Opener" },
  { key: "closer", label: "Closer" },
  { key: "anchor", label: "Anchor" },
];

export function StatsLeaderboard({
  rows,
  sort,
  position,
  seasonSlug,
}: StatsLeaderboardProps) {
  if (rows.length === 0) {
    return (
      <Card className="p-8 text-center text-[var(--text-secondary)]">
        该赛季暂无已确认的玩家数据
      </Card>
    );
  }

  return (
    <div>
      {/* 排序 Tab */}
      <div className="flex gap-1 flex-wrap mb-2">
        {SORT_OPTIONS.map(({ key, label }) => (
          <a
            key={key}
            href={`/${seasonSlug}/stats?sort=${key}${position ? `&position=${position}` : ""}`}
            className={`inline-block px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              sort === key
                ? "bg-[var(--season-primary)] text-white"
                : "border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {label}
          </a>
        ))}
      </div>

      {/* 位置筛选 */}
      <div className="flex gap-1 flex-wrap mb-4">
        {POSITIONS.map(({ key, label }) => (
          <a
            key={key}
            href={`/${seasonSlug}/stats?sort=${sort}${key ? `&position=${key}` : ""}`}
            className={`inline-block px-2.5 py-1 rounded text-[11px] transition-colors ${
              position === key
                ? "bg-[var(--bg-overlay)] text-[var(--text-primary)] font-medium"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {label}
          </a>
        ))}
      </div>

      {/* 表格 */}
      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-[var(--text-secondary)] text-xs uppercase tracking-wide">
              <th className="px-4 py-3 text-left w-8">#</th>
              <th className="px-4 py-3 text-left">选手</th>
              <th className="px-4 py-3 text-left">位置</th>
              <th className="px-4 py-3 text-left">队伍</th>
              <th className="px-4 py-3 text-center">图数</th>
              <th className="px-4 py-3 text-center">Rating</th>
              <th className="px-4 py-3 text-center">ADR</th>
              <th className="px-4 py-3 text-center">K/D</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((r, i) => (
              <tr key={r.userId ?? r.perfectName}>
                <td className="px-4 py-3 text-[var(--text-muted)] text-xs">
                  {i + 1}
                </td>
                <td className="px-4 py-3 font-medium text-[var(--text-primary)]">
                  {r.userId ? (
                    <Link
                      href={`/players/${r.userId}`}
                      className="hover:text-[var(--primary)] transition-colors"
                    >
                      {r.perfectName}
                    </Link>
                  ) : (
                    r.perfectName
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">
                  {r.position
                    ? POSITION_LABELS[r.position as keyof typeof POSITION_LABELS]?.cn ?? r.position
                    : "—"}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">
                  {r.teamId ? (
                    <Link
                      href={`/${seasonSlug}/teams/${r.teamId}`}
                      className="hover:text-[var(--primary)] transition-colors"
                    >
                      {r.teamName ?? "—"}
                    </Link>
                  ) : (
                    r.teamName ?? "—"
                  )}
                </td>
                <td className="px-4 py-3 text-center tabular-nums text-[var(--text-secondary)]">
                  {r.maps}
                </td>
                <td
                  className={`px-4 py-3 text-center tabular-nums font-semibold ${
                    r.avgRating >= 1.2
                      ? "text-[var(--season-primary)]"
                      : "text-[var(--text-primary)]"
                  }`}
                >
                  {r.avgRating.toFixed(2)}
                </td>
                <td className="px-4 py-3 text-center tabular-nums text-[var(--text-primary)]">
                  {r.avgAdr.toFixed(1)}
                </td>
                <td className="px-4 py-3 text-center tabular-nums text-[var(--text-primary)]">
                  {r.avgDeaths > 0
                    ? (r.avgKills / r.avgDeaths).toFixed(2)
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: 创建排行榜页面**

```typescript
// src/app/[seasonSlug]/stats/page.tsx
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, matches } from "@/db/schema";
import { matchPlayerStats } from "@/db/schema/player-stats";
import { seasonRegistrations } from "@/db/schema/registrations";
import { teamMembers } from "@/db/schema/teams";
import { teams } from "@/db/schema/teams";
import { sql } from "drizzle-orm";
import { StatsLeaderboard } from "@/components/matches/StatsLeaderboard";

interface StatsPageProps {
  params: Promise<{ seasonSlug: string }>;
  searchParams: Promise<{ sort?: string; position?: string }>;
}

export default async function StatsPage({ params, searchParams }: StatsPageProps) {
  const { seasonSlug } = await params;
  const { sort = "rating", position = "" } = await searchParams;

  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  if (!season) notFound();

  const sortColumn = (() => {
    switch (sort) {
      case "adr": return sql`avg(${matchPlayerStats.adr})`;
      case "kd": return sql`CASE WHEN sum(${matchPlayerStats.deaths}) > 0 THEN round((sum(${matchPlayerStats.kills}) / sum(${matchPlayerStats.deaths}))::numeric, 2) ELSE 0 END`;
      case "we": return sql`avg(${matchPlayerStats.we})`;
      case "kpr": return sql`round((sum(${matchPlayerStats.kills}) / count(*))::numeric, 1)`;
      case "maps": return sql`count(*)`;
      default: return sql`avg(${matchPlayerStats.ratingPro})`;
    }
  })();

  const positionFilter = position
    ? sql`AND ${seasonRegistrations.primaryPosition} = ${position}`
    : sql``;

  const rows = await db.execute(sql`
    SELECT
      mps.user_id,
      mps.perfect_name,
      sr.primary_position,
      t.name as team_name,
      t.id as team_id,
      count(*)::int as maps,
      round(avg(mps.rating_pro)::numeric, 2) as avg_rating,
      round(avg(mps.adr)::numeric, 1) as avg_adr,
      round(avg(mps.kills)::numeric, 1) as avg_kills,
      round(avg(mps.deaths)::numeric, 1) as avg_deaths,
      round(avg(mps.we)::numeric, 1) as avg_we,
      sum(mps.kills)::int as total_kills,
      sum(mps.deaths)::int as total_deaths
    FROM match_player_stats mps
    JOIN matches m ON m.id = mps.match_id
    LEFT JOIN season_registrations sr
      ON sr.user_id = mps.user_id AND sr.season_id = m.season_id
    LEFT JOIN team_members tm ON tm.registration_id = sr.id
    LEFT JOIN teams t ON t.id = tm.team_id
    WHERE m.season_id = ${season.id}
      AND mps.verified_by_admin IS NOT NULL
      ${positionFilter}
    GROUP BY mps.user_id, mps.perfect_name, sr.primary_position, t.name, t.id
    HAVING count(*) >= 3
    ORDER BY ${sortColumn} DESC
    LIMIT 100
  `);

  const leaderboardRows = (rows as unknown as Record<string, unknown>[]).map((r) => ({
    userId: r.user_id as string | null,
    perfectName: r.perfect_name as string,
    position: r.primary_position as string | null,
    teamName: r.team_name as string | null,
    teamId: r.team_id as string | null,
    maps: r.maps as number,
    avgRating: r.avg_rating as number,
    avgAdr: r.avg_adr as number,
    avgKills: r.avg_kills as number,
    avgDeaths: r.avg_deaths as number,
    avgWe: r.avg_we as number,
  }));

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">
          赛季排行榜
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          {season.name} · 最少 3 图
        </p>
      </div>
      <StatsLeaderboard
        rows={leaderboardRows}
        sort={sort}
        position={position}
        seasonSlug={seasonSlug}
      />
    </div>
  );
}
```

- [ ] **Step 3: 验证编译 + 运行测试**

```bash
pnpm tsc --noEmit
pnpm vitest run
```
Expected: No errors, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/\[seasonSlug\]/stats/page.tsx src/components/matches/StatsLeaderboard.tsx
git commit -m "feat: add season stats leaderboard with multi-sort and position filter"
```

---

### Task 10: 队伍统计卡片

**Files:**
- Modify: `src/app/[seasonSlug]/teams/[teamId]/page.tsx`

- [ ] **Step 1: 添加 import**

```typescript
import { matchPlayerStats } from "@/db/schema/player-stats";
import { sql } from "drizzle-orm";
```

- [ ] **Step 2: 在数据查询区添加队伍 stats 查询**

在 `const played = totalWins + totalLosses;` 之后，`return (...)` 之前:

```typescript
// ── 队伍聚合统计 ──────────────────────────────────────────────────
const teamStatRows = roster.length
  ? await db.execute(sql`
      SELECT
        round(avg(mps.rating_pro)::numeric, 2) as avg_rating,
        round(avg(mps.adr)::numeric, 1) as avg_adr,
        round(avg(mps.kills)::numeric, 1) as avg_kills,
        round(avg(mps.deaths)::numeric, 1) as avg_deaths,
        round(avg(mps.we)::numeric, 1) as avg_we,
        sr.primary_position,
        mps.perfect_name,
        mps.rating_pro
      FROM match_player_stats mps
      JOIN season_registrations sr ON sr.user_id = mps.user_id AND sr.season_id = ${season.id}
      JOIN team_members tm ON tm.registration_id = sr.id
      WHERE tm.team_id = ${teamId}
        AND mps.verified_by_admin IS NOT NULL
      GROUP BY sr.primary_position, mps.perfect_name, mps.rating_pro
    `)
  : [];

interface TeamStatRow {
  avg_rating: number;
  avg_adr: number;
  avg_kills: number;
  avg_deaths: number;
  avg_we: number;
  primary_position: string;
  perfect_name: string;
  rating_pro: number;
}

const typedStats = teamStatRows as unknown as TeamStatRow[];

// 全局聚合
const teamAvgRating =
  typedStats.length > 0
    ? (typedStats.reduce((s, r) => s + Number(r.avg_rating), 0) / typedStats.length).toFixed(2)
    : null;
const teamAvgAdr =
  typedStats.length > 0
    ? (typedStats.reduce((s, r) => s + Number(r.avg_adr), 0) / typedStats.length).toFixed(1)
    : null;
const teamAvgKd =
  typedStats.length > 0
    ? (() => {
        const k = typedStats.reduce((s, r) => s + Number(r.avg_kills), 0);
        const d = typedStats.reduce((s, r) => s + Number(r.avg_deaths), 0);
        return d > 0 ? (k / d).toFixed(2) : null;
      })()
    : null;
const teamAvgWe =
  typedStats.length > 0
    ? (typedStats.reduce((s, r) => s + Number(r.avg_we), 0) / typedStats.length).toFixed(1)
    : null;

// 每位置最高 Rating 选手
const positionBest = new Map<string, { name: string; rating: number }>();
for (const r of typedStats) {
  const pos = r.primary_position;
  const existing = positionBest.get(pos);
  if (!existing || Number(r.rating_pro) > existing.rating) {
    positionBest.set(pos, { name: r.perfect_name, rating: Number(r.rating_pro) });
  }
}
```

- [ ] **Step 3: 在阵容 section 之后加 UI**

在阵容 `</section>` 之后，地图胜率 section 之前，插入:

```tsx
{/* 队伍数据 */}
{teamAvgRating && (
  <section className="space-y-4">
    <h2 className="text-lg font-semibold text-[var(--text-primary)]">队伍数据</h2>
    <Card className="p-5 space-y-4">
      <div className="grid grid-cols-4 gap-4 text-center">
        {[
          { label: "场均 Rating", value: teamAvgRating },
          { label: "场均 ADR", value: teamAvgAdr },
          { label: "场均 K/D", value: teamAvgKd },
          { label: "场均 WE", value: teamAvgWe },
        ].map(({ label, value }) => (
          <div key={label}>
            <p className="text-xl font-bold text-[var(--season-primary)]">
              {value ?? "—"}
            </p>
            <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
              {label}
            </p>
          </div>
        ))}
      </div>
      {positionBest.size > 0 && (
        <div className="text-[11px] text-[var(--text-muted)] border-t border-[var(--border)] pt-3">
          {[...positionBest.entries()]
            .map(([pos, info]) => {
              const label =
                POSITION_LABELS[pos as keyof typeof POSITION_LABELS]?.cn ?? pos;
              return `${label} ${info.name} (${info.rating.toFixed(2)})`;
            })
            .join(" · ")}
        </div>
      )}
    </Card>
  </section>
)}
```

- [ ] **Step 4: 验证编译**

```bash
pnpm tsc --noEmit
pnpm vitest run
```

- [ ] **Step 5: Commit**

```bash
git add src/app/\[seasonSlug\]/teams/\[teamId\]/page.tsx
git commit -m "feat: add team stats aggregation card to team detail page"
```

---

### Task 11: 组件单元测试

**Files:**
- Create: `tests/unit/components/matches/PlayerStatsTable.test.tsx`
- Create: `tests/unit/components/matches/StatsLeaderboard.test.tsx`

- [ ] **Step 1: PlayerStatsTable 测试**

```typescript
// tests/unit/components/matches/PlayerStatsTable.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const mockFindMany = vi.fn();

vi.mock("@/db/client", () => ({
  db: {
    query: {
      matchPlayerStats: { findMany: mockFindMany },
      matches: {
        findFirst: vi.fn().mockResolvedValue({ teamAId: "ta", teamBId: "tb" }),
      },
      seasonRegistrations: { findMany: vi.fn().mockResolvedValue([]) },
      teamMembers: { findMany: vi.fn().mockResolvedValue([]) },
    },
  },
}));

vi.mock("@/db/schema/player-stats", () => ({
  matchPlayerStats: {
    id: {}, mapId: {}, userId: {}, perfectName: {},
    kills: {}, deaths: {}, assists: {}, adr: {}, ratingPro: {},
  },
}));

import { PlayerStatsTable } from "@/components/matches/PlayerStatsTable";

describe("PlayerStatsTable", () => {
  it("renders empty state when no stats", async () => {
    mockFindMany.mockResolvedValue([]);
    const jsx = await PlayerStatsTable({ matchId: "m1", mapId: "mp1" });
    render(jsx);
    expect(screen.getByText("暂无玩家数据")).toBeDefined();
  });

  it("renders two columns for team A and team B", async () => {
    mockFindMany.mockResolvedValue([
      { id: "p1", userId: null, perfectName: "选手1", kills: 10, deaths: 5, assists: 3, adr: 80, ratingPro: 1.1 },
      { id: "p2", userId: null, perfectName: "选手2", kills: 5, deaths: 10, assists: 1, adr: 50, ratingPro: 0.8 },
    ]);
    const jsx = await PlayerStatsTable({ matchId: "m1", mapId: "mp1" });
    render(jsx);
    expect(screen.getByText("选手1")).toBeDefined();
    expect(screen.getByText("选手2")).toBeDefined();
  });
});
```

- [ ] **Step 2: StatsLeaderboard 测试**

```typescript
// tests/unit/components/matches/StatsLeaderboard.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatsLeaderboard } from "@/components/matches/StatsLeaderboard";

describe("StatsLeaderboard", () => {
  it("renders empty state when no rows", () => {
    render(
      <StatsLeaderboard rows={[]} sort="rating" position="" seasonSlug="test" />
    );
    expect(screen.getByText("该赛季暂无已确认的玩家数据")).toBeDefined();
  });

  it("renders player rows with links", () => {
    render(
      <StatsLeaderboard
        seasonSlug="test"
        sort="rating"
        position=""
        rows={[
          {
            userId: "u1", perfectName: "张三", position: "awper",
            teamName: "Alpha", teamId: "t1",
            maps: 10, avgRating: 1.25, avgAdr: 92.3,
            avgKills: 20.5, avgDeaths: 10.1, avgWe: 10.5,
          },
        ]}
      />
    );
    expect(screen.getByText("张三")).toBeDefined();
    expect(screen.getByText("1.25")).toBeDefined();
    expect(screen.getByText("92.3")).toBeDefined();
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
pnpm vitest run tests/unit/components/matches/
```
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/components/matches/
git commit -m "test: add PlayerStatsTable and StatsLeaderboard component tests"
```

---

### Task 12: 最终验证

- [ ] **Step 1: 全量测试**

```bash
pnpm vitest run
pnpm tsc --noEmit
```
Expected: All tests pass, zero type errors.

- [ ] **Step 2: 启动 dev server 手动验证**

```bash
pnpm dev
```

访问:
- `/[seasonSlug]/matches/[matchId]` — 验证数据表 + MVP 投票区域存在
- `/players/[userId]` — 验证个人数据 section
- `/[seasonSlug]/stats` — 验证排行榜 + 排序/筛选切换
- `/[seasonSlug]/teams/[teamId]` — 验证队伍数据卡片

- [ ] **Step 3: 最终 commit（如有 UI 微调）**
