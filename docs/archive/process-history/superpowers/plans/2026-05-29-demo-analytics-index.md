# Demo 解析与多平台数据分析 · 计划总览

> 这是一组**拆分计划**的索引。每份子计划可独立交付、独立测试。本文件锁定三份计划共享的**数据契约**和**执行顺序**,所有子计划都引用这里的定义,不得各自重定义。

**整体目标:** 让 RivalHub 既能继续接完美平台的 OCR 录入数据,又能接 CS2 Insight Agent 的 demo 解析导出包(13 个 JSON 文件),并在前端展现明细数据与静态热力图,同时彻底解除"展示/排序/MVP 写死完美 rating 口径"的耦合,为未来更多平台铺路。

**背景认知(已确认):**
- demo 的 `player-stats.json` 有 40 个字段(KAST、trade、vsN 残局细分、utility damage、multi-kill 细分、wallbang/noscope/collateral),但**没有** `rws` / `ratingPro` / `we` —— 这三个是完美平台独有的。
- 现有 `match_player_stats` 表所有统计字段都是 nullable(结构层面已能兼容缺字段)。
- 真正的耦合点:`getPlayerStatsByMap` 写死 `orderBy: desc(ratingPro)`,MVP 候选也依赖 ratingPro 排序。
- 测试约定:`*.test.ts` 与源文件**同目录并放**(co-located),Vitest。

---

## 子计划拆分与依赖

```text
Plan 1 (地基)            Plan 2 (导入)              Plan 3 (展现)
多平台 stat 抽象   ──→   demo 导入管线 + 明细表  ──→  明细前端 + 静态热力图
· statProfile           · 13 张 demo_* 表           · 明细数据展示组件
· 解耦 ratingPro 排序    · zip 解析 + 校验           · 地图 radar 标定
· OCR 面板动态字段       · 绑定 map + SteamID 映射    · 击杀/死亡/炸弹/道具热力图
· 系统推荐 MVP          · 回填 match_player_stats   · (2D 动态回放 = 未来项,本期不做)
```

| 计划 | 文件 | 依赖 | 可独立交付 |
|---|---|---|---|
| Plan 1 | `2026-05-29-01-multiplatform-stat-abstraction.md` | 无 | ✅ 完整 |
| Plan 2 | `2026-05-29-02-demo-import-pipeline.md` | Plan 1 的 `statProfile` + 来源枚举 | ✅(导入跑通即可验证) |
| Plan 3 | `2026-05-29-03-demo-detail-frontend-heatmap.md` | Plan 2 的明细表数据 | ✅(比赛页/选手页/数据面板/队伍页全站展现) |

> Plan 3 范围已扩展:除比赛页明细 + 静态热力图外,还覆盖**选手页**(进阶雷达/个人热区/武器/首杀/残局/utility)、**数据面板**(进阶榜单/武器榜/高光榜/经济转化率)、**队伍页**(风格画像/半场强弱)。见 Plan 3 的 Part A/B/C/D。

**执行顺序:Plan 1 → Plan 2 → Plan 3。** 不可跳序:Plan 2 写表时要用 Plan 1 定的来源枚举;Plan 3 的热力图依赖 Plan 2 落库的坐标数据。

---

## 共享数据契约(三份计划共用,唯一定义在此)

### 契约 A:数据来源枚举

新增 PG enum,标记每条 stat / 每张 demo 包的来源:

```ts
// src/db/schema/_enums.ts(若无则在 player-stats.ts 内定义并 export)
export const statSourceEnum = pgEnum("stat_source", ["manual_ocr", "demo_import"]);
```

- `match_player_stats` 增加 `source: statSourceEnum("source").notNull().default("manual_ocr")`。
- 现存数据默认 `manual_ocr`,无需回填脚本(default 兜底)。

### 契约 B:赛季 statProfile capability

`seasons` 表新增一个 json capability 字段,作为"该赛季录入哪些字段、用什么指标排序/选 MVP"的唯一判断依据(遵循 AGENTS.md 的 capability 模式,**禁止用 `season.kind` 分支**):

```ts
// src/types/season.ts
export interface StatProfile {
  /** 仅展示/标记用,业务逻辑不得据此分支 */
  provider: string;            // 'perfectworld' | 'demo' | 其它
  /** OCR 面板渲染哪些可录入列;顺序即展示顺序 */
  inputFields: StatFieldKey[];
  /** 排序与 MVP 候选所用指标;必须是 StatFieldKey 之一 */
  rankMetric: StatFieldKey;
}

export type StatFieldKey =
  | "kills" | "deaths" | "assists" | "hsPercent" | "firstKills"
  | "multiKills" | "clutches" | "adr" | "rws" | "ratingPro" | "we";
```

