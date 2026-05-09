# CS2 赛制适配范围调研与设计计划

**日期**：2026-05-10
**目的**：梳理 2025-2026 年 CS2 大赛赛制种类，评估当前 StageExecutor 框架的适配能力，识别 gap 并排定优先级。
**方法**：Liquipedia 逐个赛事页面抓取验证。

---

## 一、已验证赛制分类

经 Liquipedia 抓取验证（7 个赛事页面），2025-2026 CS2 大赛在本次采样范围内观察到 **3 种主流赛制模式**：

### 模式 1：GSL 小组 → 6-team Single Elim（分层晋级）

| 赛事 | 来源 | 小组赛 | 淘汰赛 |
|---|---|---|---|
| IEM Katowice 2025 | [Liquipedia](https://liquipedia.net/counterstrike/Intel_Extreme_Masters/2025/Katowice) | 2 组 × 8 队 GSL 双败 | 6 队 Single Elim（Bo3 + Bo5 决赛） |
| IEM Rio 2026 | [Liquipedia](https://liquipedia.net/counterstrike/Intel_Extreme_Masters/2026/Rio) | 2 组 × 8 队 GSL 双败，全 Bo3 | 6 队 Single Elim（Bo3 + Bo5 决赛） |
| BLAST Open Spring 2026 | [Liquipedia](https://liquipedia.net/counterstrike/BLAST/Open/2026/Spring) | 2 组 × 8 队 GSL 双败，全 Bo3 | 6 队 Single Elim（Bo3 + Bo5 决赛） |
| BLAST Rivals Spring 2026 | [Liquipedia](https://liquipedia.net/counterstrike/BLAST/Rivals/2026/Spring) | 2 组 × 4 队 GSL 双败，全 Bo3 | 6 队 Single Elim（Bo3 + Bo5 决赛） |

**晋级规则（4 个赛事完全一致）**：
```
GSL Group A (8 队)              GSL Group B (8 队)
     │                                │
  1st → Semifinal (bye)          1st → Semifinal (bye)
  2nd → Quarterfinal (High)      2nd → Quarterfinal (High)
  3rd → Quarterfinal (Low)       3rd → Quarterfinal (Low)
  4th-8th → eliminated
```

关键特征：
- **组内双败淘汰**（GSL）决定名次，不是全局双败
- **分层晋级**：小组第 1 直通四强（skip 八强），第 2/3 进八强但种子层级不同
- 淘汰赛实际 **6 队**，不是 8 队也不是 4 队
- BLAST Rivals 用 4 队 GSL 组（小组赛更短），但晋级结构相同

**当前框架能否表达**：❌ 不能。缺 GSL executor + 分层晋级（`advanceTiers`）。

---

### 模式 2：Swiss → 8-team Single Elim

| 赛事 | 来源 | 瑞士轮 | 淘汰赛 |
|---|---|---|---|
| PGL Cluj-Napoca 2025 | [Liquipedia](https://liquipedia.net/counterstrike/PGL/2025/Cluj-Napoca) | 16 队 Swiss，全 Bo3，Buchholz 种子 | 8 队 Single Elim（Bo3 + Bo5 决赛） |
| PGL Astana 2026 | [Liquipedia](https://liquipedia.net/counterstrike/PGL/2026/Astana) | 16 队 Swiss，全 Bo3，VRS 种子 | 8 队 Single Elim（Bo3 + Bo5 决赛 + 季军赛 Bo3） |

**StagePlan 表达**（Swiss executor v2 实现后即可）：
```json
[
  { "key": "swiss", "type": "swiss", "teamCount": 16,
    "advanceTiers": [{ "placement": "*", "count": 8 }],
    "matchFormat": "bo3" },
  { "key": "playoff", "type": "single_elim", "teamCount": 8,
    "advanceTiers": [{ "placement": "1st", "count": 1 }],
    "matchFormat": "bo3" }
]
```

**当前框架能否表达**：⚠️ Swiss executor 缺失（v2 计划），淘汰赛部分 ✅。

**变体**：PGL Astana 有季军赛（3rd place match），single_elim executor 需要可选支持。

---

### 模式 3：多阶段 Swiss → 8-team Single Elim（Valve Major）

| 赛事 | 来源 | Stage 1 | Stage 2 | Stage 3（Playoffs） |
|---|---|---|---|---|
| IEM Cologne Major 2026 | [Liquipedia](https://liquipedia.net/counterstrike/Intel_Extreme_Masters/2026/Cologne) | 16 队 Swiss → 8 进 Stage 2 | 16 队 Swiss（8 Stage 1 + **8 直邀**）→ 8 进 Stage 3 | 16 队 Swiss（8 Stage 2 + **8 直邀**）→ 8 进 Playoffs |
| — Playoffs | 同上 | — | — | 8 队 Single Elim（Bo3 + Bo5 决赛） |

**32 队全部报名，按 VRS 种子划分进入阶段**：种子 #17-32 打 Stage 1，种子 #9-16 从 Stage 2 开始，种子 #1-8 从 Stage 3 开始。高位种子轮空到后续阶段——和 IEM 小组第一直通四强是同一个概念，只是作用在阶段之间。

**当前框架能否表达**：⚠️ 线性 StagePlan 支持多阶段，但两个能力缺失：
1. 不同种子队伍在后续阶段才进入（当前假设所有队伍参与 Stage 1）
2. Swiss executor 本身未实现

---

## 二、未验证/低优先级

以下格式在 Liquipedia 主页面提及但详情未抓取到，或历史上出现过但近年已少用：

| 格式 | 可能赛事 | 验证状态 |
|---|---|---|
| Triple Elim 小组（ESL Pro League 旧格式）| 部分早期 ESL PL 赛季 | 未验证，近年 ESL PL 已转为 Swiss 模式 |
| Round Robin 小组（BLAST 旧格式）| BLAST Premier 2024 及以前 | 未验证，BLAST 2026 已全面转向 GSL 模式 |

---

## 三、框架 Gap 总结

基于已验证数据，核心 gap：

| # | Gap | 影响赛事 | 影响范围 |
|---|---|---|---|
| 1 | **Swiss executor** | PGL 系列 + Major 全部阶段 + ESL PL | 模式 2、3 |
| 2 | **GSL 小组 executor** | IEM 全系列 + BLAST 全系列 | 模式 1 |
| 3 | **分层晋级（advanceTiers）** | 所有使用模式 1 的赛事 | 模式 1 |
| 4 | **种子轮空（高位种子从后续阶段开始）** | Major Stage 2/3 | 模式 3 |

注：(2) 和 (3) 是同一模式的两个面——GSL 小组必然搭配分层晋级，建议一起实现。(4) 本质是分层晋级的阶段间版本，和 (3) 是同构问题。

---

## 四、建议优先级

### P0（v2 — 解锁 IEM + BLAST + PGL + Major，覆盖采样中 7/7 赛事）

1. **`StageConfig` 扩展**：新增 `advanceTiers`、`groupCount`、`matchFormat`、`hasThirdPlaceMatch`；删除 `advance` 字段。详见 `2026-05-10-stage-framework-v2-design.md` §二。
2. **Swiss executor** — 解锁模式 2 和 3
3. **GSL 小组 executor** — 解锁模式 1
4. **single_elim executor 独立实现** — 支持 `advanceTiers` 输入，正确处理 6 队分层 bracket + 季军赛

### P1（v2.5）

5. **种子轮空**：高位种子从后面阶段开始比赛（Major Stage 2/3）— 队伍全部报名但不同种子从不同阶段进入

### P2（v3）

6. Triple elim executor（近两年无赛事使用，低优先级）
7. 可视化 stagePlan 编辑器

---

## 五、GSL 小组对阵算法

GSL 8 队小组的 10 场比赛完全确定性，无需 brackets-manager：

```
Round 1:    A-B, C-D, E-F, G-H
Round 2:    (A/B W)-(C/D W), (E/F W)-(G/H W)  → 胜者晋级 (2-0)
Round 3:    (A/B L)-(C/D L), (E/F L)-(G/H L)  → 败者淘汰 (0-2)
Round 4:    (R2 L)-(R3 W)  ×2                 → 胜者晋级 (2-1), 败者淘汰 (1-2)
```

GSL 4 队小组更简单——仅 5 场比赛，两组共 10 场。

---

## 六、不改动的部分

- `src/lib/bracket/` 适配层保持不动
- `StageExecutor` 接口签名扩展（`initialize` 新增 `qualifiers` 参数，新增 `getQualifiers` 方法），详见 v2 design §五
- v1 Rivals 双败淘汰逻辑零改动

---

## 参考

- [IEM Katowice 2025](https://liquipedia.net/counterstrike/Intel_Extreme_Masters/2025/Katowice) — GSL 2×8 → 6SE
- [IEM Rio 2026](https://liquipedia.net/counterstrike/Intel_Extreme_Masters/2026/Rio) — GSL 2×8 → 6SE
- [IEM Cologne Major 2026](https://liquipedia.net/counterstrike/Intel_Extreme_Masters/2026/Cologne) — 3-stage Swiss → 8SE
- [PGL Cluj-Napoca 2025](https://liquipedia.net/counterstrike/PGL/2025/Cluj-Napoca) — Swiss → 8SE
- [PGL Astana 2026](https://liquipedia.net/counterstrike/PGL/2026/Astana) — Swiss → 8SE + 季军赛
- [BLAST Open Spring 2026](https://liquipedia.net/counterstrike/BLAST/Open/2026/Spring) — GSL 2×8 → 6SE
- [BLAST Rivals Spring 2026](https://liquipedia.net/counterstrike/BLAST/Rivals/2026/Spring) — GSL 2×4 → 6SE
- 现有设计：`2026-05-09-platform-configurability-design.md`
- Swiss 算法：`2026-05-08-swiss-tournament-design.md`
