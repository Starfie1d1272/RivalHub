export interface EconomyRow {
  roundNumber: number;
  teamKey: string | null;
  equipmentValue: number | null;
  /** Player-level economy classification (pistol/eco/force/semi/full) */
  type: string | null;
}

/** Round-level economy type per team (from demoRounds) */
export interface RoundEconomyType {
  roundNumber: number;
  teamAEconomy: string | null;
  teamBEconomy: string | null;
}

export interface EconomySeriesPoint {
  roundNumber: number;
  teamA: number;
  teamB: number;
  /** Round-level economy classification for Team A */
  teamAEconomy: string | null;
  /** Round-level economy classification for Team B */
  teamBEconomy: string | null;
}

const ECONOMY_COLORS: Record<string, string> = {
  full: "rgba(34,197,94,0.08)",    // green
  semi: "rgba(234,179,8,0.06)",     // yellow
  force: "rgba(234,179,8,0.10)",    // yellow darker
  eco: "rgba(239,68,68,0.08)",      // red
  pistol: "rgba(99,102,241,0.06)",  // indigo
};

/** Get background color for an economy type string */
export function getEconomyBgColor(type: string | null): string {
  if (!type) return "transparent";
  return ECONOMY_COLORS[type.toLowerCase()] ?? "transparent";
}

/** Human-readable label for economy types */
export function getEconomyLabel(type: string | null): string {
  if (!type) return "";
  const labels: Record<string, string> = {
    full: "Full Buy",
    semi: "Semi Buy",
    force: "Force Buy",
    eco: "Eco",
    pistol: "Pistol",
  };
  return labels[type.toLowerCase()] ?? type;
}

/**
 * 按 roundNumber 分组，各队 equipmentValue 求和。
 * 缺侧补 0。可选传入 round-level 经济类型（来自 demoRounds）。
 * 产出 { roundNumber, teamA, teamB, teamAEconomy, teamBEconomy }[] 按 roundNumber 升序。
 */
export function buildEconomySeries(
  rows: EconomyRow[],
  roundTypes?: RoundEconomyType[],
): EconomySeriesPoint[] {
  const map = new Map<number, EconomySeriesPoint>();

  // 先初始化每回合经济类型
  if (roundTypes) {
    for (const rt of roundTypes) {
      map.set(rt.roundNumber, {
        roundNumber: rt.roundNumber,
        teamA: 0,
        teamB: 0,
        teamAEconomy: rt.teamAEconomy,
        teamBEconomy: rt.teamBEconomy,
      });
    }
  }

  // 再填充装备价值
  for (const row of rows) {
    let entry = map.get(row.roundNumber);
    if (!entry) {
      entry = {
        roundNumber: row.roundNumber,
        teamA: 0,
        teamB: 0,
        teamAEconomy: null,
        teamBEconomy: null,
      };
      map.set(row.roundNumber, entry);
    }
    if (row.teamKey === "teamA") {
      entry.teamA += row.equipmentValue ?? 0;
    } else if (row.teamKey === "teamB") {
      entry.teamB += row.equipmentValue ?? 0;
    }
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a - b)
    .map(([, v]) => v);
}
