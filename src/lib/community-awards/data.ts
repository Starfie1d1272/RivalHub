import { and, asc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { TxDb } from "@/db/client";
import { communityAwardEvidence, communityAwards, competitionEntries, matches, users } from "@/db/schema";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { presentMatchLabel } from "@/lib/matches/presentation";
import { getSeasonAwardCandidates, isPublicCommunityAward, PUBLIC_COMMUNITY_AWARD_STATUSES } from "@/lib/community-awards/read-model";
import { normalizeStagePlan } from "@/types/season";

type CommunityAwardQueryable = Pick<TxDb, "select" | "selectDistinct">;
type StagePlan = ReturnType<typeof normalizeStagePlan>;

type CommunityAwardEvidenceModel = {
  id: string;
  submitterName: string;
  candidateName: string | null;
  matchLabel: string | null;
  explanation: string;
  videoUrl: string | null;
  createdAt: string;
};

type CommunityAwardModel = {
  id: string;
  submittedByUserId: string;
  name: string;
  condition: string;
  prize: string;
  supplementaryNote: string | null;
  publicNote: string | null;
  reviewNote: string | null;
  status: string;
  outcomeNote: string | null;
  submitterName: string;
  recipientName: string | null;
  evidence?: CommunityAwardEvidenceModel[];
};

type CommunityAwardBoardData = {
  awards: CommunityAwardModel[];
  candidates: Awaited<ReturnType<typeof getSeasonAwardCandidates>>;
  matches: { id: string; label: string }[];
};

async function getMatchOptions(executor: CommunityAwardQueryable, seasonId: string, stagePlan: StagePlan) {
  const matchRows = await executor.select({ id: matches.id, stage: matches.stage, round: matches.round, entryRound: matches.entryRound, aName: competitionEntries.name, bId: matches.entryBId }).from(matches).innerJoin(competitionEntries, eq(matches.entryAId, competitionEntries.id)).where(eq(matches.seasonId, seasonId));
  const bIds = [...new Set(matchRows.map((row) => row.bId))];
  const bRows = bIds.length ? await executor.select({ id: competitionEntries.id, name: competitionEntries.name }).from(competitionEntries).where(inArray(competitionEntries.id, bIds)) : [];
  const bNames = new Map(bRows.map((row) => [row.id, row.name]));
  return matchRows.map((row) => ({ id: row.id, label: presentMatchLabel({ stage: row.stage, stageName: stagePlan.find((stage) => stage.key === row.stage)?.name, round: row.round, entryRound: row.entryRound, teamAName: row.aName, teamBName: bNames.get(row.bId) ?? "TBD" }) }));
}

export async function getPublicCommunityAwardBoardData(executor: CommunityAwardQueryable, args: { seasonId: string; currentUserId: string | null; stagePlan: StagePlan }): Promise<CommunityAwardBoardData> {
  const recipient = alias(users, "community_award_recipient");
  const publicAward = or(inArray(communityAwards.status, PUBLIC_COMMUNITY_AWARD_STATUSES), and(eq(communityAwards.status, "withdrawn"), isNotNull(communityAwards.reviewedAt)));
  const [rows, candidates, matchOptions] = await Promise.all([
    executor.select({ id: communityAwards.id, submittedByUserId: communityAwards.submittedByUserId, name: communityAwards.name, condition: communityAwards.condition, prize: communityAwards.prize, supplementaryNote: communityAwards.supplementaryNote, publicNote: communityAwards.publicNote, reviewNote: communityAwards.reviewNote, reviewedAt: communityAwards.reviewedAt, status: communityAwards.status, outcomeNote: communityAwards.outcomeNote, submitter: { displayName: users.displayName, perfectName: users.perfectName, steamName: users.steamName }, recipient: { displayName: recipient.displayName, perfectName: recipient.perfectName, steamName: recipient.steamName } }).from(communityAwards).innerJoin(users, eq(communityAwards.submittedByUserId, users.id)).leftJoin(recipient, eq(communityAwards.recipientUserId, recipient.id)).where(and(eq(communityAwards.seasonId, args.seasonId), args.currentUserId ? or(publicAward, eq(communityAwards.submittedByUserId, args.currentUserId)) : publicAward)).orderBy(asc(communityAwards.createdAt)),
    getSeasonAwardCandidates(executor, args.seasonId),
    getMatchOptions(executor, args.seasonId, args.stagePlan),
  ]);
  return { awards: rows.filter((row) => row.submittedByUserId === args.currentUserId || isPublicCommunityAward(row.status, row.reviewedAt)).map((row) => ({ id: row.id, submittedByUserId: row.submittedByUserId, name: row.name, condition: row.condition, prize: row.prize, supplementaryNote: row.supplementaryNote, publicNote: row.publicNote, reviewNote: row.submittedByUserId === args.currentUserId ? row.reviewNote : null, status: row.status, submitterName: getPublicDisplayName(row.submitter), recipientName: row.recipient ? getPublicDisplayName(row.recipient) : null, outcomeNote: row.outcomeNote })), candidates, matches: matchOptions };
}

export async function getAdminCommunityAwardBoardData(executor: CommunityAwardQueryable, args: { seasonId: string; stagePlan: StagePlan }): Promise<CommunityAwardBoardData> {
  const recipient = alias(users, "award_recipient");
  const evidenceSubmitter = alias(users, "evidence_submitter");
  const evidenceCandidate = alias(users, "evidence_candidate");
  const [awardRows, evidenceRows, candidates, matchOptions] = await Promise.all([
    executor.select({ id: communityAwards.id, submittedByUserId: communityAwards.submittedByUserId, name: communityAwards.name, condition: communityAwards.condition, prize: communityAwards.prize, supplementaryNote: communityAwards.supplementaryNote, publicNote: communityAwards.publicNote, reviewNote: communityAwards.reviewNote, status: communityAwards.status, outcomeNote: communityAwards.outcomeNote, submitter: { displayName: users.displayName, perfectName: users.perfectName, steamName: users.steamName }, recipient: { displayName: recipient.displayName, perfectName: recipient.perfectName, steamName: recipient.steamName } }).from(communityAwards).innerJoin(users, eq(communityAwards.submittedByUserId, users.id)).leftJoin(recipient, eq(communityAwards.recipientUserId, recipient.id)).where(eq(communityAwards.seasonId, args.seasonId)).orderBy(asc(communityAwards.createdAt)),
    executor.select({ id: communityAwardEvidence.id, awardId: communityAwardEvidence.awardId, explanation: communityAwardEvidence.explanation, videoUrl: communityAwardEvidence.videoUrl, createdAt: communityAwardEvidence.createdAt, matchId: communityAwardEvidence.matchId, submitter: { displayName: evidenceSubmitter.displayName, perfectName: evidenceSubmitter.perfectName, steamName: evidenceSubmitter.steamName }, candidate: { displayName: evidenceCandidate.displayName, perfectName: evidenceCandidate.perfectName, steamName: evidenceCandidate.steamName } }).from(communityAwardEvidence).innerJoin(communityAwards, eq(communityAwardEvidence.awardId, communityAwards.id)).innerJoin(evidenceSubmitter, eq(communityAwardEvidence.submittedByUserId, evidenceSubmitter.id)).leftJoin(evidenceCandidate, eq(communityAwardEvidence.candidateUserId, evidenceCandidate.id)).where(eq(communityAwards.seasonId, args.seasonId)),
    getSeasonAwardCandidates(executor, args.seasonId),
    getMatchOptions(executor, args.seasonId, args.stagePlan),
  ]);
  const matchLabels = new Map(matchOptions.map((match) => [match.id, match.label]));
  const evidenceByAward = new Map<string, CommunityAwardEvidenceModel[]>();
  for (const row of evidenceRows) {
    const list = evidenceByAward.get(row.awardId) ?? [];
    list.push({ id: row.id, submitterName: getPublicDisplayName(row.submitter), candidateName: row.candidate ? getPublicDisplayName(row.candidate) : null, matchLabel: row.matchId ? matchLabels.get(row.matchId) ?? null : null, explanation: row.explanation, videoUrl: row.videoUrl, createdAt: row.createdAt.toLocaleString("zh-CN") });
    evidenceByAward.set(row.awardId, list);
  }
  return { awards: awardRows.map((row) => ({ ...row, submitterName: getPublicDisplayName(row.submitter), recipientName: row.recipient ? getPublicDisplayName(row.recipient) : null, evidence: evidenceByAward.get(row.id) ?? [] })), candidates, matches: matchOptions };
}
