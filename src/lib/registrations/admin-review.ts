import "server-only";

import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  competitionEntries,
  competitionEntryParticipants,
  competitionEntryRestrictionOverrides,
  competitionEntryRosterMembers,
  competitionEntryRosterRevisions,
  seasonRegistrations,
  teamMemberships,
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
import { assessEntryRosterReadiness } from "@/lib/competition-entries/readiness";
import { escapeLikePattern } from "@/lib/db/search";
import { loadActiveSanctionsInTx } from "@/lib/discipline/service";
import { getDisplayName } from "@/lib/identity/display-name";
import { normalizePerfectTeamId } from "@/lib/competition-entries/perfect-team-id";
import { normalizeSteamProfileUrl } from "@/lib/external-url";
import { normalizeAffiliationRules, normalizeTeamRegistrationConfig } from "@/lib/seasons/compatibility";
import type { Season } from "@/types/season";
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
  type TeamRegistrationProgressResult,
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

type TeamEntryForProjection = {
  id: string;
  name: string;
  source: "linked_team" | "event_native";
  status: string;
  reviewReason: string | null;
  teamId: string | null;
  perfectTeamId: string | null;
  logoUrl: string | null;
  updatedAt: Date;
  currentRosterRevisionId: string | null;
  representative: {
    displayName: string | null;
    perfectName: string | null;
    steamName: string | null;
    email: string;
  };
};

export async function getTeamRegistrationReview(
  season: TeamReviewSeason,
  query: TeamRegistrationReviewQuery,
): Promise<TeamRegistrationReviewResult> {
  const conditions = [
    eq(competitionEntries.competitionId, season.id),
    eq(users.status, "active"),
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
        teamId: competitionEntries.teamId,
        perfectTeamId: competitionEntries.perfectTeamId,
        logoUrl: competitionEntries.logoUrl,
        updatedAt: competitionEntries.updatedAt,
        currentRosterRevisionId: competitionEntries.currentRosterRevisionId,
        representative: {
          displayName: users.displayName,
          perfectName: users.perfectName,
          steamName: users.steamName,
          email: users.email,
        },
      })
      .from(competitionEntries)
      .innerJoin(users, and(eq(competitionEntries.representativeUserId, users.id), eq(users.status, "active")))
      .where(where)
      .orderBy(...orderBy),
    db
      .select({ count: count() })
      .from(competitionEntries)
      .innerJoin(users, and(eq(competitionEntries.representativeUserId, users.id), eq(users.status, "active")))
      .where(where),
    db
      .select({ count: count() })
      .from(competitionEntries)
      .innerJoin(users, and(eq(competitionEntries.representativeUserId, users.id), eq(users.status, "active")))
      .where(and(
        eq(competitionEntries.competitionId, season.id),
        eq(users.status, "active"),
        inArray(competitionEntries.registrationStatus, [...TEAM_REVIEW_STATUSES]),
      )),
  ]);

  const projectedRows = await projectTeamRegistrationRows(season, entries, true);
  const reviewRows = projectedRows.map((row) => ({
    ...row,
    status: row.status as Exclude<TeamRegistrationReviewStatus, "all">,
  }));
  const filteredRows = query.qualification === "all"
    ? reviewRows
    : reviewRows.filter((row) => (row.qualificationFindings.length === 0) === (query.qualification === "ready"));
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

