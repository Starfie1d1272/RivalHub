# Season Directory UI Optimization Design

## Summary

Optimize three season-level directory pages so they feel closer in visual quality and information value to the existing match and stats experiences:

- Team list page: `/[seasonSlug]/teams`
- Player list page: `/[seasonSlug]/players`
- Season leaderboard page: `/[seasonSlug]/stats`

The design direction is **overview + directory**. Team and player pages gain lightweight season context and competition summaries at the directory layer. The stats page becomes a focused leaderboard with a desktop-friendly core view and separate advanced metric views.

This work does not redesign the team detail page or global player detail page. Detail pages may receive only small supporting adjustments if list links or shared labels require them.

## Goals

1. Raise the perceived quality and information density of the team and player directory pages.
2. Shift directory cards away from registration-only summaries toward season competition context.
3. Make the default stats leaderboard fit common desktop viewports without horizontal scrolling.
4. Replace Chinese position labels in the stats leaderboard with horizontal English position labels.
5. Preserve the current RivalHub tactical-grid visual language and responsive behavior.

## Non-Goals

- Rebuild team detail or player detail pages.
- Add a broad cross-page recommendation hub for "hot teams" or "featured players".
- Turn player directory into an admin search interface with many filters.
- Force the full leaderboard table to fit on small mobile viewports.
- Change stats aggregation semantics beyond view grouping and presentation needs.

## Current State

### Team List

The current team list renders team cards in a narrow three-column desktop grid inside an outer panel. Each card emphasizes team name and roster preview. This is useful after draft creation, but it does not expose enough competition context once matches and verified stats exist.

### Player List

The current player list uses three-column player cards. Card content is centered on registration information: primary position, secondary position, peak rank, current rating, and team name when available. It reads like an approved-registration directory more than a playing-season player directory.

### Stats Leaderboard

The current leaderboard displays all visible metrics at once in a table with `min-w-[900px]`. Its metric list includes core and advanced metrics together. The position table header and position values use Chinese labels, which worsens width pressure and causes awkward vertical wrapping in narrow desktop layouts.

## Design Direction

The three pages should share a season-directory rhythm:

1. Page title and season context.
2. A small overview band that helps interpret the directory below.
3. Focused filters or metric view controls.
4. A directory surface optimized for scanning.

The overview band must stay restrained. It exists to explain the page below, not to duplicate the season homepage.

## Team Directory

### Layout

Use a two-part layout:

1. **Overview band**
   - Keep the team page marker/title and admin shortcut.
   - Add compact season-level summary stats such as team count, player count, matches, and data readiness or average maps.
   - If results exist, a compact lead signal may identify the strongest visible record, but it must not become a standings panel.

2. **Team directory**
   - Move desktop presentation from narrow three-column cards toward wider two-column summary cards.
   - Keep mobile rendering as stacked cards.

### Team Summary Card

Each team card should prioritize:

1. Team identity
   - Team logo or fallback initial.
   - Team name.
   - Draft order.
   - Captain signal.

2. Competition summary
   - Record and win rate when matches exist.
   - A small verified-stats summary when available, such as maps, average rating, and average ADR.
   - Empty-data fallback that keeps the card useful from roster information alone.

3. Roster shape
   - Starters remain visible at directory level.
   - Position labels use compact English role labels where width matters.
   - Substitutes remain present but lower-priority than starters, record, and team identity.

### Rationale

Team cards should answer both "who is on this team" and "what has this team done so far". Wider summary cards make those layers readable without turning the page into a full standings table.

## Player Directory

### Layout

Use a denser directory layout than the team page:

1. **Overview band**
   - Keep the player page marker/title.
   - Add compact stats such as approved players, players with teams, players with verified data, and the current filtered position count.

2. **Position filter**
   - Keep position filtering.
   - Use English labels in the filter: `All`, `IGL`, `AWPer`, `Opener`, `Closer`, `Anchor`.

3. **Player directory rows**
   - Prefer compact desktop directory rows or row-like cards over the current three-column registration cards.
   - On mobile, let rows fold into stacked cards.

