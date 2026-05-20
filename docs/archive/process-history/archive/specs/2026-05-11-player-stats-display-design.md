# Phase 11.5: 玩家数据展示 · 设计 Spec

## 概述

OCR 录入流程已完成（PR #28），`match_player_stats` 表已有数据。
本次设计覆盖展示侧 4 个功能 + 1 个 TODO。

## 数据前提

- 数据来源: `match_player_stats` 表（OCR 识别 + 管理员确认后入库）
- 展示条件: `verifiedByAdmin IS NOT NULL`（仅展示已确认数据）
- 渲染方式: 纯 Server Component，`await db.query(...)` 直接读 DB
- 不引入 Realtime、不引入 `"use client"`（MVP 投票按钮除外）

---

## 功能 1: 比赛详情页数据表 + 单场 MVP 投票

### 路由

`/[seasonSlug]/matches/[matchId]`（修改现有页面）

### 布局（方案 A — 内联展开）

每张地图卡片下方展开双方 10 人数据表，页面底部固定「本场 MVP 投票」区域。

### 数据表组件

`src/components/matches/PlayerStatsTable.tsx`（新）

```typescript
interface PlayerStatsTableProps {
  matchId: string;
  mapId: string;
  teamAName: string;
  teamBName: string;
}
```

- Server Component，`await getPlayerStatsByMap(mapId)` 读取数据
- 按 `userId → teamMember → teamId` 将选手归类到 Team A / Team B
- 两栏布局（左 Team A / 右 Team B），每栏 5 行
- 列: `选手 / K / D / A / ADR / Rating`

### MVP 投票组件

`src/components/matches/MatchMvpVote.tsx`（新 · Client Component）

- 仅在 `match.status === "finished"` 且存在 stats 数据时渲染
- 候选人列表: 本场所有有 stats 的选手，按 Rating 降序
- 投票按钮: 每场每人 1 票（click → `castMatchMvpVote` action）
- 实时显示当前票数（投票后乐观更新 + 页面刷新）

### 新增 DB 表

```sql
match_mvp_votes (
  id uuid PK DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES matches(id),
  player_user_id uuid REFERENCES users(id),  -- NULL = 未注册选手
  player_name text NOT NULL,                  -- 兜底显示名
  voter_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
)
UNIQUE (match_id, voter_user_id)
```

### 新增 Server Action

`src/actions/player-stats.ts` 新增:

- `castMatchMvpVote(matchId, playerUserId, playerName)` — 写票，UNIQUE 约束防重
- `getMatchMvpResults(matchId)` — 返回每个选手的票数

### 页面修改

`src/app/[seasonSlug]/matches/[matchId]/page.tsx`:
- 每张地图卡片下方插入 `<PlayerStatsTable>`
- 所有地图之后插入 `<MatchMvpVote>`

---

## 功能 2: 选手个人统计聚合（跨赛季）

### 路由

`/players/[userId]`（修改现有页面）

### 布局

在现有"职业生涯战绩"section 下方新增"个人数据"section:

```
个人数据
├── 生涯总计（42 图 · 场均 21.3-11.8-5.2 · Rating 1.19 · ADR 87.5）
├── 2026 NJU Rivals（12 图 · 场均 22.5-10.3-5.8 · Rating 1.25）
├── 2025 NJU Rivals S1（10 图 · ...）
└── ...
```

### 查询逻辑

一次查询该选手所有赛季的 stats:

```sql
SELECT s.name as season_name, s.slug, COUNT(*) as maps,
       ROUND(AVG(kills)::numeric,1), ROUND(AVG(deaths)::numeric,1),
       ROUND(AVG(assists)::numeric,1), ROUND(AVG(rating_pro)::numeric,2),
       ROUND(AVG(adr)::numeric,1), ROUND(AVG(we)::numeric,1)
FROM match_player_stats mps
JOIN matches m ON m.id = mps.match_id
JOIN seasons s ON s.id = m.season_id
WHERE mps.user_id = ? AND mps.verified_by_admin IS NOT NULL
GROUP BY s.id, s.name, s.slug
ORDER BY s.created_at DESC
```

JS 层算生涯总计（加权平均 Rating、总图数、平均 K/D）。

### 页面修改

`src/app/players/[userId]/page.tsx`:
- 新增 stats 查询
- 在"职业生涯战绩"和"参赛记录"之间插入"个人数据"section

---

## 功能 3: 赛季排行榜

### 路由

`/[seasonSlug]/stats`（新页面）

### 布局（方案 A — 顶栏横排）

```
赛季排行榜 · 2026 NJU Rivals · 最少 3 图

[Rating] [ADR] [K/D] [WE] [KPR] [场次]    ← 排序 Tab
[全部] [IGL] [AWPer] [Opener] [Closer] [Anchor] ← 位置筛选

#  选手    位置    队伍    图数  Rating  ADR   K/D
1  张三   AWPer   Alpha   12   1.25   92.3  1.82
2  李四   Opener  Alpha   12   1.20   85.0  1.67
...
```

