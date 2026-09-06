import "server-only";

import { and, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  competitionEntries,
  competitionEntryParticipants,
  competitionEntryRestrictionOverrides,
  competitionEntryRosterMembers,
  competitionEntryRosterRevisions,
  seasonRegistrations,
  users,
} from "@/db/schema";
import {
  evaluateRosterQualificationFromFacts,
  getParticipantReadinessBatch,
  isHomeAffiliatedMember,
  loadParticipantQualificationFacts,
  resolveCompetitiveContext,
  resolveSeasonEducationVerification,
  type ParticipantQualificationFacts,
} from "@/lib/qualification/service";
import { sameQualificationFindingSnapshot } from "@/lib/competition-entries/restriction-overrides";
import { escapeLikePattern } from "@/lib/db/search";
import { getDisplayName } from "@/lib/identity/display-name";
import { normalizeSteamProfileUrl } from "@/lib/external-url";
import { normalizeAffiliationRules, normalizeTeamRegistrationConfig, type Season } from "@/types/season";
import {
  SOLO_REGISTRATION_REVIEW_DEFAULTS,
  SOLO_REGISTRATION_REVIEW_PAGE_SIZE,
  TEAM_REGISTRATION_REVIEW_DEFAULTS,
  TEAM_REGISTRATION_REVIEW_PAGE_SIZE,
  type RegistrationReviewSearchParams,
  type RegistrationRow,
  type SoloRegistrationReviewQuery,
  type SoloRegistrationReviewResult,
  type SoloRegistrationReviewSort,
  type SoloRegistrationReviewStatus,
  type TeamQualificationFilter,
  type TeamRegistrationReviewQuery,
  type TeamRegistrationReviewResult,
  type TeamRegistrationReviewSort,
  type TeamRegistrationReviewStatus,
} from "./admin-review-contract";

const TEAM_REVIEW_STATUSES = [
  "submitted",
  "approved",
  "waitlisted",
  "changes_requested",
  "rejected",
  "withdrawn",
] as const;

const SOLO_REVIEW_STATUSES = ["pending", "approved", "rejected", "waitlisted"] as const;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function readParam(input: RegistrationReviewSearchParams, key: string): string | undefined {
  return input instanceof URLSearchParams ? input.get(key) ?? undefined : firstValue(input[key]);
}

function positivePage(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1;
}

export function normalizeTeamRegistrationReviewQuery(input: RegistrationReviewSearchParams): TeamRegistrationReviewQuery {
  const statusValue = readParam(input, "status");
  const qualificationValue = readParam(input, "qualification");
  const sortValue = readParam(input, "sort");
  const status: TeamRegistrationReviewStatus = statusValue === "all" || TEAM_REVIEW_STATUSES.includes(statusValue as typeof TEAM_REVIEW_STATUSES[number])
    ? statusValue as TeamRegistrationReviewStatus
    : TEAM_REGISTRATION_REVIEW_DEFAULTS.status;
  const qualification: TeamQualificationFilter = qualificationValue === "ready" || qualificationValue === "blocked" || qualificationValue === "all"
    ? qualificationValue
    : TEAM_REGISTRATION_REVIEW_DEFAULTS.qualification;
  const sort: TeamRegistrationReviewSort = sortValue === "newest_updated" || sortValue === "oldest"
    ? sortValue
    : TEAM_REGISTRATION_REVIEW_DEFAULTS.sort;

  return {
    q: readParam(input, "q")?.trim() || undefined,
    status,
    qualification,
    sort,
    page: positivePage(readParam(input, "page")),
    pageSize: TEAM_REGISTRATION_REVIEW_PAGE_SIZE,
  };
}

export function normalizeSoloRegistrationReviewQuery(
  input: RegistrationReviewSearchParams,
  positions: readonly string[],
): SoloRegistrationReviewQuery {
  const statusValue = readParam(input, "status");
  const sortValue = readParam(input, "sort");
  const requestedPosition = readParam(input, "position");
  const status: SoloRegistrationReviewStatus = statusValue === "all" || SOLO_REVIEW_STATUSES.includes(statusValue as typeof SOLO_REVIEW_STATUSES[number])
    ? statusValue as SoloRegistrationReviewStatus
    : SOLO_REGISTRATION_REVIEW_DEFAULTS.status;
  const sort: SoloRegistrationReviewSort = sortValue === "newest" || sortValue === "oldest"
    ? sortValue
    : SOLO_REGISTRATION_REVIEW_DEFAULTS.sort;

  return {
    q: readParam(input, "q")?.trim() || undefined,
    status,
    position: requestedPosition && positions.includes(requestedPosition) ? requestedPosition : undefined,
    sort,
    page: positivePage(readParam(input, "page")),
    pageSize: SOLO_REGISTRATION_REVIEW_PAGE_SIZE,
  };
}

