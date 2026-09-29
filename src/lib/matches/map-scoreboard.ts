/** An official map result remains valid even if the series later ends by forfeit or cancellation. */
export function canConfirmMapScoreboard(map: { scoreA: number | null; scoreB: number | null }): boolean {
  return map.scoreA !== null && map.scoreB !== null;
}
