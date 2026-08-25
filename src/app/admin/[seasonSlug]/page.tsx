import { notFound } from "next/navigation";
import { asc, eq, inArray } from "drizzle-orm";
import { MajorPrestartConsole } from "@/components/admin/MajorPrestartConsole";
import { db } from "@/db/client";
import { seasons, teamMembers, teams } from "@/db/schema";
import { evaluateMajorPrestartReadiness } from "@/lib/major/prestart";
import {
  normalizeRegistrationConfig,
  normalizeStagePlan,
  normalizeTeamRegistrationConfig,
} from "@/types/season";

interface AdminMajorConsolePageProps {
  params: Promise<{ seasonSlug: string }>;
}

/**
 * 现有 schema 只拥有队伍和正式名单；确认、资格、管理事项和赛事种子尚无
 * 持久化来源。因此明确以 null 交给领域层，避免空数组被误读为“没有问题”。
 */
export default async function AdminMajorConsolePage({ params }: AdminMajorConsolePageProps) {
  const { seasonSlug } = await params;
  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  if (!season) notFound();

  const seasonTeams = await db.query.teams.findMany({
    where: eq(teams.seasonId, season.id),
    orderBy: [asc(teams.createdAt)],
    columns: { id: true },
  });
  const teamIds = seasonTeams.map((team) => team.id);
  const members = teamIds.length === 0
    ? []
    : await db
      .select({ teamId: teamMembers.teamId, playerId: teamMembers.userId })
      .from(teamMembers)
      .where(inArray(teamMembers.teamId, teamIds));
  const playerIdsByTeam = new Map<string, string[]>();
  for (const member of members) {
    const playerIds = playerIdsByTeam.get(member.teamId) ?? [];
    playerIds.push(member.playerId);
    playerIdsByTeam.set(member.teamId, playerIds);
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
    teams: seasonTeams.map((team) => ({
      teamId: team.id,
      playerIds: playerIdsByTeam.get(team.id) ?? [],
    })),
    confirmations: null,
    qualificationIssues: null,
    administrativeIssues: null,
    tournamentSeeds: null,
    reconfirmations: null,
  });

  return <MajorPrestartConsole seasonName={season.name} readiness={readiness} />;
}
