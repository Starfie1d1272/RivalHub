import type { PlayerStatsDraft } from "@/actions/player-stats";

export type ScoreboardDraft = PlayerStatsDraft & { gameplayLocked?: boolean };

/** Only an already resolved user identity can automatically join Demo facts. */
export function mergeScreenshotDrafts(incoming: PlayerStatsDraft[], canonical: ScoreboardDraft[]): ScoreboardDraft[] {
  const locked = canonical.filter(row => row.gameplayLocked);
  const consumed = new Set<string>();
  const rows = incoming.map(row => {
    const prior = row.userId ? locked.find(saved => saved.userId === row.userId) : undefined;
    if (!prior) return row;
    consumed.add(row.userId!);
    return enrichDraft(prior, row);
  });
  return rows.concat(locked.filter(row => !row.userId || !consumed.has(row.userId)));
}

function enrichDraft(target: ScoreboardDraft, incoming: PlayerStatsDraft): ScoreboardDraft {
  return { ...target, ratingPro: incoming.ratingPro ?? target.ratingPro, rws: incoming.rws ?? target.rws, we: incoming.we ?? target.we };
}

/** Explicitly consume an unresolved OCR row into the selected Demo row. */
export function assignScreenshotPlayer(rows: ScoreboardDraft[], index: number, player: { userId: string; perfectName: string } | null): ScoreboardDraft[] {
  const source = rows[index];
  if (!source || source.gameplayLocked) return rows;
  const targetIndex = player ? rows.findIndex((row, i) => i !== index && row.userId === player.userId) : -1;
  if (targetIndex >= 0) {
    const target = rows[targetIndex]!;
    if (source.userId !== null || !target.gameplayLocked) return rows;
    return rows.flatMap((row, i) => i === index ? [] : [i === targetIndex ? enrichDraft(target, source) : row]);
  }
  return rows.map((row, i) => i === index ? { ...row, userId: player?.userId ?? null, ...(player ? { perfectName: player.perfectName } : {}) } : row);
}
