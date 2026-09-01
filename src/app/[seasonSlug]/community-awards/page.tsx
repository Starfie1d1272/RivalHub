import { and, asc, eq, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { communityAwards, competitionEntries, competitionEntryParticipants, matches, seasonAdminGrants, seasonRegistrations, seasons, users } from "@/db/schema";
import { CommunityAwardsBoard } from "@/components/community-awards/CommunityAwardsBoard";
import { getCurrentUserAuthorization } from "@/lib/auth/session";
import { getPublicDisplayName } from "@/lib/identity/display-name";

async function getAwardBoardData(seasonId: string) {
  const recipient = alias(users, "community_award_recipient");
  const [awards, candidates, seasonMatches] = await Promise.all([
    db.select({ award: communityAwards, submitter: { displayName: users.displayName, perfectName: users.perfectName, steamName: users.steamName }, recipient: { displayName: recipient.displayName, perfectName: recipient.perfectName, steamName: recipient.steamName } }).from(communityAwards).innerJoin(users, eq(communityAwards.submittedByUserId, users.id)).leftJoin(recipient, eq(communityAwards.recipientUserId, recipient.id)).where(and(eq(communityAwards.seasonId, seasonId), inArray(communityAwards.status, ["approved", "awarded", "not_awarded", "cancelled"]))).orderBy(asc(communityAwards.createdAt)),
    db.selectDistinct({ id: users.id, displayName: users.displayName, perfectName: users.perfectName, steamName: users.steamName }).from(users)
      .leftJoin(seasonRegistrations, eq(seasonRegistrations.userId, users.id))
      .leftJoin(seasonAdminGrants, eq(seasonAdminGrants.userId, users.id))
      .leftJoin(competitionEntryParticipants, eq(competitionEntryParticipants.userId, users.id))
      .leftJoin(competitionEntries, eq(competitionEntryParticipants.entryId, competitionEntries.id))
      .where(or(eq(seasonRegistrations.seasonId, seasonId), eq(seasonAdminGrants.seasonId, seasonId), eq(competitionEntries.competitionId, seasonId))),
    db.select({ id: matches.id, stage: matches.stage, round: matches.round }).from(matches).where(eq(matches.seasonId, seasonId)).orderBy(asc(matches.createdAt)),
  ]);
  return { awards: awards.map((row) => ({ ...row.award, submitterName: getPublicDisplayName(row.submitter), recipientName: row.recipient ? getPublicDisplayName(row.recipient) : null })), candidates: candidates.map((candidate) => ({ id: candidate.id, name: getPublicDisplayName(candidate) })), matches: seasonMatches.map((match) => ({ id: match.id, label: `${match.stage}${match.round ? ` · 第 ${match.round} 轮` : ""}` })) };
}

export default async function CommunityAwardsPage({ params }: { params: Promise<{ seasonSlug: string }> }) {
  const { seasonSlug } = await params;
  const season = await db.query.seasons.findFirst({ where: eq(seasons.slug, seasonSlug) });
  if (!season) notFound();
  const [data, authorization] = await Promise.all([getAwardBoardData(season.id), getCurrentUserAuthorization()]);
  const isAdmin = authorization?.role === "super_admin" || authorization?.seasonIds.includes(season.id) || false;
  return <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8"><div><h1 className="text-2xl font-bold">社区奖 · {season.name}</h1><p className="mt-1 text-sm text-[var(--color-fg-mid)]">社区提出创意，赛事方审核与确认结果。正式赛事荣誉仍由独立的官方荣誉记录维护。</p></div><CommunityAwardsBoard seasonId={season.id} awards={data.awards} currentUserId={authorization?.userId ?? null} isAdmin={isAdmin} candidates={data.candidates} matches={data.matches} /></div>;
}
