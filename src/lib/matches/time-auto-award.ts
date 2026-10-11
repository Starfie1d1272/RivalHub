import { assertCompetitionMatch } from "./competition-context";
import "server-only";

import { writeAuditInTx } from "@/lib/audit/write";

import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { matchTimeProposals, matches, seasons } from "@/db/schema";
import { PROPOSAL_RESPONSE_HOURS, canAutoAcceptProposal } from "@/lib/matches/time-rules";

import { allocateHeldCoverageInTx, releaseMatchCoverageHoldInTx } from "./coverage";
import { materializeDefaultLineupsInTx } from "@/lib/match-rosters/service";
import { AppError, ErrorCode } from "@/lib/errors";
import { captureException } from "@/lib/observability/server";
import { ensureRequestId } from "@/lib/observability/context";

export interface MatchTimeAutoAwardCronSummary {
  processed: number;
  awarded: number;
  skipped: number;
  failed: number;
  lineups: { created: number; blocked: number; failed: number };
  /** Internal causes; the scheduler runner must remove these from its DTO. */
  lineupFailures: unknown[];
  lineupRequestId: string;
  affectedMatches: Array<{ seasonSlug: string; matchId: string }>;
}

export async function runMatchTimeAutoAwardCron(
  clock: () => Date = () => new Date(),
): Promise<MatchTimeAutoAwardCronSummary> {
  const now = clock();
  const lineupRequestId = ensureRequestId();
  const lineups = { created: 0, blocked: 0, failed: 0 };
  const lineupFailures: unknown[] = [];
  const affectedMatches: MatchTimeAutoAwardCronSummary["affectedMatches"] = [];
  const dueLineups = await db.select().from(matches).where(and(isNotNull(matches.seasonId), isNull(matches.testConfig), eq(matches.status, "scheduled"), isNotNull(matches.scheduledAt), lte(matches.scheduledAt, new Date(now.getTime() + 2 * 60 * 60_000))));
  for (const match of dueLineups) {
    try {
      const outcome = await db.transaction(async tx => {
        const [locked] = await tx.select().from(matches).where(eq(matches.id, match.id)).for("update");
        assertCompetitionMatch(locked);
        const created = await materializeDefaultLineupsInTx(tx, locked, clock());
        if (!created) return null;
        const season = await tx.query.seasons.findFirst({ where: eq(seasons.id, locked.seasonId) });
        if (!season) throw new AppError(ErrorCode.INTERNAL_ERROR, "比赛所属赛季不存在。");
        return { created, seasonSlug: season.slug, matchId: locked.id };
      });
      if (outcome) {
        lineups.created += outcome.created;
        affectedMatches.push({ seasonSlug: outcome.seasonSlug, matchId: outcome.matchId });
      }
    } catch (error) {
      // Only the eligibility owner's explicit business rejection is waiting.
      // PG, missing frozen facts and programming errors remain system failures.
      if (error instanceof AppError && error.code === ErrorCode.VALIDATION_FAILED) {
        lineups.blocked += 1;
        continue;
      }
      lineups.failed += 1;
      lineupFailures.push(error);
      captureException("match.default_lineup.failure", error, {
        scope: "match", operation: "default_lineup.materialize",
        requestId: lineupRequestId,
        safeContext: { phase: "materialization" },
      });
    }
  }
  const proposalTimeoutResult = await autoAcceptExpiredProposals(clock);

  return { ...proposalTimeoutResult, lineups, lineupFailures, lineupRequestId,
    affectedMatches: [...affectedMatches, ...proposalTimeoutResult.affectedMatches] };
}

async function autoAcceptExpiredProposals(
  clock: () => Date,
): Promise<{
  processed: number;
  awarded: number;
  skipped: number;
  failed: number;
  affectedMatches: Array<{ seasonSlug: string; matchId: string }>;
}> {
  const expiredBefore = new Date(
    clock().getTime() - PROPOSAL_RESPONSE_HOURS * 60 * 60 * 1000,
  );

  const expiredProposals = await db.query.matchTimeProposals.findMany({
    where: and(
      eq(matchTimeProposals.status, "pending"),
      lte(matchTimeProposals.createdAt, expiredBefore),
    ),
  });

  const settled = await Promise.allSettled(
    expiredProposals.map((p) => autoAcceptSingleProposal(p.id, p.matchId, clock)),
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

class AutoAcceptWindowElapsed extends Error {}

async function autoAcceptSingleProposal(
  proposalId: string,
  matchId: string,
  clock: () => Date,
): Promise<{ awarded: false; matchId: string } | { awarded: true; matchId: string; seasonSlug: string }> {
  return db.transaction<{ awarded: false; matchId: string } | { awarded: true; matchId: string; seasonSlug: string }>(async (tx) => {
    const [match] = await tx.select().from(matches).where(eq(matches.id, matchId)).for("update");
    if (!match) return { awarded: false, matchId };
    assertCompetitionMatch(match);
    const proposal = await tx.query.matchTimeProposals.findFirst({
      where: and(
        eq(matchTimeProposals.id, proposalId),
        eq(matchTimeProposals.status, "pending"),
      ),
    });
    if (!proposal) return { awarded: false, matchId };
    let now = clock();
    // Read pending under the same match lock as every participant/admin mutation.
    if (match.status !== "scheduled" || proposal.proposedTime <= now ||
        (match.completionDeadline && proposal.proposedTime > match.completionDeadline)) {
      await tx.update(matchTimeProposals).set({ status: "expired", updatedAt: now })
        .where(and(eq(matchTimeProposals.id, proposalId), eq(matchTimeProposals.status, "pending")));
      await releaseMatchCoverageHoldInTx(tx, matchId, now);
      return { awarded: false, matchId };
    }
    // An existing schedule stays valid. A delayed cron may also have missed
    // the safe notice window; either case still requires explicit consent.
    if (!canAutoAcceptProposal(match, proposal, now)) return { awarded: false, matchId };

    await allocateHeldCoverageInTx(tx, matchId, proposal.proposedTime, clock);
    // Coverage may wait on another match's slot lock too. Roll back any resource
    // changes if the notice window elapsed while waiting for that lock.
    now = clock();
    if (!canAutoAcceptProposal(match, proposal, now)) throw new AutoAcceptWindowElapsed();

    await tx
      .update(matchTimeProposals)
      .set({ status: "accepted", resolution: "auto_timeout", responseAt: now, updatedAt: now })
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

    assertCompetitionMatch(match);
    const season = await tx.query.seasons.findFirst({
      where: eq(seasons.id, match.seasonId),
    });
    return season
      ? { awarded: true, matchId, seasonSlug: season.slug }
      : { awarded: false, matchId };
  }).catch(error => {
    if (error instanceof AutoAcceptWindowElapsed) return { awarded: false as const, matchId };
    throw error;
  });
}
