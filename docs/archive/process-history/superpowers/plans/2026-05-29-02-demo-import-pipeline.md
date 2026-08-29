# Plan 2 · Demo 导出包导入管线与明细表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development 或 superpowers:executing-plans。
> **依赖 Plan 1**(`statSourceEnum`、契约 A)。共享约定见 `2026-05-29-demo-analytics-index.md` 契约 A/D。

**Goal:** 管理后台上传 CS2 Insight Agent 的导出 zip,校验 manifest/schema/demo hash/重复,落入 13 张 `demo_*` 明细表,并回填 `match_player_stats` 公共列(source=demo_import)以复用现有展示。

**Architecture:** 纯函数层(zip 解包→Zod 校验→SteamID 映射)可单测;Server Action 负责事务写库 + 审计。明细表统一 `mapId` + `importBatchId` + `roundNumber/tick`。

**Tech Stack:** Drizzle、Zod、`jszip`(解包)、Vitest、Server Action(`ActionResult<T>`)。

---

### Task 1: 明细表 schema(13 张表 + 导入批次表)

**Files:**
- Create: `src/db/schema/demo.ts`
- Modify: `src/db/schema/index.ts`(re-export)
- 迁移: `drizzle/`

字段严格对应 example 包各 JSON 的 key(契约 D:加 `mapId`/`importBatchId`,坐标用 json,SteamID 用 text)。

- [ ] **Step 1: 创建 `src/db/schema/demo.ts`**

