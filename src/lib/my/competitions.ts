import "server-only";

import { cache } from "react";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  competitionEntries,
  competitionEntryActiveClaims,
  competitionEntryParticipants,
  competitionEntryRosterRevisions,
  eventRosterMembers,
  eventRosters,
  matches,
  seasons,
} from "@/db/schema";
import {
  selectCompetitionEntryParticipantContext,
  type CompetitionEntrySelectionEntry,
} from "@/lib/competition-entries/participant-context";
import {
  presentCompetitionEntryParticipation,
  presentCompetitionEntryRegistration,
  type CompetitionEntryParticipantStatus,
  type CompetitionEntryRegistrationStatus,
} from "@/lib/competition-entries/presentation";
import { presentPersonalMatchTask, type PersonalMatchTask } from "@/lib/matches/presentation";
import { normalizeTeamRegistrationConfig } from "@/lib/seasons/compatibility";
import type { SeasonStatus } from "@/types/season";

export interface MyCompetitionSource {
  id: string;
  name: string;
  teamId: string | null;
  seasonId: string;
  seasonName: string;
  seasonSlug: string;
  seasonStatus: SeasonStatus;
  seasonCreatedAt: Date;
  entryUpdatedAt: Date;
  registrationStatus: CompetitionEntryRegistrationStatus;
  revisionOrigin?: import("@/lib/competition-entries/remediation").CompetitionEntryRosterRevisionOrigin | null;
  participantStatus: CompetitionEntryParticipantStatus | null;
  representativeUserId: string;
  teamRegistrationConfig: Parameters<typeof normalizeTeamRegistrationConfig>[0];
}

export interface MyCompetitionSourceCandidate extends MyCompetitionSource {
  activeClaimEntryId: string | null;
}

export interface MyCompetitionAction {
  href: string;
  label: string;
}

export interface MyCompetitionNextMatch {
  matchId: string;
  seasonId: string;
  seasonSlug: string;
  opponentName: string;
  scheduledAt: Date | null;
  status: "scheduled" | "in_progress";
}

export interface MyCompetitionContext {
  entryId: string;
  entryName: string;
  teamId: string | null;
  season: {
    id: string;
    name: string;
    slug: string;
    status: SeasonStatus;
  };
  viewerRole: "representative" | "participant" | "team_member";
  registration: ReturnType<typeof presentCompetitionEntryRegistration>;
  participation: ReturnType<typeof presentCompetitionEntryParticipation> | null;
  primaryAction: MyCompetitionAction;
  secondaryAction?: MyCompetitionAction;
  nextMatch?: PersonalMatchTask;
  seasonCreatedAt: Date;
  entryUpdatedAt: Date;
}

function selectionEntry(source: MyCompetitionSourceCandidate): CompetitionEntrySelectionEntry {
  return { id: source.id, name: source.name, updatedAt: source.entryUpdatedAt };
}

export function selectCanonicalMyCompetitionSources(
  rows: readonly MyCompetitionSourceCandidate[],
  userId: string,
): MyCompetitionSource[] {
  const rowsBySeason = new Map<string, MyCompetitionSourceCandidate[]>();
  for (const row of rows) {
    const seasonRows = rowsBySeason.get(row.seasonId) ?? [];
    seasonRows.push(row);
    rowsBySeason.set(row.seasonId, seasonRows);
  }

  const canonical: MyCompetitionSource[] = [];
  for (const seasonRows of rowsBySeason.values()) {
    const selection = selectCompetitionEntryParticipantContext({
      participantRows: seasonRows.flatMap((row) => row.participantStatus === null
        ? []
        : [{ entry: selectionEntry(row), participantStatus: row.participantStatus }]),
      representativeEntries: seasonRows
        .filter((row) => row.representativeUserId === userId)
        .map(selectionEntry),
      activeClaimEntries: seasonRows
        .filter((row) => row.activeClaimEntryId === row.id)
        .map(selectionEntry),
    });
    const selected = selection.primaryEntry
      ? seasonRows.find((row) => row.id === selection.primaryEntry!.id)
      : undefined;
    if (selected) {
      const source = { ...selected };
      Reflect.deleteProperty(source, "activeClaimEntryId");
      canonical.push(source);
    }
  }
  return canonical;
}

