import type { MapPreference } from "@/types/season";
import type { QualificationFinding } from "@/lib/qualification/finding";

export const TEAM_REGISTRATION_REVIEW_PAGE_SIZE = 25;
export const SOLO_REGISTRATION_REVIEW_PAGE_SIZE = 25;

export const TEAM_REGISTRATION_REVIEW_DEFAULTS = {
  q: "",
  status: "submitted",
  qualification: "all",
  sort: "oldest",
} as const;

export const SOLO_REGISTRATION_REVIEW_DEFAULTS = {
  q: "",
  status: "pending",
  position: "",
  sort: "oldest",
} as const;

export type RegistrationReviewSearchParams = Record<string, string | string[] | undefined> | URLSearchParams;
export type TeamRegistrationReviewStatus = "submitted" | "approved" | "waitlisted" | "changes_requested" | "rejected" | "withdrawn" | "all";
export type TeamQualificationFilter = "all" | "ready" | "blocked";
export type TeamRegistrationReviewSort = "oldest" | "newest_updated";
export type SoloRegistrationReviewStatus = "pending" | "approved" | "rejected" | "waitlisted" | "all";
export type SoloRegistrationReviewSort = "oldest" | "newest";

export interface TeamRegistrationReviewQuery {
  q?: string;
  status: TeamRegistrationReviewStatus;
  qualification: TeamQualificationFilter;
  sort: TeamRegistrationReviewSort;
  page: number;
  pageSize: typeof TEAM_REGISTRATION_REVIEW_PAGE_SIZE;
}

export interface SoloRegistrationReviewQuery {
  q?: string;
  status: SoloRegistrationReviewStatus;
  position?: string;
  sort: SoloRegistrationReviewSort;
  page: number;
  pageSize: typeof SOLO_REGISTRATION_REVIEW_PAGE_SIZE;
}

export interface RegistrationRow {
  id: string;
  primaryPosition: string;
  secondaryPosition: string;
  peakRank: string;
  peakRankSeason: string;
  peakRating: number;
  currentSeasonPeakRank: string;
  currentRating: number;
  screenshotUrls: string[];
  mapPreferences: MapPreference[];
  gameplayStyle: string;
  competitionHistory: string | null;
  notes: string | null;
  willingToBeCaptain: boolean;
  status: string;
  createdAt: string;
  email: string;
  studentId: string | null;
  steamName: string | null;
  displayName: string | null;
  perfectName: string | null;
  steam64: string | null;
  steamProfileUrl: string | null;
  qq: string | null;
}

export interface TeamRegistrationReviewMember {
  participantId: string;
  userId: string;
  email: string;
  label: string;
  status: "invited" | "confirmed" | "declined" | "withdrawn";
  primary: boolean;
  readiness?: {
    ready: boolean;
    blockers: string[];
    findings: QualificationFinding[];
    educationApproved: boolean;
  };
}

export interface TeamRegistrationReviewRow {
  id: string;
  name: string;
  source: "linked_team" | "event_native";
  status: Exclude<TeamRegistrationReviewStatus, "all">;
  reviewReason: string | null;
  perfectTeamId: string | null;
  logoUrl: string | null;
  updatedAt: string;
  representativeName: string;
  minRoster: number;
  maxRoster: number;
  starterCount: number;
  qualificationBlockers: string[];
  qualificationFindings: QualificationFinding[];
  activeRestrictionOverrides: Array<{
    id: string;
    restrictionCode: string;
    findingSnapshot: unknown;
    reason: string;
    grantedBy: string;
    grantedAt: string;
    snapshotMatches: boolean;
  }>;
  members: TeamRegistrationReviewMember[];
}

export interface TeamRegistrationProgressRow {
  id: string;
  name: string;
  source: "linked_team" | "event_native";
  representativeName: string;
  updatedAt: string;
  rosterCount: number;
  minRoster: number;
  maxRoster: number;
  confirmedCount: number;
  starterCount: number;
  requiredStarterCount: number;
  primaryBlockers: string[];
}

export interface TeamRegistrationProgressResult {
  drafts: TeamRegistrationProgressRow[];
  summary: {
    total: number;
    draft: number;
    submitted: number;
    approved: number;
    changesRequested: number;
    waitlisted: number;
    rejected: number;
    withdrawn: number;
  };
}

export interface TeamRegistrationReviewResult {
  rows: TeamRegistrationReviewRow[];
  total: number;
  page: number;
  pageSize: typeof TEAM_REGISTRATION_REVIEW_PAGE_SIZE;
  totalPages: number;
  normalizedQuery: TeamRegistrationReviewQuery;
  hasAnyRecords: boolean;
}

export interface SoloRegistrationReviewResult {
  rows: RegistrationRow[];
  total: number;
  page: number;
  pageSize: typeof SOLO_REGISTRATION_REVIEW_PAGE_SIZE;
  totalPages: number;
  normalizedQuery: SoloRegistrationReviewQuery;
  hasAnyRecords: boolean;
}
