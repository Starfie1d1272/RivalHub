import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { MajorPrestartConsole } from "@/components/admin/MajorPrestartConsole";
import { db } from "@/db/client";
import {
  majorPrestartEntrants,
  majorPrestartIssues,
  majorPrestartRosterMembers,
  majorPrestartStates,
  majorStageRuns,
  matches,
  majorTournamentSeeds,
  seasons,
  teamMembers,
  teams,
  users,
} from "@/db/schema";
import { evaluateMajorPrestartReadiness } from "@/lib/major/prestart";
import { buildMajorOpeningPlan } from "@/lib/major/opening";
import {
  normalizeRegistrationConfig,
  normalizeStagePlan,
  normalizeTeamRegistrationConfig,
} from "@/types/season";

function isMajorSwissFinalizedRound(value: number): value is 0 | 1 | 2 | 3 | 4 | 5 {
  return value === 0 || value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

interface AdminMajorConsolePageProps {
  params: Promise<{ seasonSlug: string }>;
}

export default async function AdminMajorConsolePage({ params }: AdminMajorConsolePageProps) {
  const { seasonSlug } = await params;
  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  if (!season) notFound();

  const seasonTeams = await db.query.teams.findMany({
    where: eq(teams.seasonId, season.id),
    orderBy: [asc(teams.createdAt)],
    columns: { id: true, name: true },
  });
  const teamIds = seasonTeams.map((team) => team.id);
  const formalMembers = teamIds.length === 0 ? [] : await db
    .select({ teamId: teamMembers.teamId, userId: teamMembers.userId, email: users.email })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .where(eq(teamMembers.seasonId, season.id));
  const candidatesByTeam = new Map<string, Array<{ userId: string; email: string }>>();
  for (const member of formalMembers) {
    const candidates = candidatesByTeam.get(member.teamId) ?? [];
    candidates.push({ userId: member.userId, email: member.email });
    candidatesByTeam.set(member.teamId, candidates);
  }

  const [state, entrantRows, rosterRows, issueRows, seedRows, stageRunRows, stageMatchRows] = await Promise.all([
    db.query.majorPrestartStates.findFirst({ where: eq(majorPrestartStates.seasonId, season.id) }),
    db.select({
      id: majorPrestartEntrants.id,
      teamId: majorPrestartEntrants.teamId,
      teamName: teams.name,
      rosterConfirmedAt: majorPrestartEntrants.rosterConfirmedAt,
    }).from(majorPrestartEntrants)
      .innerJoin(teams, eq(majorPrestartEntrants.teamId, teams.id))
      .where(eq(majorPrestartEntrants.seasonId, season.id))
      .orderBy(asc(teams.name)),
    db.select({ entrantId: majorPrestartRosterMembers.entrantId, userId: majorPrestartRosterMembers.userId, email: users.email })
      .from(majorPrestartRosterMembers)
      .innerJoin(users, eq(majorPrestartRosterMembers.userId, users.id)),
    db.select().from(majorPrestartIssues)
      .where(eq(majorPrestartIssues.seasonId, season.id))
      .orderBy(asc(majorPrestartIssues.createdAt)),
    db.select({ teamId: majorPrestartEntrants.teamId, tournamentSeed: majorTournamentSeeds.tournamentSeed })
      .from(majorTournamentSeeds)
      .innerJoin(majorPrestartEntrants, eq(majorTournamentSeeds.entrantId, majorPrestartEntrants.id))
      .where(eq(majorTournamentSeeds.seasonId, season.id))
      .orderBy(asc(majorTournamentSeeds.tournamentSeed)),
    db.select({ id: majorStageRuns.id, stageKey: majorStageRuns.stageKey, finalizedRound: majorStageRuns.finalizedRound }).from(majorStageRuns)
      .where(eq(majorStageRuns.seasonId, season.id)),
    db.select({ stageRunId: matches.majorStageRunId, round: matches.round, status: matches.status })
      .from(matches)
      .innerJoin(majorStageRuns, eq(matches.majorStageRunId, majorStageRuns.id))
      .where(and(eq(majorStageRuns.seasonId, season.id), eq(matches.ownership, "major_stage"))),
  ]);
  const entrantIds = new Set(entrantRows.map((entrant) => entrant.id));
  const rosterByEntrant = new Map<string, Array<{ userId: string; email: string }>>();
  for (const member of rosterRows) {
    if (!entrantIds.has(member.entrantId)) continue;
    const roster = rosterByEntrant.get(member.entrantId) ?? [];
    roster.push({ userId: member.userId, email: member.email });
    rosterByEntrant.set(member.entrantId, roster);
  }

  const readiness = evaluateMajorPrestartReadiness({
    capabilities: {
      registrationMode: season.registrationMode,
      hasCaptainVoting: season.hasCaptainVoting,
      hasDraft: season.hasDraft,
      stagePlan: normalizeStagePlan(season.stagePlan),
      registrationConfig: normalizeRegistrationConfig(season.registrationConfig),
      teamRegistrationConfig: normalizeTeamRegistrationConfig(season.teamRegistrationConfig),
      minTeamSize: season.minTeamSize,
      maxTeamSize: season.maxTeamSize,
      starterCount: season.starterCount,
      positions: season.positions,
    },
    teams: entrantRows.map((entrant) => ({
      teamId: entrant.teamId,
      playerIds: (rosterByEntrant.get(entrant.id) ?? []).map((member) => member.userId),
    })),
    entrantsLocked: Boolean(state?.entrantsLockedAt),
    confirmations: entrantRows.map((entrant) => ({ teamId: entrant.teamId, confirmed: Boolean(entrant.rosterConfirmedAt) })),
    qualificationIssues: issueRows.filter((issue) => issue.category === "qualification").map((issue) => ({ label: issue.label, resolved: Boolean(issue.resolvedAt) })),
    administrativeIssues: issueRows.filter((issue) => issue.category === "administration").map((issue) => ({ label: issue.label, resolved: Boolean(issue.resolvedAt) })),
    tournamentSeeds: seedRows,
    seedConfirmation: state ? { seedRevision: state.seedRevision, confirmedSeedRevision: state.confirmedSeedRevision } : null,
  });
  const stageOneMatchFormat = normalizeStagePlan(season.stagePlan)[0]?.matchFormat;
  let seedPreview: ReturnType<typeof buildMajorOpeningPlan> | null = null;
  if (seedRows.length === 32 && (stageOneMatchFormat === "bo1" || stageOneMatchFormat === "bo3")) {
    try { seedPreview = buildMajorOpeningPlan({ teams: seedRows, stageOneMatchFormat }); } catch { seedPreview = null; }
  }
  const stageRun = stageRunRows.length === 1 ? stageRunRows[0] : null;
  let swissRuntime: import("@/components/admin/MajorSwissRuntimeManagement").MajorSwissRuntimeData | null = null;
  if (stageRun && isMajorSwissFinalizedRound(stageRun.finalizedRound)) {
    const finalizedRound = stageRun.finalizedRound;
    const currentRound = (finalizedRound === 5 ? 5 : finalizedRound + 1) as 1 | 2 | 3 | 4 | 5;
    const currentMatches = stageMatchRows.filter((match) => match.stageRunId === stageRun.id && match.round === currentRound);
    swissRuntime = {
      seasonId: season.id,
      stageKey: stageRun.stageKey,
      finalizedRound,
      currentRound,
      currentMatchCount: currentMatches.length,
      completedMatchCount: currentMatches.filter((match) => match.status === "finished").length,
      stageComplete: finalizedRound === 5,
    };
  }

  return <MajorPrestartConsole
    seasonName={season.name}
    readiness={readiness}
    management={{
      seasonId: season.id,
      entrantsLocked: Boolean(state?.entrantsLockedAt),
      availableTeams: seasonTeams.filter((team) => !entrantRows.some((entrant) => entrant.teamId === team.id)).map((team) => ({
        id: team.id,
        name: team.name,
        members: candidatesByTeam.get(team.id) ?? [],
      })),
      entrants: entrantRows.map((entrant) => ({
        ...entrant,
        roster: rosterByEntrant.get(entrant.id) ?? [],
        candidates: candidatesByTeam.get(entrant.teamId) ?? [],
      })),
      issues: issueRows.map((issue) => ({ id: issue.id, category: issue.category, label: issue.label, resolved: Boolean(issue.resolvedAt) })),
    }}
    seedManagement={{
      seasonId: season.id,
      entrantsLocked: Boolean(state?.entrantsLockedAt),
      entrants: entrantRows.map((entrant) => ({ teamId: entrant.teamId, teamName: entrant.teamName })),
      seeds: seedRows,
      seedRevision: state?.seedRevision ?? 0,
      confirmedSeedRevision: state?.confirmedSeedRevision ?? null,
      firstRound: seedPreview?.firstRound.pairings.map((pairing) => ({
        higherSeed: pairing.higherSeed.tournamentSeed,
        lowerSeed: pairing.lowerSeed.tournamentSeed,
        format: pairing.format,
      })) ?? null,
    }}
    started={stageRunRows.length > 0}
    swissRuntime={swissRuntime}
  />;
}
