import type { CompetitionMatch } from "@/lib/matches/competition-context";
import type { CompetitionEntry, Match as DbMatch, MatchMap, MatchRosterStatus, Season } from "@/db/schema";
import type { MajorPlayoffRuntimeData, MajorSwissRuntimeData } from "@/lib/admin/major-runtime";
import type { TeamStanding } from "@/lib/standings";
import type { StageConfig, StagePlan } from "@/types/season";
import type { SwissStageReadModel } from "@/lib/matches/stage-read-model";
import type { CompetitionQualificationRun } from "@/db/schema";
import type { OperatorWorkflow, PerfectRoomGuideData } from "./operator-workflow";
import type { AdminMatchCommentaryData } from "./commentary";

type Match = CompetitionMatch<DbMatch>;

export type OperatorLineupPlayer = { name: string; userId?: string; steam64: string | null; profileUrl: string | null };
export type OperatorLineupDifference = { missing: OperatorLineupPlayer[]; unexpected: OperatorLineupPlayer[]; duplicated: OperatorLineupPlayer[] };

export interface TeamMemberData {
  userId: string;
  id: string;
  entryId: string;
  personaName: string | null;
  displayName: string | null;
  perfectName: string | null;
  primaryPosition: string;
  isCurrent: boolean;
}

export interface RosterData {
  rosterId: string | null;
  starters: string[];
  substitutes: string[];
  vetoRepresentativeEventRosterMemberId: string | null;
  status: MatchRosterStatus | null;
}

export interface AdminMatchPreflight {
  valid: boolean;
  blockers: string[];
}

export interface AdminPostMatchRecordData {
  commentators: { userId: string; name: string; hasLiveStream: boolean }[];
  seasonAdmins: { userId: string; name: string; hasLiveStream: boolean }[];
  submittedAt: Date | null;
  submittedByUserId: string | null;
  videoUrl: string | null;
  completionLabel: string;
  canSubmit: boolean;
}

export interface AdminCommentaryEffectiveness {
  admin: { userId: string; name: string; hasLiveStream: boolean };
  matches: AdminMatchSummary[];
}

/** Explicit summary projection used by the season-level matches overview. */
export interface AdminMatchSummary {
  id: Match["id"];
  entryAId: Match["entryAId"];
  entryBId: Match["entryBId"];
  stage: Match["stage"];
  round: Match["round"];
  format: Match["format"];
  entryRound: Match["entryRound"];
  scoreA: Match["scoreA"];
  scoreB: Match["scoreB"];
  status: Match["status"];
  isForfeit: Match["isForfeit"];
  ownership: Match["ownership"];
  scheduledAt: Match["scheduledAt"];
  demoNeedsAttentionCount?: number;
}

export interface AdminDemoReviewCandidate {
  eventRosterMemberId: string;
  entryId: string;
  name: string;
  steam64: string | null;
}

export interface AdminDemoReviewParticipant {
  entryId: string;
  observedSteam64: string;
  demoName: string;
  teamName: string;
  state: "confirmable" | "conflict-retirable" | "conflict-nonretirable" | "roster-mismatch" | "blocked";
  currentPlayer: { userId: string; name: string } | null;
  retirableIdentityId: string | null;
  note: string | null;
  candidates: AdminDemoReviewCandidate[];
  observedSteamProfile?: {
    personaName: string;
    avatarUrl: string | null;
    profileUrl: string;
  } | null;
}

export interface AdminDemoReviewMap {
  importId: string;
  matchMapId: string;
  mapOrder: number;
  mapName: string;
  invalidPayload: boolean;
  message: string;
  resolvedCount: number;
  blockingIssues: string[];
  participants: AdminDemoReviewParticipant[];
}

export interface AdminCompletedMap {
  mapOrder: number;
  mapName: string;
  scoreA: number;
  scoreB: number;
  pickedByEntryId: string | null;
  teamAStartSide: "t" | "ct" | null;
}

export interface AdminPendingMap {
  mapOrder: number;
  mapName: string;
  pickedByEntryId: string | null;
  teamAStartSide: "t" | "ct" | null;
}

export interface AdminFinishedMap {
  id: string;
  mapName: string;
  scoreA: number;
  scoreB: number;
}

export interface AdminMatchOverviewData {
  season: Pick<Season, "id" | "slug" | "name" | "status">;
  teams: Pick<CompetitionEntry, "id" | "name">[];
  stagePlan: StagePlan;
  matches: AdminMatchSummary[];
  stageViews: { stage: StageConfig; matches: AdminMatchSummary[] }[];
  stageReadModels: Map<string, SwissStageReadModel>;
  qualificationRun: Pick<CompetitionQualificationRun, "id" | "format" | "playInEntryCount"> | null;
  commentaryEffectiveness: AdminCommentaryEffectiveness[];
  unconfiguredMatches: AdminMatchSummary[];
  standingsByStage: Map<string, TeamStanding[]>;
  batchDeadlineGroups: {
    label: string;
    stage: string;
    round?: number | null;
    entryRound?: string | null;
    matchCount: number;
  }[];
  canGenerate: boolean;
  hasSwissStage: boolean;
  defaultStageKey: string | null;
  swissRuntime: MajorSwissRuntimeData | null;
  playoffRuntime: MajorPlayoffRuntimeData | null;
}

export interface AdminMatchWorkbenchData {
  completion: { official: string; data: string; production: string };
  broadcasts?: { name: string; label: string }[];
  uploaderDownloads?: { windows: string; macos: string } | null;
  season: Pick<Season, "id" | "slug" | "name">;
  stageName: string | null;
  match: Match;
  teamAName: string;
  teamBName: string;
  mapPool: string[];
  teamAMembers: TeamMemberData[];
  teamBMembers: TeamMemberData[];
  teamARoster: RosterData | null;
  teamBRoster: RosterData | null;
  teamAPreflight: AdminMatchPreflight | null;
  teamBPreflight: AdminMatchPreflight | null;
  completedMaps: AdminCompletedMap[];
  pendingMaps: AdminPendingMap[];
  finishedMaps: AdminFinishedMap[];
  vetoCompletedAt: Date | null;
  officialMapStart?: { mapId: string; mapName: string } | null;
  postMatch: AdminPostMatchRecordData | null;
  demoReviews?: AdminDemoReviewMap[];
  operator: {
    liveScope?: { authorityRevision: number; generation: number; epoch: number; mapId: string | null } | null;
    problemRecovery?: { sessionId: string; mapEpoch: number; mapId: string; recoverMapBinding: boolean; mapLabel: string; reportContext: { programSourceGeneration: number; lastReliableSeq: number; currentMapId: string | null } } | null;
    review?: { expectedTeams: string; currentMap: string | null; officialScore: string | null; evidence: { lineupDifference?: OperatorLineupDifference | null; at: string; mapBinding: string; mapName: string | null; scoreA: number | null; scoreB: number | null } | null }; workflow: OperatorWorkflow; roomGuide: PerfectRoomGuideData | null; recoveryMapLabel?: string | null; takeover?: { sessionId: string; mapEpoch: number; mapId: string; recoverMapBinding?: boolean } | null };
  commentary: AdminMatchCommentaryData;
}

export type AdminMatchMapRecord = Pick<
  MatchMap,
  | "id"
  | "matchId"
  | "mapOrder"
  | "mapName"
  | "scoreA"
  | "scoreB"
  | "pickedByEntryId"
  | "teamAStartSide"
>;