```typescript
import { pgTable, uuid, integer, real, text, boolean, timestamp, json, pgEnum } from "drizzle-orm/pg-core";
import { matchMaps } from "./match-maps";
import { users } from "./users";

type Vec3 = { x: number; y: number; z: number };
export const demoSideEnum = pgEnum("demo_side", ["t", "ct", "unknown"]);

// 一次导入批次（对应一张 demo 地图包）
export const demoImports = pgTable("demo_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  mapId: uuid("map_id").notNull().references(() => matchMaps.id),
  demoHash: text("demo_hash").notNull(),
  schemaVersion: text("schema_version").notNull(),
  exporterName: text("exporter_name"),
  exporterVersion: text("exporter_version"),
  parserName: text("parser_name"),
  mapName: text("map_name").notNull(),
  tickrate: integer("tickrate").notNull(),
  exportedAt: timestamp("exported_at", { withTimezone: true }),
  importedBy: uuid("imported_by").references(() => users.id),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
});

// players.json
export const demoPlayers = pgTable("demo_players", {
  id: uuid("id").primaryKey().defaultRandom(),
  importBatchId: uuid("import_batch_id").notNull().references(() => demoImports.id),
  mapId: uuid("map_id").notNull().references(() => matchMaps.id),
  steamId64: text("steam_id64").notNull(),
  name: text("name").notNull(),
  teamKey: text("team_key").notNull(),
  userId: uuid("user_id").references(() => users.id), // 映射结果,可 null
});

// rounds.json
export const demoRounds = pgTable("demo_rounds", {
  id: uuid("id").primaryKey().defaultRandom(),
  importBatchId: uuid("import_batch_id").notNull().references(() => demoImports.id),
  mapId: uuid("map_id").notNull().references(() => matchMaps.id),
  roundNumber: integer("round_number").notNull(),
  startTick: integer("start_tick"),
  freezeEndTick: integer("freeze_end_tick"),
  endTick: integer("end_tick"),
  teamASide: demoSideEnum("team_a_side"),
  teamBSide: demoSideEnum("team_b_side"),
  teamAScoreBefore: integer("team_a_score_before"),
  teamBScoreBefore: integer("team_b_score_before"),
  teamAEconomy: text("team_a_economy"),
  teamBEconomy: text("team_b_economy"),
  winnerTeamKey: text("winner_team_key"),
  winnerSide: demoSideEnum("winner_side"),
  endReason: text("end_reason"),
});

// player-stats.json(40 字段汇总)
export const demoPlayerStats = pgTable("demo_player_stats", {
  id: uuid("id").primaryKey().defaultRandom(),
  importBatchId: uuid("import_batch_id").notNull().references(() => demoImports.id),
  mapId: uuid("map_id").notNull().references(() => matchMaps.id),
  steamId64: text("steam_id64").notNull(),
  userId: uuid("user_id").references(() => users.id),
  teamKey: text("team_key").notNull(),
  kills: integer("kills"), deaths: integer("deaths"), assists: integer("assists"),
  damageHealth: integer("damage_health"), damageArmor: integer("damage_armor"),
  adr: real("adr"), utilityDamage: integer("utility_damage"),
  averageUtilityDamagePerRound: real("avg_utility_damage_per_round"),
  headshotCount: integer("headshot_count"),
  firstKillCount: integer("first_kill_count"), firstDeathCount: integer("first_death_count"),
  tradeKillCount: integer("trade_kill_count"), tradeDeathCount: integer("trade_death_count"),
  kast: real("kast"),
  oneKillCount: integer("one_kill_count"), twoKillCount: integer("two_kill_count"),
  threeKillCount: integer("three_kill_count"), fourKillCount: integer("four_kill_count"),
  fiveKillCount: integer("five_kill_count"),
  vsOneCount: integer("vs_one_count"), vsOneWonCount: integer("vs_one_won_count"), vsOneLostCount: integer("vs_one_lost_count"),
  vsTwoCount: integer("vs_two_count"), vsTwoWonCount: integer("vs_two_won_count"), vsTwoLostCount: integer("vs_two_lost_count"),
  vsThreeCount: integer("vs_three_count"), vsThreeWonCount: integer("vs_three_won_count"), vsThreeLostCount: integer("vs_three_lost_count"),
  vsFourCount: integer("vs_four_count"), vsFourWonCount: integer("vs_four_won_count"), vsFourLostCount: integer("vs_four_lost_count"),
  vsFiveCount: integer("vs_five_count"), vsFiveWonCount: integer("vs_five_won_count"), vsFiveLostCount: integer("vs_five_lost_count"),
  bombPlantedCount: integer("bomb_planted_count"), bombDefusedCount: integer("bomb_defused_count"),
  wallbangKillCount: integer("wallbang_kill_count"), noScopeKillCount: integer("no_scope_kill_count"),
  collateralKillCount: integer("collateral_kill_count"),
});

// player-economies.json
export const demoPlayerEconomies = pgTable("demo_player_economies", {
  id: uuid("id").primaryKey().defaultRandom(),
  importBatchId: uuid("import_batch_id").notNull().references(() => demoImports.id),
  mapId: uuid("map_id").notNull().references(() => matchMaps.id),
  roundNumber: integer("round_number").notNull(),
  steamId64: text("steam_id64").notNull(),
  teamKey: text("team_key"), side: demoSideEnum("side"),
  startMoney: integer("start_money"), moneySpent: integer("money_spent"),
  equipmentValue: integer("equipment_value"), type: text("type"),
});

// kills.json
export const demoKills = pgTable("demo_kills", {
  id: uuid("id").primaryKey().defaultRandom(),
  importBatchId: uuid("import_batch_id").notNull().references(() => demoImports.id),
  mapId: uuid("map_id").notNull().references(() => matchMaps.id),
  roundNumber: integer("round_number").notNull(), tick: integer("tick").notNull(),
  killerSteamId64: text("killer_steam_id64"), victimSteamId64: text("victim_steam_id64"),
  assisterSteamId64: text("assister_steam_id64"),
  killerTeamKey: text("killer_team_key"), victimTeamKey: text("victim_team_key"),
  killerSide: demoSideEnum("killer_side"), victimSide: demoSideEnum("victim_side"),
  weapon: text("weapon"), headshot: boolean("headshot"), flashAssist: boolean("flash_assist"),
  tradeKill: boolean("trade_kill"), tradeDeath: boolean("trade_death"),
  throughSmoke: boolean("through_smoke"), noScope: boolean("no_scope"),
  penetratedObjects: integer("penetrated_objects"),
  killerPosition: json("killer_position").$type<Vec3>(),
  victimPosition: json("victim_position").$type<Vec3>(),
});

// damages.json
export const demoDamages = pgTable("demo_damages", {
  id: uuid("id").primaryKey().defaultRandom(),
  importBatchId: uuid("import_batch_id").notNull().references(() => demoImports.id),
  mapId: uuid("map_id").notNull().references(() => matchMaps.id),
  roundNumber: integer("round_number").notNull(), tick: integer("tick").notNull(),
  attackerSteamId64: text("attacker_steam_id64"), victimSteamId64: text("victim_steam_id64"),
  attackerTeamKey: text("attacker_team_key"), victimTeamKey: text("victim_team_key"),
  attackerSide: demoSideEnum("attacker_side"), victimSide: demoSideEnum("victim_side"),
  weapon: text("weapon"), hitgroup: text("hitgroup"),
  healthDamage: integer("health_damage"), armorDamage: integer("armor_damage"),
  victimHealthBefore: integer("victim_health_before"), victimHealthAfter: integer("victim_health_after"),
  victimArmorBefore: integer("victim_armor_before"), victimArmorAfter: integer("victim_armor_after"),
});

// blinds.json
export const demoBlinds = pgTable("demo_blinds", {
  id: uuid("id").primaryKey().defaultRandom(),
  importBatchId: uuid("import_batch_id").notNull().references(() => demoImports.id),
  mapId: uuid("map_id").notNull().references(() => matchMaps.id),
  roundNumber: integer("round_number").notNull(), tick: integer("tick").notNull(),
  flasherSteamId64: text("flasher_steam_id64"), flashedSteamId64: text("flashed_steam_id64"),
  flasherTeamKey: text("flasher_team_key"), flashedTeamKey: text("flashed_team_key"),
  flasherSide: demoSideEnum("flasher_side"), flashedSide: demoSideEnum("flashed_side"),
  durationSeconds: real("duration_seconds"),
});

// bombs.json
export const demoBombs = pgTable("demo_bombs", {
  id: uuid("id").primaryKey().defaultRandom(),
  importBatchId: uuid("import_batch_id").notNull().references(() => demoImports.id),
  mapId: uuid("map_id").notNull().references(() => matchMaps.id),
  roundNumber: integer("round_number").notNull(), tick: integer("tick").notNull(),
  type: text("type"), site: text("site"),
  actorSteamId64: text("actor_steam_id64"), actorTeamKey: text("actor_team_key"),
  actorSide: demoSideEnum("actor_side"), position: json("position").$type<Vec3>(),
});

// clutches.json
export const demoClutches = pgTable("demo_clutches", {
  id: uuid("id").primaryKey().defaultRandom(),
  importBatchId: uuid("import_batch_id").notNull().references(() => demoImports.id),
  mapId: uuid("map_id").notNull().references(() => matchMaps.id),
  roundNumber: integer("round_number").notNull(), tick: integer("tick"),
  clutcherSteamId64: text("clutcher_steam_id64"), clutcherTeamKey: text("clutcher_team_key"),
  clutcherSide: demoSideEnum("clutcher_side"),
  opponentCount: integer("opponent_count"), won: boolean("won"),
  survived: boolean("survived"), killCount: integer("kill_count"),
});

// grenades.json
export const demoGrenades = pgTable("demo_grenades", {
  id: uuid("id").primaryKey().defaultRandom(),
  importBatchId: uuid("import_batch_id").notNull().references(() => demoImports.id),
  mapId: uuid("map_id").notNull().references(() => matchMaps.id),
  roundNumber: integer("round_number").notNull(),
  throwTick: integer("throw_tick"), effectTick: integer("effect_tick"),
  grenade: text("grenade"), throwerSteamId64: text("thrower_steam_id64"),
  throwerTeamKey: text("thrower_team_key"), throwerSide: demoSideEnum("thrower_side"),
  throwPosition: json("throw_position").$type<Vec3>(),
  effectPosition: json("effect_position").$type<Vec3>(),
});

// shots.json
export const demoShots = pgTable("demo_shots", {
  id: uuid("id").primaryKey().defaultRandom(),
  importBatchId: uuid("import_batch_id").notNull().references(() => demoImports.id),
  mapId: uuid("map_id").notNull().references(() => matchMaps.id),
  roundNumber: integer("round_number").notNull(), tick: integer("tick").notNull(),
  steamId64: text("steam_id64"), teamKey: text("team_key"), side: demoSideEnum("side"),
  weapon: text("weapon"), position: json("position").$type<Vec3>(),
  velocity: json("velocity").$type<Vec3>(), yaw: real("yaw"), pitch: real("pitch"),
});

// positions-1s.json
export const demoPositions = pgTable("demo_positions", {
  id: uuid("id").primaryKey().defaultRandom(),
  importBatchId: uuid("import_batch_id").notNull().references(() => demoImports.id),
  mapId: uuid("map_id").notNull().references(() => matchMaps.id),
  roundNumber: integer("round_number").notNull(), tick: integer("tick").notNull(),
  steamId64: text("steam_id64").notNull(), teamKey: text("team_key"), side: demoSideEnum("side"),
  alive: boolean("alive"), position: json("position").$type<Vec3>(),
  yaw: real("yaw"), pitch: real("pitch"),
  health: integer("health"), armor: integer("armor"), money: integer("money"),
  activeWeapon: text("active_weapon"), flashDurationRemaining: real("flash_duration_remaining"),
  hasBomb: boolean("has_bomb"), hasDefuseKit: boolean("has_defuse_kit"),
});
```

