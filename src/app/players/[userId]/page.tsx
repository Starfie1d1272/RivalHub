import { notFound } from "next/navigation";
import { eq, or, and, asc, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users, seasonRegistrations, seasons, teams, teamMembers, matches } from "@/db/schema";
import { getSteamAvatar } from "@/lib/steam";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import Image from "next/image";
import Link from "next/link";
import { POSITION_LABELS } from "@/lib/validators/registration";
import { matchPlayerStats } from "@/db/schema/player-stats";

interface PlayerPageProps {
  params: Promise<{ userId: string }>;
}

function pct(n: number, d: number) {
  if (d === 0) return "—";
  return `${Math.round((n / d) * 100)}%`;
}

function AvatarFallback({ name }: { name: string }) {
  const initials = name.slice(0, 2).toUpperCase();
  return (
    <div className="w-24 h-24 rounded-full bg-[var(--surface-elevated)] border border-[var(--border)] flex items-center justify-center text-2xl font-bold text-[var(--text-secondary)]">
      {initials}
    </div>
  );
}

export default async function PlayerPage({ params }: PlayerPageProps) {
  const { userId } = await params;

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user) notFound();

  // ── 所有已批准的报名记录（按赛季时间降序）─────────────────────────────
  const registrations = await db
    .select({
      id: seasonRegistrations.id,
      seasonId: seasonRegistrations.seasonId,
      primaryPosition: seasonRegistrations.primaryPosition,
      secondaryPosition: seasonRegistrations.secondaryPosition,
      peakRank: seasonRegistrations.peakRank,
      peakRankSeason: seasonRegistrations.peakRankSeason,
      peakRating: seasonRegistrations.peakRating,
      currentSeasonPeakRank: seasonRegistrations.currentSeasonPeakRank,
      currentRating: seasonRegistrations.currentRating,
      gameplayStyle: seasonRegistrations.gameplayStyle,
      competitionHistory: seasonRegistrations.competitionHistory,
      highlightVideoUrl: seasonRegistrations.highlightVideoUrl,
      status: seasonRegistrations.status,
      seasonName: seasons.name,
      seasonSlug: seasons.slug,
    })
    .from(seasonRegistrations)
    .innerJoin(seasons, eq(seasonRegistrations.seasonId, seasons.id))
    .where(
      and(
        eq(seasonRegistrations.userId, userId),
        eq(seasonRegistrations.status, "approved"),
      )
    )
    .orderBy(asc(seasons.createdAt));

  // ── 队伍归属（registrationId → team）────────────────────────────────
  const allRegIds = registrations.map((r) => r.id);
  const teamMemberRows = allRegIds.length
    ? await db
        .select({
          registrationId: teamMembers.registrationId,
          teamId: teamMembers.teamId,
          teamName: teams.name,
          seasonSlug: seasons.slug,
        })
        .from(teamMembers)
        .innerJoin(teams, eq(teamMembers.teamId, teams.id))
        .innerJoin(seasons, eq(teams.seasonId, seasons.id))
        .where(inArray(teamMembers.registrationId, allRegIds))
    : [];

  const regIdToTeam = new Map(teamMemberRows.map((r) => [r.registrationId, r]));

  // ── 跨赛季比赛战绩 ────────────────────────────────────────────────────
  const teamIds = [...new Set(teamMemberRows.map((r) => r.teamId).filter(Boolean))];
  const allMatches = teamIds.length
    ? await db.query.matches.findMany({
        where: and(
          eq(matches.status, "finished"),
          or(
            inArray(matches.teamAId, teamIds),
            inArray(matches.teamBId, teamIds),
          )
        ),
      })
    : [];

  // 聚合：总场次/胜负（以队伍为单位，因为 match 记录的是队伍，不是个人）
  const teamIdSet = new Set(teamIds);
  let totalWins = 0;
  let totalLosses = 0;
  let totalNetRounds = 0;

  for (const m of allMatches) {
    const myTeamId = teamIdSet.has(m.teamAId) ? m.teamAId : m.teamBId;
    const isA = m.teamAId === myTeamId;
    const myScore = isA ? (m.scoreA ?? 0) : (m.scoreB ?? 0);
    const oppScore = isA ? (m.scoreB ?? 0) : (m.scoreA ?? 0);
    if (myScore > oppScore) totalWins++;
    else totalLosses++;
    totalNetRounds += myScore - oppScore;
  }

  const played = totalWins + totalLosses;

  // ── Steam 头像 ────────────────────────────────────────────────────────
  const avatarUrl = user.steam64 ? await getSteamAvatar(user.steam64) : null;

  // 最新报名的主位置
  const latestReg = registrations[registrations.length - 1];

  // ── 个人数据统计（跨赛季）─────────────────────────────────────
  const playerStats = await db
    .select({
      seasonName: seasons.name,
      seasonSlug: seasons.slug,
      seasonCreatedAt: seasons.createdAt,
      maps: sql<number>`count(distinct ${matchPlayerStats.mapId})::int`,
      avgKills: sql<number>`round(avg(${matchPlayerStats.kills})::numeric, 1)`,
      avgDeaths: sql<number>`round(avg(${matchPlayerStats.deaths})::numeric, 1)`,
      avgAssists: sql<number>`round(avg(${matchPlayerStats.assists})::numeric, 1)`,
      avgRating: sql<number>`round(avg(${matchPlayerStats.ratingPro})::numeric, 2)`,
      avgAdr: sql<number>`round(avg(${matchPlayerStats.adr})::numeric, 1)`,
      avgWe: sql<number>`round(avg(${matchPlayerStats.we})::numeric, 1)`,
      avgHs: sql<number>`round(avg(${matchPlayerStats.hsPercent})::numeric, 0)`,
      totalKills: sql<number>`sum(${matchPlayerStats.kills})::int`,
      totalDeaths: sql<number>`sum(${matchPlayerStats.deaths})::int`,
    })
    .from(matchPlayerStats)
    .innerJoin(matches, eq(matchPlayerStats.matchId, matches.id))
    .innerJoin(seasons, eq(matches.seasonId, seasons.id))
    .where(
      and(
        eq(matchPlayerStats.userId, userId),
        sql`${matchPlayerStats.verifiedByAdmin} IS NOT NULL`,
      )
    )
    .groupBy(seasons.id, seasons.name, seasons.slug, seasons.createdAt)
    .orderBy(asc(seasons.createdAt));

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl space-y-10">

      {/* 头像 + 基本信息 */}
      <div className="flex items-center gap-6">
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt={user.steamName ?? "选手头像"}
            width={96}
            height={96}
            className="rounded-full border border-[var(--border)]"
          />
        ) : (
          <AvatarFallback name={user.steamName ?? user.email} />
        )}

        <div className="space-y-2">
          <h1 className="text-3xl font-black text-[var(--text-primary)]">
            {user.steamName ?? "未知选手"}
          </h1>

          <div className="flex flex-wrap items-center gap-2">
            {latestReg && (
              <>
                <Badge variant="outline" className="text-[var(--primary)]">
                  {POSITION_LABELS[latestReg.primaryPosition as keyof typeof POSITION_LABELS]?.cn ?? latestReg.primaryPosition}
                </Badge>
                <Badge variant="outline" className="text-[var(--text-secondary)]">
                  {POSITION_LABELS[latestReg.secondaryPosition as keyof typeof POSITION_LABELS]?.cn ?? latestReg.secondaryPosition}
                </Badge>
              </>
            )}
            {user.steamProfileUrl && (
              <a
                href={user.steamProfileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[var(--text-secondary)] hover:text-[var(--primary)] transition-colors"
              >
                Steam ↗
              </a>
            )}
          </div>
        </div>
      </div>

      {/* 职业生涯战绩 */}
      {played > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">职业生涯战绩</h2>
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "出场", value: played },
              { label: "胜", value: totalWins },
              { label: "负", value: totalLosses },
              { label: "胜率", value: pct(totalWins, played) },
            ].map(({ label, value }) => (
              <Card key={label} className="p-4 text-center">
                <p className="text-xl font-bold text-[var(--text-primary)]">{value}</p>
                <p className="text-xs text-[var(--text-secondary)] mt-1">{label}</p>
              </Card>
            ))}
          </div>
          {totalNetRounds !== 0 && (
            <p className="text-xs text-[var(--text-secondary)] px-1">
              净胜回合：
              <span className={totalNetRounds > 0 ? "text-green-500" : "text-red-500"}>
                {totalNetRounds > 0 ? "+" : ""}{totalNetRounds}
              </span>
            </p>
          )}
        </section>
      )}

      {/* 个人数据 */}
      {playerStats.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            个人数据
          </h2>

          {/* 生涯总计 */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[var(--primary)]">
                生涯总计
              </Badge>
              <span className="text-xs text-[var(--text-secondary)]">
                {playerStats.reduce((s, x) => s + x.maps, 0)} 图
              </span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-center">
              {[
                {
                  label: "Rating",
                  value: (
                    playerStats.reduce((s, x) => s + x.avgRating * x.maps, 0) /
                    playerStats.reduce((s, x) => s + x.maps, 0)
                  ).toFixed(2),
                },
                {
                  label: "ADR",
                  value: (
                    playerStats.reduce((s, x) => s + x.avgAdr * x.maps, 0) /
                    playerStats.reduce((s, x) => s + x.maps, 0)
                  ).toFixed(1),
                },
                {
                  label: "K/D",
                  value:
                    playerStats.reduce((s, x) => s + x.totalKills, 0) > 0 &&
                    playerStats.reduce((s, x) => s + x.totalDeaths, 0) > 0
                      ? (
                          playerStats.reduce((s, x) => s + x.totalKills, 0) /
                          playerStats.reduce((s, x) => s + x.totalDeaths, 0)
                        ).toFixed(2)
                      : "—",
                },
                {
                  label: "WE",
                  value: (
                    playerStats.reduce((s, x) => s + x.avgWe * x.maps, 0) /
                    playerStats.reduce((s, x) => s + x.maps, 0)
                  ).toFixed(1),
                },
                {
                  label: "场均击杀",
                  value: (
                    playerStats.reduce((s, x) => s + x.totalKills, 0) /
                    playerStats.reduce((s, x) => s + x.maps, 0)
                  ).toFixed(1),
                },
                {
                  label: "HS%",
                  value: Math.round(
                    playerStats.reduce((s, x) => s + x.avgHs * x.maps, 0) /
                      playerStats.reduce((s, x) => s + x.maps, 0)
                  ) + "%",
                },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-lg font-bold text-[var(--text-primary)]">
                    {value}
                  </p>
                  <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                    {label}
                  </p>
                </div>
              ))}
            </div>
          </Card>

          {/* 按赛季分组 */}
          {[...playerStats].reverse().map((ps) => (
            <Card key={ps.seasonSlug} className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Link
                  href={
                    `/${ps.seasonSlug}/stats` as any
                  }
                  className="text-sm font-semibold text-[var(--text-primary)] hover:text-[var(--primary)] transition-colors"
                >
                  {ps.seasonName}
                </Link>
                <span className="text-[11px] text-[var(--text-muted)]">
                  {ps.maps} 图 · 场均 {ps.avgKills}-{ps.avgDeaths}-{ps.avgAssists}
                </span>
              </div>
              <div className="flex gap-4 text-xs text-[var(--text-secondary)]">
                <span>
                  Rating{" "}
                  <span className="text-[var(--primary)] font-semibold">
                    {ps.avgRating}
                  </span>
                </span>
                <span>
                  ADR{" "}
                  <span className="text-[var(--text-primary)]">{ps.avgAdr}</span>
                </span>
                <span>
                  K/D{" "}
                  <span className="text-[var(--text-primary)]">
                    {ps.avgDeaths > 0
                      ? (ps.totalKills / ps.totalDeaths).toFixed(2)
                      : "—"}
                  </span>
                </span>
                <span>
                  WE{" "}
                  <span className="text-[var(--text-primary)]">{ps.avgWe}</span>
                </span>
              </div>
            </Card>
          ))}
        </section>
      )}

      {/* 赛季记录 */}
      {registrations.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">参赛记录</h2>
          <div className="space-y-3">
            {[...registrations].reverse().map((reg) => {
              const teamInfo = regIdToTeam.get(reg.id);
              return (
                <Card key={reg.id} className="p-5 space-y-3">
                  {/* 赛季标题行 */}
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="space-y-0.5">
                      <p className="font-semibold text-[var(--text-primary)]">{reg.seasonName}</p>
                      {teamInfo && (
                        <Link
                          href={`/${teamInfo.seasonSlug}/teams/${teamInfo.teamId}`}
                          className="text-xs text-[var(--text-secondary)] hover:text-[var(--primary)] transition-colors"
                        >
                          {teamInfo.teamName} ↗
                        </Link>
                      )}
                    </div>
                    <div className="flex gap-2 items-center flex-wrap">
                      <Badge variant="outline" className="text-xs text-[var(--primary)]">
                        {POSITION_LABELS[reg.primaryPosition as keyof typeof POSITION_LABELS]?.cn ?? reg.primaryPosition}
                      </Badge>
                      <span className="text-xs text-[var(--text-secondary)]">
                        峰值 {reg.peakRank}（{reg.peakRankSeason}）
                      </span>
                    </div>
                  </div>

                  {/* 风格描述 */}
                  {reg.gameplayStyle && (
                    <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                      {reg.gameplayStyle}
                    </p>
                  )}

                  {/* 参赛历史 */}
                  {reg.competitionHistory && (
                    <p className="text-xs text-[var(--text-secondary)] opacity-80 leading-relaxed border-t border-[var(--border)] pt-2">
                      {reg.competitionHistory}
                    </p>
                  )}

                  {/* 高光视频 */}
                  {reg.highlightVideoUrl && (
                    <a
                      href={reg.highlightVideoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-[var(--primary)] hover:underline"
                    >
                      🎬 高光视频
                    </a>
                  )}
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {registrations.length === 0 && (
        <Card className="p-8 text-center text-[var(--text-secondary)]">暂无参赛记录</Card>
      )}
    </div>
  );
}
