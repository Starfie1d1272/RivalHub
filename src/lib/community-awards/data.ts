import { officialMatchCondition } from "@/lib/matches/scope";
import { and, asc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DB } from "@/db/client";
import { communityAwardEvidence, communityAwardRecipients, communityAwards, competitionEntries, matches, steamProfiles, users } from "@/db/schema";
import { canSettleCommunityAward } from "./policy";
import { getCommunityAwardProgress } from "./progress";
import type { CommunityAwardStatus, CommunityAward } from "@/db/schema";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { presentMatchLabel } from "@/lib/matches/presentation";
import { formatCST } from "@/lib/utils/date";
import { getSeasonAwardCandidates, isPublicCommunityAward, PUBLIC_COMMUNITY_AWARD_STATUSES } from "@/lib/community-awards/read-model";
import { getPublicPlayerIdentityIds } from "@/lib/players/public-identity";
import { normalizeStagePlan } from "@/lib/seasons/compatibility";

type CommunityAwardQueryable = Pick<DB, "select" | "selectDistinct">;
type StagePlan = ReturnType<typeof normalizeStagePlan>;

type CommunityAwardEvidenceModel = {
  verificationStatus: "pending" | "eligible" | "ineligible";
  verifiedByUserId: string | null;
  verifiedByName: string | null;
  verifiedAt: string | null;
  verificationNote: string | null;
  submittedByUserId: string;
  submitterPlayerUserId: string | null;
  candidateUserId: string | null;
  candidatePlayerUserId: string | null;
  id: string;
  submitterName: string;
  candidateName: string | null;
  matchLabel: string | null;
  explanation: string;
  videoUrl: string | null;
  createdAt: string;
};

export type CommunityAwardModel = {
  id: string;
  recipients: { userId: string; name: string; target: string | null }[];
  recipientPolicy: CommunityAward["recipientPolicy"];
  recipientLimit: number | null;
  settlementPolicy: CommunityAward["settlementPolicy"];
  settlementStageKey: string | null;
  resultVersion: number;
  settlementReady?: boolean;
  nonAwardingReady?: boolean;
  submittedByUserId: string;
  submitterPlayerUserId: string | null;
  name: string;
  condition: string;
  prize: string;
  supplementaryNote: string | null;
  publicNote: string | null;
  reviewNote: string | null;
  status: CommunityAwardStatus;
  outcomeNote: string | null;
  submitterName: string;
  recipientName: string | null;
  recipientUserId: string | null;
  recipientTarget: string | null;
  evidence?: CommunityAwardEvidenceModel[];
};

type CommunityAwardBoardData = {
  awards: CommunityAwardModel[];
  candidates: Awaited<ReturnType<typeof getSeasonAwardCandidates>>;
  matches: { id: string; label: string }[];
  stages?: { key: string; name: string }[];
};

export type CommunityAwardAdminSummary = Omit<CommunityAwardModel,
  "evidence" | "condition" | "supplementaryNote" | "publicNote" | "reviewNote" | "outcomeNote"
> & { evidenceCount: number; eligibleEvidenceCount: number; settlementReady: boolean; nonAwardingReady: boolean };

/** Internal admin readers: entrypoints must freshly authorize the requested season.
 * Read all authoritative progress/eligible evidence, without evidence bodies or form options.
 */
