import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionEntries, competitionEntryParticipants, competitionEntryRestrictionOverrides, competitionEntryRosterMembers, competitionEntryRosterRevisions, seasons, seasonRegistrations, users, registrationDrafts } from "@/db/schema";
import { PageHeader } from "@/components/rivalhub";
import {
  RegistrationReviewList,
  type RegistrationRow,
} from "@/components/admin/RegistrationReviewList";
import { DraftRegistrationTable } from "@/components/admin/DraftRegistrationTable";
import { CompetitionEntryReviewList } from "@/components/admin/CompetitionEntryReviewList";
import { isTeamRegistration } from "@/lib/utils/season";
import { getDisplayName } from "@/lib/identity/display-name";
import { evaluateRosterQualificationFromFacts, getParticipantReadinessBatch, isHomeAffiliatedMember, loadParticipantQualificationFacts, resolveCompetitiveContext, resolveSeasonEducationVerification, type ParticipantQualificationFacts } from "@/lib/qualification/service";
import { sameQualificationFindingSnapshot } from "@/lib/competition-entries/restriction-overrides";
import { normalizeAffiliationRules, normalizeTeamRegistrationConfig } from "@/types/season";
import { presentSeasonStatus } from "@/lib/seasons/presentation";
import { normalizeSteamProfileUrl } from "@/lib/external-url";

interface PageProps {
  params: Promise<{ seasonSlug: string }>;
}

export default async function AdminRegistrationsPage({ params }: PageProps) {
  const { seasonSlug } = await params;

  // 1. 查赛季
  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  if (!season) notFound();

  if (isTeamRegistration(season)) {
    const entries = await db
      .select({
        id: competitionEntries.id,
        name: competitionEntries.name,
        source: competitionEntries.source,
        status: competitionEntries.registrationStatus,
        reviewReason: competitionEntries.reviewReason,
        perfectTeamId: competitionEntries.perfectTeamId,
        currentRosterRevisionId: competitionEntries.currentRosterRevisionId,
        representative: { displayName: users.displayName, perfectName: users.perfectName, steamName: users.steamName, email: users.email },
      })
      .from(competitionEntries)
      .innerJoin(users, eq(competitionEntries.representativeUserId, users.id))
      .where(eq(competitionEntries.competitionId, season.id))
      .orderBy(desc(competitionEntries.updatedAt));
    const entryIds = entries.map((entry) => entry.id);
    const overrideRows = entryIds.length === 0
      ? []
      : await db.select().from(competitionEntryRestrictionOverrides).where(and(
          eq(competitionEntryRestrictionOverrides.competitionId, season.id),
          inArray(competitionEntryRestrictionOverrides.entryId, entryIds),
          isNull(competitionEntryRestrictionOverrides.revokedAt),
        ));
    const rosterRows = entryIds.length === 0
      ? []
      : await db
          .select({ entryId: competitionEntryRosterRevisions.entryId, revisionId: competitionEntryRosterRevisions.id, revision: competitionEntryRosterRevisions.revisionNumber, participantId: competitionEntryParticipants.id, userId: users.id, email: users.email, displayName: users.displayName, perfectName: users.perfectName, steamName: users.steamName, status: competitionEntryParticipants.status, primary: competitionEntryRosterMembers.isPrimaryStarter })
          .from(competitionEntryRosterRevisions)
          .innerJoin(competitionEntryRosterMembers, eq(competitionEntryRosterMembers.revisionId, competitionEntryRosterRevisions.id))
          .innerJoin(competitionEntryParticipants, eq(competitionEntryParticipants.id, competitionEntryRosterMembers.participantId))
          .innerJoin(users, eq(users.id, competitionEntryRosterMembers.userId))
          .where(inArray(competitionEntryRosterRevisions.entryId, entryIds));
    const teamConfig = normalizeTeamRegistrationConfig(season.teamRegistrationConfig);
    const affiliationRules = normalizeAffiliationRules(season.affiliationRules);
    const userIds = [...new Set(rosterRows.map((member) => member.userId))];
    const hasCompetitiveProfile = Boolean(teamConfig.requireCompetitiveProfile && teamConfig.competitiveProfile);
    const competitiveContext = hasCompetitiveProfile
      ? await resolveCompetitiveContext(teamConfig.competitiveProfile!)
      : undefined;
    const needsQualificationFacts = hasCompetitiveProfile || affiliationRules.length > 0;
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
    const reviewRows = await Promise.all(entries.map(async (entry) => {
      const members = rosterRows
        .filter((member) => member.entryId === entry.id && member.revisionId === entry.currentRosterRevisionId)
        .map((member) => ({
          ...member,
          label: getDisplayName(member),
          readiness: readinessByUser.get(member.userId),
        }));
      const qualification = competitiveContext === null
        ? { blockers: ["该赛事采用的竞技资料暂时无法核验。"], findings: [{ code: "competitive_context_unavailable", message: "该赛事采用的竞技资料暂时无法核验。", waivable: false }] }
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
      ...entry,
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
    return (
      <div className="container mx-auto max-w-3xl px-4 py-8">
        <PageHeader title={`赛事报名审核 · ${season.name}`} description={`${entries.length} 支报名队伍 · 赛季状态：${presentSeasonStatus(season.status).label}`} />
        <CompetitionEntryReviewList entries={reviewRows} />
      </div>
    );
  }

  // 2. 并行查报名记录 + 草稿
  const [rows, drafts] = await Promise.all([
    db
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
      .where(eq(seasonRegistrations.seasonId, season.id))
      .orderBy(asc(seasonRegistrations.createdAt)),
    db
      .select()
      .from(registrationDrafts)
      .where(eq(registrationDrafts.seasonId, season.id))
      .orderBy(desc(registrationDrafts.updatedAt)),
  ]);

  const registrations: RegistrationRow[] = rows.map((r) => ({
    ...r,
    status: r.status ?? "pending",
    email: r.email ?? "",
    screenshotUrls: r.screenshotUrls ?? [],
    mapPreferences: r.mapPreferences ?? [],
    createdAt: r.createdAt?.toISOString() ?? "",
    competitionHistory: r.competitionHistory ?? null,
    notes: r.notes ?? null,
    studentId: r.studentId ?? null,
    steamName: r.steamName ?? null,
    displayName: r.displayName ?? null,
    perfectName: r.perfectName ?? null,
    steam64: r.steam64 ?? null,
    steamProfileUrl: normalizeSteamProfileUrl(r.steamProfileUrl),
    qq: r.qq ?? null,
  }));

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <PageHeader title={`报名审核 · ${season.name}`} description={`${registrations.length} 份已提交 · ${drafts.length} 份草稿 · 赛季状态：${presentSeasonStatus(season.status).label}`} />

      <RegistrationReviewList registrations={registrations} />

      <DraftRegistrationTable drafts={drafts} />
    </div>
  );
}
