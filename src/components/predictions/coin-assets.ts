export const COIN_FINISHES: Record<string, { metal: string; label: string }> = {
  未获得: { metal: "#64717e", label: "待解锁" },
  青铜: { metal: "#bd8258", label: "铜币" },
  白银: { metal: "#c1d2de", label: "银币" },
  黄金: { metal: "#efbd54", label: "金币" },
  钻石: { metal: "#a0e5f4", label: "钻石币" },
};

/** Owner-supplied 2026 artwork; each grade currently supplies one face. */
export function coinFaces(coin: string) {
  const grade = ({ 青铜: "bronze", 白银: "silver", 黄金: "gold", 钻石: "diamond" } as Record<string, string>)[coin] ?? "bronze";
  const face = `/images/pickem/coin-${grade}.webp`;
  return { front: face, back: face };
}