- [ ] **Step 2: 在 `src/db/schema/index.ts` re-export**

```typescript
export * from "./demo";
```

- [ ] **Step 3: 生成迁移 + 类型检查**

Run: `pnpm db:generate && pnpm tsc --noEmit`
Expected: 生成 14 张表 + 2 个 enum 的 SQL,类型通过。

- [ ] **Step 4: 提交**

```bash
git add src/db/schema/demo.ts src/db/schema/index.ts drizzle/
git commit -m "feat: 新增 demo 导入 14 张明细表 schema"
```

---

### Task 2: Zod 校验 schema(对应 manifest 与 13 文件)

**Files:**
- Create: `src/lib/demo/schemas.ts`
- Test: `src/lib/demo/schemas.test.ts`

- [ ] **Step 1: 写失败测试(用真实 example 包逐文件校验通过)**

```typescript
// src/lib/demo/schemas.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { manifestSchema, killsSchema, playerStatsSchema, positionsSchema } from "./schemas";

const dir = join(process.cwd(), "docs/demo-export/example/package");
const load = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf-8"));

describe("demo zod schemas 接受 example 包", () => {
  it("manifest", () => { expect(() => manifestSchema.parse(load("manifest.json"))).not.toThrow(); });
  it("kills", () => { expect(() => killsSchema.parse(load("kills.json"))).not.toThrow(); });
  it("player-stats", () => { expect(() => playerStatsSchema.parse(load("player-stats.json"))).not.toThrow(); });
  it("positions-1s", () => { expect(() => positionsSchema.parse(load("positions-1s.json"))).not.toThrow(); });
  it("拒绝 schemaVersion 不符", () => {
    expect(() => manifestSchema.parse({ ...load("manifest.json"), schemaVersion: "wrong/9" })).toThrow();
  });
});
```

