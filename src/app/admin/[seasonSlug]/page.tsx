import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { MajorPrestartConsole } from "@/components/admin/MajorPrestartConsole";
import { PostEventManagement } from "@/components/admin/PostEventManagement";
import { db } from "@/db/client";
import {
  majorPrestartEntrants,
  majorPrestartIssues,
  majorPrestartRosterMembers,
  majorPrestartStates,
  majorFinalResults,
  majorStageRuns,
  matches,
  majorTournamentSeeds,
  postEventAdjudications,
  seasons,
  teamMembers,
  teams,
  tournamentHonors,
  users,
} from "@/db/schema";
import { evaluateMajorPrestartReadiness } from "@/lib/major/prestart";
import { buildMajorOpeningPlan } from "@/lib/major/opening";
import {
  normalizeRegistrationConfig,
  normalizeStagePlan,
  normalizeTeamRegistrationConfig,
  normalizeAffiliationRules,
} from "@/types/season";

function isMajorSwissFinalizedRound(value: number): value is 0 | 1 | 2 | 3 | 4 | 5 {
  return value === 0 || value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

interface AdminMajorConsolePageProps {
  params: Promise<{ seasonSlug: string }>;
}

function placementGroupsForAdmin(value: unknown): Array<{ from: number; to: number; teamIds: string[] }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((group) => {
    if (!group || typeof group !== "object") return [];
    const candidate = group as { from?: unknown; to?: unknown; teamIds?: unknown };
    if (!Number.isInteger(candidate.from) || !Number.isInteger(candidate.to) || !Array.isArray(candidate.teamIds) || !candidate.teamIds.every((id) => typeof id === "string")) return [];
    return [{ from: candidate.from as number, to: candidate.to as number, teamIds: candidate.teamIds as string[] }];
  });
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

  const [state, entrantRows, rosterRows, issueRows, seedRows, stageRunRows, stageMatchRows, finalResult, honorRows, adjudicationRows] = await Promise.all([
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
    db.select({ entrantId: majorPrestartRosterMembers.entrantId, userId: majorPrestartRosterMembers.userId, email: users.email, educationVerificationId: majorPrestartRosterMembers.educationVerificationId })
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
    db.select({ id: majorStageRuns.id, stageKey: majorStageRuns.stageKey, finalizedRound: majorStageRuns.finalizedRound, startedAt: majorStageRuns.startedAt }).from(majorStageRuns)
      .where(eq(majorStageRuns.seasonId, season.id)),
    db.select({ stageRunId: matches.majorStageRunId, round: matches.round, entryRound: matches.entryRound, status: matches.status })
      .from(matches)
      .innerJoin(majorStageRuns, eq(matches.majorStageRunId, majorStageRuns.id))
      .where(and(eq(majorStageRuns.seasonId, season.id), eq(matches.ownership, "major_stage"))),
    db.query.majorFinalResults.findFirst({ where: eq(majorFinalResults.seasonId, season.id) }),
    db.select({ id: tournamentHonors.id, honorKey: tournamentHonors.honorKey, type: tournamentHonors.type, label: tournamentHonors.label, state: tournamentHonors.state, teamId: tournamentHonors.teamId, userId: tournamentHonors.userId, placementFrom: tournamentHonors.placementFrom, placementTo: tournamentHonors.placementTo })
      .from(tournamentHonors).where(eq(tournamentHonors.seasonId, season.id)).orderBy(asc(tournamentHonors.createdAt)),
    db.select({ id: postEventAdjudications.id, status: postEventAdjudications.status, kind: postEventAdjudications.kind, target: postEventAdjudications.target, impacts: postEventAdjudications.impacts, targetTeamId: postEventAdjudications.targetTeamId, targetUserId: postEventAdjudications.targetUserId, targetMatchId: postEventAdjudications.targetMatchId, reason: postEventAdjudications.reason, explanation: postEventAdjudications.publicExplanation, createdAt: postEventAdjudications.createdAt })
      .from(postEventAdjudications).where(eq(postEventAdjudications.seasonId, season.id)).orderBy(asc(postEventAdjudications.createdAt)),
  ]);
  const entrantIds = new Set(entrantRows.map((entrant) => entrant.id));
  const rosterByEntrant = new Map<string, Array<{ userId: string; email: string; educationVerificationId: string | null }>>();
  for (const member of rosterRows) {
    if (!entrantIds.has(member.entrantId)) continue;
    const roster = rosterByEntrant.get(member.entrantId) ?? [];
    roster.push({ userId: member.userId, email: member.email, educationVerificationId: member.educationVerificationId });
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
      affiliationRules: normalizeAffiliationRules(season.affiliationRules),
      minTeamSize: season.minTeamSize,
      maxTeamSize: season.maxTeamSize,
      starterCount: season.starterCount,
      positions: season.positions,
    },
    teams: entrantRows.map((entrant) => ({
      teamId: entrant.teamId,
      playerIds: (rosterByEntrant.get(entrant.id) ?? []).map((member) => member.userId),
      educationVerificationIds: (rosterByEntrant.get(entrant.id) ?? []).map((member) => member.educationVerificationId),
    })),
    entrantsLocked: Boolean(state?.entrantsLockedAt),
    confirmations: entrantRows.map((entrant) => ({ teamId: entrant.teamId, confirmed: Boolean(entrant.rosterConfirmedAt) })),
    qualificationIssues: issueRows.filter((issue) => issue.category === "qualification").map((issue) => ({ label: issue.label, resolved: Boolean(issue.resolvedAt) })),
    administrativeIssues: issueRows.filter((issue) => issue.category === "administration").map((issue) => ({ label: issue.label, resolved: Boolean(issue.resolvedAt) })),
    tournamentSeeds: seedRows,
    seedConfirmation: state ? { seedRevision: state.seedRevision, confirmedSeedRevision: state.confirmedSeedRevision } : null,
  });
  const stagePlan = normalizeStagePlan(season.stagePlan);
  const stageOneMatchFormat = stagePlan[0]?.matchFormat;
  let seedPreview: ReturnType<typeof buildMajorOpeningPlan> | null = null;
  if (seedRows.length === 32 && (stageOneMatchFormat === "bo1" || stageOneMatchFormat === "bo3")) {
    try { seedPreview = buildMajorOpeningPlan({ teams: seedRows, stageOneMatchFormat }); } catch { seedPreview = null; }
  }
  const stageRun = [...stagePlan].reverse()
    .map((stage) => stageRunRows.find((run) => run.stageKey === stage.key))
    .find((run) => run !== undefined) ?? null;
  const configuredStage = stageRun ? stagePlan.find((stage) => stage.key === stageRun.stageKey) : null;
  let swissRuntime: import("@/components/admin/MajorSwissRuntimeManagement").MajorSwissRuntimeData | null = null;
  let playoffRuntime: import("@/components/admin/MajorPlayoffRuntimeManagement").MajorPlayoffRuntimeData | null = null;
  if (stageRun && configuredStage?.type === "swiss" && isMajorSwissFinalizedRound(stageRun.finalizedRound)) {
    const finalizedRound = stageRun.finalizedRound;
    const currentRound = (finalizedRound === 5 ? 5 : finalizedRound + 1) as 1 | 2 | 3 | 4 | 5;
    const currentMatches = stageMatchRows.filter((match) => match.stageRunId === stageRun.id && match.round === currentRound);
    swissRuntime = {
      seasonId: season.id,
      stageRunId: stageRun.id,
      stageKey: stageRun.stageKey,
      finalizedRound,
      currentRound,
      currentMatchCount: currentMatches.length,
      completedMatchCount: currentMatches.filter((match) => match.status === "finished").length,
      stageComplete: finalizedRound === 5,
      nextStageName: finalizedRound === 5 ? stagePlan[stagePlan.findIndex((stage) => stage.key === stageRun.stageKey) + 1]?.name ?? null : null,
      nextStageType: finalizedRound === 5
        ? stagePlan[stagePlan.findIndex((stage) => stage.key === stageRun.stageKey) + 1]?.type === "swiss"
          ? "swiss"
          : stagePlan[stagePlan.findIndex((stage) => stage.key === stageRun.stageKey) + 1]?.type === "single_elim"
            ? "playoff"
            : null
        : null,
    };
  }
  if (stageRun && configuredStage?.type === "single_elim") {
    const playoffMatches = stageMatchRows.filter((match) => match.stageRunId === stageRun.id);
    const inRound = (round: "quarterfinal" | "semifinal" | "final") => playoffMatches.filter((match) => match.entryRound === round);
    const complete = (round: "quarterfinal" | "semifinal" | "final", count: number) => {
      const rows = inRound(round);
      return rows.length === count && rows.every((match) => match.status === "finished");
    };
    const currentRound = finalResult?.status === "pending_confirmation"
      ? null
      : !complete("quarterfinal", 4) ? "quarterfinal"
        : !complete("semifinal", 2) ? "semifinal"
          : "final";
    const currentMatches = currentRound ? inRound(currentRound) : [];
    playoffRuntime = {
      seasonId: season.id,
      stageRunId: stageRun.id,
      currentRound,
      currentMatchCount: currentMatches.length,
      completedMatchCount: currentMatches.filter((match) => match.status === "finished").length,
      resultPendingConfirmation: finalResult?.status === "pending_confirmation",
    };
  }

  return <div className="space-y-4">
    <MajorPrestartConsole
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
    playoffRuntime={playoffRuntime}
    />
    <PostEventManagement data={{
      seasonId: season.id,
      seasonStatus: season.status,
      finalResult: finalResult ? {
        id: finalResult.id,
        status: finalResult.status,
        championTeamId: finalResult.championTeamId,
        placementGroups: placementGroupsForAdmin(finalResult.placementGroups),
      } : null,
      teams: seasonTeams,
      honors: honorRows,
      adjudications: adjudicationRows.map((row) => ({ ...row, impacts: row.impacts as string[] })),
    }} />
  </div>;
}
