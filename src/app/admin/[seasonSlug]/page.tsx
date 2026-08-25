import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { MajorPrestartConsole } from "@/components/admin/MajorPrestartConsole";
import { db } from "@/db/client";
import {
  majorPrestartEntrants,
  majorPrestartIssues,
  majorPrestartRosterMembers,
  majorPrestartStates,
  seasons,
  teamMembers,
  teams,
  users,
} from "@/db/schema";
import { evaluateMajorPrestartReadiness } from "@/lib/major/prestart";
import {
  normalizeRegistrationConfig,
  normalizeStagePlan,
  normalizeTeamRegistrationConfig,
} from "@/types/season";

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

  const [state, entrantRows, rosterRows, issueRows] = await Promise.all([
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
    tournamentSeeds: null,
    seedConfirmation: null,
  });

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
  />;
}
