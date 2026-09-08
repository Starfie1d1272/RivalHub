import type { MajorPrestartReadiness } from "@/lib/major/prestart";
import type { SeedOrderRowStatus } from "@/lib/major/team-seed-recommendation";
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

export interface MajorStrengthFact {
  rank: string;
  stars: number | null;
  sourcePlatform: string | null;
  sourceSeasonKey: string | null;
  sourceRank: string | null;
  sourceStars: number | null;
  conversionVersion: string | null;
}

export interface MajorStrengthStarter {
  userId: string;
  label: string;
  historicalPeak: MajorStrengthFact | null;
  previousSeasonPeak: MajorStrengthFact | null;
  currentSeasonPeak: MajorStrengthFact | null;
  recentSeasonPeaks: Array<MajorStrengthFact | null>;
  effectiveRecentPeak: MajorStrengthFact | null;
  breakdown: {
    available: boolean;
    blockers: string[];
    weightedRank: number | null;
    historicalValue: number | null;
    previousValue: number | null;
    currentValue: number | null;
    effectiveRecentPeak: MajorStrengthFact | null;
    historicalRating: number | null;
  };
}

export interface MajorStrengthTeam {
  teamId: string;
  teamName: string;
  available: boolean;
  blockers: string[];
  teamSeedStrength: number | null;
  teamSeedStrengthScaled: number | null;
  recommendationRank: number | null;
  tieGroup: number | null;
  displayOrder: number | null;
  starters: MajorStrengthStarter[];
}

export type MajorStrengthRecommendationTeam = Omit<MajorStrengthTeam, "teamSeedStrength" | "teamSeedStrengthScaled" | "recommendationRank" | "tieGroup" | "displayOrder"> & {
  teamSeedStrength: number;
  teamSeedStrengthScaled: number;
  recommendationRank: number;
  tieGroup: number;
  displayOrder: number;
};

export interface MajorPrestartStrengthPreview {
  status: "ready" | "unavailable";
  platform: string | null;
  conversionPolicyId: string | null;
  conversionPolicyVersion: string | null;
  blockers: string[];
  teams: MajorStrengthTeam[];
}

export interface MajorPrestartPageData {
  season: Pick<Season, "id" | "name" | "competitionTemplate">;
  readiness: MajorPrestartReadiness;
  management: {
    seasonId: string;
    entrantCapacity: number;
    entrantsLocked: boolean;
    strengthPreview: MajorPrestartStrengthPreview;
    approvedCandidates: Array<{
      id: string;
      name: string;
      representativeName: string;
      submittedAt: string | null;
      reviewedAt: string | null;
      approvedAt: string | null;
      qualificationStatus: "approved";
      selectedAsEntrant: boolean;
      roster: {
        memberCount: number;
        primaryStarterCount: number;
        members: Array<{ userId: string; email: string; isPrimaryStarter: boolean }>;
      };
    }>;
    entrants: Array<{
      id: string;
      teamId: string;
      teamName: string;
      rosterStatus: "preparing" | "confirmed" | "frozen";
      roster: Array<{ userId: string; email: string; isPrimaryStarter: boolean; educationVerified: boolean }>;
    }>;
    issues: Array<{ id: string; category: "qualification" | "administration"; label: string; resolved: boolean }>;
  };
  seedManagement: {
    seasonId: string;
    entrantsLocked: boolean;
    entrants: Array<{ teamId: string; teamName: string }>;
    seeds: Array<{ teamId: string; tournamentSeed: number }>;
    seedsConfirmed: boolean;
    recommendationStatus: "missing" | "ready" | "mismatch";
    recommendation: {
      version: 1;
      generatedAt: string;
      platform: string;
      conversionPolicyId: string | null;
      conversionPolicyVersion: string | null;
      teams: Array<MajorStrengthRecommendationTeam & {
        entrantId: string;
        finalSeed: number | null;
        finalOrderStatus: SeedOrderRowStatus;
      }>;
    } | null;
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