type TeamReviewSeason = Pick<
  Season,
  "id" | "teamRegistrationConfig" | "affiliationRules" | "minTeamSize" | "maxTeamSize" | "starterCount"
>;

export async function getTeamRegistrationReview(
  season: TeamReviewSeason,
  query: TeamRegistrationReviewQuery,
): Promise<TeamRegistrationReviewResult> {
  const conditions = [
    eq(competitionEntries.competitionId, season.id),
    query.status === "all"
      ? inArray(competitionEntries.registrationStatus, [...TEAM_REVIEW_STATUSES])
      : eq(competitionEntries.registrationStatus, query.status),
  ];
  if (query.q) {
    const pattern = `%${escapeLikePattern(query.q)}%`;
    conditions.push(or(
      ilike(competitionEntries.name, pattern),
      ilike(users.displayName, pattern),
      ilike(users.perfectName, pattern),
      ilike(users.steamName, pattern),
      ilike(users.email, pattern),
    )!);
  }
  const where = and(...conditions);
  const orderBy = query.sort === "oldest"
    ? [sql`${competitionEntries.submittedAt} ASC NULLS LAST`, asc(competitionEntries.id)]
    : [desc(competitionEntries.updatedAt), desc(competitionEntries.id)];

  const [entries, [datasetCount], [reviewQueueCount]] = await Promise.all([
    db
      .select({
        id: competitionEntries.id,
        name: competitionEntries.name,
        source: competitionEntries.source,
        status: competitionEntries.registrationStatus,
        reviewReason: competitionEntries.reviewReason,
        perfectTeamId: competitionEntries.perfectTeamId,
        currentRosterRevisionId: competitionEntries.currentRosterRevisionId,
        representative: {
          displayName: users.displayName,
          perfectName: users.perfectName,
          steamName: users.steamName,
          email: users.email,
        },
      })
      .from(competitionEntries)
      .innerJoin(users, eq(competitionEntries.representativeUserId, users.id))
      .where(where)
      .orderBy(...orderBy),
    db
      .select({ count: count() })
      .from(competitionEntries)
      .innerJoin(users, eq(competitionEntries.representativeUserId, users.id))
      .where(where),
    db
      .select({ count: count() })
      .from(competitionEntries)
      .where(and(
        eq(competitionEntries.competitionId, season.id),
        inArray(competitionEntries.registrationStatus, [...TEAM_REVIEW_STATUSES]),
      )),
  ]);

  const entryIds = entries.map((entry) => entry.id);
  const [overrideRows, rosterRows] = entryIds.length === 0
    ? [[], []]
    : await Promise.all([
        db
          .select()
          .from(competitionEntryRestrictionOverrides)
          .where(and(
            eq(competitionEntryRestrictionOverrides.competitionId, season.id),
            inArray(competitionEntryRestrictionOverrides.entryId, entryIds),
            sql`${competitionEntryRestrictionOverrides.revokedAt} IS NULL`,
          )),
        db
          .select({
            entryId: competitionEntryRosterRevisions.entryId,
            revisionId: competitionEntryRosterRevisions.id,
            revision: competitionEntryRosterRevisions.revisionNumber,
            participantId: competitionEntryParticipants.id,
            userId: users.id,
            email: users.email,
            displayName: users.displayName,
            perfectName: users.perfectName,
            steamName: users.steamName,
            status: competitionEntryParticipants.status,
            primary: competitionEntryRosterMembers.isPrimaryStarter,
          })
          .from(competitionEntryRosterRevisions)
          .innerJoin(competitionEntryRosterMembers, eq(competitionEntryRosterMembers.revisionId, competitionEntryRosterRevisions.id))
          .innerJoin(competitionEntryParticipants, eq(competitionEntryParticipants.id, competitionEntryRosterMembers.participantId))
          .innerJoin(users, eq(users.id, competitionEntryRosterMembers.userId))
          .where(inArray(competitionEntryRosterRevisions.entryId, entryIds)),
      ]);

  const teamConfig = normalizeTeamRegistrationConfig(season.teamRegistrationConfig);
  const affiliationRules = normalizeAffiliationRules(season.affiliationRules);
  const userIds = [...new Set(rosterRows.map((member) => member.userId))];
  const requiresCompetitiveProfile = Boolean(teamConfig.requireCompetitiveProfile);
  const hasCompetitiveProfile = Boolean(requiresCompetitiveProfile && teamConfig.competitiveProfile);
  const competitiveContext = requiresCompetitiveProfile
    ? teamConfig.competitiveProfile
      ? await resolveCompetitiveContext(teamConfig.competitiveProfile)
      : null
    : undefined;
  const needsQualificationFacts = requiresCompetitiveProfile || affiliationRules.length > 0;
  const qualificationFacts: Map<string, ParticipantQualificationFacts> = needsQualificationFacts
    ? await loadParticipantQualificationFacts(userIds, {
        platform: competitiveContext?.platform ?? teamConfig.competitiveProfile?.platform,
        fallbackPlatform: competitiveContext?.fallbackConversion?.sourcePlatform,
        includeCompetitiveFacts: hasCompetitiveProfile,
      })
    : new Map();
  const readinessByUser = hasCompetitiveProfile
    ? await getParticipantReadinessBatch(userIds, teamConfig.competitiveProfile!, { facts: qualificationFacts })
    : new Map();

  const projectedRows = await Promise.all(entries.map(async (entry) => {
    const members = rosterRows
      .filter((member) => member.entryId === entry.id && member.revisionId === entry.currentRosterRevisionId)
      .map((member) => ({
        ...member,
        label: getDisplayName(member),
        readiness: readinessByUser.get(member.userId),
      }));
    const qualification = competitiveContext === null
      ? {
          blockers: ["该赛事采用的竞技资料暂时无法核验。"],
          findings: [{ code: "competitive_context_unavailable", message: "该赛事采用的竞技资料暂时无法核验。", waivable: false }],
        }
      : await evaluateRosterQualificationFromFacts({
          members: members.map((member) => {
            const fact = qualificationFacts.get(member.userId);
            const education = resolveSeasonEducationVerification(fact?.educationHistory ?? [], affiliationRules).selectedVerification;
            return {
              userId: member.userId,
              email: fact?.email ?? member.email,
              emailVerifiedAt: fact?.emailVerifiedAt ?? null,
              educationHistory: fact?.educationHistory ?? [],
              isHome: isHomeAffiliatedMember(education ?? { institutionCode: null, academicStatus: null }, affiliationRules),
            };
          }),
          facts: qualificationFacts,
          affiliationRules,
          competitiveProfile: competitiveContext,
          primaryStarterUserIds: members.filter((member) => member.primary).map((member) => member.userId),
        });
    return {
      id: entry.id,
      name: entry.name,
      source: entry.source,
      status: entry.status as Exclude<TeamRegistrationReviewStatus, "all">,
      reviewReason: entry.reviewReason,
      perfectTeamId: entry.perfectTeamId,
      representativeName: getDisplayName(entry.representative),
      members,
      minRoster: season.minTeamSize,
      maxRoster: season.maxTeamSize,
      starterCount: season.starterCount,
      qualificationBlockers: qualification.blockers,
      qualificationFindings: qualification.findings,
      activeRestrictionOverrides: overrideRows
        .filter((override) => override.entryId === entry.id && override.rosterRevisionId === entry.currentRosterRevisionId)
        .map((override) => ({
          id: override.id,
          restrictionCode: override.restrictionCode,
          findingSnapshot: override.findingSnapshot,
          reason: override.reason,
          grantedBy: override.grantedBy,
          grantedAt: override.grantedAt.toISOString(),
          snapshotMatches: sameQualificationFindingSnapshot(
            override.findingSnapshot,
            qualification.findings.find((finding) => finding.code === override.restrictionCode) ?? {
              code: override.restrictionCode,
              message: "当前资格结果中不存在该限制。",
              waivable: false,
            },
          ),
        })),
    };
  }));

  const filteredRows = query.qualification === "all"
    ? projectedRows
    : projectedRows.filter((row) => (row.qualificationFindings.length === 0) === (query.qualification === "ready"));
  const total = filteredRows.length;
  const totalPages = Math.ceil(total / TEAM_REGISTRATION_REVIEW_PAGE_SIZE);
  const page = totalPages > 0 ? Math.min(query.page, totalPages) : 1;
  const start = (page - 1) * TEAM_REGISTRATION_REVIEW_PAGE_SIZE;

  return {
    rows: filteredRows.slice(start, start + TEAM_REGISTRATION_REVIEW_PAGE_SIZE),
    total,
    page,
    pageSize: TEAM_REGISTRATION_REVIEW_PAGE_SIZE,
    totalPages,
    normalizedQuery: { ...query, page },
    hasAnyRecords: Number(reviewQueueCount?.count ?? datasetCount?.count ?? 0) > 0,
  };
}

