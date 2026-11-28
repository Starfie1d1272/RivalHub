import "server-only";
import { createHash } from "node:crypto";
import { ZodError } from "zod";
import { and, asc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { db } from "@/db/client";
import {
  eventRosterMembers,
  eventRosters,
  matches,
  matchLiveSessions,
  matchMaps,
  matchVetoSessions,
  mizarReliableReceipts,
  users,
} from "@/db/schema";
import { mizarAuditActorId } from "@/lib/audit/people";
import { writeAuditInTx } from "@/lib/audit/write";
import { ErrorCode } from "@/lib/errors";
import { getDisplayName } from "@/lib/identity/display-name";
import { loadEffectiveMatchRoster } from "@/lib/match-rosters/effective";
import { applyMatchStatusTransitionInTx } from "@/lib/matches/lifecycle";
import { lockCompetitionMatchInTx as lockMatchInTx } from "@/lib/matches/locking";
import { startCanonicalMapInTx } from "@/lib/matches/map-start";
import { recordCanonicalMapResultInTx } from "@/lib/matches/results";
import { beginRuntimeResource } from "@/lib/observability/runtime-resources";
import { touchMizarInstallation } from "./heartbeat";
import { assertInstallationInTx, hashCredential } from "./installation";
import { LINEUP_REVIEW_REQUIRED } from "./lineup-display";
import { parseReliableEventV2 } from "./protocol-v2";
import { ReliableRejection } from "./rejection";
import { validateObservedLineupInTx } from "./source";

const LATE_SUBMISSION_WINDOW_MS = 24 * 60 * 60 * 1000;

export type ReliableV2Outcome =
  "accepted" | "canonicalized" | "canonicalized_with_warning" | "consistent" | "needs_attention";

export type ReliableV2Warning =
  | "lineup_mismatch"
  | "result_conflict"
  | "manual_takeover"
  | "map_not_found"
  | "veto_incomplete"
  | "series_mismatch";

export interface ReliableV2Result {
  outcome: ReliableV2Outcome;
  duplicate: boolean;
  warning?: ReliableV2Warning;
}

export async function ingestMizarReliableV2(
  installationId: string,
  competitionId: string,
  input: unknown,
): Promise<ReliableV2Result> {
  let event: ReturnType<typeof parseReliableEventV2>;
  try {
    event = parseReliableEventV2(input);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ReliableRejection(
        ErrorCode.VALIDATION_FAILED,
        "制播数据格式无效，请刷新比赛资料并更新 Mizar 后重试。",
        "invalid_schema",
      );
    }
    throw error;
  }

  if (event.competitionId !== competitionId) {
    throw new ReliableRejection(
      ErrorCode.FORBIDDEN,
      "制播数据不属于当前连接。",
      "authority_changed",
    );
  }

  const finishResource = beginRuntimeResource("mizar.reliable");
  try {
    const result = await db.transaction(async (tx): Promise<ReliableV2Result> => {
      await assertInstallationInTx(tx, installationId, competitionId);
      const match = await lockMatchInTx(tx, event.matchId);
      if (
        match.seasonId !== competitionId ||
        match.entryAId !== event.entryAId ||
        match.entryBId !== event.entryBId
      ) {
        throw new ReliableRejection(
          ErrorCode.FORBIDDEN,
          "当前数据源或比赛资料已经变化，请重新连接。",
          "authority_changed",
        );
      }

      const [source] = await tx
        .select()
        .from(matchLiveSessions)
        .where(
          and(
            eq(matchLiveSessions.matchId, match.id),
            eq(matchLiveSessions.installationId, installationId),
            eq(matchLiveSessions.producerInstanceId, event.session.producerInstanceId),
            eq(matchLiveSessions.liveSessionId, event.session.liveSessionId),
            eq(matchLiveSessions.authorityRevision, event.session.authorityRevision),
          ),
        )
        .for("update");

      if (!source) {
        throw new ReliableRejection(
          ErrorCode.FORBIDDEN,
          "当前数据源或比赛资料已经变化，请重新连接。",
          "authority_changed",
        );
      }

      const allowsClosedSession = event.kind === "map_ended" || event.kind === "series_ended";
      if (source.closedAt !== null) {
        if (!allowsClosedSession) {
          throw new ReliableRejection(
            ErrorCode.FORBIDDEN,
            "当前数据源或比赛资料已经变化，请重新连接。",
            "authority_changed",
          );
        }
        const within24h = Date.now() - source.closedAt.getTime() <= LATE_SUBMISSION_WINDOW_MS;
        if (!within24h || source.closeReason === "revoked") {
          throw new ReliableRejection(
            ErrorCode.FORBIDDEN,
            "当前数据源或比赛资料已经变化，请重新连接。",
            "authority_changed",
          );
        }
        const [otherActive] = await tx
          .select({ id: matchLiveSessions.id })
          .from(matchLiveSessions)
          .where(
            and(
              eq(matchLiveSessions.matchId, match.id),
              isNull(matchLiveSessions.closedAt),
              ne(matchLiveSessions.installationId, installationId),
            ),
          )
          .limit(1);
        if (otherActive) {
          throw new ReliableRejection(
            ErrorCode.FORBIDDEN,
            "当前数据源或比赛资料已经变化，请重新连接。",
            "authority_changed",
          );
        }
      }

      const details = {
        kind: event.kind,
        scopeHash: createHash("sha256").update(match.id).digest("hex").slice(0, 16),
      };
      const eventHash = hashCredential(JSON.stringify(event));
      const [receipt] = await tx
        .select()
        .from(mizarReliableReceipts)
        .where(
          and(
            eq(mizarReliableReceipts.sessionId, source.id),
            eq(mizarReliableReceipts.idempotencyKey, event.idempotencyKey),
          ),
        );
      if (receipt) {
        if (receipt.eventHash !== eventHash) {
          throw new ReliableRejection(
            ErrorCode.VALIDATION_FAILED,
            "重复事件内容冲突。",
            "idempotency_conflict",
            details,
          );
        }
        return { outcome: receipt.outcome as ReliableV2Outcome, duplicate: true };
      }

      const now = new Date();
      let outcome: ReliableV2Outcome = "accepted";
      let warning: ReliableV2Warning | undefined;
      let lineupDifference: {
        missing: { name: string; userId: string; steam64: string | null }[];
        unexpected: string[];
        duplicated: string[];
      } | null = null;
      const updates: Partial<typeof matchLiveSessions.$inferInsert> = {
        lastReliableEventAt: now,
      };

      if (event.kind === "match_started") {
        if (match.status === "scheduled") {
          await applyMatchStatusTransitionInTx(tx, {
            matchId: match.id,
            nextStatus: "in_progress",
            actorId: mizarAuditActorId(installationId),
            now,
          });
          outcome = "canonicalized";
        } else {
          outcome = "accepted";
        }
      } else if (event.kind === "map_started") {
        const maps = await tx
          .select()
          .from(matchMaps)
          .where(eq(matchMaps.matchId, match.id))
          .orderBy(asc(matchMaps.mapOrder));
        const candidates = maps.filter((m) => {
          if (m.completedAt !== null) return false;
          if (event.mapId !== null) {
            return m.id === event.mapId && (event.mapName === null || m.mapName === event.mapName);
          }
          return event.mapName !== null && m.mapName === event.mapName;
        });
        if (candidates.length === 1) {
          const targetMap = candidates[0]!;
          updates.currentMapId = targetMap.id;
          updates.mapExecutionPhase = "gameplay";
          const veto = await tx.query.matchVetoSessions.findFirst({
            where: eq(matchVetoSessions.matchId, match.id),
            columns: { completedAt: true },
          });
          if (match.status === "in_progress" && veto?.completedAt) {
            await startCanonicalMapInTx(
              tx,
              match.id,
              targetMap.id,
              mizarAuditActorId(installationId),
              { allowUnobservedPriorMaps: true },
            );
          }
        }
        outcome = "accepted";
      } else if (event.kind === "map_ended") {
        const maps = await tx
          .select()
          .from(matchMaps)
          .where(eq(matchMaps.matchId, match.id))
          .orderBy(asc(matchMaps.mapOrder));
        const targetMap =
          event.mapId !== null
            ? maps.find((m) => m.id === event.mapId)
            : event.mapName !== null
              ? (() => {
                  const byName = maps.filter((m) => m.mapName === event.mapName);
                  return byName.length === 1
                    ? byName[0]
                    : byName.find((m) => m.completedAt === null);
                })()
              : undefined;

        if (!targetMap) {
          outcome = "needs_attention";
          warning = "map_not_found";
        } else {
          const veto = await tx.query.matchVetoSessions.findFirst({
            where: eq(matchVetoSessions.matchId, match.id),
            columns: { completedAt: true },
          });
          if (!veto?.completedAt) {
            outcome = "needs_attention";
            warning = "veto_incomplete";
          } else if (targetMap.completedAt !== null) {
            if (
              targetMap.scoreA === event.payload.scoreA &&
              targetMap.scoreB === event.payload.scoreB
            ) {
              outcome = "consistent";
            } else {
              updates.continuityHealth = "result_conflict";
              outcome = "needs_attention";
              warning = "result_conflict";
            }
          } else if (
            source.manualTakeoverMapEpoch !== null &&
            source.manualTakeoverMapEpoch === source.mapEpoch
          ) {
            outcome = "needs_attention";
            warning = "manual_takeover";
          } else {
            const roster = await loadEffectiveMatchRoster(tx, [match.id]);
            const observed = event.payload.lineupSteam64;
            const hasTenUnique = observed.length === 10 && new Set(observed).size === 10;
            const lineupValid = hasTenUnique
              ? await validateObservedLineupInTx(tx, match, observed)
              : false;

            let canCanonicalize = lineupValid;
            if (!lineupValid) {
              const expectedPlayers = roster.filter((player) => player.isStarter);
              lineupDifference = expectedPlayers.length
                ? {
                    missing: expectedPlayers
                      .filter((player) => !player.steam64 || !observed.includes(player.steam64))
                      .map((player) => ({
                        name: getDisplayName(player),
                        userId: player.userId,
                        steam64: player.steam64,
                      })),
                    unexpected: observed.filter(
                      (id) => !expectedPlayers.some((player) => player.steam64 === id),
                    ),
                    duplicated: [
                      ...new Set(observed.filter((id, index) => observed.indexOf(id) !== index)),
                    ],
                  }
                : null;

              if (hasTenUnique) {
                const registered = await tx
                  .select({
                    entryId: eventRosters.entryId,
                    steam64: users.steam64,
                  })
                  .from(eventRosterMembers)
                  .innerJoin(eventRosters, eq(eventRosters.id, eventRosterMembers.eventRosterId))
                  .innerJoin(users, eq(users.id, eventRosterMembers.userId))
                  .where(
                    and(
                      inArray(eventRosters.entryId, [match.entryAId, match.entryBId]),
                      eq(eventRosterMembers.isCurrent, true),
                      isNotNull(users.steam64),
                    ),
                  );
                const teamASteam64s = new Set(
                  registered
                    .filter((r) => r.entryId === match.entryAId && r.steam64)
                    .map((r) => r.steam64!),
                );
                const teamBSteam64s = new Set(
                  registered
                    .filter((r) => r.entryId === match.entryBId && r.steam64)
                    .map((r) => r.steam64!),
                );
                const teamACount = observed.filter(
                  (id) => teamASteam64s.has(id) && !teamBSteam64s.has(id),
                ).length;
                const teamBCount = observed.filter(
                  (id) => teamBSteam64s.has(id) && !teamASteam64s.has(id),
                ).length;
                if (teamACount === 5 && teamBCount === 5) {
                  canCanonicalize = true;
                }
              }
            }

            if (!canCanonicalize) {
              updates.lineupHealth = "conflict";
              outcome = "needs_attention";
              warning = "lineup_mismatch";
            } else {
              if (match.status === "scheduled") {
                await applyMatchStatusTransitionInTx(tx, {
                  matchId: match.id,
                  nextStatus: "in_progress",
                  actorId: mizarAuditActorId(installationId),
                  now,
                });
              }
              await recordCanonicalMapResultInTx(tx, {
                matchId: match.id,
                mapOrder: targetMap.mapOrder,
                mapName: targetMap.mapName,
                scoreA: event.payload.scoreA,
                scoreB: event.payload.scoreB,
                pickedByEntryId: null,
                teamAStartSide: null,
                actorId: mizarAuditActorId(installationId),
              });
              updates.mapExecutionPhase = "inter_map";

              if (event.payload.players?.length) {
                const players = event.payload.players.flatMap((player) => {
                  const candidates = roster.filter(
                    (r) =>
                      r.steam64 === player.sourcePlayerId &&
                      (player.canonicalPlayerId === null || r.userId === player.canonicalPlayerId),
                  );
                  if (candidates.length !== 1) return [];
                  const resolved = candidates[0]!;
                  return [
                    {
                      userId: resolved.userId,
                      name: getDisplayName(resolved),
                      kills: player.kills,
                      deaths: player.deaths,
                      assists: player.assists,
                    },
                  ];
                });
                if (
                  players.length &&
                  new Set(players.map((p) => p.userId)).size === players.length
                ) {
                  await tx
                    .update(matchMaps)
                    .set({ provisionalPlayers: players })
                    .where(eq(matchMaps.id, targetMap.id));
                }
              }

              if (lineupValid) {
                updates.lineupHealth = "healthy";
                outcome = "canonicalized";
              } else {
                updates.lineupHealth = LINEUP_REVIEW_REQUIRED;
                outcome = "canonicalized_with_warning";
                warning = "lineup_mismatch";
              }
            }
          }
        }
      } else if (event.kind === "series_ended") {
        const [current] = await tx.select().from(matches).where(eq(matches.id, match.id));
        if (
          current &&
          current.status === "finished" &&
          current.scoreA === event.payload.scoreA &&
          current.scoreB === event.payload.scoreB
        ) {
          outcome = "consistent";
        } else {
          updates.continuityHealth = "result_conflict";
          outcome = "needs_attention";
          warning = "series_mismatch";
        }
      }

      await tx.update(matchLiveSessions).set(updates).where(eq(matchLiveSessions.id, source.id));
      await tx.insert(mizarReliableReceipts).values({
        sessionId: source.id,
        idempotencyKey: event.idempotencyKey,
        eventHash,
        kind: event.kind,
        outcome,
      });
      await writeAuditInTx(tx, {
        seasonId: competitionId,
        actorId: mizarAuditActorId(installationId),
        action: "mizar.reliable.accept",
        targetId: match.id,
        meta: {
          schemaVersion: event.schemaVersion,
          kind: event.kind,
          outcome,
          ...(warning ? { warning } : {}),
          lineupDifference,
          sessionId: source.id,
          currentMapId:
            updates.currentMapId === undefined ? source.currentMapId : updates.currentMapId,
          receivedMapId: event.mapId,
          receivedMapName: event.mapName,
          continuityHealth: updates.continuityHealth ?? source.continuityHealth,
          ...(event.kind === "map_ended"
            ? {
                scoreA: event.payload.scoreA,
                scoreB: event.payload.scoreB,
                scoreCT: event.payload.scoreCT,
                scoreT: event.payload.scoreT,
              }
            : {}),
        },
      });

      return { outcome, duplicate: false, ...(warning ? { warning } : {}) };
    });

    await touchMizarInstallation(installationId, competitionId);
    return result;
  } finally {
    finishResource();
  }
}
