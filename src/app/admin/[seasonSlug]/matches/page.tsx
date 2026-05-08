import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema/seasons";
import { teams } from "@/db/schema/teams";
import { matches } from "@/db/schema/matches";
import { AdminMatchList, type MatchRow } from "@/components/admin/AdminMatchList";

export const dynamic = "force-dynamic";

interface AdminMatchesPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export default async function AdminMatchesPage({ params }: AdminMatchesPageProps) {
  const { seasonSlug } = await params;

  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  if (!season) notFound();

  const [seasonTeams, matchRows] = await Promise.all([
    db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(eq(teams.seasonId, season.id))
      .orderBy(teams.draftOrder),
    db
      .select({
        id: matches.id,
        teamAId: matches.teamAId,
        teamBId: matches.teamBId,
        format: matches.format,
        stage: matches.stage,
        status: matches.status,
        scoreA: matches.scoreA,
        scoreB: matches.scoreB,
        scheduledAt: matches.scheduledAt,
        completedAt: matches.completedAt,
        teamAName: teams.name,
      })
      .from(matches)
      .innerJoin(teams, eq(matches.teamAId, teams.id))
      .where(eq(matches.seasonId, season.id))
      .orderBy(desc(matches.createdAt)),
  ]);

  // 补充 teamBName
  const teamNameMap = new Map(seasonTeams.map((t) => [t.id, t.name]));

  const matchList: MatchRow[] = matchRows.map((m) => ({
    id: m.id,
    teamAId: m.teamAId,
    teamAName: m.teamAName,
    teamBId: m.teamBId,
    teamBName: teamNameMap.get(m.teamBId) ?? m.teamBId,
    format: m.format,
    stage: m.stage,
    status: m.status,
    scoreA: m.scoreA,
    scoreB: m.scoreB,
    scheduledAt: m.scheduledAt,
    completedAt: m.completedAt,
  }));

  return (
    <div className="container mx-auto px-4 py-8">
      <AdminMatchList
        seasonId={season.id}
        seasonSlug={seasonSlug}
        matches={matchList}
        teams={seasonTeams}
      />
    </div>
  );
}
