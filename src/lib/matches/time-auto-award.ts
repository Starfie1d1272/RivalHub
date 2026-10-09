import { assertCompetitionMatch } from "./competition-context";
import "server-only";

import { writeAuditInTx } from "@/lib/audit/write";

import { and, eq, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { matchTimeProposals, matches, seasons } from "@/db/schema";
import { PROPOSAL_RESPONSE_HOURS, canAutoAcceptProposal } from "@/lib/matches/time-rules";

import { allocateHeldCoverageInTx, releaseMatchCoverageHoldInTx } from "./coverage";
import { materializeDefaultLineupsInTx } from "@/lib/match-rosters/service";

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
  const dueLineups = await db.select().from(matches).where(and(isNotNull(matches.seasonId), eq(matches.status, "scheduled"), isNotNull(matches.scheduledAt), lte(matches.scheduledAt, new Date(now.getTime() + 2 * 60 * 60_000))));
  for (const match of dueLineups) {
    try {
      await db.transaction(async tx => {
        const [locked] = await tx.select().from(matches).where(eq(matches.id, match.id)).for("update");
        assertCompetitionMatch(locked);
        await materializeDefaultLineupsInTx(tx, locked, now);
      });
    } catch { /* Unavailable legal lineup remains a visible start blocker. */ }
  }
  const proposalTimeoutResult = await autoAcceptExpiredProposals(now);

  return proposalTimeoutResult;
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
    now.getTime() - PROPOSAL_RESPONSE_HOURS * 60 * 60 * 1000,
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
    assertCompetitionMatch(match);
    const proposal = await tx.query.matchTimeProposals.findFirst({
      where: and(
        eq(matchTimeProposals.id, proposalId),
        eq(matchTimeProposals.status, "pending"),
      ),
    });
    if (!proposal) return { awarded: false, matchId };
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
    await allocateHeldCoverageInTx(tx, matchId, proposal.proposedTime, now);
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
  });
}