export const loadMyCompetitionSources = cache(async (userId: string): Promise<MyCompetitionSource[]> => {
  const rows = await db
    .select({
      id: competitionEntries.id,
      name: competitionEntries.name,
      teamId: competitionEntries.teamId,
      seasonId: seasons.id,
      seasonName: seasons.name,
      seasonSlug: seasons.slug,
      seasonStatus: seasons.status,
      seasonCreatedAt: seasons.createdAt,
      entryUpdatedAt: competitionEntries.updatedAt,
      registrationStatus: competitionEntries.registrationStatus,
      revisionOrigin: competitionEntryRosterRevisions.origin,
      participantStatus: competitionEntryParticipants.status,
      representativeUserId: competitionEntries.representativeUserId,
      teamRegistrationConfig: seasons.teamRegistrationConfig,
      activeClaimEntryId: competitionEntryActiveClaims.entryId,
    })
    .from(competitionEntries)
    .innerJoin(seasons, eq(seasons.id, competitionEntries.competitionId))
    .leftJoin(competitionEntryRosterRevisions, eq(competitionEntryRosterRevisions.id, competitionEntries.currentRosterRevisionId))
    .leftJoin(
      competitionEntryParticipants,
      and(eq(competitionEntryParticipants.entryId, competitionEntries.id), eq(competitionEntryParticipants.userId, userId)),
    )
    .leftJoin(
      competitionEntryActiveClaims,
      and(
        eq(competitionEntryActiveClaims.entryId, competitionEntries.id),
        eq(competitionEntryActiveClaims.competitionId, competitionEntries.competitionId),
        eq(competitionEntryActiveClaims.userId, userId),
      ),
    )
    .where(or(
      eq(competitionEntries.representativeUserId, userId),
      eq(competitionEntryParticipants.userId, userId),
      eq(competitionEntryActiveClaims.userId, userId),
    ))
    .orderBy(desc(seasons.createdAt), desc(competitionEntries.updatedAt), asc(competitionEntries.id));
  return selectCanonicalMyCompetitionSources(rows, userId);
});

export const loadTeamCompetitionSources = cache(async (teamId: string, userId: string): Promise<MyCompetitionSource[]> => {
  return db
    .select({
      id: competitionEntries.id,
      name: competitionEntries.name,
      teamId: competitionEntries.teamId,
      seasonId: seasons.id,
      seasonName: seasons.name,
      seasonSlug: seasons.slug,
      seasonStatus: seasons.status,
      seasonCreatedAt: seasons.createdAt,
      entryUpdatedAt: competitionEntries.updatedAt,
      registrationStatus: competitionEntries.registrationStatus,
      revisionOrigin: competitionEntryRosterRevisions.origin,
      participantStatus: competitionEntryParticipants.status,
      representativeUserId: competitionEntries.representativeUserId,
      teamRegistrationConfig: seasons.teamRegistrationConfig,
    })
    .from(competitionEntries)
    .innerJoin(seasons, eq(seasons.id, competitionEntries.competitionId))
    .leftJoin(competitionEntryRosterRevisions, eq(competitionEntryRosterRevisions.id, competitionEntries.currentRosterRevisionId))
    .leftJoin(
      competitionEntryParticipants,
      and(eq(competitionEntryParticipants.entryId, competitionEntries.id), eq(competitionEntryParticipants.userId, userId)),
    )
    .where(eq(competitionEntries.teamId, teamId))
    .orderBy(desc(seasons.createdAt), desc(competitionEntries.updatedAt), asc(competitionEntries.id));
});

