import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { teamMemberships, teams } from "@/db/schema";
import { EmptyState, PageHeader, PageLayout, ResultSummary } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { TeamDirectoryCard } from "@/components/teams/TeamDirectoryCard";
import { TeamDirectoryControls } from "@/components/teams/TeamDirectoryControls";
import { TeamSectionNav } from "@/components/teams/TeamSectionNav";
import { getUserSession } from "@/lib/auth/session";
import { getTeamDirectory } from "@/lib/teams/directory";
import { normalizeTeamDirectoryQuery, type TeamDirectorySearchParams } from "@/lib/teams/directory-contract";
import { countPendingDirectTeamInvitations } from "@/lib/teams/invitations";
import { getTeamDirectoryCta } from "@/lib/teams/presentation";

export default function TeamDirectoryPage({ searchParams }: { searchParams: Promise<TeamDirectorySearchParams> }) {
  return (
    <Suspense fallback={<TeamDirectoryFallback />}>
      <TeamDirectoryContent searchParams={searchParams} />
    </Suspense>
  );
}

function TeamDirectoryFallback() {
  return <PageLayout variant="wide" className="min-h-[60vh]" aria-busy="true"><span className="sr-only">正在加载队伍目录…</span></PageLayout>;
}

async function TeamDirectoryContent({ searchParams }: { searchParams: Promise<TeamDirectorySearchParams> }) {
  await connection();
  const [rawSearchParams, session] = await Promise.all([searchParams, getUserSession()]);
  const query = normalizeTeamDirectoryQuery(rawSearchParams);
  const [directory, currentTeamRows, pendingDirectInvitationCount] = await Promise.all([
    getTeamDirectory(query),
    session
      ? db.select({ slug: teams.slug }).from(teamMemberships).innerJoin(teams, eq(teams.id, teamMemberships.teamId)).where(and(eq(teamMemberships.userId, session.userId), isNull(teamMemberships.endedAt), eq(teams.status, "active"))).limit(1)
      : Promise.resolve([]),
    session ? countPendingDirectTeamInvitations(session.userId) : Promise.resolve(0),
  ]);
  const currentTeam = currentTeamRows[0] ?? null;
  const cta = getTeamDirectoryCta(Boolean(currentTeam), pendingDirectInvitationCount);

  return (
    <PageLayout as="div" variant="wide" className="space-y-8">
      <PageHeader
        title="队伍"
        description="查看队伍、成员和赛事履历"
        actions={session && <Button size="sm" asChild><Link href={cta.href as never}>{cta.label}</Link></Button>}
      />
      <div className="space-y-4">
        <TeamSectionNav active="directory" />
        <TeamDirectoryControls normalizedQuery={directory.normalizedQuery} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <ResultSummary total={directory.total} page={1} pageSize={Math.max(directory.total, 1)} totalPages={1} />
      </div>
      {directory.rows.length === 0
        ? directory.hasAnyTeams
          ? <EmptyState title="没有找到符合条件的队伍" sub="请调整搜索或筛选条件后重试。" />
          : <EmptyState title="还没有公开队伍" sub="创建队伍后，它会出现在这里。" />
        : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{directory.rows.map((team) => <TeamDirectoryCard key={team.id} slug={team.slug} name={team.name} logoUrl={team.logoUrl} description={team.description} hasOpenRecruitment={team.hasOpenRecruitment} status={team.status} captainName={team.captainName} memberCount={team.memberCount} />)}</div>}
    </PageLayout>
  );
}
