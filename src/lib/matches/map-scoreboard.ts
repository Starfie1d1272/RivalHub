/** An official completed map remains valid even if the series later ends by forfeit or cancellation. */
export function canConfirmMapScoreboard(map: { scoreA: number | null; scoreB: number | null; completedAt: Date | null }): boolean {
  return map.scoreA !== null && map.scoreB !== null && map.completedAt !== null;
}