export async function loadMyCompetitionNextMatches(userId: string): Promise<Map<string, MyCompetitionNextMatch>> {
  const rosterRows = await db
    .select({ seasonId: seasons.id, seasonSlug: seasons.slug, entryId: competitionEntries.id })
    .from(eventRosterMembers)
    .innerJoin(eventRosters, eq(eventRosters.id, eventRosterMembers.eventRosterId))
    .innerJoin(competitionEntries, eq(competitionEntries.id, eventRosters.entryId))
    .innerJoin(seasons, eq(seasons.id, competitionEntries.competitionId))
    .where(and(
      eq(eventRosterMembers.userId, userId),
      eq(seasons.status, "playing"),
      inArray(eventRosters.status, ["confirmed", "frozen"]),
    ));

  const entryContexts = new Map<string, { seasonId: string; seasonSlug: string }>();
  for (const row of rosterRows) {
    entryContexts.set(row.entryId, { seasonId: row.seasonId, seasonSlug: row.seasonSlug });
  }
  if (entryContexts.size === 0) return new Map();

  const entryIds = [...entryContexts.keys()];
  const seasonIds = [...new Set([...entryContexts.values()].map((context) => context.seasonId))];

  const upcoming = await db
    .select({
      id: matches.id,
      seasonId: matches.seasonId,
      status: matches.status,
      entryAId: matches.entryAId,
      entryBId: matches.entryBId,
      scheduledAt: matches.scheduledAt,
    })
    .from(matches)
    .where(and(
      inArray(matches.seasonId, seasonIds),
      inArray(matches.status, ["scheduled", "in_progress"]),
      or(
        inArray(matches.entryAId, entryIds),
        inArray(matches.entryBId, entryIds),
      ),
    ))
    .orderBy(sql`case when ${matches.status} = 'in_progress' then 0 else 1 end`, asc(matches.scheduledAt), asc(matches.id));

  const validMatches = upcoming.flatMap((match) => {
    const ownA = entryContexts.get(match.entryAId);
    const ownB = entryContexts.get(match.entryBId);
    if ((ownA && ownB) || (!ownA && !ownB)) return [];
    const own = ownA ?? ownB;
    if (!own || own.seasonId !== match.seasonId) return [];
    return [{
      match,
      ownEntryId: ownA ? match.entryAId : match.entryBId,
      own,
      opponentId: ownA ? match.entryBId : match.entryAId,
    }];
  });
  const opponentIds = [...new Set(validMatches.map(({ opponentId }) => opponentId))];
  if (opponentIds.length === 0) return new Map();

  const opponents = await db
    .select({ id: competitionEntries.id, name: competitionEntries.name })
    .from(competitionEntries)
    .where(inArray(competitionEntries.id, opponentIds));
  const opponentNames = new Map(opponents.map((opponent) => [opponent.id, opponent.name]));
  const result = new Map<string, MyCompetitionNextMatch>();
  for (const candidate of validMatches) {
    if (result.has(candidate.ownEntryId)) continue;
    const opponentName = opponentNames.get(candidate.opponentId);
    if (!opponentName) continue;
    result.set(candidate.ownEntryId, {
      matchId: candidate.match.id,
      seasonId: candidate.match.seasonId,
      seasonSlug: candidate.own.seasonSlug,
      opponentName,
      scheduledAt: candidate.match.scheduledAt,
      status: candidate.match.status === "in_progress" ? "in_progress" : "scheduled",
    });
  }
  return result;
}

