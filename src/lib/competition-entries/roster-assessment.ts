import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "@/lib/qualification/facts";
import { competitionEntries, competitionEntryActiveClaims, competitionEntryParticipants, competitionEntryRosterMembers, competitionEntryRosterRevisions, seasonRegistrations, teamMemberships } from "@/db/schema";
import type { seasons } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { loadActiveSanctionsInTx, type ActiveSanctionSummary } from "@/lib/discipline/service";
import { evaluateParticipant, loadParticipantQualificationFacts } from "@/lib/qualification/service";
import { buildQualificationEvidence, deriveCompetitiveRequirements, type CompetitivePurpose } from "@/lib/qualification/evidence";
import { uniqueQualificationFindings } from "@/lib/qualification/finding";
import { evaluateRoster } from "@/lib/competition-entries/evaluate-roster";
import { unresolvedQualificationFindings } from "@/lib/competition-entries/restriction-overrides";
import { decodeSeasonRules, type DecodedSeasonRules, type QualificationDecision, type QualificationEvidence, type RosterCandidate } from "@/lib/seasons/rules";
import type { CompetitionEntryRestrictionOverride } from "@/db/schema";
import type { PlayerType } from "@/types/season";

export function rosterCompetitivePurposes(rules: DecodedSeasonRules): CompetitivePurpose[] {
  const participant = rules.roster.legacyParticipant ?? rules.participant;
  const purposes: CompetitivePurpose[] = [];
  if (participant.competitiveProfileRequired) purposes.push("profile_completeness");
  if (participant.rankThreshold?.currentMin || participant.rankThreshold?.peakMin) purposes.push("rank_threshold");
  if (rules.competitive.externalStrengthGap.enabled) purposes.push("external_historical_gap");
  return purposes;
}

