/**
 * HLTV Rating 2.0 近似（社区逆向复刻，R²≈0.995）
 *
 * 公式：0.0073·KAST + 0.3591·KPR − 0.5329·DPR + 0.2372·Impact + 0.0032·ADR + 0.1587
 * Impact ≈ 2.13·KPR + 0.42·APR − 0.41
 * KAST 以百分数传入（如 73.5，非 0.735）。
 */
export interface HltvRatingInput {
  kills: number;
  deaths: number;
  assists: number;
  /** KAST 百分数（0-100） */
  kast: number;
  /** Average Damage Per Round */
  adr: number;
  /** 该图总回合数 */
  totalRounds: number;
}

export function computeHltvRating(input: HltvRatingInput): number {
  const { kills, deaths, assists, kast, adr, totalRounds } = input;
  if (totalRounds <= 0) return 1.0;

  const kpr = kills / totalRounds;
  const dpr = deaths / totalRounds;
  const apr = assists / totalRounds;
  const impact = 2.13 * kpr + 0.42 * apr - 0.41;

  const rating =
    0.0073 * kast +
    0.3591 * kpr -
    0.5329 * dpr +
    0.2372 * impact +
    0.0032 * adr +
    0.1587;

  // clamp 到合理范围 [0.1, 3.0]
  return Math.max(0.1, Math.min(3.0, rating));
}
