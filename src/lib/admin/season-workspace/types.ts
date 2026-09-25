import type { MajorPrestartReadiness } from "@/lib/major/prestart";
import type { RegistrationWindowPhase } from "@/lib/registration/window";
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
  scheduledMatchesWithoutConfirmedLineups: number;
  finalResultPendingConfirmation: boolean;
  activeAdjudications: number;
}

export interface SeasonWorkspaceNextAction {
  label: string;
  detail: string;
  href: string;
}

export interface SeasonWorkspaceTeamRegistrationFunnel {
  mode: "team";
  total: number;
  draft: number;
  submitted: number;
  approved: number;
  deadline: Date | null;
  windowPhase: RegistrationWindowPhase;
}

export interface SeasonWorkspaceOverviewData {
  season: SeasonWorkspaceOverviewSeason;
  summary: SeasonWorkspaceOverviewSummary;
  registrationFunnel: SeasonWorkspaceTeamRegistrationFunnel | null;
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
  presentation: {
    historicalPeak: MajorStrengthFact | null;
    referenceSeasonPeak: MajorStrengthFact | null;
    currentSeasonPeak: MajorStrengthFact | null;
    recentPeak: MajorStrengthFact | null;
    historicalRating: number | null;
    available: boolean;
    blockers: string[];
  };
}

export type MajorStrengthTieState = "not_ranked" | "not_tied" | "tied";

export interface MajorStrengthTeam {
  teamId: string;
  teamName: string;
  available: boolean;
  blockers: string[];
  recommendationRank: number | null;
  displayOrder: number | null;
  tieState: MajorStrengthTieState;
  starters: MajorStrengthStarter[];
}

export type MajorStrengthRecommendationTeam = Omit<MajorStrengthTeam, "recommendationRank"> & {
  recommendationRank: number;
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
    seasonSlug: string;
    seasonStatus: Season["status"];
    managedProfileId: "major-24" | "major-32";
    registrationClosesAt: string | null;
    registrationClosed: boolean;
    entrantCapacity: number;
    entrantsLocked: boolean;
    approvedCandidateCount: number;
    pendingReviewCount: number;
    initialPreliminaryOrderEntryIds: string[];
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
        members: Array<{ userId: string; label: string; isPrimaryStarter: boolean }>;
      };
    }>;
    entrants: Array<{
      id: string;
      teamId: string;
      teamName: string;
      rosterStatus: "preparing" | "confirmed" | "frozen";
      roster: Array<{ userId: string; label: string; isPrimaryStarter: boolean; educationVerified: boolean }>;
    }>;
    qualification: {
      run: {
        id: string;
        format: "direct_bo3" | "short_swiss_2w2l";
        targetEntrantCount: number;
        candidateCount: number;
        directEntryCount: number;
        playInEntryCount: number;
        qualifierCount: number;
        startedAt: string | null;
        completedAt: string | null;
        entrants: Array<{
          entryId: string;
          teamName: string;
          preliminarySeed: number;
          route: "direct" | "play-in";
          wins: number;
          losses: number;
          status: "active" | "advanced" | "eliminated" | "not_started";
        }>;
        currentRound: number;
        matchCount: number;
        finishedMatchCount: number;
      } | null;
    };
  };
  seedManagement: {
    seasonId: string;
    entrantCapacity: number;
    firstSwissStageName: string;
    entryCohorts: Array<{ stageKey: string; stageName: string; fromSeed: number; toSeed: number }>;
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