export async function getAdminCommunityAwardBoardSummaries(executor: CommunityAwardQueryable, args: { seasonId: string }): Promise<{
  awards: CommunityAwardAdminSummary[]; stages: { key: string; name: string }[];
}> {
  const [rows, evidence, progress] = await Promise.all([
    executor.select({ id: communityAwards.id, name: communityAwards.name, prize: communityAwards.prize,
      status: communityAwards.status, recipientPolicy: communityAwards.recipientPolicy, recipientLimit: communityAwards.recipientLimit,
      settlementPolicy: communityAwards.settlementPolicy, settlementStageKey: communityAwards.settlementStageKey,
      resultVersion: communityAwards.resultVersion, submittedByUserId: communityAwards.submittedByUserId,
      submitter: { displayName: users.displayName, perfectName: users.perfectName, personaName: steamProfiles.personaName },
    }).from(communityAwards).innerJoin(users, eq(communityAwards.submittedByUserId, users.id))
      .leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
      .where(eq(communityAwards.seasonId, args.seasonId)).orderBy(asc(communityAwards.createdAt)),
    executor.select({ awardId: communityAwardEvidence.awardId,
      evidenceCount: sql<number>`count(*)`.mapWith(Number),
      eligibleEvidenceCount: sql<number>`count(*) filter (where ${communityAwardEvidence.verificationStatus} = 'eligible')`.mapWith(Number),
      eligibleCandidateIds: sql<string[]>`coalesce(array_agg(${communityAwardEvidence.candidateUserId}) filter
        (where ${communityAwardEvidence.verificationStatus} = 'eligible' and ${communityAwardEvidence.candidateUserId} is not null), '{}'::uuid[])`,
    }).from(communityAwardEvidence).innerJoin(communityAwards, eq(communityAwardEvidence.awardId, communityAwards.id))
      .where(eq(communityAwards.seasonId, args.seasonId)).groupBy(communityAwardEvidence.awardId),
    getCommunityAwardProgress(executor, args.seasonId),
  ]);
  const { recipients, players } = await loadRecipients(executor, rows.map(row => row.id), rows.map(row => row.submittedByUserId));
  const evidenceByAward = new Map(evidence.map(row => [row.awardId, row]));
  return { stages: progress.stages, awards: rows.map(({ submitter, ...row }) => {
    const aggregate = evidenceByAward.get(row.id);
    const eligible = aggregate?.eligibleCandidateIds ?? [];
    const awarded = recipients.get(row.id) ?? [];
    return { ...row, recipients: awarded, recipientUserId: awarded[0]?.userId ?? null,
      recipientName: awarded[0]?.name ?? null, recipientTarget: awarded[0]?.target ?? null,
      submitterName: getPublicDisplayName(submitter), submitterPlayerUserId: players.has(row.submittedByUserId) ? row.submittedByUserId : null,
      settlementReady: canSettleCommunityAward(row, progress, "awarded", eligible, eligible),
      nonAwardingReady: canSettleCommunityAward(row, progress, "not_awarded", [], eligible),
      evidenceCount: aggregate?.evidenceCount ?? 0, eligibleEvidenceCount: aggregate?.eligibleEvidenceCount ?? 0,
    };
  }) };
}

/** Complete authorized award detail; candidates/options remain a separate form-only read. */
export async function getAdminCommunityAwardDetail(executor: CommunityAwardQueryable, args: {
  seasonId: string; awardId: string; stagePlan: StagePlan;
}): Promise<CommunityAwardModel | null> {
  if (!args.awardId) return null;
  const board = await loadAdminCommunityAwardBoardData(executor, args, args.awardId);
  return board.awards[0] ?? null;
}

async function getMatchOptions(executor: CommunityAwardQueryable, seasonId: string, stagePlan: StagePlan, matchIds?: readonly string[]) {
  if (matchIds && matchIds.length === 0) return [];
  const entryB = alias(competitionEntries, "award_match_entry_b");
  const rows = await executor.select({ id: matches.id, stage: matches.stage, round: matches.round, entryRound: matches.entryRound, aName: competitionEntries.name, bName: entryB.name })
    .from(matches).innerJoin(competitionEntries, eq(matches.entryAId, competitionEntries.id))
    .innerJoin(entryB, eq(matches.entryBId, entryB.id))
    .where(and(officialMatchCondition(), eq(matches.seasonId, seasonId), matchIds ? inArray(matches.id, [...new Set(matchIds)]) : undefined));
  return rows.flatMap(row => row.stage === null ? [] : [{ id: row.id, label: presentMatchLabel({ stage: row.stage, stageName: stagePlan.find(stage => stage.key === row.stage)?.name, round: row.round, entryRound: row.entryRound, teamAName: row.aName, teamBName: row.bName }) }]);
}

