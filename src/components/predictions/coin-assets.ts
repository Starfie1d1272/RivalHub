/** Replace these two owned face assets when the final artwork arrives. */
export const PICKEM_COIN_FACES = { front: "/images/pickem/coin-front.svg", back: "/images/pickem/coin-back.svg" };
export const COIN_FINISHES: Record<string, { metal: string; label: string }> = {
  未获得: { metal: "#64717e", label: "待解锁" },
  青铜: { metal: "#bd8258", label: "铜币" },
  白银: { metal: "#c1d2de", label: "银币" },
  黄金: { metal: "#efbd54", label: "金币" },
  钻石: { metal: "#a0e5f4", label: "钻石币" },
};
