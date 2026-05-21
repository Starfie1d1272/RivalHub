# Season Directory UI Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the team directory, player directory, and season stats leaderboard into a denser season competition experience with a desktop-friendly core leaderboard.

**Architecture:** Keep pages as Server Components and move reusable directory presentation into focused display components. Reuse season-scoped SQL and page queries for overview and competition summaries, while the stats leaderboard owns its metric view grouping and responsive table columns.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Drizzle SQL, Tailwind CSS v4, Vitest, React Testing Library.

---

## File Structure

- `src/components/matches/StatsLeaderboard.tsx`: metric views, English position presentation, compact desktop table.
- `src/components/matches/StatsLeaderboard.test.tsx`: leaderboard view and label tests.
- `src/app/[seasonSlug]/stats/page.tsx`: pass metric-view search state to leaderboard.
- `src/components/teams/TeamCard.tsx`: wider team summary card presentation.
- `src/components/teams/TeamCard.test.tsx`: team record and summary stat tests.
- `src/app/[seasonSlug]/teams/page.tsx`: season overview and team summary data aggregation.
- `src/components/players/PlayerDirectoryRow.tsx`: player directory row/card presentation.
- `src/components/players/PlayerDirectoryRow.test.tsx`: competition-summary and fallback tests.
- `src/app/[seasonSlug]/players/page.tsx`: season overview and verified-stat player directory data.

### Task 1: Focus Stats Leaderboard

**Files:**
- Modify: `src/components/matches/StatsLeaderboard.tsx`
- Create: `src/components/matches/StatsLeaderboard.test.tsx`
- Modify: `src/app/[seasonSlug]/stats/page.tsx`

- [ ] **Step 1: Write failing leaderboard tests**

```tsx
it("shows the compact core metrics and English position label by default", () => {
  render(<StatsLeaderboard rows={[row]} sort="rating" position="" seasonSlug="spring" view="core" />);
  expect(screen.getByRole("columnheader", { name: "Pos" })).toBeInTheDocument();
  expect(screen.getByText("AWPer")).toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "FKPR /100r" })).not.toBeInTheDocument();
});

it("shows impact metrics after switching to the impact view prop", () => {
  render(<StatsLeaderboard rows={[row]} sort="fk" position="" seasonSlug="spring" view="impact" />);
  expect(screen.getByRole("columnheader", { name: "FKPR /100r" })).toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "HS%" })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the leaderboard test and confirm it fails**

Run: `pnpm vitest run src/components/matches/StatsLeaderboard.test.tsx`

Expected: FAIL because `StatsLeaderboard` does not accept `view` and still renders all metric columns.

- [ ] **Step 3: Implement metric view grouping**

Add view-aware sort controls, split metric columns into core/impact/advanced groups, render English position labels, and pass `view` from the stats page search params.

- [ ] **Step 4: Re-run leaderboard tests**

Run: `pnpm vitest run src/components/matches/StatsLeaderboard.test.tsx`

Expected: PASS.

### Task 2: Add Team Directory Summaries

**Files:**
- Modify: `src/components/teams/TeamCard.tsx`
- Create: `src/components/teams/TeamCard.test.tsx`
- Modify: `src/app/[seasonSlug]/teams/page.tsx`

- [ ] **Step 1: Write failing team card tests**

```tsx
it("renders a team record and verified stat summary", () => {
  render(<TeamCard {...props} record={{ played: 4, wins: 3, losses: 1, winRate: "75%" }} summary={{ maps: 12, avgRating: 1.14, avgAdr: 78.2 }} />);
  expect(screen.getByText("3-1")).toBeInTheDocument();
  expect(screen.getByText("75% WR")).toBeInTheDocument();
  expect(screen.getByText("1.14")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the team card test and confirm it fails**

Run: `pnpm vitest run src/components/teams/TeamCard.test.tsx`

Expected: FAIL because `TeamCard` has no record or summary presentation.

- [ ] **Step 3: Implement team overview and card summary data**

Aggregate season matches and verified team stats on the team list page, add compact page overview stats, move the list to wider desktop cards, and add identity/record/stat summary layers to each team card.

- [ ] **Step 4: Re-run team card tests**

Run: `pnpm vitest run src/components/teams/TeamCard.test.tsx`

Expected: PASS.

### Task 3: Build Player Directory Rows

**Files:**
- Create: `src/components/players/PlayerDirectoryRow.tsx`
- Create: `src/components/players/PlayerDirectoryRow.test.tsx`
- Modify: `src/app/[seasonSlug]/players/page.tsx`

- [ ] **Step 1: Write failing player directory row tests**

```tsx
it("prioritizes season competition stats when they exist", () => {
  render(<PlayerDirectoryRow player={{ ...player, stats: { maps: 8, avgRating: 1.21, avgAdr: 82.4 } }} />);
  expect(screen.getByText("8 Maps")).toBeInTheDocument();
  expect(screen.getByText("1.21")).toBeInTheDocument();
  expect(screen.getByText("82.4")).toBeInTheDocument();
});

it("falls back to a no-stats state without losing registration context", () => {
  render(<PlayerDirectoryRow player={{ ...player, stats: null }} />);
  expect(screen.getByText("No verified stats")).toBeInTheDocument();
  expect(screen.getByText("Peak")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the player directory row tests and confirm they fail**

Run: `pnpm vitest run src/components/players/PlayerDirectoryRow.test.tsx`

Expected: FAIL because `PlayerDirectoryRow` does not exist yet.

- [ ] **Step 3: Implement player overview and row directory**

Add a season stats query keyed by player registration/user, add overview counts, keep English role filters, and render desktop row-like player entries with mobile-friendly wrapping.

- [ ] **Step 4: Re-run player row tests**

Run: `pnpm vitest run src/components/players/PlayerDirectoryRow.test.tsx`

Expected: PASS.

### Task 4: Verify Full UI Change

**Files:**
- Verify changed files above.

- [ ] **Step 1: Run focused tests**

Run: `pnpm vitest run src/components/matches/StatsLeaderboard.test.tsx src/components/teams/TeamCard.test.tsx src/components/players/PlayerDirectoryRow.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run type check**

Run: `pnpm type-check`

Expected: PASS.

- [ ] **Step 3: Run browser verification**

Start the local dev server and inspect the three target routes on desktop and mobile widths. Confirm the stats Core view has no desktop horizontal scrolling, position labels are English and horizontal, and directory surfaces wrap cleanly.

