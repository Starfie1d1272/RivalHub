import "server-only";

import { writeAuditInTx } from "@/lib/audit/write";

import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { matchTimeProposals, matches, seasons } from "@/db/schema";
import {
  TIME_CONFIRMATION_BUFFER_HOURS,
  getTimeConfirmationCutoff,
  getTimeBufferHoursForStage,
} from "@/lib/matches/time-rules";

const PROPOSAL_AUTO_ACCEPT_HOURS = 24;

export interface MatchTimeAutoAwardCronSummary {
  processed: number;
  awarded: number;
  skipped: number;
  failed: number;
  affectedMatches: Array<{ seasonSlug: string; matchId: string }>;
}

export async function runMatchTimeAutoAwardCron(
  now = new Date(),
): Promise<MatchTimeAutoAwardCronSummary> {
  const proposalTimeoutResult = await autoAcceptExpiredProposals(now);

  const cutoffThreshold = new Date(
    now.getTime() + TIME_CONFIRMATION_BUFFER_HOURS * 60 * 60 * 1000,
  );

  const candidateMatches = await db.query.matches.findMany({
    where: and(
      eq(matches.status, "scheduled"),
      isNull(matches.scheduledAt),
      isNotNull(matches.completionDeadline),
      lte(matches.completionDeadline, cutoffThreshold),
    ),
  });

  const settled = await Promise.allSettled(
    candidateMatches.map(async (match) => {
      const result = await autoAwardMatchTime(match.id, now);
      return { matchId: match.id, result };
    }),
  );

  let awarded = proposalTimeoutResult.awarded;
  let skipped = proposalTimeoutResult.skipped;
  let failed = proposalTimeoutResult.failed;
  const affectedMatches = [...proposalTimeoutResult.affectedMatches];
  for (const item of settled) {
    if (item.status === "rejected") {
      failed += 1;
      continue;
    }
    const { matchId, result } = item.value;
    if (result.awarded) {
      awarded += 1;
      affectedMatches.push({ seasonSlug: result.seasonSlug, matchId });
    } else {
      skipped += 1;
    }
  }

  return {
    processed: candidateMatches.length + proposalTimeoutResult.processed,
    awarded,
    skipped,
    failed,
    affectedMatches,
  };
}

async function autoAcceptExpiredProposals(
  now: Date,
): Promise<{
  processed: number;
  awarded: number;
  skipped: number;
  failed: number;
  affectedMatches: Array<{ seasonSlug: string; matchId: string }>;
}> {
  const expiredBefore = new Date(
    now.getTime() - PROPOSAL_AUTO_ACCEPT_HOURS * 60 * 60 * 1000,
  );

  const expiredProposals = await db.query.matchTimeProposals.findMany({
    where: and(
      eq(matchTimeProposals.status, "pending"),
      lte(matchTimeProposals.createdAt, expiredBefore),
    ),
  });

  const settled = await Promise.allSettled(
    expiredProposals.map((p) => autoAcceptSingleProposal(p.id, p.matchId, now)),
  );

  let awarded = 0;
  let skipped = 0;
  let failed = 0;
  const affectedMatches: Array<{ seasonSlug: string; matchId: string }> = [];
  for (const item of settled) {
    if (item.status === "rejected") {
      failed += 1;
      continue;
    }
    if (item.value.awarded) {
      awarded += 1;
      affectedMatches.push({ seasonSlug: item.value.seasonSlug, matchId: item.value.matchId });
    } else {
      skipped += 1;
    }
  }

  return { processed: expiredProposals.length, awarded, skipped, failed, affectedMatches };
}

