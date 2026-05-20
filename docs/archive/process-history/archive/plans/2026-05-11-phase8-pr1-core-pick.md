# Phase 8 PR1 落地计划：核心 pick 事务

## 目标

把 Phase 8 拆成第一轮可合并 PR：先交付 `pickPlayer` 的后端原子事务、幂等键、队内同位置上限和基础规则测试。队长面板 UI、Cron 超时自动 pick、`autoPick` 独立放到后续 PR。

## 范围

- 修正 `docs/draft-flow.md` 中同位置规则描述：每队同主选位置最多 2 人，检查条件应为 `COUNT >= 2`。
- 扩展 `src/lib/draft/rules.ts`：
  - `isStarterRound(round)`：Round 1-4 为首发，Round 5-6 为替补。
  - `canPickPosition(currentCount)`：当前同主选位置人数小于 2 才允许继续 pick。
- 扩展 `src/lib/validators/draft.ts`：
  - 新增 `pickPlayerSchema` 和 `PickPlayerInput`。
- 实现 `src/actions/draft.ts` 的 `pickPlayer(input)`：
  - `requireAuth()` 获取当前用户。
  - 在同一个 `db.transaction()` 内用 `SELECT ... FOR UPDATE` 锁住当前赛季 `draft_state`。
  - 先检查 `clientRequestId` 幂等记录，重复同请求直接返回成功。
  - 校验赛季启用 draft、draft active、当前队伍、deadline、队长身份、目标报名状态、目标未被选。
  - 校验该队同主选位置人数 `< 2`。
  - 写入 `draft_picks` 与 `team_members`。
  - 用蛇形顺序推进 `draft_state`；最后一 pick 后关闭 draft，并把赛季推进到 `playing`。
  - commit 后再 `revalidatePath()` 相关页面。
- 更新 `PHASES.md` Phase 8 checkbox：PR1 范围完成后勾选 `pickPlayer` 与同位置约束。

## 非目标

- 不做 `/[seasonSlug]/draft/captain` 交互面板。
- 不做 `/api/cron/draft-timeout` 与 `autoPick`。
- 不引入新 Realtime 表订阅。
- 不在本 PR 里改动 Swiss / bracket / match 相关代码。

## 自检

必须通过：

```bash
pnpm test
pnpm tsc --noEmit
```

视改动情况补充：

```bash
pnpm type-check
```

## PR 拆分与进度

- PR1：核心 pick 事务与规则测试。已落地。
- PR2：队长端页面和客户端幂等按钮。已落地。
- PR3：Cron route + `autoPick` 复用同一事务核心。已落地。
- PR4：移动端 draft UI 与端到端流程测试。
