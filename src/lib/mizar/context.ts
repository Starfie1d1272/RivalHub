import { assertCompetitionMatch } from "@/lib/matches/competition-context";
import "server-only";
import { recordMizarFullBuild } from "@/lib/observability/read-budget";
import { createHash } from "node:crypto";
import { and, eq, asc, gte, lte, inArray, isNull, or } from "drizzle-orm";
import { db, type TxDb } from "@/db/client";
import { matches, seasons, competitionEntries, matchMaps, matchVetoSteps, matchCommentators, users, steamProfiles } from "@/db/schema";
import { loadEffectiveMatchRoster } from "@/lib/match-rosters/effective";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { normalizeRegistrationConfig, normalizeStagePlan } from "@/lib/seasons/compatibility";
import { AppError, ErrorCode } from "@/lib/errors";

export const documentRevision = (document: unknown) => createHash("sha256").update(JSON.stringify(document)).digest("hex");
const iso = (date: Date | null) => date?.toISOString() ?? null;

const matchFields = {
  id: matches.id, seasonId: matches.seasonId, entryAId: matches.entryAId, entryBId: matches.entryBId,
  status: matches.status, format: matches.format, testConfig: matches.testConfig, resultDisposition: matches.resultDisposition,
  stage: matches.stage, qualificationRunId: matches.qualificationRunId, round: matches.round, entryRound: matches.entryRound,
  scheduledAt: matches.scheduledAt, startedAt: matches.startedAt, completedAt: matches.completedAt,
  scoreA: matches.scoreA, scoreB: matches.scoreB, isForfeit: matches.isForfeit,
};
const entrantFields = { entryId: competitionEntries.id, name: competitionEntries.name, logoUrl: competitionEntries.logoUrl };

async function loadCompetitionInTx(tx: TxDb, competitionId: string) {
  const [season] = await tx.select({ id: seasons.id, slug: seasons.slug, name: seasons.name, logoUrl: seasons.logoUrl, themeColor: seasons.themeColor, stagePlan: seasons.stagePlan, registrationConfig: seasons.registrationConfig }).from(seasons).where(eq(seasons.id, competitionId));
  if (!season) throw new AppError(ErrorCode.NOT_FOUND, "赛事不存在。");
  return season;
}
function competition(season: Awaited<ReturnType<typeof loadCompetitionInTx>>) {
  return { competitionId: season.id, slug: season.slug, name: season.name, logoUrl: season.logoUrl, themeColor: season.themeColor };
}
function matchContext(match: Pick<typeof matches.$inferSelect, keyof typeof matchFields>, season: Awaited<ReturnType<typeof loadCompetitionInTx>>) {
  const stage = normalizeStagePlan(season.stagePlan).find(stage => stage.key === match.stage);
  return {
    matchId: match.id, status: match.status, format: match.format, isTest: Boolean(match.testConfig), resultDisposition: match.resultDisposition,
    stage: match.stage, stageKey: match.stage, stageLabel: match.testConfig ? "测试赛" : match.qualificationRunId ? "PLAY-IN" : stage?.name ?? null,
    round: match.round, roundLabel: match.round === null ? null : `Round ${match.round}`,
    entryRound: match.entryRound, matchLabel: match.testConfig ? "测试赛" : null, stakesLabel: null,
    scheduledAt: iso(match.scheduledAt), startedAt: iso(match.startedAt), completedAt: iso(match.completedAt),
    scoreA: match.scoreA, scoreB: match.scoreB, isForfeit: match.isForfeit,
  };
}

