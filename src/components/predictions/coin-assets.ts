/** Median RGB sampled from each artwork’s opaque outer annulus (88–96% radius). */
export const COIN_FINISHES: Record<string, { metal: string; label: string }> = {
  未获得: { metal: "#6e4127", label: "待解锁" },
  青铜: { metal: "#6e4127", label: "铜币" },
  白银: { metal: "#7c7770", label: "银币" },
  黄金: { metal: "#aa7735", label: "金币" },
  钻石: { metal: "#ad9051", label: "钻石币" },
};

/** Owner-supplied 2026 artwork; each grade currently supplies one face. */
export function coinFaces(coin: string) {
  const grade = ({ 青铜: "bronze", 白银: "silver", 黄金: "gold", 钻石: "diamond" } as Record<string, string>)[coin] ?? "bronze";
  const face = `/images/pickem/coin-${grade}.webp`;
  return { front: face, back: face };
}