- [ ] **Step 2: 跑确认失败**

Run: `pnpm test src/lib/demo/schemas.test.ts` → FAIL(模块不存在)

- [ ] **Step 3: 实现 `src/lib/demo/schemas.ts`**

为 manifest + 13 文件各写一个 Zod schema。关键约束:`schemaVersion` 用 `z.literal("rivalhub-demo-export/1")`;`side` 用 `z.enum(["t","ct","unknown"])`;坐标 `z.object({x:z.number(),y:z.number(),z:z.number()})`;数组文件用 `z.array(rowSchema)`。每个 row 的字段与 Task 1 表字段一一对应,数值字段用 `.nullable()` 容忍缺失。导出全部 schema + 一个 `FILE_SCHEMAS: Record<string, ZodTypeAny>` 映射 manifest.files 的 key 到 schema。

> 执行者:字段清单直接照搬 Task 1 各表(已是 example 包真实 key);不要省略字段。

- [ ] **Step 4: 跑确认通过**

Run: `pnpm test src/lib/demo/schemas.test.ts` → PASS(5 用例)

- [ ] **Step 5: 提交**

```bash
git add src/lib/demo/schemas.ts src/lib/demo/schemas.test.ts
git commit -m "feat: demo 导出包 Zod 校验 schema"
```

