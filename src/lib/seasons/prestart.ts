import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { competitionEntries, draftState, eventRosterMembers, eventRosters, seasons } from "@/db/schema";
import { writeAuditInTx } from "@/lib/audit/write";
import { AppError, ErrorCode } from "@/lib/errors";
import { assertPrestartEntryCoherenceInTx } from "@/lib/event-rosters/coherence";
import { prepareApprovedEventRosterInTx } from "@/lib/event-rosters/prepare-approved";
import { decodeEventRosterEligibilitySnapshotV2 } from "@/lib/seasons/eligibility-snapshot";
import { decodeFrozenLineupEligibility } from "@/lib/match-rosters/frozen-eligibility";
import { evaluateLineup } from "@/lib/match-rosters/lineup";
import { loadActiveSanctionsInTx } from "@/lib/discipline/service";
import { getFirstStage, normalizeStagePlan } from "@/lib/seasons/compatibility";
import { decodeSeasonRules } from "@/lib/seasons/rules";

/** Adopt approved entries and freeze their rosters in the season transaction. */
export async function startSeasonInTx(tx: TxDb, seasonId: string, actorId: string): Promise<string> {
  const [season] = await tx.select().from(seasons).where(eq(seasons.id, seasonId)).for("update");
  if (!season || decodeSeasonRules(season).source !== "policy_v2" || !["registration", "drafting"].includes(season.status)) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "当前赛事不能开赛。");
  if (season.competitionTemplate === "major") throw new AppError(ErrorCode.SEASON_CAPABILITY_DISABLED, "Major 请通过赛前筹备完成资格赛、名单冻结和开赛。");
  if (season.hasCaptainVoting && season.status !== "drafting") throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "请先完成队长投票并确认队长。");
  if (season.hasDraft) {
    const state = await tx.query.draftState.findFirst({ where: eq(draftState.seasonId, season.id) });
    if (!state || state.isActive || state.currentEntryId) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "请先完成选秀。");
  }
  if (!getFirstStage(normalizeStagePlan(season.stagePlan))) throw new AppError(ErrorCode.VALIDATION_FAILED, "请先配置赛程阶段。");
  const entries = await tx.select({ id: competitionEntries.id, status: competitionEntries.registrationStatus }).from(competitionEntries).where(and(eq(competitionEntries.competitionId, season.id), inArray(competitionEntries.registrationStatus, ["draft", "submitted", "changes_requested", "waitlisted", "approved"])));
  if (entries.length < 2) throw new AppError(ErrorCode.VALIDATION_FAILED, "至少需要两支已批准的参赛队伍。");
  if (entries.some(entry => entry.status !== "approved")) throw new AppError(ErrorCode.VALIDATION_FAILED, "请先处理所有未完成的队伍报名和名单审核。");

  for (const entry of entries) await prepareApprovedEventRosterInTx(tx, { seasonId: season.id, entryId: entry.id, actorId });
  const coherent = await assertPrestartEntryCoherenceInTx(tx, season.id, entries.map(entry => ({ competitionEntryId: entry.id })));
  for (const row of coherent) {
    if (row.eventRoster.status !== "confirmed" || !row.eventRoster.eligibilitySnapshot || row.eventRoster.eligibilitySnapshot.version !== 2) throw new AppError(ErrorCode.VALIDATION_FAILED, `队伍「${row.entry.name}」的名单尚未审核并采用。`);
    const snapshot = decodeEventRosterEligibilitySnapshotV2(row.eventRoster.eligibilitySnapshot);
    const frozen = decodeFrozenLineupEligibility(snapshot, { seasonId: season.id, entryId: row.entry.id, rosterRevisionId: row.approvedRevision.id });
    const members = await tx.select().from(eventRosterMembers).where(and(eq(eventRosterMembers.eventRosterId, row.eventRoster.id), eq(eventRosterMembers.isCurrent, true)));
    if (members.length !== snapshot.members.length || members.some(member => !snapshot.members.some(saved => saved.eventRosterMemberId === member.id && saved.userId === member.userId && saved.participantId === member.participantId && saved.educationVerificationId === member.educationVerificationId && saved.isPrimaryStarter === member.isPrimaryStarter))) throw new AppError(ErrorCode.VALIDATION_FAILED, "已采用资格快照与正式名单成员不一致。");
    const bans = await loadActiveSanctionsInTx(tx, { seasonId: season.id, effect: "match_participation_block", subjectUserIds: members.map(member => member.userId) });
    const decision = evaluateLineup({ entryId: row.entry.id, starterMemberIds: members.filter(member => member.isPrimaryStarter).map(member => member.id), substituteMemberIds: [] }, frozen, new Set(bans.keys()));
    if (decision.state === "blocked") throw new AppError(ErrorCode.VALIDATION_FAILED, decision.findings.map(finding => finding.message).join(" "));
  }
  const now = new Date();
  await tx.update(eventRosters).set({ status: "frozen", frozenAt: now, frozenBy: actorId, updatedAt: now }).where(inArray(eventRosters.id, coherent.map(row => row.eventRoster.id)));
  await tx.update(seasons).set({ status: "playing", updatedAt: now }).where(eq(seasons.id, season.id));
  await writeAuditInTx(tx, { seasonId: season.id, action: "season.update", actorId, targetId: season.id, meta: { operation: "formation_start", from: season.status, to: "playing", entryIds: entries.map(entry => entry.id) } });
  return season.slug;
}
