import type { PublicLiveMatchProjection } from "./live-projection";

/** Match Detail translates Mizar's finite bomb states into short viewer copy. */
export function presentLiveBomb(
  bomb: PublicLiveMatchProjection["bomb"],
  players: PublicLiveMatchProjection["players"],
): string {
  if (!bomb) return "C4 状态暂不可用";
  if (bomb.action) {
    const action = bomb.action.kind === "plant" ? "正在安放 C4" : "正在拆除 C4";
    const actor = bomb.action.sourcePlayerId
      ? players.find((player) => player.sourcePlayerId === bomb.action!.sourcePlayerId)?.displayName
      : null;
    const remaining = bomb.action.remainingSeconds == null ? "" : ` · ${Math.ceil(bomb.action.remainingSeconds)} 秒`;
    return `${action}${actor ? ` · ${actor}` : ""}${remaining}`;
  }
  switch (bomb.state) {
    case "carried": {
      const carrier = bomb.carrierSourceId
        ? players.find((player) => player.sourcePlayerId === bomb.carrierSourceId)?.displayName
        : null;
      return carrier ? `C4 携带者：${carrier}` : "C4 由队员携带";
    }
    case "dropped": return "C4 已掉落";
    case "planting": return "正在安放 C4";
    case "planted": return "C4 已安放";
    case "defusing": return "正在拆除 C4";
    case "defused": return "C4 已拆除";
    case "exploded": return "C4 已爆炸";
    default: return "C4 状态暂不可用";
  }
}