---

### Task 3: SteamID → 站内用户映射(纯函数)

**Files:**
- Create: `src/lib/demo/map-players.ts`
- Test: `src/lib/demo/map-players.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// src/lib/demo/map-players.test.ts
import { describe, it, expect } from "vitest";
import { mapDemoPlayers } from "./map-players";

describe("mapDemoPlayers", () => {
  it("能映射的填 userId,不能的留 null 并标记 unmatched", () => {
    const demoPlayers = [
      { steamId64: "111", name: "Alice", teamKey: "teamA" },
      { steamId64: "999", name: "Ghost", teamKey: "teamB" },
    ];
    const known = new Map([["111", "user-uuid-1"]]);
    const { mapped, unmatched } = mapDemoPlayers(demoPlayers, known);
    expect(mapped[0].userId).toBe("user-uuid-1");
    expect(mapped[1].userId).toBeNull();
    expect(unmatched).toEqual(["Ghost"]);
  });
});
```

- [ ] **Step 2: 跑确认失败** → `pnpm test src/lib/demo/map-players.test.ts` FAIL

- [ ] **Step 3: 实现**

```typescript
// src/lib/demo/map-players.ts
export interface DemoPlayerInput { steamId64: string; name: string; teamKey: string; }
export interface MappedPlayer extends DemoPlayerInput { userId: string | null; }

export function mapDemoPlayers(
  players: DemoPlayerInput[],
  steamIdToUserId: Map<string, string>,
): { mapped: MappedPlayer[]; unmatched: string[] } {
  const mapped: MappedPlayer[] = [];
  const unmatched: string[] = [];
  for (const p of players) {
    const userId = steamIdToUserId.get(p.steamId64) ?? null;
    if (!userId) unmatched.push(p.name);
    mapped.push({ ...p, userId });
  }
  return { mapped, unmatched };
}
```

- [ ] **Step 4: 跑确认通过** → PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/demo/map-players.ts src/lib/demo/map-players.test.ts
git commit -m "feat: demo 玩家 SteamID 映射纯函数"
```

> 前置:users 表需有 steamId64 字段用于映射。执行者先确认 `src/db/schema/users.ts` 是否有 `steamId64`;若无,补一个 `steamId64 text` 字段 + 迁移(单独 commit),否则映射 Map 无从构造。

---

### Task 4: zip 解包 + 校验聚合(纯函数)

**Files:**
- Create: `src/lib/demo/parse-package.ts`
- Test: `src/lib/demo/parse-package.test.ts`
- 依赖: `pnpm add jszip`

- [ ] **Step 1: 写失败测试(用 example zip)**

```typescript
// src/lib/demo/parse-package.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDemoPackage } from "./parse-package";

