import type { PublicPlayerIdentity } from "@/lib/identity/public-player";
import type { PlayerAttributeKey, PlayerAttributeProjection } from "@/lib/stats/player-attributes";

export interface LineupStyleMember extends PublicPlayerIdentity {
  maps: number;
  rounds: number;
  attributes: Pick<PlayerAttributeProjection, "key" | "score" | "status">[];
}

export const LINEUP_STYLE_CHARTS = [
  { key: "firepower-utility", title: "Star Chart", x: "firepower", y: "utility", xLabel: "Firepower", yLabel: "Utility", corners: ["Support", "Both", "Neither", "Star"] },
  { key: "opening-clutching", title: "Aggression Chart", x: "opening", y: "clutching", xLabel: "Opening", yLabel: "Clutching", corners: ["Passive", "Both", "Neither", "Aggro"] },
  { key: "entrying-trading", title: "Trading Chart", x: "entrying", y: "trading", xLabel: "Entrying", yLabel: "Trading", corners: ["Crow", "Pack", "Loner", "Lamb"] },
] as const;

export interface LineupStylePoint extends PublicPlayerIdentity {
  maps: number;
  rounds: number;
  x: number;
  y: number;
  limited: boolean;
}

/** Selection is independent for each pair, including qualification and missing coordinates. */
export function selectLineupStylePoints(members: readonly LineupStyleMember[], xKey: PlayerAttributeKey, yKey: PlayerAttributeKey): LineupStylePoint[] {
  const points = members.flatMap((member): LineupStylePoint[] => {
    const x = member.attributes.find((attribute) => attribute.key === xKey);
    const y = member.attributes.find((attribute) => attribute.key === yKey);
    if (!x || !y || x.status === "no-data" || y.status === "no-data"
      || x.score == null || y.score == null || !Number.isFinite(x.score) || !Number.isFinite(y.score)
      || x.score < 0 || x.score > 100 || y.score < 0 || y.score > 100) return [];
    return [{ userId: member.userId, name: member.name, avatarUrl: member.avatarUrl, maps: member.maps, rounds: member.rounds,
      x: x.score, y: y.score, limited: x.status === "limited" || y.status === "limited" }];
  }).sort((a, b) => b.maps - a.maps || b.rounds - a.rounds || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  const qualified = points.filter((point) => !point.limited);
  const limited = points.filter((point) => point.limited);
  let selected: LineupStylePoint[];
  if (qualified.length >= 5) selected = qualified.filter((point, index) => index < 5 || point.maps >= qualified[4].maps * 0.8);
  else if (qualified.length >= 3) selected = qualified;
  else if (qualified.length > 0) selected = [...qualified, ...limited.slice(0, 3 - qualified.length)];
  else selected = limited.slice(0, 5);
  return selected.length >= 3 ? selected : [];
}

/** Outward rounded true-score domain; a minimum span keeps tied points readable. */
export function lineupStyleAxis(values: readonly number[]) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max(5, (max - min) * 0.1);
  const low = Math.max(0, Math.floor((min - padding) / 5) * 5);
  const high = Math.min(100, Math.ceil((max + padding) / 5) * 5);
  const step = high - low > 40 ? 20 : high - low > 20 ? 10 : 5;
  const ticks = [low];
  for (let tick = Math.ceil((low + 1) / step) * step; tick < high; tick += step) {
    if (tick - low >= step * 0.6 && high - tick >= step * 0.6) ticks.push(tick);
  }
  ticks.push(high);
  return { min: low, max: high, ticks };
}
