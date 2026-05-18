import { cache } from "react";
import { notFound } from "next/navigation";
import { eq, and, asc, or } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db/client";
import { seasons, seasonRegistrations, users, teams, teamMembers } from "@/db/schema";
import { Marker, PosChip, Panel } from "@/components/rivalhub";
import { POS_ABBR, positionLabel, positionValues } from "@/lib/validators/registration";
import { getDisplayName } from "@/lib/utils/display-name";
import type { Metadata } from "next";

interface PlayersPageProps {
  params: Promise<{ seasonSlug: string }>;
  searchParams: Promise<{ position?: string }>;
}

/** 用 React.cache() 去重，generateMetadata 和页面组件共享同一次查询 */
const getSeason = cache(async (slug: string) => {
  return db.query.seasons.findFirst({ where: eq(seasons.slug, slug) });
});

export async function generateMetadata({ params }: PlayersPageProps): Promise<Metadata> {
  const { seasonSlug } = await params;
  const season = await getSeason(seasonSlug);
  return {
    title: season ? `${season.name} · 选手名单` : "选手名单",
  };
}

export default async function PlayersPage({ params, searchParams }: PlayersPageProps) {
  const { seasonSlug } = await params;
  const { position = "" } = await searchParams;

  const season = await getSeason(seasonSlug);
  if (!season) notFound();

  const whereConditions = position
    ? and(
        eq(seasonRegistrations.seasonId, season.id),
        eq(seasonRegistrations.status, "approved"),
        or(
          eq(seasonRegistrations.primaryPosition, position),
          eq(seasonRegistrations.secondaryPosition, position),
        ),
      )
    : and(
        eq(seasonRegistrations.seasonId, season.id),
        eq(seasonRegistrations.status, "approved"),
      );

  const registrations = await db
    .select({
      userId: seasonRegistrations.userId,
      registrationId: seasonRegistrations.id,
      primaryPosition: seasonRegistrations.primaryPosition,
      secondaryPosition: seasonRegistrations.secondaryPosition,
      peakRank: seasonRegistrations.peakRank,
      currentRating: seasonRegistrations.currentRating,
      perfectName: users.perfectName,
      steamName: users.steamName,
      email: users.email,
    })
    .from(seasonRegistrations)
    .innerJoin(users, eq(seasonRegistrations.userId, users.id))
    .where(whereConditions)
    .orderBy(asc(seasonRegistrations.primaryPosition), asc(users.perfectName));

  // 查询已有队伍的成员（用于显示队伍归属）
  const teamMemberRows = await db
    .select({
      registrationId: teamMembers.registrationId,
      teamId: teamMembers.teamId,
      teamName: teams.name,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .where(eq(teams.seasonId, season.id));

  const teamByRegId = new Map(teamMemberRows.map((r) => [r.registrationId, r.teamName]));

  const positionFilters = [
    { value: "", label: "All" },
    ...positionValues.map((p) => ({ value: p, label: positionLabel(p) })),
  ];

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl space-y-8">
      <Marker sub={`${season.name} · ${registrations.length} 人已通过审核`}>选手名单</Marker>

      {/* 位置筛选 */}
      <div className="flex gap-2 flex-wrap">
        {positionFilters.map(({ value, label }) => {
          const isActive = position === value;
          const href = value ? `/${seasonSlug}/players?position=${value}` : `/${seasonSlug}/players`;
          return (
            <Link
              key={value}
              href={href as never}
              className={[
                "px-3 py-1.5 rounded text-sm font-medium border transition-colors",
                isActive
                  ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
                  : "border-[var(--color-border)] text-[var(--color-fg-mid)] hover:text-[var(--color-fg)]",
              ].join(" ")}
            >
              {label}
            </Link>
          );
        })}
      </div>

      {registrations.length === 0 ? (
        <div className="text-center py-16 text-[var(--color-fg-mid)]">暂无符合条件的选手</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {registrations.map((reg) => {
            const displayName = getDisplayName(reg);
            const teamName = teamByRegId.get(reg.registrationId);
            const posLabel = positionLabel(reg.primaryPosition);
            const secPosLabel = reg.secondaryPosition ? positionLabel(reg.secondaryPosition) : null;

            return (
              <Link
                key={reg.registrationId}
                href={`/players/${reg.userId}` as never}
                className="block"
              >
                <Panel hoverable className="h-full cursor-pointer">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <span className="font-semibold text-[var(--color-fg)] truncate text-base">
                      {displayName}
                    </span>
                    <PosChip pos={POS_ABBR[reg.primaryPosition] ?? reg.primaryPosition.slice(0, 1).toUpperCase()} small />
                  </div>
                  <div className="space-y-1 text-sm text-[var(--color-fg-mid)]">
                    <div className="flex justify-between">
                      <span>主位置</span>
                      <span className="text-[var(--color-fg)]">{posLabel}</span>
                    </div>
                    {secPosLabel && (
                      <div className="flex justify-between">
                        <span>副位置</span>
                        <span className="text-[var(--color-fg-mid)]">{secPosLabel}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span>历史最高</span>
                      <span className="text-[var(--color-fg)]">{reg.peakRank}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>当前 Rating</span>
                      <span className="text-[var(--color-fg)]">{reg.currentRating}</span>
                    </div>
                    {teamName && (
                      <div className="flex justify-between">
                        <span>队伍</span>
                        <span className="text-[var(--color-accent)] font-medium truncate max-w-[120px]">{teamName}</span>
                      </div>
                    )}
                  </div>
                </Panel>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
