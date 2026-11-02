import "server-only";
import { and, eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { competitionEntries, eventRosterMembers, eventRosters } from "@/db/schema";
import { loadActiveSanctionsInTx } from "@/lib/discipline/service";
import { AppError, ErrorCode } from "@/lib/errors";
import { decodeEventRosterEligibilitySnapshotV2 } from "@/lib/seasons/eligibility-snapshot";
import { decodeFrozenLineupEligibility } from "./frozen-eligibility";
import { evaluateLineup } from "./lineup";

/** Evaluate the adopted primary lineup at prestart using frozen facts and current sanctions. */
export async function evaluateFrozenEventRosterInTx(tx: TxDb, input: {
  seasonId: string; entryId: string; rosterRevisionId: string; eventRosterId: string;
}) {
  const [roster] = await tx.select({ status: eventRosters.status, revisionId: eventRosters.sourceRosterRevisionId, snapshot: eventRosters.eligibilitySnapshot })
    .from(eventRosters).innerJoin(competitionEntries, eq(competitionEntries.id, eventRosters.entryId))
    .where(and(eq(eventRosters.id, input.eventRosterId), eq(eventRosters.entryId, input.entryId), eq(competitionEntries.competitionId, input.seasonId)));
  if (!roster || roster.status !== "frozen" || roster.revisionId !== input.rosterRevisionId || roster.snapshot?.version !== 2) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "已冻结名单缺少对应的资格快照。");
  }
  const snapshot = decodeEventRosterEligibilitySnapshotV2(roster.snapshot);
  const frozen = decodeFrozenLineupEligibility(snapshot, input);
  const members = await tx.select({ id: eventRosterMembers.id, userId: eventRosterMembers.userId }).from(eventRosterMembers)
    .where(and(eq(eventRosterMembers.eventRosterId, input.eventRosterId), eq(eventRosterMembers.isCurrent, true)));
  if (members.length !== frozen.membersById.size || members.some((member) => frozen.membersById.get(member.id)?.userId !== member.userId)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "冻结资格快照与赛事名单成员不一致。");
  }
  const bans = await loadActiveSanctionsInTx(tx, { seasonId: input.seasonId, effect: "match_participation_block", subjectUserIds: members.map((member) => member.userId) });
  const decision = evaluateLineup({ entryId: input.entryId,
    starterMemberIds: snapshot.members.filter((member) => member.isPrimaryStarter).map((member) => member.eventRosterMemberId),
    substituteMemberIds: [] }, frozen, new Set(bans.keys()));
  return { snapshot, frozen, decision };
}
