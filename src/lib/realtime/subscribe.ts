// Supabase Realtime 订阅辅助
//
// ⚠️ Realtime 是高成本能力，订阅范围严格限定于以下三张表：
//   - draft_state（必须）
//   - draft_picks（必须）
//   - captain_votes（可选，也可用轮询）
// 禁止订阅其他表（season_registrations / teams / matches 等）
// 详细约束见 docs/architecture.md § Realtime 订阅范围
//
// TODO: 各函数体在 Phase 7（围观）/ Phase 6（投票）实装

import type { RealtimeChannel } from "@supabase/supabase-js";
import type { DraftState, DraftPick } from "@/types/draft";

/** 订阅选秀状态变更（轮次推进、倒计时刷新）*/
export function subscribeDraftState(
  _seasonId: string,
  _onUpdate: (state: DraftState) => void
): RealtimeChannel {
  throw new Error("not implemented");
}

/** 订阅新的 pick 事件（围观页动画）*/
export function subscribeDraftPicks(
  _seasonId: string,
  _onPick: (pick: DraftPick) => void
): RealtimeChannel {
  throw new Error("not implemented");
}

/**
 * 订阅队长投票数变更（可选）。
 * 当 voting 阶段访问压力低时，可改为按需轮询替代以节省 Realtime 成本。
 */
export function subscribeCaptainVotes(
  _seasonId: string,
  _onUpdate: (counts: Record<string, number>) => void
): RealtimeChannel {
  throw new Error("not implemented");
}