async function loadExecutionFactsInTx(tx: TxDb, matchId: string) {
  const maps = await tx.select({ mapId: matchMaps.id, mapOrder: matchMaps.mapOrder, mapName: matchMaps.mapName, pickedByEntryId: matchMaps.pickedByEntryId, teamAStartSide: matchMaps.teamAStartSide, scoreA: matchMaps.scoreA, scoreB: matchMaps.scoreB, completedAt: matchMaps.completedAt }).from(matchMaps).where(eq(matchMaps.matchId, matchId)).orderBy(asc(matchMaps.mapOrder));
  const veto = await tx.select({ stepOrder: matchVetoSteps.stepOrder, actionType: matchVetoSteps.actionType, mapName: matchVetoSteps.mapName, entryId: matchVetoSteps.entryId, side: matchVetoSteps.side }).from(matchVetoSteps).where(eq(matchVetoSteps.matchId, matchId)).orderBy(asc(matchVetoSteps.stepOrder));
  const commentatorRows = await tx.select({ userId: users.id, displayName: users.displayName, perfectName: users.perfectName, personaName: steamProfiles.personaName, avatarUrl: steamProfiles.avatarUrl, liveStreamUrl: users.liveStreamUrl }).from(matchCommentators).innerJoin(users, eq(users.id, matchCommentators.userId)).leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64)).where(eq(matchCommentators.matchId, matchId)).orderBy(asc(users.id));
  return { maps: maps.map(map => ({ ...map, completedAt: iso(map.completedAt) })), veto,
    commentators: commentatorRows.map(row => ({ userId: row.userId, displayName: getPublicDisplayName(row), avatarUrl: row.avatarUrl, liveStreamUrl: row.liveStreamUrl })) };
}

/** Explicit provider DTO, independent of React/admin/internal persistence shape. */
export async function loadMizarMatchDocumentInTx(tx: TxDb, matchId: string, competitionId: string) {
  recordMizarFullBuild("match");
  const [match] = await tx.select(matchFields).from(matches).where(and(eq(matches.id, matchId), eq(matches.seasonId, competitionId)));
  if (!match) throw new AppError(ErrorCode.NOT_FOUND, "比赛不存在。");
  assertCompetitionMatch(match);
  const season = await loadCompetitionInTx(tx, competitionId);
  const players = await loadEffectiveMatchRoster(tx, [match.id], true);
  const steam64s = [...new Set(players.flatMap(player => player.steam64 ? [player.steam64] : []))];
  const profiles = steam64s.length
    ? await tx.select({ steam64: steamProfiles.steam64, avatarUrl: steamProfiles.avatarUrl }).from(steamProfiles).where(inArray(steamProfiles.steam64, steam64s))
    : [];
  const avatarBySteam64 = new Map(profiles.map(profile => [profile.steam64, profile.avatarUrl]));
  const entries = await tx.select(entrantFields).from(competitionEntries).where(inArray(competitionEntries.id, [...new Set([match.entryAId, match.entryBId])]));
  const entryById = new Map(entries.map(entry => [entry.entryId, entry]));
  const entrant = (entryId: string) => {
    const entry = entryById.get(entryId);
    if (!entry) throw new AppError(ErrorCode.NOT_FOUND, "参赛队伍不存在。");
    const roster = players.filter(player => player.entryId === entryId);
    const identities = roster.map(player => ({ playerId: player.userId, steam64: player.steam64, displayName: getPublicDisplayName(player), avatarUrl: player.steam64 ? avatarBySteam64.get(player.steam64) ?? null : null, isStarter: player.isStarter }));
    return { ...entry, roster: { rosterId: roster[0]?.rosterId ?? null, players: identities } };
  };
  const a = entrant(match.entryAId);
  const b = entrant(match.entryBId);
  const execution = await loadExecutionFactsInTx(tx, match.id);
  const payload = {
    schemaVersion: "rivalhub.broadcast-manifest.v1" as const,
    match: { ...matchContext(match, season), competition: competition(season), mapPool: match.testConfig?.mapPool ?? normalizeRegistrationConfig(season.registrationConfig).mapPool },
    entrants: { a, b }, ...execution,
  };
  return { ...payload, revision: documentRevision(payload) };
}

export const loadMizarMatchDocument = (matchId: string, competitionId: string) => db.transaction(tx => loadMizarMatchDocumentInTx(tx, matchId, competitionId), { isolationLevel: "repeatable read", accessMode: "read only" });

