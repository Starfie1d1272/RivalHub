import Link from "next/link";
import Image from "next/image";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { teamMemberships, teams } from "@/db/schema";
import { EmptyState, PageHeader, PageLayout, Panel, PosChip, ResultSummary, StatusPill } from "@/components/rivalhub";
import { MapPreferenceChips } from "@/components/rivalhub/MapPreferenceChips";
import { InviteRecruitingPlayerButton } from "@/components/recruitment/InviteRecruitingPlayerButton";
import { PlayerLftEditorDialog } from "@/components/recruitment/PlayerLftEditorDialog";
import { RecruitmentInterestButton } from "@/components/recruitment/RecruitmentInterestButton";
import { RecruitmentLobbyControls } from "@/components/recruitment/RecruitmentLobbyControls";
import { TeamLogo } from "@/components/teams/TeamLogo";
import { TeamSectionNav } from "@/components/teams/TeamSectionNav";
import { Button } from "@/components/ui/button";
import { CS2_POSITION_VALUES, type Cs2Position } from "@/lib/config/cs2-positions";
import { getUserSession } from "@/lib/auth/session";
import { getPublicPlayerLft, getRecruitmentLobbyData, type RecruitmentFilters, type RecruitmentTeamSize } from "@/lib/recruitment/data";
import { formatCSTShortDate } from "@/lib/utils/date";
import { CURRENT_CS2_ACTIVE_DUTY_MAP_POOL } from "@/lib/config/cs2-maps";

// Search filters and viewer-specific recruiting actions are request-bound.
export const instant = false;

type RecruitmentSearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isPosition(value: string | undefined): value is Cs2Position {
  return Boolean(value && (CS2_POSITION_VALUES as readonly string[]).includes(value));
}

