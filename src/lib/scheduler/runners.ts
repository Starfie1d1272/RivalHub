import "server-only";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { maybeAdvanceFromRegistration } from "@/lib/seasons/transitions";
import { runDraftTimeoutCron } from "@/lib/draft/operations";
import { runMatchTimeAutoAwardCron } from "@/lib/matches/time-auto-award";
import { purgeExpiredEducationEvidence } from "@/lib/education/retention";
import { ensureRegistrationOpenForParticipantInTx } from "@/lib/seasons/registration-recovery";
import { revalidateMatchPaths, revalidatePublicSeasonTags, revalidateSeasonPaths } from "@/lib/revalidation";
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

export async function runSchedulerJobByKey(key: SchedulerJobKey): Promise<SchedulerRunnerResult<unknown>> {
  switch (key) {
    case "draft-timeout": return runDraftTimeoutJob();
    case "check-registration-deadline": return runRegistrationDeadlineJob();
    case "match-time-auto-award": return runMatchTimeAutoAwardJob();
    case "cleanup-education-evidence": return runEducationEvidenceCleanupJob();
  }
}
