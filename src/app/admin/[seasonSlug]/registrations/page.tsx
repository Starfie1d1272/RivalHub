import { notFound } from "next/navigation";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionEntries, competitionEntryParticipants, competitionEntryRosterMembers, competitionEntryRosterRevisions, seasons, seasonRegistrations, users, registrationDrafts } from "@/db/schema";
import { Marker } from "@/components/rivalhub";
import {
  RegistrationReviewList,
  type RegistrationRow,
} from "@/components/admin/RegistrationReviewList";
import { DraftRegistrationTable } from "@/components/admin/DraftRegistrationTable";
import { CompetitionEntryReviewList } from "@/components/admin/CompetitionEntryReviewList";
import { isTeamRegistration } from "@/lib/utils/season";

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
        currentRosterRevision: competitionEntries.currentRosterRevision,
        representativeEmail: users.email,
      })
      .from(competitionEntries)
      .innerJoin(users, eq(competitionEntries.representativeUserId, users.id))
      .where(eq(competitionEntries.competitionId, season.id))
      .orderBy(desc(competitionEntries.updatedAt));
    const entryIds = entries.map((entry) => entry.id);
    const rosterRows = entryIds.length === 0
      ? []
      : await db
          .select({ entryId: competitionEntryRosterRevisions.entryId, revision: competitionEntryRosterRevisions.revision, participantId: competitionEntryParticipants.id, userId: users.id, email: users.email, displayName: users.displayName, perfectId: users.perfectId, status: competitionEntryParticipants.status, primary: competitionEntryRosterMembers.isPrimaryStarter })
          .from(competitionEntryRosterRevisions)
          .innerJoin(competitionEntryRosterMembers, eq(competitionEntryRosterMembers.revisionId, competitionEntryRosterRevisions.id))
          .innerJoin(competitionEntryParticipants, eq(competitionEntryParticipants.id, competitionEntryRosterMembers.participantId))
          .innerJoin(users, eq(users.id, competitionEntryRosterMembers.userId))
          .where(inArray(competitionEntryRosterRevisions.entryId, entryIds));
    const reviewRows = entries.map((entry) => ({
      ...entry,
      members: rosterRows.filter((member) => member.entryId === entry.id && member.revision === entry.currentRosterRevision),
      minRoster: season.minTeamSize,
      maxRoster: season.maxTeamSize,
      starterCount: season.starterCount,
    }));
    return (
      <div className="container mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6"><Marker sub={`${entries.length} 支报名队伍 · 赛季状态：${season.status}`}>赛事报名审核 · {season.name}</Marker></div>
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
    steamProfileUrl: r.steamProfileUrl ?? null,
    qq: r.qq ?? null,
  }));

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <div className="mb-6">
        <Marker sub={`${registrations.length} 份已提交 · ${drafts.length} 份草稿 · 赛季状态：${season.status}`}>报名审核 · {season.name}</Marker>
      </div>

      <RegistrationReviewList registrations={registrations} />

      <DraftRegistrationTable drafts={drafts} />
    </div>
  );
}
