import "server-only";
import { getUserSession } from "@/lib/auth/session";
import { loadMyReadiness } from "@/lib/my/readiness";
import { loadCompetitionEntryParticipantContext } from "@/lib/competition-entries/participant-context";
import type { PublicSeason } from "@/lib/data/public-seasons";

/** Authenticated handoff only; all mutations remain in their existing workflow. */
export async function getSeasonPersonalNextStep(season: PublicSeason) {
  if (season.status !== "registration") return null;
  const session = await getUserSession();
  if (!session?.userId) return null;
  const readiness = await loadMyReadiness(session.userId);
  const context = season.registrationMode === "team"
    ? await loadCompetitionEntryParticipantContext({ competitionId: season.id, userId: session.userId }) : null;
  const competition = readiness.competitions.find((entry) => entry.id === context?.primaryEntry?.id);
  const items = competition ? [competition.entry, competition.qualification, readiness.profile, readiness.education] : [readiness.profile, readiness.education];
  const task = items.find((item) => ["blocked", "incomplete"].includes(item.state) || item.owner === "我" || item.owner === "我与赛事管理员");
  return task ? { title: task.cta.label, detail: task.detail, href: task.cta.href } : null;
}
