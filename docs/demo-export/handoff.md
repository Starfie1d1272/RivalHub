# RivalHub Demo 导出交接

## 目标

CS2 Insight Agent 解析一张 demo 地图并导出 zip；RivalHub 管理后台把该 zip 绑定到一张已结束比赛地图，校验、导入并做后续统计分析。

```text
demo -> CS2 Insight Agent export zip -> RivalHub import
```

字段设计参考 CS Demo Manager 的数据分层：地图、玩家、回合、事件、空间数据分开。示例包是交接 contract，不要求复用其内部实现。

## 交付物

- 导出说明：本文
- 示例目录：`example/package/`
- 示例 zip：`example/rivalhub-demo-export-example.zip`

## 导出包

一份 zip 对应一张 demo 地图：

```text
rivalhub-demo-export.zip
├── manifest.json
├── match.json
├── players.json
├── player-stats.json
├── rounds.json
├── player-economies.json
├── kills.json
├── damages.json
├── blinds.json
├── bombs.json
├── clutches.json
├── grenades.json
├── shots.json
└── positions-1s.json
```

RivalHub 希望数据尽量一次导全，避免后续重跑 demo。全 tick 玩家位置和完整道具轨迹若导出侧可提供，可另放 `raw/` 压缩文件；常规导入先使用 `positions-1s.json`。

## 数据范围

| 文件 | 内容 |
|---|---|
| `manifest.json` | schema、导出器/解析器版本、demo hash、文件索引 |
| `match.json` | 地图、tickrate、时长、server/source、双方比分 |
| `players.json` | SteamID、昵称、稳定队伍归属 |
| `player-stats.json` | 地图级玩家汇总 |
| `rounds.json` | 回合 tick、比分、side、胜方、经济、结束原因 |
| `player-economies.json` | 每回合每名玩家的金钱、花费、装备价值、经济类型 |
| `kills.json` | 击杀、助攻、trade、HS、武器、烟杀/盲狙/穿透、坐标 |
| `damages.json` | 伤害来源、武器、hitgroup、health/armor damage |
| `blinds.json` | 谁闪了谁、持续时间、side |
| `bombs.json` | plant、defuse、explode、site、actor、坐标 |
| `clutches.json` | 每条残局的 `1vN`、胜负、存活、残局击杀数 |
| `grenades.json` | 投掷物类型、投掷者、投掷/生效 tick、落点或爆点 |
| `shots.json` | 开枪事件、武器、玩家位置与朝向 |
| `positions-1s.json` | 约每秒采样的玩家状态与坐标 |

`player-stats` 至少希望包含：

- K/D/A、health/armor damage、ADR、utility damage
- headshot、first kill/death、trade kill/death、KAST
- `1K` 到 `5K`
- `1v1` 到 `1v5` 的 attempts / won / lost
- plant / defuse、wallbang / no-scope / collateral 可解析统计
- rating 若提供，需注明口径

这些数据足够 RivalHub 做地图、选手、队伍、胜负切片和大部分 HLTV Attributes 风格分析。Utility 依赖 `damages`、`blinds`、`grenades`；空间热区和活跃位置依赖 `positions-1s` 或 raw 位置数据。

## 分析覆盖

| 方向 | 主要数据 |
|---|---|
| 火力、ADR、多杀 | `player-stats`、`kills`、`damages` |
| 首杀与回合开局 | `kills`、`rounds`、`player-stats` |
| 补枪与交易 | `kills` 的 trade 字段、`player-stats` |
| 残局 | `clutches`、`player-stats` |
| 狙击与武器表现 | `kills`、`shots` |
| 道具贡献 | `damages`、`blinds`、`grenades` |
| 热区、活跃位置、基础路线 | `positions-1s` |

若要实现 HLTV Attributes 风格评分，RivalHub 仍需自行确认具体公式；导出包优先保留支撑计算的原始事件和汇总字段。

## 字段约定

- SteamID 使用 Steam64 十进制字符串，字段名统一 `steamId64`。
- `teamKey` 表示整张 demo 内稳定队伍归属，建议 `teamA` / `teamB`；T/CT 换边写在 `side`。
- `side` 取 `t` / `ct` / `unknown`。
- 事件至少带 `roundNumber` 与 `tick`；可提供时保留 `frame`。
- 坐标统一为 `{ "x": number, "y": number, "z": number }`。
- 事件中同时保留 actor SteamID、`teamKey` 与事件发生时 `side`，避免导入后反推。
- 相同 demo 重导时 `demo.hash` 用于识别重复包。

## 位置采样

`positions-1s.json` 由导出侧采样，建议比赛进行中约每 1 秒记录一次玩家状态：

- `roundNumber`、`tick`、`steamId64`
- `teamKey`、`side`、`alive`
- `position`、`yaw`、`pitch`
- `health`、`armor`、`activeWeapon`
- `flashDurationRemaining`、`money`、`hasBomb`、`hasDefuseKit` 可提供时保留

## RivalHub 导入边界

RivalHub 负责：

1. 将 zip 绑定到已结束比赛的一张地图。
2. 用 SteamID 映射站内选手；未映射玩家保留 demo 身份并提示管理员。
3. 校验 schema、文件索引、字段结构、demo hash 和重复导入。
4. 保存导入人、导入时间、导出器版本和导入结果。

CS2 Insight Agent 负责：

1. 从 demo 解析并导出上述文件。
2. 明确字段缺失、解析失败或近似计算的情况。
3. 确认 rating、trade、clutch、采样位置等统计口径。

## 需要对齐

1. 上述文件与字段是否都能稳定导出。
2. rating、KAST、trade、clutch、economy type 的计算口径。
3. `positions-1s` 的实际采样 tick 规则。
4. 是否额外提供 `raw/` 全量位置和道具轨迹文件。
