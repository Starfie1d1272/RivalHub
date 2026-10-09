import "server-only";
import { loadMyCompetitionContexts } from "@/lib/my/competitions";
import { getUserSession } from "@/lib/auth/session";
import { loadMyReadiness, selectMyPrimaryAction, type MyReadinessItem } from "@/lib/my/readiness";
import { loadCompetitionEntryParticipantContext } from "@/lib/competition-entries/participant-context";
import type { PublicSeason } from "@/lib/data/public-seasons";

export { presentPersonalMatchTask as presentUpcomingMatchTask } from "@/lib/matches/presentation";

export function presentPersonalNextStep(items: readonly MyReadinessItem[]) {
  const task = selectMyPrimaryAction(items);
  return task ? { title: task.cta.label, detail: task.detail, href: task.cta.href } : null;
}

/** Authenticated handoff only; all mutations remain in their existing workflow. */
export async function getSeasonPersonalNextStep(season: PublicSeason) {
  const session = await getUserSession();
  if (!session?.userId) return null;
  if (season.status === "playing" || season.status === "registration") {
    const contexts = await loadMyCompetitionContexts(session.userId);
    const task = contexts.find(context => context.season.id === season.id)?.nextMatch;
    if (task) return task;
  }
  if (season.status !== "registration") return null;
  const readiness = await loadMyReadiness(session.userId);
  const context = season.registrationMode === "team"
    ? await loadCompetitionEntryParticipantContext({ competitionId: season.id, userId: session.userId }) : null;
  const competition = readiness.competitions.find((entry) => entry.id === context?.primaryEntry?.id);
  const items = competition ? [competition.entry, competition.qualification, readiness.profile, readiness.education] : [readiness.profile, readiness.education];
  return presentPersonalNextStep(items);
}
