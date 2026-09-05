import type { CompetitionEntry, Match, MatchMap, Season } from "@/db/schema";
import type { MajorPlayoffRuntimeData, MajorSwissRuntimeData } from "@/lib/admin/major-runtime";
import type { TeamStanding } from "@/lib/standings";
import type { StageConfig, StagePlan } from "@/types/season";

export interface TeamMemberData {
  id: string;
  entryId: string;
  steamName: string;
  displayName: string | null;
  perfectName: string | null;
  primaryPosition: string;
}

export interface RosterData {
  rosterId: string | null;
  starters: string[];
  substitutes: string[];
  status: string | null;
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
  commentaryEffectiveness: AdminCommentaryEffectiveness[];
  unconfiguredMatches: AdminMatchSummary[];
  standingsByStage: Map<string, TeamStanding[]>;
  qualifierStandings: TeamStanding[];
  qualifierStage: StageConfig | null;
  playoffStage: StageConfig | null;
  batchDeadlineGroups: {
    label: string;
    stage: string;
    round?: number | null;
    entryRound?: string | null;
    matchCount: number;
  }[];
  canGenerate: boolean;
  canGeneratePlayoff: boolean;
  hasLegacyAdjacentPlayoff: boolean;
  hasSwissStage: boolean;
  defaultStageKey: string | null;
  swissRuntime: MajorSwissRuntimeData | null;
  playoffRuntime: MajorPlayoffRuntimeData | null;
}

export interface AdminMatchWorkbenchData {
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
  postMatch: AdminPostMatchRecordData | null;
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
