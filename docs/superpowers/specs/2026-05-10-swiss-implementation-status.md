# Swiss Executor 实现状态快照

**日期**：2026-05-10
**分支**：`fix/swiss-review-fixes`（基于 `feat/swiss-executor` + PR #40 合并）
**上游 PR**：#39 `feat/swiss-executor`、#40 `codex/fix-pr39-bracket-viewer`

---

## 一、已完成

| 功能 | 文件 | 来源 |
|---|---|---|
| Swiss executor：`initialize` / `advanceRound` / `isComplete` | `src/lib/formats/swiss.ts` | PR #39 |
| `getQualifiers` 方法 | `src/lib/formats/swiss.ts` | 本次分支 |
| R1 种子配对（上半区 vs 下半区） | `swiss.ts` | PR #39 |
| 逐轮推进：wins/losses 更新 → BU 重算 → slide pairing + 避重赛 | `swiss.ts` | PR #39 |
| BO3 升级（晋级局 / 淘汰局） | `swiss.ts` | PR #39 |
| `swiss_standings` 表 + Drizzle schema | `src/db/schema/swiss-standings.ts` | PR #39 |
| 数据库迁移 0006 | `drizzle/migrations/` | PR #39 |
| Swiss 数据查询层 `getSwissViewData` | `src/lib/swiss/data.ts` | PR #39 |
| HLTV 风格 SwissBracket UI 组件 | `src/components/matches/SwissBracket.tsx` | PR #39 |
| matches page Swiss 集成（capability 驱动分支） | `src/app/[seasonSlug]/matches/page.tsx` | PR #39 |
| Format registry 注册 swiss | `src/lib/formats/index.ts` | PR #39 |
| Brackets-viewer 字段修复（snake_case） | `src/lib/bracket/index.ts` | PR #40 |
| Brackets-viewer CSS class + data-match-id 修复 | `src/components/matches/BracketView.tsx` | PR #40 |
| BracketView 回归测试 | `tests/unit/components/matches/BracketView.test.tsx` | PR #40 |
| serializeBracket 回归测试 | `tests/unit/lib/bracket.test.ts` | PR #40 |
| `StageExecutor` 接口 v2 对齐（`qualifiers` 参数 + `getQualifiers` 方法） | `src/lib/formats/types.ts` | 本次分支 |
| `round-robin.ts` / `double-elim.ts` / `single-elim.ts` `getQualifiers` + 签名更新 | `src/lib/formats/` | 本次分支 |
| Swiss executor 核心路径测试（6 case） | `tests/unit/lib/formats/swiss.test.ts` | 本次分支 |

---

## 二、本次 Bug 修复

| # | 问题 | 位置 | 修复 |
|---|---|---|---|
| B1 | 胜负判定 `(null ?? 0) > (null ?? 0)` 错误判负 | `swiss.ts` `advanceRound` | 加 non-null 校验 + 平局禁止 |
| B2 | slidePair fallback 未检查重赛 | `swiss.ts` `slidePair` | 检查后抛 `AppError` |
| B3 | `data.ts` 重复定义 `SwissStanding` 类型 | `data.ts` | import from schema |
| B4 | `swiss.ts` 未使用 import `teamsTable` | `swiss.ts` | 删除 |
| B5 | `SwissBracket.tsx` 未使用 import | `SwissBracket.tsx` | 删除 |

---

## 三、接口差距（v2 design 尚未实现）

| # | 内容 | 优先级 |
|---|---|---|
| G1 | `advance` → `advanceTiers` 配置迁移 + migration SQL | P0 |
| G2 | `matches.entry_round` 列 + check constraint | P0 |
| G3 | GSL 组 executor | P0 |
| G4 | Single elim executor 独立实现（bye + 季军赛） | P0 |
| G5 | `initializeStage` Server Action 泛化 | P0 |
| G6 | double-elim / single-elim `getQualifiers` 完整实现（当前返回 `[]`） | P1 |
| G7 | BU 计算 O(n²) → O(n) 优化 | P2 |

---

## 四、测试

| 文件 | 覆盖 | 来源 |
|------|------|------|
| `tests/unit/components/matches/BracketView.test.tsx` | brackets-viewer class、渲染参数、data-match-id 点击 | PR #40 |
| `tests/unit/lib/bracket.test.ts` | serializeBracket 字段形状 | PR #40 |
| `tests/unit/lib/formats/swiss.test.ts` | initialize / advanceRound 守卫 / 平局禁止 / 胜负更新+BU / isComplete / getQualifiers（6 case） | 本次分支 |

---

## 五、本次分支实现范围总结

`fix/swiss-review-fixes` 包含：
1. **Bug 修复**：B1（胜负判定）、B2（slidePair 重赛）、B3/B4/B5（类型/import 清理）
2. **接口对齐**：`StageExecutor` v2 签名（`qualifiers` 参数 + `getQualifiers` 方法），所有 5 个 executor 同步更新
3. **测试**：`tests/unit/lib/formats/swiss.test.ts`（6 case）
4. **文档**：更新 `2026-05-08-swiss-tournament-design.md` + `2026-05-10-stage-framework-v2-design.md` + 本文件