### Player Directory Row

Each player entry should prioritize:

1. Player identity
   - Display name.
   - Primary position badge.
   - Team name when available.

2. Competition summary
   - Maps, rating, and ADR when verified season stats exist.
   - A clear no-stats fallback when the player has not yet produced verified stats.

3. Registration context
   - Keep a small amount of registration identity such as peak rank or current rating.
   - Secondary position becomes supporting information rather than a peer of primary position.

### Rationale

The player directory should read as a playing-season roster index, not just an approval result list. The competitive summary should rise in priority once data exists, while registration context remains useful for players without official match stats.

## Stats Leaderboard

### Default Core View

The default desktop leaderboard should be a compact **Core** view intended to fit common desktop widths without horizontal scrolling.

Recommended visible columns:

- Rank
- Player
- Position
- Team
- Maps
- Rating
- ADR
- K/D
- KPR
- HS%

Position presentation changes:

- Table header becomes `Pos`.
- Table values are horizontal English labels such as `IGL`, `AWPer`, `Opener`, `Closer`, and `Anchor`.
- Chinese position labels are not used in the stats leaderboard.

### Metric Views

Advanced metrics should move out of the default full-width table.

Recommended control model:

- `Core`: core player comparison metrics.
- `Impact`: entry and high-impact rate metrics such as FKPR, MKPR, and CPR.
- `Advanced`: secondary rating-style metrics such as WE and RWS.

Names may be adjusted during implementation if a metric grouping becomes clearer, but the design requirement is stable: the default core table does not display every leaderboard metric at once.

Sort controls must follow the active metric view so the toolbar does not become a long wrapped list of metrics that are not visible in the current table.

### Width Strategy

- Remove the assumption that the default desktop table must preserve a wide all-metric minimum width.
- Give player and team columns flexible readable space.
- Use compact numeric columns and tabular numerals for metrics.
- Shorten headers and keep visible labels consistent in English where width matters.
- Keep mobile horizontal scrolling acceptable for data tables.

### Rationale

The leaderboard should be a readable comparison surface. Splitting core and advanced metrics solves the desktop width problem structurally instead of compressing every column until labels and values degrade.

## Data and Reuse

Reuse current season-scoped data semantics wherever possible:

- Team detail already exposes record and team-level stat aggregation patterns that can inform team directory summaries.
- Player detail and stats pages already expose verified player stat aggregation patterns.
- New directory summaries should remain season-scoped and must not hardcode season IDs or slugs.

Any write behavior remains outside scope. These pages stay read-oriented Server Components and shared display components.

## Responsive Behavior

### Desktop

- Team page uses wider summary cards.
- Player page uses compact row-like directory entries.
- Stats Core view fits common desktop widths without page-level left-right movement.

### Mobile

- Overview bands wrap into small responsive stat grids.
- Team summary cards stack.
- Player rows collapse into stacked cards.
- Stats tables may scroll horizontally when needed.

## Visual Rules

- Preserve existing dark tactical-grid styling and existing RivalHub component vocabulary.
- Favor restrained density and clear hierarchy over new decorative flourishes.
- Avoid nested-card-heavy page sections.
- Use compact English role labels where role text participates in width-sensitive directories or tables.
- Keep competition summary values visually subordinate to the primary identity unless a metric is the current leaderboard sort target.

## Empty and Partial Data States

- Team summary cards without official stats still show identity and roster shape.
- Player rows without verified stats fall back to registration context without looking broken.
- Stats leaderboard empty state remains explicit.
- Overview-band stats must avoid implying competition results when no matches or verified stats exist.

## Verification Criteria

1. Team page exposes team identity, roster shape, and competition summary in the list view when data exists.
2. Player page exposes player identity, team context, and season competition summary in the list view when data exists.
3. Player list entries degrade cleanly when a player has no verified stats.
4. Stats default Core view uses English horizontal position labels.
5. Stats default Core view does not require horizontal scrolling on common desktop widths during browser verification.
6. Mobile layouts remain readable and do not rely on desktop row layouts being squeezed below their usable width.

