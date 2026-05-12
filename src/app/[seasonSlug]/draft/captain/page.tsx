import Link from "next/link";
import { notFound } from "next/navigation";
import type { Route } from "next";
import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasonRegistrations, seasons, teams } from "@/db/schema";
import { CaptainDraftPanel } from "@/components/draft/CaptainDraftPanel";
import { Panel, Btn } from "@/components/rivalhub";
import { getUserSession } from "@/lib/auth/session";
import { getDraftData, type DraftTeamSlot } from "@/lib/draft/data";

export const dynamic = "force-dynamic";

interface DraftCaptainPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export async function generateMetadata({ params }: DraftCaptainPageProps): Promise<Metadata> {
  const { seasonSlug } = await params;
  return { title: `队长选人 · ${seasonSlug}` };
}

export default async function DraftCaptainPage({ params }: DraftCaptainPageProps) {
  const { seasonSlug } = await params;
  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  if (!season) notFound();

  if (!season.hasDraft) {
    return <UnavailablePanel title={`队长选人 · ${season.name}`} message="该赛季未启用蛇形选秀。" />;
  }

  if (season.status !== "drafting") {
    return (
      <UnavailablePanel
        title={`队长选人 · ${season.name}`}
        message="当前不在选秀阶段，队长面板暂不可用。"
        href={`/${seasonSlug}/draft` as Route}
        action="查看选秀直播间"
      />
    );
  }

  const session = await getUserSession();
  if (!session) {
    return (
      <UnavailablePanel
        title={`队长选人 · ${season.name}`}
        message="请先登录队长账号后再进入选人面板。"
        href="/login"
        action="登录"
      />
    );
  }

  const [captainTeam] = await db
    .select({
      teamId: teams.id,
      teamName: teams.name,
    })
    .from(teams)
    .innerJoin(
      seasonRegistrations,
      eq(teams.captainRegistrationId, seasonRegistrations.id),
    )
    .where(
      and(
        eq(teams.seasonId, season.id),
        eq(seasonRegistrations.seasonId, season.id),
        eq(seasonRegistrations.userId, session.userId),
      ),
    )
    .limit(1);

  if (!captainTeam) {
    return (
      <UnavailablePanel
        title={`队长选人 · ${season.name}`}
        message="当前账号不是本赛季队长，无法操作队长选人面板。"
        href={`/${seasonSlug}/draft` as Route}
        action="查看选秀直播间"
      />
    );
  }

  const data = await getDraftData(season.id);
  if (!data.state) {
    return (
      <UnavailablePanel
        title={`队长选人 · ${season.name}`}
        message="选秀尚未启动，等待管理员开启后再操作。"
      />
    );
  }

  const currentTeamName =
    data.teams.find((team) => team.teamId === data.state?.currentTeamId)?.teamName ?? null;
  const captainTeamSlot = data.teams.find((team) => team.teamId === captainTeam.teamId);
  const positionCounts = computePositionCounts(captainTeamSlot);

  return (
    <main className="container mx-auto max-w-5xl px-4 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">队长选人 · {season.name}</h1>
        <p className="mt-2 text-sm text-[var(--color-fg-mid)]">
          当前队长端只在轮到本队时开放选择；重复点击会通过请求 ID 幂等处理。
        </p>
      </div>

      <CaptainDraftPanel
        seasonId={season.id}
        teamId={captainTeam.teamId}
        teamName={captainTeam.teamName}
        currentTeamName={currentTeamName}
        currentRound={data.state.currentRound}
        roundDeadline={data.state.roundDeadline}
        isDraftActive={data.state.isActive}
        isCurrentCaptainTurn={
          data.state.isActive && data.state.currentTeamId === captainTeam.teamId
        }
        positionCounts={positionCounts}
        players={data.remainingPlayers}
        seasonPositions={season.positions}
      />
    </main>
  );
}

function UnavailablePanel({
  title,
  message,
  href,
  action,
}: {
  title: string;
  message: string;
  href?: Route;
  action?: string;
}) {
  return (
    <main className="container mx-auto max-w-4xl px-4 py-10">
      <Panel pad={32}>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-2 text-sm text-[var(--color-fg-mid)]">{message}</p>
        {href && action && (
          <Btn ghost asChild className="mt-4">
            <Link href={href}>{action}</Link>
          </Btn>
        )}
      </Panel>
    </main>
  );
}

function computePositionCounts(team: DraftTeamSlot | undefined): Record<string, number> {
  const counts: Record<string, number> = {};
  if (!team) return counts;

  counts[team.captain.primaryPosition] = (counts[team.captain.primaryPosition] ?? 0) + 1;
  for (const member of team.members) {
    counts[member.primaryPosition] = (counts[member.primaryPosition] ?? 0) + 1;
  }
  return counts;
}
