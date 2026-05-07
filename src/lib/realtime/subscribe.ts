// TODO: 实现 Supabase Realtime 订阅辅助
// - subscribeDraftState(seasonId, onUpdate)：订阅选秀状态变更
// - subscribeDraftPicks(seasonId, onPick)：订阅新的 pick 事件
// - subscribePositionCounts(seasonId, onUpdate)：订阅位置人数变更
// - subscribeCaptainVotes(seasonId, onUpdate)：订阅投票数变更

import type { RealtimeChannel } from "@supabase/supabase-js";
import type { DraftState, DraftPick } from "@/types/draft";

export function subscribeDraftState(
  _seasonId: string,
  _onUpdate: (state: DraftState) => void
): RealtimeChannel {
  throw new Error("not implemented");
}

export function subscribeDraftPicks(
  _seasonId: string,
  _onPick: (pick: DraftPick) => void
): RealtimeChannel {
  throw new Error("not implemented");
}

export function subscribePositionCounts(
  _seasonId: string,
  _onUpdate: (counts: Record<string, number>) => void
): RealtimeChannel {
  throw new Error("not implemented");
}

export function subscribeCaptainVotes(
  _seasonId: string,
  _onUpdate: (counts: Record<string, number>) => void
): RealtimeChannel {
  throw new Error("not implemented");
}
