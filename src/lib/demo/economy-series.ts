export interface EconomyRow {
  roundNumber: number;
  teamKey: string | null;
  equipmentValue: number | null;
}

export interface EconomySeriesPoint {
  roundNumber: number;
  teamA: number;
  teamB: number;
}

/**
 * 按 roundNumber 分组，各队 equipmentValue 求和。
 * 缺侧补 0。产出 { roundNumber, teamA, teamB }[] 按 roundNumber 升序。
 */
export function buildEconomySeries(
  rows: EconomyRow[],
): EconomySeriesPoint[] {
  const map = new Map<number, { teamA: number; teamB: number }>();

  for (const row of rows) {
    let entry = map.get(row.roundNumber);
    if (!entry) {
      entry = { teamA: 0, teamB: 0 };
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
    .map(([roundNumber, v]) => ({
      roundNumber,
      teamA: v.teamA,
      teamB: v.teamB,
    }));
}