export async function getPublicCommunityAwardBoardData(executor: CommunityAwardQueryable, args: { seasonId: string; currentUserId: string | null; stagePlan: StagePlan }): Promise<CommunityAwardBoardData> {
  const publicAward = or(inArray(communityAwards.status, PUBLIC_COMMUNITY_AWARD_STATUSES), and(eq(communityAwards.status, "withdrawn"), isNotNull(communityAwards.reviewedAt)));
  const rows = await (
    executor.select({ id: communityAwards.id, recipientPolicy: communityAwards.recipientPolicy, recipientLimit: communityAwards.recipientLimit, settlementPolicy: communityAwards.settlementPolicy, settlementStageKey: communityAwards.settlementStageKey, resultVersion: communityAwards.resultVersion, submittedByUserId: communityAwards.submittedByUserId, name: communityAwards.name, condition: communityAwards.condition, prize: communityAwards.prize, supplementaryNote: communityAwards.supplementaryNote, publicNote: communityAwards.publicNote, reviewNote: communityAwards.reviewNote, reviewedAt: communityAwards.reviewedAt, status: communityAwards.status, outcomeNote: communityAwards.outcomeNote, submitter: { displayName: users.displayName, perfectName: users.perfectName, personaName: steamProfiles.personaName } }).from(communityAwards).innerJoin(users, eq(communityAwards.submittedByUserId, users.id)).leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64)).where(and(eq(communityAwards.seasonId, args.seasonId), args.currentUserId ? or(publicAward, eq(communityAwards.submittedByUserId, args.currentUserId)) : publicAward)).orderBy(asc(communityAwards.createdAt))
  );
  const { recipients: recipientsByAward, players: playerUserIdSet } = await loadRecipients(
    executor, rows.map(row => row.id), rows.map(row => row.submittedByUserId),
  );

  return {
    awards: rows.filter((row) => row.submittedByUserId === args.currentUserId || isPublicCommunityAward(row.status, row.reviewedAt)).map((row) => ({
      id: row.id,
      recipients: recipientsByAward.get(row.id) ?? [],
      recipientPolicy: row.recipientPolicy, recipientLimit: row.recipientLimit, settlementPolicy: row.settlementPolicy, settlementStageKey: row.settlementStageKey, resultVersion: row.resultVersion,
      submittedByUserId: row.submittedByUserId,
      submitterPlayerUserId: playerUserIdSet.has(row.submittedByUserId) ? row.submittedByUserId : null,
      name: row.name,
      condition: row.condition,
      prize: row.prize,
      supplementaryNote: row.supplementaryNote,
      publicNote: row.publicNote,
      reviewNote: row.submittedByUserId === args.currentUserId ? row.reviewNote : null,
      status: row.status,
      submitterName: getPublicDisplayName(row.submitter),
      recipientName: recipientsByAward.get(row.id)?.[0]?.name ?? null,
      recipientUserId: recipientsByAward.get(row.id)?.[0]?.userId ?? null,
      recipientTarget: recipientsByAward.get(row.id)?.[0]?.target ?? null,
      outcomeNote: row.outcomeNote,
    })),
    candidates: [],
    matches: [],
  };
}

/** Form-only public options; entrypoints must authorize the visible event first. */
export async function getCommunityAwardFormOptions(executor: CommunityAwardQueryable, seasonId: string, stagePlan: StagePlan) {
  const [candidates, matches] = await Promise.all([
    getSeasonAwardCandidates(executor, seasonId), getMatchOptions(executor, seasonId, stagePlan),
  ]);
  return { candidates, matches };
}

export async function getAdminCommunityAwardBoardData(executor: CommunityAwardQueryable, args: { seasonId: string; stagePlan: StagePlan }): Promise<CommunityAwardBoardData> {
  return loadAdminCommunityAwardBoardData(executor, args);
}

