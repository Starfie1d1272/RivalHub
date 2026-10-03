import { playerRowSchema } from "@/lib/ocr/types";
import { isStatOutOfRange } from "@/lib/config/stat-ranges";

const fields = ["kills", "deaths", "assists", "hsPercent", "firstKills", "multiKills", "clutches", "adr", "ratingPro", "rws", "we"] as const;
export interface ScoreboardContext {
  matchId: string;
  mapId: string;
  scoreA: number | null;
  scoreB: number | null;
  participants: readonly { userId: string; perfectName: string | null }[];
}
export type ScoreboardRow = { userId: string | null; perfectName?: string; matchId?: string; mapId?: string } & Partial<Record<typeof fields[number], number | null>>;

export function isScoreboardRoundConsistent(row: ScoreboardRow, rounds: number): boolean {
  return [row.deaths, row.firstKills, row.clutches, row.multiKills].every(value => value == null || value <= rounds)
    && (row.firstKills == null || row.kills == null || row.firstKills <= row.kills);
}

/** Checked data, not a submission flag. Missing, zero and invalid are distinct. */
export function isCompleteScoreboard(context: ScoreboardContext, rows: readonly ScoreboardRow[]): boolean {
  const participants = new Map(context.participants.map(row => [row.userId, row]));
  if (participants.size !== 10 || rows.length !== participants.size || new Set(rows.map(row => row.userId)).size !== rows.length) return false;
  if (context.scoreA === null || context.scoreB === null) return false;
  const rounds = context.scoreA + context.scoreB;
  return rows.every(row => {
    const person = row.userId ? participants.get(row.userId) : null;
    if (!person || row.mapId !== context.mapId || row.matchId !== context.matchId || !row.perfectName?.trim()) return false;
    // Frozen user identity is authoritative; mutable platform nicknames are not identity proof.
    if (!playerRowSchema.safeParse(row).success) return false;
    if (fields.some(key => row[key] == null || !Number.isFinite(row[key]) || isStatOutOfRange(key, row[key]!))) return false;
    // Hard per-round bounds only; no invented platform rating equations/tolerances.
    return isScoreboardRoundConsistent(row, rounds);
  });
}