export function projectMyCompetitionContext(
  source: MyCompetitionSource,
  userId: string,
  nextMatch?: MyCompetitionNextMatch | null,
): MyCompetitionContext {
  const isRepresentative = source.representativeUserId === userId;
  const viewerRole = isRepresentative
    ? "representative"
    : source.participantStatus !== null
      ? "participant"
      : "team_member";
  const registration = presentCompetitionEntryRegistration(source.registrationStatus, source.revisionOrigin);
  const participation = viewerRole === "team_member"
    ? null
    : presentCompetitionEntryParticipation(source.participantStatus, source.registrationStatus);
  const seasonHref = `/${source.seasonSlug}`;
  const registrationHref = `${seasonHref}/register`;
  const matchTask = viewerRole !== "team_member" && nextMatch
    ? presentPersonalMatchTask({
        matchId: nextMatch.matchId,
        seasonSlug: nextMatch.seasonSlug,
        opponentName: nextMatch.opponentName,
        scheduledAt: nextMatch.scheduledAt,
        status: nextMatch.status,
      })
    : undefined;

  let primaryAction: MyCompetitionAction;
  if (source.seasonStatus === "finished" || source.seasonStatus === "archived") {
    primaryAction = { href: seasonHref, label: "赛事回顾" };
  } else if (source.seasonStatus === "registration" && isRepresentative && source.registrationStatus === "draft") {
    primaryAction = { href: registrationHref, label: "继续报名" };
  } else if (source.seasonStatus === "registration" && isRepresentative && source.registrationStatus === "changes_requested") {
    primaryAction = {
      href: registrationHref,
      label: source.revisionOrigin === "self_roster_change" ? "继续调整名单" : "处理补正",
    };
  } else if (source.seasonStatus === "registration" && viewerRole === "participant" && source.participantStatus === "invited") {
    primaryAction = { href: registrationHref, label: "确认是否参赛" };
  } else if (source.seasonStatus === "playing" && matchTask) {
    primaryAction = { href: matchTask.href, label: matchTask.title };
  } else if (source.seasonStatus === "playing") {
    primaryAction = { href: seasonHref, label: "查看赛事" };
  } else if (viewerRole === "team_member") {
    primaryAction = { href: seasonHref, label: "查看赛事" };
  } else if (source.seasonStatus === "draft" || source.seasonStatus === "voting" || source.seasonStatus === "drafting") {
    primaryAction = { href: seasonHref, label: "查看赛事" };
  } else if (source.seasonStatus === "registration") {
    primaryAction = { href: registrationHref, label: "查看本届报名" };
  } else {
    primaryAction = { href: seasonHref, label: "查看赛事" };
  }

  const secondaryAction = viewerRole !== "team_member" && primaryAction.href !== registrationHref
    ? { href: registrationHref, label: "查看本届报名" }
    : undefined;

  return {
    entryId: source.id,
    entryName: source.name,
    teamId: source.teamId,
    season: { id: source.seasonId, name: source.seasonName, slug: source.seasonSlug, status: source.seasonStatus },
    viewerRole,
    registration,
    participation,
    primaryAction,
    ...(secondaryAction ? { secondaryAction } : {}),
    ...(matchTask ? { nextMatch: matchTask } : {}),
    seasonCreatedAt: source.seasonCreatedAt,
    entryUpdatedAt: source.entryUpdatedAt,
  };
}

export const loadMyCompetitionContexts = cache(async (userId: string): Promise<MyCompetitionContext[]> => {
  const [sources, nextMatches] = await Promise.all([loadMyCompetitionSources(userId), loadMyCompetitionNextMatches(userId)]);
  return sources.map((source) => projectMyCompetitionContext(source, userId, nextMatches.get(source.id)));
});

export const loadTeamCompetitionContexts = cache(async (teamId: string, userId: string): Promise<MyCompetitionContext[]> => {
  const [sources, nextMatches] = await Promise.all([loadTeamCompetitionSources(teamId, userId), loadMyCompetitionNextMatches(userId)]);
  return sources.map((source) => {
    const hasPersonalEntryContext = source.representativeUserId === userId || source.participantStatus !== null;
    return projectMyCompetitionContext(source, userId, hasPersonalEntryContext ? nextMatches.get(source.id) : undefined);
  });
});

export function groupMyCompetitionContexts(contexts: readonly MyCompetitionContext[]): { current: MyCompetitionContext[]; history: MyCompetitionContext[] } {
  const current: MyCompetitionContext[] = [];
  const history: MyCompetitionContext[] = [];
  for (const context of contexts) {
    (context.season.status === "finished" || context.season.status === "archived" ? history : current).push(context);
  }
  const sort = (a: MyCompetitionContext, b: MyCompetitionContext) => {
    const seasonDifference = b.seasonCreatedAt.getTime() - a.seasonCreatedAt.getTime();
    if (seasonDifference) return seasonDifference;
    const entryDifference = b.entryUpdatedAt.getTime() - a.entryUpdatedAt.getTime();
    if (entryDifference) return entryDifference;
    return a.entryId.localeCompare(b.entryId);
  };
  current.sort(sort);
  history.sort(sort);
  return { current, history };
}
