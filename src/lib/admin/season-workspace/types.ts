import type { MajorPrestartReadiness } from "@/lib/major/prestart";
import type { Season } from "@/db/schema/seasons";

type SeasonWorkspaceOverviewSeason = Pick<
  Season,
  "id" | "slug" | "name" | "status" | "competitionTemplate" | "registrationMode" | "registrationOpenedAt" | "registrationOpensAt" | "registrationClosesAt" | "rosterChangeClosesAt" | "endAt"
>;

export interface SeasonWorkspaceOverviewSummary {
  pendingApplications: number;
  approvedEntries: number;
  formedTeamCount: number;
  entrantCount: number;
  frozenEntrantCount: number;
  matchCount: number;
  unresolvedPrestartIssues: number;
  scheduledMatchesWithoutConfirmedLineups: number;
  finalResultPendingConfirmation: boolean;
  activeAdjudications: number;
}

export interface SeasonWorkspaceNextAction {
  label: string;
  detail: string;
  href: string;
}

export interface SeasonWorkspaceOverviewData {
  season: SeasonWorkspaceOverviewSeason;
  summary: SeasonWorkspaceOverviewSummary;
  readiness: MajorPrestartReadiness | null;
  nextAction: SeasonWorkspaceNextAction;
}

export interface MajorPrestartPageData {
  season: Pick<Season, "id" | "name" | "competitionTemplate">;
  readiness: MajorPrestartReadiness;
  management: {
    seasonId: string;
    entrantsLocked: boolean;
    availableTeams: Array<{ id: string; name: string; members: Array<{ userId: string; email: string }> }>;
    entrants: Array<{
      id: string;
      teamId: string;
      teamName: string;
      rosterStatus: "preparing" | "confirmed" | "frozen";
      roster: Array<{ userId: string; email: string }>;
      candidates: Array<{ userId: string; email: string }>;
    }>;
    issues: Array<{ id: string; category: "qualification" | "administration"; label: string; resolved: boolean }>;
  };
  seedManagement: {
    seasonId: string;
    entrantsLocked: boolean;
    entrants: Array<{ teamId: string; teamName: string }>;
    seeds: Array<{ teamId: string; tournamentSeed: number }>;
    seedsConfirmed: boolean;
    firstRound: Array<{ higherSeed: number; lowerSeed: number; format: "bo1" | "bo3" }> | null;
  };
  started: boolean;
}

export interface PostEventPageData {
  season: Pick<Season, "id" | "name" | "status" | "competitionTemplate">;
  data: {
    seasonId: string;
    seasonStatus: string;
    competitionTemplate: Season["competitionTemplate"];
    matchCount: number;
    honorCount: number;
    activeAdjudicationCount: number;
    finalResult: { id: string; status: "pending_confirmation" | "confirmed"; championEntryId: string; placementGroups: Array<{ from: number; to: number; entryIds: string[] }> } | null;
    teams: Array<{ id: string; name: string }>;
    honors: Array<{ id: string; honorKey: string; type: string; label: string; state: string; entryId: string | null; userId: string | null; placementFrom: number | null; placementTo: number | null }>;
    adjudications: Array<{ id: string; status: string; kind: string; target: string; impacts: string[]; targetEntryId: string | null; targetUserId: string | null; targetMatchId: string | null; reason: string; explanation: string; createdAt: Date }>;
  };
}
