import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { matchLiveSessions, mizarInstallations, matchVetoSessions, matchRosters, matchMaps, matches, matchRosterPlayers, eventRosterMembers, users } from "@/db/schema";
import { canConfirmMapScoreboard } from "./map-scoreboard";
import { deriveMatchPresentationPhase, MATCH_PHASE_LABELS } from "./runtime-presentation";

export async function loadMatchRuntimePresentation(matchId: string) {
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
  if (!match) return null;
  const [veto, rosters, maps, bindings] = await Promise.all([
    db.select().from(matchVetoSessions).where(eq(matchVetoSessions.matchId, matchId)),
    db.select({ entryId: matchRosters.entryId }).from(matchRosters).where(eq(matchRosters.matchId, matchId)),
    db.select({ id: matchMaps.id, scoreA: matchMaps.scoreA, scoreB: matchMaps.scoreB }).from(matchMaps).where(eq(matchMaps.matchId, matchId)),
    db.select({ currentMapId: matchLiveSessions.currentMapId, phase: matchLiveSessions.mapExecutionPhase, identity: matchLiveSessions.identityHealth, lineup: matchLiveSessions.lineupHealth, continuity: matchLiveSessions.continuityHealth, armed: matchLiveSessions.autoCanonicalizationArmed, lastSeenAt: matchLiveSessions.lastReliableEventAt, deviceName: users.displayName }).from(matchLiveSessions).innerJoin(mizarInstallations, eq(mizarInstallations.id, matchLiveSessions.installationId)).innerJoin(users, eq(users.id, mizarInstallations.authorizedByUserId)).where(and(eq(matchLiveSessions.matchId, matchId), isNull(matchLiveSessions.closedAt))),
  ]);
  const representatives = await db.select({ userId: eventRosterMembers.userId }).from(matchRosterPlayers).innerJoin(matchRosters, eq(matchRosters.id, matchRosterPlayers.rosterId)).innerJoin(eventRosterMembers, eq(eventRosterMembers.id, matchRosterPlayers.eventRosterMemberId)).where(and(eq(matchRosters.matchId, matchId), eq(matchRosterPlayers.isStarter, true), eq(matchRosterPlayers.isVetoRepresentative, true)));
  const source = bindings[0];
  const needsAttention = Boolean(source && [source.identity, source.lineup, source.continuity].some(health => health === "conflict"));
  const lineupsReady = [match.entryAId, match.entryBId].every(id => rosters.some(roster => roster.entryId === id));
  const phase = deriveMatchPresentationPhase({ status: match.status, lineupsReady, vetoStarted: Boolean(veto[0]?.startedAt || match.startedAt), vetoCompleted: Boolean(veto[0]?.completedAt), completedMaps: maps.filter(canConfirmMapScoreboard).length, currentMapCompleted: Boolean(source?.currentMapId && maps.some(map => map.id === source.currentMapId && canConfirmMapScoreboard(map))), mapExecution: source?.phase === "gameplay" || source?.phase === "inter_map" ? source.phase : "waiting" });
  return { phase, phaseLabel: MATCH_PHASE_LABELS[phase], lineupsReady, needsAttention, bpRepresentativeUserIds: representatives.map(row => row.userId), source: source ? { deviceName: source.deviceName?.trim() || "未设置显示名的管理员", label: needsAttention ? "需要处理" : source.armed ? "数据源已连接" : "本图由人工处理", lastSeenAt: source.lastSeenAt } : null };
}