### 查询逻辑

```sql
SELECT mps.user_id, mps.perfect_name,
       sr.primary_position, t.name as team_name,
       COUNT(*) as maps,
       ROUND(AVG(mps.rating_pro)::numeric,2) as avg_rating,
       ROUND(AVG(mps.adr)::numeric,1) as avg_adr,
       ROUND(AVG(mps.kills)::numeric,1) as avg_kills,
       ROUND(AVG(mps.deaths)::numeric,1) as avg_deaths,
       ROUND(AVG(mps.we)::numeric,1) as avg_we
FROM match_player_stats mps
JOIN matches m ON m.id = mps.match_id
LEFT JOIN season_registrations sr ON sr.user_id = mps.user_id AND sr.season_id = m.season_id
LEFT JOIN team_members tm ON tm.registration_id = sr.id
LEFT JOIN teams t ON t.id = tm.team_id
WHERE m.season_id = ? AND mps.verified_by_admin IS NOT NULL
  [AND sr.primary_position = ?]  -- 位置筛选
GROUP BY mps.user_id, mps.perfect_name, sr.primary_position, t.name
HAVING COUNT(*) >= 3
ORDER BY [sort_column] DESC
```

### URL 驱动

- `/[seasonSlug]/stats` — 默认 Rating 降序、全部位置
- `/[seasonSlug]/stats?sort=adr&position=awper` — 按 ADR 排、只看 AWPer
- 所有排序/筛选通过 `<a href>` 切换，不引入客户端 state

### 文件

- `src/app/[seasonSlug]/stats/page.tsx`（新）
- `src/components/matches/StatsLeaderboard.tsx`（新）

### 入口

- `SeasonNav` 或赛季首页 QuickLinks 加「数据统计」链接
- `src/lib/utils/season.ts` 加 `showStats` capability

---

## 功能 4: 队伍聚合统计

### 路由

`/[seasonSlug]/teams/[teamId]`（修改现有页面）

### 布局（方案 B — 底部独立 section）

首发/替补阵容下方新增「队伍数据」卡片:

```
队伍数据
┌──────────┬──────────┬──────────┬──────────┐
│ 场均 Rating │ 场均 ADR  │ 场均 K/D  │ 场均 WE   │
│   1.12     │   82.4    │   1.38    │   9.8     │
└──────────┴──────────┴──────────┴──────────┘
AWPer 张三 (1.25) · Opener 李四 (1.20) · IGL 甲 (1.18) · ...
```

### 查询逻辑

该队所有队员的 stats 聚合:

```sql
SELECT ROUND(AVG(mps.rating_pro)::numeric,2), ROUND(AVG(mps.adr)::numeric,1),
       ROUND(AVG(mps.kills)::numeric,1), ROUND(AVG(mps.deaths)::numeric,1),
       ROUND(AVG(mps.we)::numeric,1)
FROM match_player_stats mps
JOIN team_members tm ON tm.registration_id = (
  SELECT id FROM season_registrations WHERE user_id = mps.user_id AND season_id = ?
)
WHERE tm.team_id = ? AND mps.verified_by_admin IS NOT NULL
```

同时按位置分组展示各代表选手的最高 Rating。

### 页面修改

`src/app/[seasonSlug]/teams/[teamId]/page.tsx`:
- 阵容 section 下方新增「队伍数据」卡片

---

## TODO: 赛季 MVP 评选

赛季结束后自动生成候选人、开启投票期、展示赛季 MVP。
等 v1 有真实 finished 赛季后再设计具体方案。

---

## 实现顺序

| # | 功能 | 新增文件 | 修改文件 |
|---|---|---|---|
| 1 | 比赛数据表 + MVP 投票 | `PlayerStatsTable.tsx`, `MatchMvpVote.tsx` | `matchId/page.tsx`, `player-stats.ts` (action), schema 新表 |
| 2 | 选手统计聚合 | — | `players/[userId]/page.tsx` |
| 3 | 赛季排行榜 | `stats/page.tsx`, `StatsLeaderboard.tsx` | `season.ts` (capability), `SeasonNav` |
| 4 | 队伍统计 | — | `teams/[teamId]/page.tsx` |

---

## 架构约束

- 所有数据读取走 Server Component，禁止 `useEffect` + fetch
- MVP 投票按钮是唯一的 Client Component（`"use client"`）
- 不新增 API Route，投票走 Server Action
- 不引入 Realtime（投票低频）
- `match_player_stats` 只读，写入仍由管理员 OCR 确认流程完成
- 所有 DB 查询使用 Drizzle relational query（`db.query.*`）