function isUuid(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function isTeamSize(value: string | undefined): value is RecruitmentTeamSize {
  return value === "small" || value === "medium" || value === "large";
}

export default async function RecruitmentLobbyPage({ searchParams }: { searchParams: Promise<RecruitmentSearchParams> }) {
  const params = await searchParams;
  const activeView = firstValue(params.view) === "players" ? "players" : "teams";
  const rawPosition = firstValue(params.position);
  const rawEvent = firstValue(params.event);
  const rawSize = firstValue(params.size);
  const filters: RecruitmentFilters = {
    q: firstValue(params.q),
    position: isPosition(rawPosition) ? rawPosition : undefined,
    targetSeasonId: isUuid(rawEvent) ? rawEvent : undefined,
    teamSize: isTeamSize(rawSize) ? rawSize : undefined,
    map: firstValue(params.map),
  };
  const session = await getUserSession();
  const [lobby, currentCaptainTeam, viewerCurrentTeam, ownLft] = await Promise.all([
    getRecruitmentLobbyData(filters, session?.userId),
    session ? db.select({ id: teams.id, name: teams.name }).from(teamMemberships).innerJoin(teams, eq(teams.id, teamMemberships.teamId)).where(and(eq(teamMemberships.userId, session.userId), isNull(teamMemberships.endedAt), eq(teams.captainUserId, session.userId), eq(teams.status, "active"))).limit(1) : Promise.resolve([]),
    session ? db.select({ teamId: teamMemberships.teamId }).from(teamMemberships).where(and(eq(teamMemberships.userId, session.userId), isNull(teamMemberships.endedAt))).limit(1) : Promise.resolve([]),
    session ? getPublicPlayerLft(session.userId) : Promise.resolve(null),
  ]);
  const captainTeam = currentCaptainTeam[0] ?? null;
  const viewerCurrentTeamId = viewerCurrentTeam[0]?.teamId ?? null;
  const normalizedFilters = lobby.normalizedFilters ?? filters;
  const targetSeasons = lobby.targetSeasons;
  const mapOptions = lobby.mapOptions ?? [...CURRENT_CS2_ACTIVE_DUTY_MAP_POOL];
  const cards = activeView === "teams" ? lobby.teamRecruitments : lobby.playerLfts;

  return (
    <PageLayout as="div" variant="wide" className="space-y-8">
      <PageHeader
        title="组队大厅"
        description="找到正在补充队员的队伍，或公开当前找队意向"
        actions={session ? <PlayerLftEditorDialog targetSeasons={targetSeasons} existing={ownLft} /> : <Button size="sm" asChild><Link href="/login?next=/teams/recruitment">登录后发布找队</Link></Button>}
      />
      <TeamSectionNav active="recruitment" />
      <RecruitmentLobbyControls
        view={activeView}
        normalizedFilters={normalizedFilters}
        targetSeasons={targetSeasons}
        mapOptions={mapOptions}
        teamCount={lobby.teamRecruitments.length}
        playerCount={lobby.playerLfts.length}
      />
      <div className="flex items-center justify-between gap-3">
        <ResultSummary total={cards.length} page={1} pageSize={Math.max(cards.length, 1)} totalPages={1} />
      </div>
      {cards.length === 0 ? <EmptyState title={activeView === "teams" ? "暂时没有符合条件的公开队伍招募" : "暂时没有符合条件的选手找队信息"} sub="公开信息到期、关闭或更新后会自动反映在这里。" /> : <div className="grid gap-4 md:grid-cols-2">{activeView === "teams" ? lobby.teamRecruitments.map((item) => <Panel key={item.id} contentClassName="p-5"><div className="space-y-4"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><TeamLogo logoUrl={item.logoUrl} teamName={item.teamName} /><div className="min-w-0"><Link href={`/teams/${item.teamSlug}`} className="block break-words text-lg font-semibold hover:text-[var(--color-accent)]">{item.teamName}</Link><p className="text-xs text-[var(--color-fg-mid)]">队长 {item.captainName} · {item.memberCount} 名当前成员</p></div></div><StatusPill label="招募中" tone="accent" /></div><div className="flex flex-wrap gap-1.5">{item.positions.length ? item.positions.map((role) => <PosChip key={role} pos={role} />) : <span className="text-sm text-[var(--color-fg-mid)]">位置不限</span>}</div>{item.targetSeasonName && <p className="text-sm text-[var(--color-fg-mid)]">目标赛事 · {item.targetSeasonName}</p>}{item.note && <p className="text-sm leading-6 text-[var(--color-fg-mid)]">{item.note}</p>}<div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-[var(--color-fg-dim)]">最近更新 · {formatCSTShortDate(item.updatedAt)}</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" asChild><Link href={`/teams/${item.teamSlug}`}>查看队伍</Link></Button>{item.teamId !== viewerCurrentTeamId && <RecruitmentInterestButton recruitmentIntentId={item.id} interested={lobby.viewerInterestedIntentIds.has(item.id)} loggedIn={Boolean(session)} />}</div></div></div></Panel>) : lobby.playerLfts.map((item) => <Panel key={item.id} contentClassName="p-5"><div className="space-y-4"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3">{item.avatarUrl ? <Image src={item.avatarUrl} width={40} height={40} alt={item.name} className="size-10 shrink-0 rounded-full border border-[var(--color-border)] object-cover" /> : <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-panel-hi)] font-semibold">{item.name.slice(0, 2).toUpperCase()}</div>}<div className="min-w-0"><Link href={`/players/${item.userId}`} className="block break-words text-lg font-semibold hover:text-[var(--color-accent)]">{item.name}</Link>{item.currentTeamName && <p className="text-xs text-[var(--color-fg-mid)]">当前队伍 · {item.currentTeamName}</p>}</div></div><StatusPill label="找队中" tone="accent" /></div><div className="flex flex-wrap gap-1.5">{item.positions.map((role) => <PosChip key={role} pos={role} />)}</div>{item.competitiveSummary.length > 0 && <div className="space-y-2">{item.competitiveSummary.map((platform) => <div key={platform.displayName} className="space-y-1"><p className="text-xs font-medium text-[var(--color-fg-mid)]">{platform.displayName}</p><div className="flex flex-wrap gap-x-3 gap-y-1">{platform.facts.map((fact) => <span key={`${fact.label}-${fact.rankLabel}`} className="text-xs text-[var(--color-fg-dim)]">{fact.label} · {fact.rankLabel}{fact.stars !== null && <> · {fact.stars}★</>}{fact.ratingLabel && fact.rating !== null && <> · {fact.ratingLabel} {fact.rating}</>}</span>)}</div></div>)}</div>}{item.targetSeasonName && <p className="text-sm text-[var(--color-fg-mid)]">目标赛事 · {item.targetSeasonName}</p>}{item.note && <p className="text-sm leading-6 text-[var(--color-fg-mid)]">{item.note}</p>}{item.competitiveRoles.length > 0 && <p className="text-xs text-[var(--color-fg-dim)]">长期位置 · {item.competitiveRoles.join(" · ")}</p>}{item.mapPreferences.length > 0 ? <div className="space-y-1"><p className="text-xs font-medium text-[var(--color-fg-mid)]">{item.mapPreferenceContextLabel ?? (item.targetSeasonName ? "目标赛事图池熟练度" : "当前 Active Duty 熟练度")}</p><MapPreferenceChips preferences={item.mapPreferences} compact minLevel="playable" showUnfilled /></div> : <p className="text-xs text-[var(--color-fg-dim)]">未填写地图熟练度</p>}<div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-[var(--color-fg-dim)]">最近更新 · {formatCSTShortDate(item.updatedAt)}</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" asChild><Link href={`/players/${item.userId}`}>查看个人主页</Link></Button>{captainTeam && captainTeam.id !== item.currentTeamId && item.userId !== session?.userId && <InviteRecruitingPlayerButton teamId={captainTeam.id} userId={item.userId} />}</div></div></div></Panel>)}</div>}
    </PageLayout>
  );
}
