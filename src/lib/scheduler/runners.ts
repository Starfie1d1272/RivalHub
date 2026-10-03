import "server-only";
import { runPredictionReconciliationJob } from "@/lib/predictions/reconciliation";

import { refreshSteamProfiles } from "@/lib/steam-profiles";
import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { matchVetoSessions, matches, seasons } from "@/db/schema";
import { maybeAdvanceFromRegistration } from "@/lib/seasons/transitions";
import { runDraftTimeoutCron } from "@/lib/draft/operations";
import { runMatchTimeAutoAwardCron } from "@/lib/matches/time-auto-award";
import { purgeExpiredEducationEvidence } from "@/lib/education/retention";
import { ensureRegistrationOpenForParticipantInTx } from "@/lib/seasons/registration-recovery";
import { revalidateMatchPaths, revalidatePublicSeasonTags, revalidatePublicStatsTag, revalidateSeasonPaths } from "@/lib/revalidation";
import { readVetoRoomCore } from "@/lib/matches/veto-room/service";
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
  const result = await runMatchTimeAutoAwardCron(new Date());
  const { affectedMatches, ...summary } = result;
  for (const { seasonSlug, matchId } of affectedMatches) {
    revalidateMatchPaths(seasonSlug, matchId, { mode: "route" });
  }
  return {
    result: summary,
    businessTransitions: result.awarded,
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
    ));

  let changed = 0;
  for (const candidate of candidates) {
    const snapshot = await readVetoRoomCore(candidate.matchId);
    if (snapshot.session.revision > candidate.revision) {
      changed += 1;
      revalidateMatchPaths(candidate.seasonSlug, candidate.matchId, { mode: "route" });
    }
  }
  return {
    result: { processed: candidates.length, changed },
    businessTransitions: changed,
  } satisfies SchedulerRunnerResult<{ processed: number; changed: number }>;
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
  if (transitions > 0) revalidatePublicStatsTag();
  if (result.failed > 0) throw new Error(`Failed to rebuild ${result.failed} statistics projections`);
  return { result, businessTransitions: transitions } satisfies SchedulerRunnerResult<typeof result>;
}