it("解析 example zip 返回 manifest 与各文件数组", async () => {
  const buf = readFileSync(join(process.cwd(), "docs/demo-export/example/rivalhub-demo-export-example.zip"));
  const result = await parseDemoPackage(buf);
  expect(result.manifest.mapName).toBe("de_mirage");
  expect(Array.isArray(result.files.kills)).toBe(true);
  expect(result.files.playerStats.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: 跑确认失败** → FAIL

- [ ] **Step 3: 实现 `parse-package.ts`**

用 `jszip` 加载 buffer → 读 `manifest.json` → 用 `manifestSchema` 校验 → 按 `manifest.files` 索引逐个读取并用 `FILE_SCHEMAS` 校验 → 返回 `{ manifest, files: { kills, damages, ... } }`。任一文件缺失或校验失败抛带文件名的错误。

- [ ] **Step 4: 跑确认通过** → PASS

- [ ] **Step 5: 提交**

```bash
git add package.json pnpm-lock.yaml src/lib/demo/parse-package.ts src/lib/demo/parse-package.test.ts
git commit -m "feat: demo zip 解包与校验"
```

---

### Task 5: 回填 match_player_stats 公共列(纯函数)

**Files:**
- Create: `src/lib/demo/to-match-player-stats.ts`
- Test: `src/lib/demo/to-match-player-stats.test.ts`

把 demo `player-stats` 映射为现有 `match_player_stats` 可填列(kills/deaths/assists/adr/hsPercent 由 headshotCount÷kills、firstKills=firstKillCount、multiKills=three+four+five、clutches=vsN won 合计),`source="demo_import"`,完美独有列(rws/ratingPro/we)留 undefined。

- [ ] **Step 1-4: TDD**

写测试断言:给一条 demo player-stat,产出对象 `kills/deaths/adr` 透传、`hsPercent = round(headshotCount/kills*100)`、`source="demo_import"`、`ratingPro===undefined`。跑失败→实现纯函数→跑通。

- [ ] **Step 5: 提交**

```bash
git add src/lib/demo/to-match-player-stats.ts src/lib/demo/to-match-player-stats.test.ts
git commit -m "feat: demo player-stats 回填 match_player_stats 公共列"
```

---

### Task 6: 导入 Server Action(事务写库 + 审计)

**Files:**
- Create: `src/actions/demo-import.ts`

- [ ] **Step 1: 实现 `importDemoPackage(mapId, zipBuffer)`**

签名:`importDemoPackage(mapId, zipBuffer, opts?: { confirmOverwriteOcr?: boolean })`。
流程(返回 `ActionResult<{ importBatchId; unmatched: string[] }>`):
1. 鉴权:管理员校验(复用现有 admin guard)。
2. 校验 map 存在且其比赛已结束;不满足 `fail("MAP_NOT_FINISHED")`。
3. `parseDemoPackage(zipBuffer)`。
4. 查重:`demoImports` 已存在相同 `demoHash` + `mapId` → `fail("DUPLICATE_IMPORT")`。
5. **来源冲突检测(契约 E):** 若该 map 已有 `source="manual_ocr"` 的 `match_player_stats` 行且 `opts.confirmOverwriteOcr !== true` → `fail("OCR_EXISTS_NEEDS_CONFIRM")`(前端据此弹二次确认)。
6. 构造 `steamIdToUserId` Map(查 users.steamId64),`mapDemoPlayers`。
7. `db.transaction`:插 `demoImports` 拿 batchId → 批量插 13 张明细表(带 batchId/mapId,事件行用 mapped userId 回填)→ 删除该 map 旧的 demo 来源 `match_player_stats`(`source="demo_import"`)→ 插回填行(Task 5 产物)→ **设置 `match_maps.activeStatSource = "demo_import"`** → 写 `auditLogs`(action `match.import_demo`)。
8. 返回 `ok({ importBatchId, unmatched })`。

> 遵守 AGENTS.md:Server Action 必返回 `ActionResult`;错误码加到 `src/lib/errors.ts`;事务内**不**广播 Realtime。

- [ ] **Step 2: 类型检查** → `pnpm tsc --noEmit` 通过

- [ ] **Step 3: 提交**

```bash
git add src/actions/demo-import.ts src/lib/errors.ts
git commit -m "feat: demo 导出包导入 Server Action"
```

---

### Task 7: 后台上传 UI

**Files:**
- Create: `src/components/admin/DemoImportPanel.tsx`
- Modify: 比赛地图后台页(挂载入口,执行者按现有后台路由放置)

- [ ] **Step 1: 实现上传组件**

`"use client"`:文件选择(.zip)→ 调 `importDemoPackage` → 成功 toast 显示 unmatched 玩家名提醒管理员手动处理;失败按错误码提示。复用现有 Button/InlineConfirm/sonner。

- [ ] **Step 2: 手动验证**

`pnpm dev` → 后台某已结束比赛地图 → 上传 `docs/demo-export/example/rivalhub-demo-export-example.zip` → 确认提示导入成功 + 列出未映射玩家;DB 中 14 张表有数据、`match_player_stats` 出现 source=demo_import 行。

- [ ] **Step 3: 提交**

```bash
git add src/components/admin/DemoImportPanel.tsx "src/app/..."
git commit -m "feat: 后台 demo 导入上传面板"
```

---

### Task 8: 生效来源标记与冲突约束(契约 E)

**Files:**
- Modify: `src/db/schema/match-maps.ts`(加 `activeStatSource`)
- Modify: `src/db/schema/player-stats.ts`(unique 约束调整)
- Modify: `src/components/admin/DemoImportPanel.tsx`(二次确认)
- 迁移: `drizzle/`

- [ ] **Step 1: match_maps 增加生效来源字段**

在 `src/db/schema/match-maps.ts` import `statSourceEnum`(来自 `./player-stats`),`matchMaps` 表增加:

```typescript
  // 该图聚合/展示的生效来源(契约 E);null = 仅历史 OCR
  activeStatSource: statSourceEnum("active_stat_source"),
```

- [ ] **Step 2: 调整 match_player_stats unique 约束**

把 `src/db/schema/player-stats.ts` 的 `uniqueMapPlayer: unique().on(t.mapId, t.perfectName)` 改为:

```typescript
  uniqueMapPlayerSource: unique().on(t.mapId, t.perfectName, t.source),
```

> 这样 OCR 行与 demo 回填行可物理共存,聚合查询靠 `source = activeStatSource` 过滤(见契约 E、Plan 1/3 聚合改造)。

- [ ] **Step 3: 生成迁移 + 类型检查**

Run: `pnpm db:generate && pnpm tsc --noEmit`
Expected: ALTER match_maps + 调整 unique 的 SQL,类型通过。

- [ ] **Step 4: 前端二次确认接线**

`DemoImportPanel` 捕获 `fail("OCR_EXISTS_NEEDS_CONFIRM")` → 用 `InlineConfirm` 弹「该图已有 OCR 数据,导入 demo 将以 demo 为准(OCR 数据保留但不参与聚合),确认?」→ 确认后带 `confirmOverwriteOcr: true` 重试。

- [ ] **Step 5: 手动验证 + 提交**

先对一张图录 OCR,再导入同图 demo:首次应弹冲突确认;确认后该图 `activeStatSource=demo_import`,比赛页展示切到 demo 口径。

```bash
git add src/db/schema/match-maps.ts src/db/schema/player-stats.ts src/components/admin/DemoImportPanel.tsx drizzle/
git commit -m "feat: demo 导入生效来源标记与 OCR 冲突二次确认"
```

---

## Self-Review

- **覆盖:** 13 文件→14 表(Task1)、校验(Task2)、映射(Task3)、解包(Task4)、回填(Task5)、导入事务(Task6)、UI(Task7)、来源冲突与生效标记(Task8,契约 E)。✅
- **类型一致:** `statSourceEnum` 来自 Plan 1;`Vec3`、`demoSideEnum` 全程统一;`importBatchId` 命名一致。✅
- **依赖前置:** Task3 标注 users.steamId64 前置检查,避免映射无数据。✅

## 完成后维护

- 更新 `docs/code-map.md`、`docs/data-integrity.md`(新增 demo 表约束)。
- `pnpm db:push` 推迁移;example 包联调通过后与 Insight 对齐 handoff §「需要对齐」4 项。
