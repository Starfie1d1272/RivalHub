import "server-only";
import { canPublishVetoAppealClosure } from "@/lib/matches/veto-room/lifecycle-publication";
import { runPredictionReconciliationJob } from "@/lib/predictions/reconciliation";

import { refreshSteamProfiles } from "@/lib/steam-profiles";
import { and, asc, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { matchVetoInvalidations, matchVetoSessions, matchVetoAppeals, matchVetoTimeoutIncidents, matchMaps, matches, seasons } from "@/db/schema";
import { maybeAdvanceFromRegistration } from "@/lib/seasons/transitions";
import { runDraftTimeoutCron } from "@/lib/draft/operations";
import { runMatchTimeAutoAwardCron } from "@/lib/matches/time-auto-award";
import { CommittedDefaultLineupsError, DefaultLineupMaterializationError } from "@/lib/matches/default-lineup-error";
import { purgeExpiredEducationEvidence } from "@/lib/education/retention";
import { ensureRegistrationOpenForParticipantInTx } from "@/lib/seasons/registration-recovery";
import { revalidateMatchPaths, revalidatePublicSeasonTags, revalidatePublicStatsTag, revalidateSeasonPaths } from "@/lib/revalidation";
import { reconcileVetoRoom } from "@/lib/matches/veto-room/service";
import { deliverVetoInvalidation } from "@/lib/matches/veto-room/invalidation";
import { settleExpiredMatchMvpVotes } from "@/lib/matches/mvp";
import { reconcileMissingStatisticsProjections } from "@/lib/stats/projection-backfill";
import type { SchedulerJobKey } from "./definitions";
import type { SchedulerRunnerResult } from "./execution";

export async function runRegistrationDeadlineJob(): Promise<SchedulerRunnerResult<{
  processed: number;
  opened: number;
  advanced: number;
  skipped: number;
}>> {
  const activeSeasons = await db
    .select({ id: seasons.id })
    .from(seasons)
    .where(eq(seasons.status, "registration"));

  let advanced = 0;
  let opened = 0;

  for (const season of activeSeasons) {
    let advancedSlug: string | null = null;
    await db.transaction(async (tx) => {
      const openResult = await ensureRegistrationOpenForParticipantInTx(tx, season.id);
      if (openResult.opened) opened += 1;
      advancedSlug = await maybeAdvanceFromRegistration(tx, season.id);
      if (advancedSlug) advanced += 1;
    });
    if (advancedSlug) {
      revalidatePublicSeasonTags(advancedSlug, season.id);
      revalidatePath(`/${advancedSlug}`);
      revalidatePath(`/admin/${advancedSlug}/registrations`);
    }
  }

  return {
    result: {
      processed: activeSeasons.length,
      opened,
      advanced,
      skipped: Math.max(0, activeSeasons.length - opened - advanced),
    },
    businessTransitions: opened + advanced,
  };
}

export async function runDraftTimeoutJob() {
  const result = await runDraftTimeoutCron((slug) => {
    revalidateSeasonPaths(slug, ["draft", "draftCaptain", "teams", "adminDraft"], { mode: "route" });
  });
  return {
    result: {
      processed: result.picked + result.skipped,
      picked: result.picked,
      skipped: result.skipped,
    },
    businessTransitions: result.picked,
  } satisfies SchedulerRunnerResult<{
    processed: number;
    picked: number;
    skipped: number;
  }>;
}

export async function runMatchTimeAutoAwardJob() {
  const result = await runMatchTimeAutoAwardCron().catch(error => {
    if (error instanceof CommittedDefaultLineupsError) {
      for (const { seasonSlug, matchId } of error.affectedMatches) {
        revalidateMatchPaths(seasonSlug, matchId, { mode: "route" });
      }
    }
    throw error;
  });
  const { affectedMatches, lineupFailures, lineupRequestId, ...summary } = result;
  for (const { seasonSlug, matchId } of affectedMatches) {
    revalidateMatchPaths(seasonSlug, matchId, { mode: "route" });
  }
  // Refresh every committed success before surfacing a partial batch failure.
  if (lineupFailures.length) throw new DefaultLineupMaterializationError(lineupFailures[0], lineupRequestId);
  return {
    result: summary,
    businessTransitions: result.awarded + result.lineups.created,
  } satisfies SchedulerRunnerResult<typeof summary>;
}

export async function runEducationEvidenceCleanupJob() {
  const cleared = await purgeExpiredEducationEvidence();
  return {
    result: { cleared },
    businessTransitions: cleared,
  } satisfies SchedulerRunnerResult<{ cleared: number }>;
}

export async function runSteamProfileRefreshJob() {
  return { result: await refreshSteamProfiles(), businessTransitions: 0 };
}

export async function runMatchVetoTimeoutJob() {
  const candidates = await db
    .select({
      matchId: matchVetoSessions.matchId,
      revision: matchVetoSessions.revision,
      seasonSlug: seasons.slug,
    })
    .from(matchVetoSessions)
    .innerJoin(matches, eq(matches.id, matchVetoSessions.matchId))
    .innerJoin(seasons, eq(seasons.id, matches.seasonId))
    .where(or(
      and(
        eq(matches.status, "in_progress"),
        isNotNull(matchVetoSessions.startedAt),
        isNull(matchVetoSessions.completedAt),
        isNull(matchVetoSessions.pausedAt),
        sql`${matchVetoSessions.turnDeadlineAt} < clock_timestamp() - interval '2 seconds'`,
      ),
      and(
        eq(matches.status, "scheduled"),
        isNull(matchVetoSessions.startedAt),
        isNull(matchVetoSessions.completedAt),
        or(isNotNull(matchVetoSessions.entryAStartRequestedAt), isNotNull(matchVetoSessions.entryBStartRequestedAt)),
        or(
          isNull(matches.scheduledAt),
          sql`${matches.scheduledAt} <= clock_timestamp() + interval '15 minutes'`,
        ),
      ),
      sql`${canPublishVetoAppealClosure()} AND EXISTS (SELECT 1 FROM ${matchVetoAppeals} appeal
        JOIN ${matchVetoTimeoutIncidents} incident ON incident.id = appeal.timeout_incident_id
        WHERE incident.match_id = ${matches.id} AND appeal.status = 'pending')
        AND (${matches.gameplayStartedAt} IS NOT NULL OR EXISTS (
          SELECT 1 FROM ${matchMaps} played_map WHERE played_map.match_id = ${matches.id}
          AND (played_map.started_at IS NOT NULL OR played_map.score_a IS NOT NULL OR played_map.score_b IS NOT NULL OR played_map.completed_at IS NOT NULL)))`,
    ));

  const pending = await db.select({ matchId: matchVetoInvalidations.matchId, generation: matchVetoInvalidations.generation })
    .from(matchVetoInvalidations)
    .where(gt(matchVetoInvalidations.generation, matchVetoInvalidations.publishedGeneration))
    .orderBy(asc(matchVetoInvalidations.updatedAt)).limit(50);
  const selectedGenerations = new Map(pending.map(row => [row.matchId, row.generation]));
  const work = new Map(candidates.map(candidate => [candidate.matchId, { matchId: candidate.matchId, lifecycleDue: true }]));
  for (const row of pending) if (!work.has(row.matchId)) work.set(row.matchId, { matchId: row.matchId, lifecycleDue: false });
  let changed = 0;
  let deliveryPending = 0;
  let firstFailure: unknown;
  for (const candidate of work.values()) {
    try {
      if (candidate.lifecycleDue && await reconcileVetoRoom(candidate.matchId) === "applied") changed += 1;
    } catch (error) { firstFailure ??= error; }
    // A lifecycle rejection does not revoke a previously committed cache duty.
    // Report the domain error, but independently attempt delivery for this room.
    try {
      // Paused/completed/archived rooms can have delivery work without an
      // ordinary domain transition. Do not run their mutation guard merely to
      // deliver already committed cache obligations.
      if (await deliverVetoInvalidation(candidate.matchId, "route") === "pending") deliveryPending += 1;
    } catch (error) { firstFailure ??= error; }
    // Only rotate a selected, still-pending generation after its delivery was
    // attempted. A newer fact or a successful acknowledgement wins the race.
    const selectedGeneration = selectedGenerations.get(candidate.matchId);
    if (selectedGeneration !== undefined) {
      try {
        await db.update(matchVetoInvalidations)
          .set({ updatedAt: sql`clock_timestamp()` })
          .where(and(eq(matchVetoInvalidations.matchId, candidate.matchId), eq(matchVetoInvalidations.generation, selectedGeneration), gt(matchVetoInvalidations.generation, matchVetoInvalidations.publishedGeneration)));
      } catch (error) { firstFailure ??= error; }
    }
  }
  // Durable work remains pending and scheduler execution/health records fail.
  // Other rooms were still allowed to recover during this invocation.
  if (firstFailure) throw firstFailure;
  return {
    result: { processed: work.size, changed, deliveryPending },
    businessTransitions: changed,
  } satisfies SchedulerRunnerResult<{ processed: number; changed: number; deliveryPending: number }>;
}

export async function runSchedulerJobByKey(key: SchedulerJobKey): Promise<SchedulerRunnerResult<unknown>> {
  switch (key) {
    case "rebuild-statistics-projections": return runStatisticsProjectionRebuildJob();
    case "settle-match-mvp": return runMatchMvpSettlementJob();
    case "reconcile-predictions": return runPredictionReconciliationJob();
    case "refresh-steam-profiles": return runSteamProfileRefreshJob();
    case "resolve-match-veto-timeouts": return runMatchVetoTimeoutJob();
    case "draft-timeout": return runDraftTimeoutJob();
    case "check-registration-deadline": return runRegistrationDeadlineJob();
    case "match-time-auto-award": return runMatchTimeAutoAwardJob();
    case "cleanup-education-evidence": return runEducationEvidenceCleanupJob();
  }
}

export async function runMatchMvpSettlementJob() {
  const { affectedMatches, failures, ...result } = await settleExpiredMatchMvpVotes();
  for (const { seasonSlug, matchId } of affectedMatches) {
    revalidateMatchPaths(seasonSlug, matchId, { mode: "route" });
  }
  // Invalidate committed successes even when another match failed. Pending
  // matches remain due, and scheduler health must report the failed batch.
  if (failures.length > 0) throw new AggregateError(failures, "MVP settlement failed");
  return { result, businessTransitions: result.settled } satisfies SchedulerRunnerResult<typeof result>;
}

export async function runStatisticsProjectionRebuildJob() {
  const result = await reconcileMissingStatisticsProjections(db);
  const transitions = result.rebuilt + result.invalid;
  if (transitions > 0) revalidatePublicStatsTag("stats.projection_rebuild");
  if (result.failed > 0) throw new Error(`Failed to rebuild ${result.failed} statistics projections`);
  return { result, businessTransitions: transitions } satisfies SchedulerRunnerResult<typeof result>;
}