async function projectTeamRegistrationRows(
  season: TeamReviewSeason,
  entries: TeamEntryForProjection[],
  includeOverrides: boolean,
) {
  const entryIds = entries.map((entry) => entry.id);
  const [overrideRows, rosterRows] = entryIds.length === 0
    ? [[], []]
    : await Promise.all([
        includeOverrides ? db
          .select()
          .from(competitionEntryRestrictionOverrides)
          .where(and(
            eq(competitionEntryRestrictionOverrides.competitionId, season.id),
            inArray(competitionEntryRestrictionOverrides.entryId, entryIds),
            sql`${competitionEntryRestrictionOverrides.revokedAt} IS NULL`,
          )) : Promise.resolve([]),
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
        .innerJoin(users, and(eq(users.id, competitionEntryRosterMembers.userId), eq(users.status, "active")))
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
              label: member.label,
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
      perfectTeamId: normalizePerfectTeamId(entry.perfectTeamId),
      logoUrl: entry.logoUrl,
      updatedAt: entry.updatedAt.toISOString(),
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

  return projectedRows;
}

export async function getTeamRegistrationProgress(season: TeamReviewSeason): Promise<TeamRegistrationProgressResult> {
  const [draftEntries, statusRows] = await Promise.all([
    db.select({
      id: competitionEntries.id,
      name: competitionEntries.name,
      source: competitionEntries.source,
      status: competitionEntries.registrationStatus,
      reviewReason: competitionEntries.reviewReason,
      teamId: competitionEntries.teamId,
      perfectTeamId: competitionEntries.perfectTeamId,
      logoUrl: competitionEntries.logoUrl,
      updatedAt: competitionEntries.updatedAt,
      currentRosterRevisionId: competitionEntries.currentRosterRevisionId,
      representative: {
        displayName: users.displayName,
        perfectName: users.perfectName,
        steamName: users.steamName,
        email: users.email,
      },
    })
      .from(competitionEntries)
      .innerJoin(users, and(eq(competitionEntries.representativeUserId, users.id), eq(users.status, "active")))
      .where(and(eq(competitionEntries.competitionId, season.id), eq(competitionEntries.registrationStatus, "draft")))
      .orderBy(desc(competitionEntries.updatedAt), desc(competitionEntries.id)),
    db.select({ status: competitionEntries.registrationStatus, count: count() })
      .from(competitionEntries)
      .innerJoin(users, and(eq(competitionEntries.representativeUserId, users.id), eq(users.status, "active")))
      .where(eq(competitionEntries.competitionId, season.id))
      .groupBy(competitionEntries.registrationStatus),
  ]);
  const projectedDrafts = await projectTeamRegistrationRows(season, draftEntries, false);
  const counts = new Map(statusRows.map((row) => [row.status, Number(row.count)]));
  const draftUserIds = [...new Set(projectedDrafts.flatMap((entry) => entry.members.map((member) => member.userId)))];
  const draftTeamIds = [...new Set(draftEntries.flatMap((entry) => entry.teamId ? [entry.teamId] : []))];
  const [registrationBlocks, rosterBlocks, activeMemberships] = await Promise.all([
    draftUserIds.length > 0
      ? loadActiveSanctionsInTx(db, { seasonId: season.id, subjectUserIds: draftUserIds, effect: "registration_block" })
      : Promise.resolve(new Map()),
    draftUserIds.length > 0
      ? loadActiveSanctionsInTx(db, { seasonId: season.id, subjectUserIds: draftUserIds, effect: "roster_block" })
      : Promise.resolve(new Map()),
    draftTeamIds.length > 0 && draftUserIds.length > 0
      ? db.select({ teamId: teamMemberships.teamId, userId: teamMemberships.userId })
        .from(teamMemberships)
        .where(and(inArray(teamMemberships.teamId, draftTeamIds), inArray(teamMemberships.userId, draftUserIds), eq(teamMemberships.status, "active"), isNull(teamMemberships.endedAt)))
      : Promise.resolve([]),
  ]);
  const draftEntryById = new Map(draftEntries.map((entry) => [entry.id, entry]));
  const activeMembersByTeam = new Map<string, Set<string>>();
  for (const membership of activeMemberships) {
    const members = activeMembersByTeam.get(membership.teamId) ?? new Set<string>();
    members.add(membership.userId);
    activeMembersByTeam.set(membership.teamId, members);
  }

  return {
    drafts: projectedDrafts.map((entry) => {
      const sourceEntry = draftEntryById.get(entry.id)!;
      const draftUserIds = new Set(entry.members.map((member) => member.userId));
      const readiness = assessEntryRosterReadiness({
        entry: sourceEntry,
        season,
        members: entry.members.map((member) => ({ userId: member.userId, label: member.label, primary: member.primary, participantStatus: member.status })),
        qualificationFindings: entry.qualificationFindings,
        registrationBlockedUserIds: new Set([...registrationBlocks.keys()].filter((userId) => draftUserIds.has(userId))),
        rosterBlockedUserIds: new Set([...rosterBlocks.keys()].filter((userId) => draftUserIds.has(userId))),
        currentTeamMemberUserIds: sourceEntry.teamId ? activeMembersByTeam.get(sourceEntry.teamId) : undefined,
        requireCurrentTeamMembership: true,
        requireActiveRestrictionOverrides: false,
      });
      return {
        id: entry.id,
        name: entry.name,
        source: entry.source,
        representativeName: entry.representativeName,
        updatedAt: entry.updatedAt,
        rosterCount: readiness.rosterSize,
        minRoster: season.minTeamSize,
        maxRoster: season.maxTeamSize,
        confirmedCount: readiness.confirmedCount,
        starterCount: readiness.primaryStarterCount,
        requiredStarterCount: season.starterCount,
        primaryBlockers: readiness.blockers.slice(0, 3),
      };
    }),
    summary: {
      total: [...counts.values()].reduce((sum, value) => sum + value, 0),
      draft: counts.get("draft") ?? 0,
      submitted: counts.get("submitted") ?? 0,
      approved: counts.get("approved") ?? 0,
      changesRequested: counts.get("changes_requested") ?? 0,
      waitlisted: counts.get("waitlisted") ?? 0,
      rejected: counts.get("rejected") ?? 0,
      withdrawn: counts.get("withdrawn") ?? 0,
    },
  };
}

export async function getSoloRegistrationReview(
  seasonId: string,
  positions: readonly string[],
  query: SoloRegistrationReviewQuery,
): Promise<SoloRegistrationReviewResult> {
  const conditions = [eq(seasonRegistrations.seasonId, seasonId), eq(users.status, "active")];
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
    : [desc(seasonRegistrations.createdAt), desc(seasonRegistrations.id)];

  const [[totalRow], [datasetRow]] = await Promise.all([
    db
      .select({ count: count() })
      .from(seasonRegistrations)
      .innerJoin(users, and(eq(seasonRegistrations.userId, users.id), eq(users.status, "active")))
      .where(where),
    db.select({ count: count() }).from(seasonRegistrations).innerJoin(users, and(eq(seasonRegistrations.userId, users.id), eq(users.status, "active"))).where(eq(seasonRegistrations.seasonId, seasonId)),
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
    .innerJoin(users, and(eq(seasonRegistrations.userId, users.id), eq(users.status, "active")))
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
