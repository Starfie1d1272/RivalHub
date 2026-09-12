import "server-only";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { presentMatchStatus } from "@/lib/matches/presentation";
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
  status?: "scheduled" | "in_progress";
}) {
  return {
    title: input.status === "in_progress" ? "你的当前比赛" : "你的下一场",
    detail: `对阵 ${input.opponentName} · ${presentMatchStatus(input.status ?? "scheduled", { scheduledAt: input.scheduledAt }).label}`,
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
      status: matches.status,
      entryAId: matches.entryAId,
      entryBId: matches.entryBId,
      scheduledAt: matches.scheduledAt,
    })
    .from(matches)
    .where(and(
      eq(matches.seasonId, season.id),
      inArray(matches.status, ["scheduled", "in_progress"]),
      or(inArray(matches.entryAId, entryIds), inArray(matches.entryBId, entryIds)),
    ))
    .orderBy(sql`case when ${matches.status} = 'in_progress' then 0 else 1 end`, asc(matches.scheduledAt), asc(matches.id));
  const match = upcoming[0];
  if (!match) return null;

  const opponentId = entryIds.includes(match.entryAId) ? match.entryBId : match.entryAId;
  const opponent = await db.query.competitionEntries.findFirst({
    where: and(eq(competitionEntries.id, opponentId), publicCompetitionEntryCondition()),
    columns: { name: true },
  });
  if (!opponent) return null;
  return presentUpcomingMatchTask({ matchId: match.id, seasonSlug: season.slug, opponentName: opponent.name, scheduledAt: match.scheduledAt, status: match.status === "in_progress" ? "in_progress" : "scheduled" });
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
