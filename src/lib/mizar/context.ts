import "server-only";
import { createHash } from "node:crypto";
import { and, eq, asc, gte, lte, isNull, or } from "drizzle-orm";
import { db, type TxDb } from "@/db/client";
import { matches, seasons, competitionEntries, matchMaps, matchVetoSteps, matchCommentators, users, steamProfiles } from "@/db/schema";
import { loadEffectiveMatchRoster } from "@/lib/match-rosters/effective";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { normalizeRegistrationConfig, normalizeStagePlan } from "@/lib/seasons/compatibility";
import { AppError, ErrorCode } from "@/lib/errors";

export const documentRevision = (document: unknown) => createHash("sha256").update(JSON.stringify(document)).digest("hex");
const iso = (date: Date | null) => date?.toISOString() ?? null;

async function loadCompetitionInTx(tx: TxDb, competitionId: string) {
  const [season] = await tx.select().from(seasons).where(eq(seasons.id, competitionId));
  if (!season) throw new AppError(ErrorCode.NOT_FOUND, "赛事不存在。");
  return season;
}
function competition(season: Awaited<ReturnType<typeof loadCompetitionInTx>>) {
  return { competitionId: season.id, slug: season.slug, name: season.name, logoUrl: season.logoUrl, themeColor: season.themeColor };
}
function matchContext(match: typeof matches.$inferSelect, season: Awaited<ReturnType<typeof loadCompetitionInTx>>) {
  const stage = normalizeStagePlan(season.stagePlan).find(stage => stage.key === match.stage);
  return {
    matchId: match.id, status: match.status, format: match.format,
    stage: match.stage, stageKey: match.stage, stageLabel: match.qualificationRunId ? "PLAY-IN" : stage?.name ?? null,
    round: match.round, roundLabel: match.round === null ? null : `Round ${match.round}`,
    entryRound: match.entryRound, matchLabel: null, stakesLabel: null,
    scheduledAt: iso(match.scheduledAt), startedAt: iso(match.startedAt), completedAt: iso(match.completedAt),
    scoreA: match.scoreA, scoreB: match.scoreB, isForfeit: match.isForfeit,
  };
}

/** Explicit provider DTO, independent of React/admin/internal persistence shape. */
export async function loadMizarMatchDocumentInTx(tx: TxDb, matchId: string, competitionId: string) {
  const [match] = await tx.select().from(matches).where(and(eq(matches.id, matchId), eq(matches.seasonId, competitionId)));
  if (!match) throw new AppError(ErrorCode.NOT_FOUND, "比赛不存在。");
  const season = await loadCompetitionInTx(tx, competitionId);
  const players = await loadEffectiveMatchRoster(tx, [match.id], true);
  const entrant = async (entryId: string) => {
    const [entry] = await tx.select({ entryId: competitionEntries.id, name: competitionEntries.name, logoUrl: competitionEntries.logoUrl }).from(competitionEntries).where(eq(competitionEntries.id, entryId));
    if (!entry) throw new AppError(ErrorCode.NOT_FOUND, "参赛队伍不存在。");
    const roster = players.filter(player => player.entryId === entryId);
    const identities = [];
    for (const player of roster) {
      const [profile] = player.steam64 ? await tx.select({ avatarUrl: steamProfiles.avatarUrl }).from(steamProfiles).where(eq(steamProfiles.steam64, player.steam64)) : [];
      identities.push({ playerId: player.userId, steam64: player.steam64, displayName: getPublicDisplayName(player), avatarUrl: profile?.avatarUrl ?? null, isStarter: player.isStarter });
    }
    return { ...entry, roster: { rosterId: roster[0]?.rosterId ?? null, players: identities } };
  };
  const a = await entrant(match.entryAId);
  const b = await entrant(match.entryBId);
  const maps = await tx.select({ mapId: matchMaps.id, mapOrder: matchMaps.mapOrder, mapName: matchMaps.mapName, pickedByEntryId: matchMaps.pickedByEntryId, teamAStartSide: matchMaps.teamAStartSide, scoreA: matchMaps.scoreA, scoreB: matchMaps.scoreB, completedAt: matchMaps.completedAt }).from(matchMaps).where(eq(matchMaps.matchId, match.id)).orderBy(asc(matchMaps.mapOrder));
  const veto = await tx.select({ stepOrder: matchVetoSteps.stepOrder, actionType: matchVetoSteps.actionType, mapName: matchVetoSteps.mapName, entryId: matchVetoSteps.entryId, side: matchVetoSteps.side }).from(matchVetoSteps).where(eq(matchVetoSteps.matchId, match.id)).orderBy(asc(matchVetoSteps.stepOrder));
  const commentatorRows = await tx.select({ userId: users.id, displayName: users.displayName, perfectName: users.perfectName, personaName: steamProfiles.personaName, avatarUrl: steamProfiles.avatarUrl, liveStreamUrl: users.liveStreamUrl }).from(matchCommentators).innerJoin(users, eq(users.id, matchCommentators.userId)).leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64)).where(eq(matchCommentators.matchId, match.id)).orderBy(asc(users.id));
  const payload = {
    schemaVersion: "rivalhub.broadcast-manifest.v1" as const,
    match: { ...matchContext(match, season), competition: competition(season), mapPool: normalizeRegistrationConfig(season.registrationConfig).mapPool },
    entrants: { a, b }, maps: maps.map(map => ({ ...map, completedAt: iso(map.completedAt) })), veto,
    commentators: commentatorRows.map(row => ({ userId: row.userId, displayName: getPublicDisplayName(row), avatarUrl: row.avatarUrl, liveStreamUrl: row.liveStreamUrl })),
  };
  return { ...payload, revision: documentRevision(payload) };
}

export const loadMizarMatchDocument = (matchId: string, competitionId: string) => db.transaction(tx => loadMizarMatchDocumentInTx(tx, matchId, competitionId), { isolationLevel: "repeatable read", accessMode: "read only" });

export async function loadMizarScheduleWindow(competitionId: string, from: Date, to: Date) {
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from || to.getTime() - from.getTime() > 31 * 86400_000) throw new AppError(ErrorCode.VALIDATION_FAILED, "请选择不超过一个月的赛程窗口。");
  return db.transaction(async tx => {
    const season = await loadCompetitionInTx(tx, competitionId);
    const rows = await tx.select().from(matches).where(and(eq(matches.seasonId, competitionId), or(isNull(matches.scheduledAt), and(gte(matches.scheduledAt, from), lte(matches.scheduledAt, to))))).orderBy(asc(matches.scheduledAt), asc(matches.id)).limit(501);
    if (rows.length > 500) throw new AppError(ErrorCode.VALIDATION_FAILED, "赛程窗口过大，请缩小日期范围。");
    const result = [];
    for (const match of rows) {
      const entrants = await tx.select({ entryId: competitionEntries.id, name: competitionEntries.name, logoUrl: competitionEntries.logoUrl }).from(competitionEntries).where(or(eq(competitionEntries.id, match.entryAId), eq(competitionEntries.id, match.entryBId)));
      const { stageKey: _stageKey, entryRound: _entryRound, stakesLabel: _stakesLabel, ...context } = matchContext(match, season);
      void _stageKey; void _entryRound; void _stakesLabel;
      result.push({ ...context, entrantA: entrants.find(entry => entry.entryId === match.entryAId)!, entrantB: entrants.find(entry => entry.entryId === match.entryBId)! });
    }
    const payload = { schemaVersion: "rivalhub.broadcast-schedule-window.v1" as const, competition: competition(season), from: from.toISOString(), to: to.toISOString(), matches: result };
    return { ...payload, revision: documentRevision(payload) };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
