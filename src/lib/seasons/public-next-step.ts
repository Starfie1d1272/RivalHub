import "server-only";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionEntries, eventRosterMembers, eventRosters, matches } from "@/db/schema";
import { getUserSession } from "@/lib/auth/session";
import { publicCompetitionEntryCondition } from "@/lib/competition-entries/public-visibility";
import { loadMyReadiness } from "@/lib/my/readiness";
import { loadCompetitionEntryParticipantContext } from "@/lib/competition-entries/participant-context";
import type { PublicSeason } from "@/lib/data/public-seasons";

export function presentUpcomingMatchTask(input: {
  matchId: string;
  seasonSlug: string;
  opponentName: string;
  scheduledAt: Date | null;
}) {
  return {
    title: "你的下一场",
    detail: input.scheduledAt ? `对阵 ${input.opponentName} · 赛程已安排` : `对阵 ${input.opponentName} · 时间待定`,
    href: `/${input.seasonSlug}/matches/${input.matchId}`,
  };
}

async function getPlayingSeasonNextStep(season: PublicSeason, userId: string) {
  const rosterRows = await db
    .select({ entryId: competitionEntries.id })
    .from(eventRosterMembers)
    .innerJoin(eventRosters, eq(eventRosters.id, eventRosterMembers.eventRosterId))
    .innerJoin(competitionEntries, eq(competitionEntries.id, eventRosters.entryId))
    .where(and(
      eq(eventRosterMembers.userId, userId),
      eq(competitionEntries.competitionId, season.id),
      publicCompetitionEntryCondition(),
      inArray(eventRosters.status, ["confirmed", "frozen"]),
    ));
  const entryIds = [...new Set(rosterRows.map((row) => row.entryId))];
  if (!entryIds.length) return null;

  const upcoming = await db
    .select({
      id: matches.id,
      entryAId: matches.entryAId,
      entryBId: matches.entryBId,
      scheduledAt: matches.scheduledAt,
    })
    .from(matches)
    .where(and(
      eq(matches.seasonId, season.id),
      eq(matches.status, "scheduled"),
      or(inArray(matches.entryAId, entryIds), inArray(matches.entryBId, entryIds)),
    ))
    .orderBy(asc(matches.scheduledAt), asc(matches.id));
  const match = upcoming[0];
  if (!match) return null;

  const opponentId = entryIds.includes(match.entryAId) ? match.entryBId : match.entryAId;
  const opponent = await db.query.competitionEntries.findFirst({
    where: and(eq(competitionEntries.id, opponentId), publicCompetitionEntryCondition()),
    columns: { name: true },
  });
  if (!opponent) return null;
  return presentUpcomingMatchTask({ matchId: match.id, seasonSlug: season.slug, opponentName: opponent.name, scheduledAt: match.scheduledAt });
}

/** Authenticated handoff only; all mutations remain in their existing workflow. */
export async function getSeasonPersonalNextStep(season: PublicSeason) {
  const session = await getUserSession();
  if (!session?.userId) return null;
  if (season.status === "playing") return getPlayingSeasonNextStep(season, session.userId);
  if (season.status !== "registration") return null;
  const readiness = await loadMyReadiness(session.userId);
  const context = season.registrationMode === "team"
    ? await loadCompetitionEntryParticipantContext({ competitionId: season.id, userId: session.userId }) : null;
  const competition = readiness.competitions.find((entry) => entry.id === context?.primaryEntry?.id);
  const items = competition ? [competition.entry, competition.qualification, readiness.profile, readiness.education] : [readiness.profile, readiness.education];
  const task = items.find((item) => ["blocked", "incomplete"].includes(item.state) || item.owner === "我" || item.owner === "我与赛事管理员");
  return task ? { title: task.cta.label, detail: task.detail, href: task.cta.href } : null;
}