async function loadAdminCommunityAwardBoardData(executor: CommunityAwardQueryable, args: { seasonId: string; stagePlan: StagePlan }, awardId?: string): Promise<CommunityAwardBoardData> {
  const evidenceVerifier = alias(users, "evidence_verifier");
  const evidenceSubmitter = alias(users, "evidence_submitter");
  const evidenceSubmitterProfile = alias(steamProfiles, "evidence_submitter_profile");
  const evidenceCandidate = alias(users, "evidence_candidate");
  const evidenceCandidateProfile = alias(steamProfiles, "evidence_candidate_profile");
  const [awardRows, evidenceRows, candidates, allMatchOptions] = await Promise.all([
    executor.select({ id: communityAwards.id, recipientPolicy: communityAwards.recipientPolicy, recipientLimit: communityAwards.recipientLimit, settlementPolicy: communityAwards.settlementPolicy, settlementStageKey: communityAwards.settlementStageKey, resultVersion: communityAwards.resultVersion, submittedByUserId: communityAwards.submittedByUserId, name: communityAwards.name, condition: communityAwards.condition, prize: communityAwards.prize, supplementaryNote: communityAwards.supplementaryNote, publicNote: communityAwards.publicNote, reviewNote: communityAwards.reviewNote, status: communityAwards.status, outcomeNote: communityAwards.outcomeNote, submitter: { displayName: users.displayName, perfectName: users.perfectName, personaName: steamProfiles.personaName } }).from(communityAwards).innerJoin(users, eq(communityAwards.submittedByUserId, users.id)).leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64)).where(and(eq(communityAwards.seasonId, args.seasonId), awardId !== undefined ? eq(communityAwards.id, awardId) : undefined)).orderBy(asc(communityAwards.createdAt)),
    executor.select({ id: communityAwardEvidence.id, verificationStatus: communityAwardEvidence.verificationStatus, verifiedByName: evidenceVerifier.displayName, verifiedByUserId: communityAwardEvidence.verifiedByUserId, verifiedAt: communityAwardEvidence.verifiedAt, verificationNote: communityAwardEvidence.verificationNote, awardId: communityAwardEvidence.awardId, submittedByUserId: communityAwardEvidence.submittedByUserId, candidateUserId: communityAwardEvidence.candidateUserId, explanation: communityAwardEvidence.explanation, videoUrl: communityAwardEvidence.videoUrl, createdAt: communityAwardEvidence.createdAt, matchId: communityAwardEvidence.matchId, submitter: { displayName: evidenceSubmitter.displayName, perfectName: evidenceSubmitter.perfectName, personaName: evidenceSubmitterProfile.personaName }, candidate: { displayName: evidenceCandidate.displayName, perfectName: evidenceCandidate.perfectName, personaName: evidenceCandidateProfile.personaName } }).from(communityAwardEvidence).leftJoin(evidenceVerifier, eq(communityAwardEvidence.verifiedByUserId, evidenceVerifier.id)).innerJoin(communityAwards, eq(communityAwardEvidence.awardId, communityAwards.id)).innerJoin(evidenceSubmitter, eq(communityAwardEvidence.submittedByUserId, evidenceSubmitter.id)).leftJoin(evidenceSubmitterProfile, eq(evidenceSubmitterProfile.steam64, evidenceSubmitter.steam64)).leftJoin(evidenceCandidate, eq(communityAwardEvidence.candidateUserId, evidenceCandidate.id)).leftJoin(evidenceCandidateProfile, eq(evidenceCandidateProfile.steam64, evidenceCandidate.steam64)).where(and(eq(communityAwards.seasonId, args.seasonId), awardId !== undefined ? eq(communityAwards.id, awardId) : undefined)).orderBy(asc(communityAwardEvidence.createdAt), asc(communityAwardEvidence.id)),
    awardId !== undefined ? Promise.resolve([]) : getSeasonAwardCandidates(executor, args.seasonId),
    awardId !== undefined ? Promise.resolve([]) : getMatchOptions(executor, args.seasonId, args.stagePlan),
  ]);
  if (awardId !== undefined && awardRows.length === 0) return { awards: [], candidates: [], matches: [] };
  const matchOptions = awardId !== undefined
    ? await getMatchOptions(executor, args.seasonId, args.stagePlan, evidenceRows.flatMap(row => row.matchId ? [row.matchId] : []))
    : allMatchOptions;
  const [{ recipients: recipientsByAward, players: playerUserIdSet }, progress] = await Promise.all([
    loadRecipients(executor, awardRows.map(row => row.id), [
      ...awardRows.map(row => row.submittedByUserId),
      ...evidenceRows.flatMap(row => [row.submittedByUserId, ...(row.candidateUserId ? [row.candidateUserId] : [])]),
    ]),
    getCommunityAwardProgress(executor, args.seasonId),
  ]);
  const matchLabels = new Map(matchOptions.map((match) => [match.id, match.label]));
  const evidenceByAward = new Map<string, CommunityAwardEvidenceModel[]>();
  for (const row of evidenceRows) {
    const list = evidenceByAward.get(row.awardId) ?? [];
    list.push({ id: row.id, verificationStatus: row.verificationStatus, verifiedByName: row.verifiedByName, verifiedByUserId: row.verifiedByUserId, verifiedAt: row.verifiedAt ? formatCST(row.verifiedAt) : null, verificationNote: row.verificationNote, submittedByUserId: row.submittedByUserId, candidateUserId: row.candidateUserId, submitterPlayerUserId: playerUserIdSet.has(row.submittedByUserId) ? row.submittedByUserId : null, candidatePlayerUserId: row.candidateUserId && playerUserIdSet.has(row.candidateUserId) ? row.candidateUserId : null, submitterName: getPublicDisplayName(row.submitter), candidateName: row.candidate ? getPublicDisplayName(row.candidate) : null, matchLabel: row.matchId ? matchLabels.get(row.matchId) ?? null : null, explanation: row.explanation, videoUrl: row.videoUrl, createdAt: formatCST(row.createdAt) });
    evidenceByAward.set(row.awardId, list);
  }
  return { awards: awardRows.map((row) => {
    const eligible = (evidenceByAward.get(row.id) ?? []).flatMap(item => item.verificationStatus === "eligible" && item.candidateUserId ? [item.candidateUserId] : []);
    return { ...row, nonAwardingReady: canSettleCommunityAward(row, progress, "not_awarded", [], eligible), recipientUserId: recipientsByAward.get(row.id)?.[0]?.userId ?? null, recipients: recipientsByAward.get(row.id) ?? [], settlementReady: canSettleCommunityAward(row, progress, "awarded", eligible, eligible), submitterPlayerUserId: playerUserIdSet.has(row.submittedByUserId) ? row.submittedByUserId : null, submitterName: getPublicDisplayName(row.submitter), recipientName: recipientsByAward.get(row.id)?.[0]?.name ?? null, recipientTarget: recipientsByAward.get(row.id)?.[0]?.target ?? null, evidence: evidenceByAward.get(row.id) ?? [] };
  }), candidates, matches: matchOptions, stages: progress.stages };

}

async function loadRecipients(executor: CommunityAwardQueryable, awardIds: string[], relatedUserIds: string[]) {
  const result = new Map<string, CommunityAwardModel["recipients"]>();
  const rows = awardIds.length ? await executor.select({ awardId: communityAwardRecipients.awardId, userId: users.id, displayName: users.displayName, perfectName: users.perfectName, personaName: steamProfiles.personaName }).from(communityAwardRecipients).innerJoin(users, eq(communityAwardRecipients.userId, users.id)).leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64)).where(inArray(communityAwardRecipients.awardId, awardIds)).orderBy(asc(communityAwardRecipients.position), asc(communityAwardRecipients.userId)) : [];
  const players = await getPublicPlayerIdentityIds(executor, [...new Set([...relatedUserIds, ...rows.map(row => row.userId)])]);
  for (const row of rows) {
    const list = result.get(row.awardId) ?? [];
    list.push({ userId: row.userId, name: getPublicDisplayName(row), target: players.has(row.userId) ? `/players/${row.userId}` : null });
    result.set(row.awardId, list);
  }
  return { recipients: result, players };
}