async function autoAcceptSingleProposal(
  proposalId: string,
  matchId: string,
  now: Date,
): Promise<{ awarded: false; matchId: string } | { awarded: true; matchId: string; seasonSlug: string }> {
  return db.transaction(async (tx) => {
    const [match] = await tx.select().from(matches).where(eq(matches.id, matchId)).for("update");
    if (!match) return { awarded: false, matchId };
    if (match.status !== "scheduled" || match.scheduledAt) {
      await tx
        .update(matchTimeProposals)
        .set({ status: "expired", updatedAt: now })
        .where(eq(matchTimeProposals.id, proposalId));
      return { awarded: false, matchId };
    }

    const proposal = await tx.query.matchTimeProposals.findFirst({
      where: and(
        eq(matchTimeProposals.id, proposalId),
        eq(matchTimeProposals.status, "pending"),
      ),
    });
    if (!proposal) return { awarded: false, matchId };

    await tx
      .update(matchTimeProposals)
      .set({ status: "accepted", responseAt: now, updatedAt: now })
      .where(eq(matchTimeProposals.id, proposalId));
    await tx
      .update(matchTimeProposals)
      .set({ status: "expired", updatedAt: now })
      .where(
        and(
          eq(matchTimeProposals.matchId, matchId),
          eq(matchTimeProposals.status, "pending"),
        ),
      );
    await tx
      .update(matches)
      .set({ scheduledAt: proposal.proposedTime, updatedAt: now })
      .where(eq(matches.id, matchId));

    await writeAuditInTx(tx, {
      seasonId: match.seasonId,
      action: "match.auto_accept_proposal_timeout",
      actorId: "system",
      targetId: matchId,meta: {
        proposalId: proposal.id,
        proposedBy: proposal.proposedBy,
        scheduledAt: proposal.proposedTime.toISOString(),
        reason: "对方 24h 未回应自动采纳",
      },
    });

    const season = await tx.query.seasons.findFirst({
      where: eq(seasons.id, match.seasonId),
    });
    return season
      ? { awarded: true, matchId, seasonSlug: season.slug }
      : { awarded: false, matchId };
  });
}

async function autoAwardMatchTime(
  matchId: string,
  now: Date,
): Promise<{ awarded: true; seasonSlug: string } | { awarded: false }> {
  return db.transaction(async (tx) => {
    const [match] = await tx.select().from(matches).where(eq(matches.id, matchId)).for("update");
    if (!match || match.status !== "scheduled" || match.scheduledAt || !match.completionDeadline) {
      return { awarded: false };
    }

    const season = await tx.query.seasons.findFirst({
      where: eq(seasons.id, match.seasonId),
    });
    const bufferHours = getTimeBufferHoursForStage(season?.stagePlan, match.stage);
    const cutoff = getTimeConfirmationCutoff(match.completionDeadline, bufferHours);
    if (!cutoff || now.getTime() < cutoff.getTime()) {
      return { awarded: false };
    }

    const proposal = await tx.query.matchTimeProposals.findFirst({
      where: and(
        eq(matchTimeProposals.matchId, match.id),
        eq(matchTimeProposals.status, "pending"),
      ),
      orderBy: (tps, { asc }) => [asc(tps.createdAt)],
    });
    if (!proposal || !season) {
      return { awarded: false };
    }

    await tx
      .update(matches)
      .set({ scheduledAt: proposal.proposedTime, updatedAt: now })
      .where(eq(matches.id, match.id));
    await tx
      .update(matchTimeProposals)
      .set({ status: "expired", updatedAt: now })
      .where(
        and(
          eq(matchTimeProposals.matchId, match.id),
          eq(matchTimeProposals.status, "pending"),
        ),
      );
    await tx
      .update(matchTimeProposals)
      .set({ status: "accepted", responseAt: now, updatedAt: now })
      .where(eq(matchTimeProposals.id, proposal.id));

    await writeAuditInTx(tx, {
      seasonId: match.seasonId,
      action: "match.auto_award_time",
      actorId: "system",
      targetId: match.id,meta: {
        proposalId: proposal.id,
        proposedBy: proposal.proposedBy,
        scheduledAt: proposal.proposedTime.toISOString(),
      },
    });

    return { awarded: true, seasonSlug: season.slug };
  });
}