- 完美赛季默认:`{ provider: "perfectworld", inputFields: [...全部 11], rankMetric: "ratingPro" }`。
- 未来无 rating 平台:`{ provider: "xxx", inputFields: [不含 rws/ratingPro/we], rankMetric: "adr" }`。
- seasons 表字段:`statProfile: json("stat_profile").$type<StatProfile>().notNull().default(sql\`'{...完美默认...}'::json\`)`。

### 契约 C:坐标标定(Plan 3 用,提前声明避免返工)

demo 的坐标是 CS2 世界坐标 `{x,y,z}`。热力图/2D 需要把它映射到地图 radar 像素坐标,公式(SimpleRadar 标准):

```text
pixelX = (worldX - mapOffsetX) / mapScale
pixelY = (mapOffsetY - worldY) / mapScale
```

- 每张图一组 `{ offsetX, offsetY, scale, radarImage }`,集中放 `src/lib/demo/map-calibration.ts`。
- radar 底图作为静态资源放 `public/maps/radars/<mapName>.png`。
- 本期至少标定 example 包用到的 `de_mirage`,其余地图按需补。

### 契约 D:明细表统一约定(Plan 2 建 13 张表共用)

- 每张表都有 `mapId uuid notNull references(matchMaps.id)`、`importBatchId uuid`(指向一次导入记录)。
- SteamID 一律 `steamId64 text`(Steam64 十进制字符串)。
- 坐标统一 `position: json().$type<{x:number;y:number;z:number}>()`。
- 每条事件保留 `roundNumber int` + `tick int`。
- 玩家映射:导入时用 `steamId64` 关联 `users`,映射不到则 `userId = null`,保留 demo 身份。

### 契约 E:单一事实来源与来源冲突(关键)

**问题:** 同一张图可能既有 OCR 录入、又导入了 demo。`match_player_stats` 有 `unique(mapId, perfectName)`,两来源混入会撞约束或导致 `COUNT/SUM` double count。

**策略:每张图只有一个"生效来源"(activeStatSource),聚合/展示只认它。**

- **来源优先级(主办方场景):** 主办方比赛 demo 必有,故 **demo 为主、OCR 兜底**。导入 demo 成功后该图 `activeStatSource = demo_import`。
- **生效来源标记:** 在 `match_maps` 增加 `activeStatSource: statSourceEnum`(nullable;null = 仅有 OCR 的历史数据,按 manual_ocr 处理)。所有跨场聚合(hexagon、stats 榜单、选手页、队伍页)**必须按 `activeStatSource` 过滤** `match_player_stats.source`,避免两来源同时计入。
- **冲突提示:** 导入 demo 时若该图已存在 `source=manual_ocr` 行 → 返回需二次确认的提示「该图已有 OCR 数据,导入 demo 将以 demo 为准(OCR 行保留但不参与聚合)」;管理员确认后才切 `activeStatSource` 并写入。
- **回填表共存但不混算:** demo 回填的 `match_player_stats`(source=demo_import)与 OCR 行(source=manual_ocr)物理共存(便于回退/审计),但 `unique` 约束改为 `unique(mapId, perfectName, source)`,聚合查询永远带 `source = <activeStatSource>` 条件。

> 落地:`activeStatSource` 字段 + unique 约束调整在 Plan 2 新增 Task;聚合按来源过滤的改造分散在 Plan 1(hexagon/detail-stats)与 Plan 3(各页面查询)。

---

## 共享非目标(本期明确不做)

- **2D 动态回放**(用户确认不急):需要 `raw/` 全 tick 位置 + 流畅渲染,依赖 Insight 额外导出 contract,后续单开计划。
- **HLTV rating 自算公式**:demo 提供原始事件即可,自算口径单独确认,不在本期。
- **Realtime/GSI 实时管线**:与本期赛后管线无关,已在前期讨论中判定低优先级。

---

## 落地后维护动作(每份计划完成时)

- 新增组件需 PascalCase 且更新 `docs/code-map.md`,跑 `zsh scripts/check-claude-md.sh`(AGENTS.md §5.9)。
- DB 改动走 `pnpm db:generate` 生成迁移,**不手动改** package.json version。
- 发版走 `.claude/skills/release.md`,CHANGELOG 先于 `npm version`。