/** viewerUserId is the authenticated installation authorizer, never a client-selected identity. */
export async function loadMizarScheduleWindow(competitionId: string, from: Date, to: Date, viewerUserId?: string) {
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from || to.getTime() - from.getTime() > 31 * 86400_000) throw new AppError(ErrorCode.VALIDATION_FAILED, "请选择不超过一个月的赛程窗口。");
  return db.transaction(async tx => {
    recordMizarFullBuild("schedule");
    const season = await loadCompetitionInTx(tx, competitionId);
    const rows = await tx.select(matchFields).from(matches).where(and(eq(matches.seasonId, competitionId), or(isNull(matches.scheduledAt), and(gte(matches.scheduledAt, from), lte(matches.scheduledAt, to))))).orderBy(asc(matches.scheduledAt), asc(matches.id)).limit(501);
    if (rows.length > 500) throw new AppError(ErrorCode.VALIDATION_FAILED, "赛程窗口过大，请缩小日期范围。");
    const entryIds = new Set<string>();
    for (const match of rows) {
      assertCompetitionMatch(match);
      entryIds.add(match.entryAId);
      entryIds.add(match.entryBId);
    }
    const entrants = entryIds.size
      ? await tx.select(entrantFields).from(competitionEntries).where(inArray(competitionEntries.id, [...entryIds]))
      : [];
    const entryById = new Map(entrants.map(entry => [entry.entryId, entry]));
    // One batch keeps the public identity and commentary assignments in this
    // repeatable-read snapshot, independent of the number of schedule rows.
    const viewerRows = viewerUserId === undefined ? [] : await tx.select({
      userId: users.id, displayName: users.displayName, perfectName: users.perfectName,
      personaName: steamProfiles.personaName, matchId: matchCommentators.matchId,
    }).from(users)
      .leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
      .leftJoin(matchCommentators, and(eq(matchCommentators.userId, users.id), inArray(matchCommentators.matchId, rows.map(match => match.id))))
      .where(eq(users.id, viewerUserId));
    const viewerRow = viewerRows[0];
    if (viewerUserId !== undefined && !viewerRow) throw new AppError(ErrorCode.FORBIDDEN, "制播设备授权账号不存在。");
    const viewer = viewerRow ? { userId: viewerRow.userId, displayName: getPublicDisplayName(viewerRow) } : undefined;
    const assignedMatchIds = new Set(viewerRows.flatMap(row => row.matchId ? [row.matchId] : []));
    const result = [];
    for (const match of rows) {
      assertCompetitionMatch(match);
      const { stageKey: _stageKey, entryRound: _entryRound, stakesLabel: _stakesLabel, ...context } = matchContext(match, season);
      void _stageKey; void _entryRound; void _stakesLabel;
      result.push({ ...context, entrantA: entryById.get(match.entryAId)!, entrantB: entryById.get(match.entryBId)!, ...(viewer ? { assignedToViewer: assignedMatchIds.has(match.id) } : {}) });
    }
    const payload = { schemaVersion: "rivalhub.broadcast-schedule-window.v1" as const, competition: competition(season), from: from.toISOString(), to: to.toISOString(), matches: result, ...(viewer ? { viewer } : {}) };
    return { ...payload, revision: documentRevision(payload) };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

/** Internal provider adapter. A future transport must authorize this exact match before calling. */
export async function loadUnassociatedMizarDocumentInTx(tx: TxDb, matchId: string) {
  recordMizarFullBuild("match");
  const [match] = await tx.select({
    id: matches.id, executionContext: matches.executionContext, resultDisposition: matches.resultDisposition,
    status: matches.status, format: matches.format, scheduledAt: matches.scheduledAt,
    startedAt: matches.startedAt, completedAt: matches.completedAt,
    scoreA: matches.scoreA, scoreB: matches.scoreB, isForfeit: matches.isForfeit,
  }).from(matches).where(and(eq(matches.id, matchId), isNull(matches.seasonId)));
  if (!match?.executionContext) throw new AppError(ErrorCode.NOT_FOUND, "独立比赛不存在。");
  const execution = await loadExecutionFactsInTx(tx, match.id);
  const context = match.executionContext;
  const side = (position: "a" | "b") => ({
    entryId: `${match.id}:${position}`,
    ...context.sides[position],
    roster: { rosterId: null, players: [] },
  });
  const payload = {
    schemaVersion: "rivalhub.broadcast-manifest.v2" as const,
    match: {
      matchId: match.id, resultDisposition: match.resultDisposition, competition: null, status: match.status, format: match.format,
      stage: null, stageKey: null, stageLabel: null, round: null, entryRound: null,
      scheduledAt: iso(match.scheduledAt), startedAt: iso(match.startedAt), completedAt: iso(match.completedAt),
      scoreA: match.scoreA, scoreB: match.scoreB, isForfeit: match.isForfeit,
      mapPool: match.executionContext.mapPool,
    },
    entrants: { a: side("a"), b: side("b") }, ...execution,
  };
  return { ...payload, revision: documentRevision(payload) };
}
