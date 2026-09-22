import "server-only";

import { cache } from "react";
import { groupMyCompetitionContexts, loadMyCompetitionContexts, type MyCompetitionContext } from "@/lib/my/competitions";
import {
  isMyReadinessActionable,
  loadMyReadiness,
  type MyReadinessItem,
  type MyReadinessModel,
} from "@/lib/my/readiness";
import { loadMyCurrentTeam, type MyCurrentTeam } from "@/lib/my/team-workspace";
import type { PersonalMatchTask } from "@/lib/matches/presentation";

export interface MyUpcomingMatch {
  seasonId: string;
  seasonName: string;
  entryName: string;
  task: PersonalMatchTask;
}

export interface MyWorkspaceModel {
  displayName: string;
  tasks: MyReadinessItem[];
  upcomingMatches: MyUpcomingMatch[];
  currentTeam: MyCurrentTeam | null;
  currentCompetitions: MyCompetitionContext[];
  historyCompetitions: MyCompetitionContext[];
  readiness: MyReadinessModel;
  sanctions: MyReadinessModel["sanctions"];
}

function addTask(tasks: MyReadinessItem[], seenHrefs: Set<string>, candidate: MyReadinessItem | undefined): void {
  if (!candidate || !isMyReadinessActionable(candidate) || seenHrefs.has(candidate.cta.href)) return;
  seenHrefs.add(candidate.cta.href);
  tasks.push(candidate);
}

function selectTasks(readiness: MyReadinessModel): MyReadinessItem[] {
  const tasks: MyReadinessItem[] = [];
  const seenHrefs = new Set<string>();
  const entries = readiness.competitions.map((competition) => competition.entry);
  const qualificationBlockers = readiness.competitions
    .map((competition) => competition.qualification)
    .filter((item) => item.state === "blocked");

  for (const entry of entries) addTask(tasks, seenHrefs, entry);
  for (const qualification of qualificationBlockers) addTask(tasks, seenHrefs, qualification);
  if (readiness.team.state === "waiting") addTask(tasks, seenHrefs, readiness.team);
  addTask(tasks, seenHrefs, readiness.recruitment);
  addTask(tasks, seenHrefs, readiness.profile);
  addTask(tasks, seenHrefs, readiness.education);
  for (const qualification of readiness.competitions.map((competition) => competition.qualification)) {
    addTask(tasks, seenHrefs, qualification);
  }
  return tasks;
}

function projectUpcomingMatches(contexts: readonly MyCompetitionContext[]): MyUpcomingMatch[] {
  return contexts
    .filter((context): context is MyCompetitionContext & { nextMatch: PersonalMatchTask } => Boolean(context.nextMatch))
    .map((context) => ({
      seasonId: context.season.id,
      seasonName: context.season.name,
      entryName: context.entryName,
      task: context.nextMatch,
    }));
}

export const loadMyWorkspace = cache(async (userId: string): Promise<MyWorkspaceModel> => {
  const [readiness, competitionContexts, currentTeam] = await Promise.all([
    loadMyReadiness(userId),
    loadMyCompetitionContexts(userId),
    loadMyCurrentTeam(userId),
  ]);
  const groupedCompetitions = groupMyCompetitionContexts(competitionContexts);
  return {
    displayName: readiness.displayName,
    tasks: selectTasks(readiness),
    upcomingMatches: projectUpcomingMatches(competitionContexts),
    currentTeam,
    currentCompetitions: groupedCompetitions.current,
    historyCompetitions: groupedCompetitions.history,
    readiness,
    sanctions: readiness.sanctions,
  };
});