export async function getSoloRegistrationReview(
  seasonId: string,
  positions: readonly string[],
  query: SoloRegistrationReviewQuery,
): Promise<SoloRegistrationReviewResult> {
  const conditions = [eq(seasonRegistrations.seasonId, seasonId)];
  if (query.q) {
    const pattern = `%${escapeLikePattern(query.q)}%`;
    conditions.push(or(
      ilike(users.displayName, pattern),
      ilike(users.perfectName, pattern),
      ilike(users.steamName, pattern),
      ilike(users.email, pattern),
    )!);
  }
  if (query.status !== "all") conditions.push(eq(seasonRegistrations.status, query.status));
  if (query.position && positions.includes(query.position)) {
    conditions.push(or(
      eq(seasonRegistrations.primaryPosition, query.position),
      eq(seasonRegistrations.secondaryPosition, query.position),
    )!);
  }
  const where = and(...conditions);
  const orderBy = query.sort === "oldest"
    ? [asc(seasonRegistrations.createdAt), asc(seasonRegistrations.id)]
    : [desc(seasonRegistrations.updatedAt), desc(seasonRegistrations.id)];

  const [[totalRow], [datasetRow]] = await Promise.all([
    db
      .select({ count: count() })
      .from(seasonRegistrations)
      .leftJoin(users, eq(seasonRegistrations.userId, users.id))
      .where(where),
    db.select({ count: count() }).from(seasonRegistrations).where(eq(seasonRegistrations.seasonId, seasonId)),
  ]);
  const total = Number(totalRow?.count ?? 0);
  const totalPages = Math.ceil(total / SOLO_REGISTRATION_REVIEW_PAGE_SIZE);
  const page = totalPages > 0 ? Math.min(query.page, totalPages) : 1;
  const rows = await db
    .select({
      id: seasonRegistrations.id,
      primaryPosition: seasonRegistrations.primaryPosition,
      secondaryPosition: seasonRegistrations.secondaryPosition,
      peakRank: seasonRegistrations.peakRank,
      peakRankSeason: seasonRegistrations.peakRankSeason,
      peakRating: seasonRegistrations.peakRating,
      currentSeasonPeakRank: seasonRegistrations.currentSeasonPeakRank,
      currentRating: seasonRegistrations.currentRating,
      screenshotUrls: seasonRegistrations.screenshotUrls,
      mapPreferences: seasonRegistrations.mapPreferences,
      gameplayStyle: seasonRegistrations.gameplayStyle,
      competitionHistory: seasonRegistrations.competitionHistory,
      notes: seasonRegistrations.notes,
      willingToBeCaptain: seasonRegistrations.willingToBeCaptain,
      status: seasonRegistrations.status,
      createdAt: seasonRegistrations.createdAt,
      email: users.email,
      studentId: users.studentId,
      steamName: users.steamName,
      displayName: users.displayName,
      perfectName: users.perfectName,
      steam64: users.steam64,
      steamProfileUrl: users.steamProfileUrl,
      qq: users.qq,
    })
    .from(seasonRegistrations)
    .leftJoin(users, eq(seasonRegistrations.userId, users.id))
    .where(where)
    .orderBy(...orderBy)
    .limit(SOLO_REGISTRATION_REVIEW_PAGE_SIZE)
    .offset((page - 1) * SOLO_REGISTRATION_REVIEW_PAGE_SIZE);

  const registrations: RegistrationRow[] = rows.map((row) => ({
    ...row,
    status: row.status ?? "pending",
    email: row.email ?? "",
    screenshotUrls: row.screenshotUrls ?? [],
    mapPreferences: row.mapPreferences ?? [],
    createdAt: row.createdAt?.toISOString() ?? "",
    competitionHistory: row.competitionHistory ?? null,
    notes: row.notes ?? null,
    studentId: row.studentId ?? null,
    steamName: row.steamName ?? null,
    displayName: row.displayName ?? null,
    perfectName: row.perfectName ?? null,
    steam64: row.steam64 ?? null,
    steamProfileUrl: normalizeSteamProfileUrl(row.steamProfileUrl),
    qq: row.qq ?? null,
  }));

  return {
    rows: registrations,
    total,
    page,
    pageSize: SOLO_REGISTRATION_REVIEW_PAGE_SIZE,
    totalPages,
    normalizedQuery: { ...query, page },
    hasAnyRecords: Number(datasetRow?.count ?? 0) > 0,
  };
}