/** Read all candidate facts once per season without taking write locks. */
export async function loadRosterCandidates(
  executor: DatabaseExecutor,
  season: typeof seasons.$inferSelect,
  requested: readonly { entryId: string; expectedRevisionId: string }[],
): Promise<Map<string, RosterCandidate>> {
  const result = new Map<string, RosterCandidate>();
  if (!requested.length) return result;
  const rules = decodeSeasonRules(season);
  const entries = await executor.select().from(competitionEntries).where(and(eq(competitionEntries.competitionId, season.id), inArray(competitionEntries.id, requested.map((item) => item.entryId))));
  const revisions = await executor.select().from(competitionEntryRosterRevisions).where(inArray(competitionEntryRosterRevisions.id, requested.map((item) => item.expectedRevisionId)));
  const rows = await executor.select({ revisionId: competitionEntryRosterMembers.revisionId, userId: competitionEntryRosterMembers.userId, participantId: competitionEntryParticipants.id, participantUserId: competitionEntryParticipants.userId, participantEntryId: competitionEntryParticipants.entryId, declaredPlayerType: competitionEntryParticipants.playerType, teamMembershipId: competitionEntryRosterMembers.teamMembershipId, status: competitionEntryParticipants.status, isPrimaryStarter: competitionEntryRosterMembers.isPrimaryStarter, primaryPosition: competitionEntryRosterMembers.primaryPosition })
    .from(competitionEntryRosterMembers).innerJoin(competitionEntryParticipants, eq(competitionEntryParticipants.id, competitionEntryRosterMembers.participantId)).where(inArray(competitionEntryRosterMembers.revisionId, requested.map((item) => item.expectedRevisionId)));
  const ids = [...new Set(rows.map((row) => row.userId))];
  const teamIds = entries.flatMap((entry) => entry.teamId ? [entry.teamId] : []);
  const profile = rules.competitive.competitiveProfile;
  const purposes = rosterCompetitivePurposes(rules);
  const participantRules = rules.roster.legacyParticipant ?? rules.participant;
  const facts = await loadParticipantQualificationFacts(ids, { executor, includeCompetitiveFacts: purposes.length > 0, platform: profile?.platform, fallbackPlatform: profile?.fallbackConversion?.sourcePlatform, ...(profile ? { competitiveRequirements: deriveCompetitiveRequirements(purposes, profile, participantRules) } : {}) });
  const registrations = await (ids.length ? executor.select({ id: seasonRegistrations.id, userId: seasonRegistrations.userId, status: seasonRegistrations.status, playerType: seasonRegistrations.playerType }).from(seasonRegistrations).where(and(eq(seasonRegistrations.seasonId, season.id), inArray(seasonRegistrations.userId, ids))) : []);
  const claims = await (ids.length ? executor.select({ userId: competitionEntryActiveClaims.userId, entryId: competitionEntryActiveClaims.entryId }).from(competitionEntryActiveClaims).where(and(eq(competitionEntryActiveClaims.competitionId, season.id), inArray(competitionEntryActiveClaims.userId, ids))) : []);
  const memberships = await (teamIds.length && ids.length ? executor.select({ id: teamMemberships.id, teamId: teamMemberships.teamId, userId: teamMemberships.userId }).from(teamMemberships).where(and(inArray(teamMemberships.teamId, teamIds), inArray(teamMemberships.userId, ids), inArray(teamMemberships.status, ["active", "benched"]), isNull(teamMemberships.endedAt))) : []);
  const registrationBlocks = await (ids.length ? loadActiveSanctionsInTx(executor, { seasonId: season.id, subjectUserIds: ids, effect: "registration_block" }) : new Map<string, ActiveSanctionSummary[]>());
  const rosterBlocks = await (ids.length ? loadActiveSanctionsInTx(executor, { seasonId: season.id, subjectUserIds: ids, effect: "roster_block" }) : new Map<string, ActiveSanctionSummary[]>());
  const names = await (rules.roster.requireUniqueTeamName ? executor.select({ id: competitionEntries.id, normalized: sql<string>`lower(trim(${competitionEntries.name}))` }).from(competitionEntries).where(and(eq(competitionEntries.competitionId, season.id), sql`${competitionEntries.registrationStatus} NOT IN ('rejected', 'withdrawn')`)) : []);
  const registrationByUser = new Map(registrations.map((item) => [item.userId, item]));
  const playerType = (value: string | null | undefined): PlayerType | null => value === "enrolled" || value === "graduated" || value === "external" ? value : null;
  // Use the database's own normalization on both sides, including non-ASCII names.
  const targetNames = rules.roster.requireUniqueTeamName ? await executor.select({ id: competitionEntries.id, normalized: sql<string>`lower(trim(${competitionEntries.name}))` }).from(competitionEntries).where(inArray(competitionEntries.id, entries.map((entry) => entry.id))) : [];
  const targetNameById = new Map(targetNames.map((item) => [item.id, item.normalized]));
  for (const request of requested) {
    const entry = entries.find((item) => item.id === request.entryId);
    if (!entry || entry.currentRosterRevisionId !== request.expectedRevisionId) continue;
    const revision = revisions.find((item) => item.id === request.expectedRevisionId && item.entryId === entry.id);
    if (!revision) continue;
    const memberRows = rows.filter((row) => row.revisionId === revision.id);
    if (memberRows.some((row) => row.participantEntryId !== entry.id || row.participantUserId !== row.userId)) throw new AppError(ErrorCode.VALIDATION_FAILED, "名单成员记录与参赛队不一致。 ");
    const members = memberRows.map((row) => ({ ...row, playerType: entry.source === "linked_team" ? playerType(row.declaredPlayerType) : playerType(registrationByUser.get(row.userId)?.playerType) }));
    const memberIds = new Set(members.map((member) => member.userId));
    const common = {
      season, revision, factsByUser: new Map([...facts].filter(([id]) => memberIds.has(id))),
      currentTeamMemberUserIds: entry.teamId ? new Set(memberships.filter((membership) => membership.teamId === entry.teamId && members.some((member) => member.userId === membership.userId && member.teamMembershipId === membership.id)).map((membership) => membership.userId)) : null,
      nativeRegistrationsByUser: new Map(registrations.filter((item) => memberIds.has(item.userId)).map((item) => [item.userId, { id: item.id, status: item.status }])),
      activeClaimEntryByUser: new Map(claims.filter((item) => memberIds.has(item.userId)).map((item) => [item.userId, item.entryId])),
      registrationBlockedUserIds: new Set([...registrationBlocks.keys()].filter((id) => memberIds.has(id))), rosterBlockedUserIds: new Set([...rosterBlocks.keys()].filter((id) => memberIds.has(id))),
    };
    const entryFacts = { ...entry, logoPresent: Boolean(entry.logoUrl), nameConflicts: names.some((item) => item.id !== entry.id && item.normalized === targetNameById.get(entry.id)) };
    if (entry.source === "event_native") {
      if (members.some((member) => member.teamMembershipId !== null)) throw new AppError(ErrorCode.VALIDATION_FAILED, "赛事原生名单不能关联长期队伍成员记录。 ");
      result.set(entry.id, { ...common, entry: { ...entryFacts, source: "event_native" }, members: members.map((member) => ({ ...member, teamMembershipId: null })) });
    } else result.set(entry.id, { ...common, entry: { ...entryFacts, source: "linked_team" }, members });
  }
  return result;
}

export function assessRosterCandidate(candidate: RosterCandidate, rules: DecodedSeasonRules, approvedOverrides: readonly CompetitionEntryRestrictionOverride[]) {
  const participantRules = rules.roster.legacyParticipant ?? rules.participant;
  const profile = rules.competitive.competitiveProfile;
  const evidence: QualificationEvidence = profile ? buildQualificationEvidence(candidate.factsByUser, profile, participantRules, rosterCompetitivePurposes(rules)) : { kind: "none" };
  const participantDecisions = new Map<string, QualificationDecision>();
  for (const member of candidate.members) {
    const facts = candidate.factsByUser.get(member.userId);
    participantDecisions.set(member.userId, facts ? evaluateParticipant({ userId: member.userId, facts, playerType: member.playerType }, participantRules, evidence) : { state: "blocked", findings: [{ code: "participant_missing", message: "名单成员资料不可用。", waivable: false, metadata: { userId: member.userId } }] });
  }
  const rosterDecision = evaluateRoster(candidate, rules, evidence);
  const decisions = [rosterDecision, ...candidate.members.map((member) => participantDecisions.get(member.userId)!)];
  const findings = uniqueQualificationFindings(decisions.flatMap((result) => [...result.findings]));
  const unresolved = unresolvedQualificationFindings(findings, approvedOverrides);
  const decision: QualificationDecision = unresolved.length ? { state: "blocked", findings: [unresolved[0], ...unresolved.slice(1)] } : { state: "ready", findings: [] };
  return { candidate, rules, evidence, participantDecisions, rosterDecision, decisions, findings, decision, approvedOverrides };
}
