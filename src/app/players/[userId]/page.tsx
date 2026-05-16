import { notFound } from "next/navigation";
import { eq, or, and, asc, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users, seasonRegistrations, seasons, teams, teamMembers, matches } from "@/db/schema";
import { resolveAvatarUrl } from "@/lib/steam";
import { PLAYER_INFO_FIELDS } from "@/lib/utils/player-info-fields";
import { getDisplayName } from "@/lib/utils/display-name";
import { Panel, Stat, PosChip } from "@/components/rivalhub";
import { MapPreferenceChips } from "@/components/rivalhub/map-preference-chips";
import Image from "next/image";
import Link from "next/link";
import { POSITION_LABELS } from "@/lib/validators/registration";
import { matchPlayerStats } from "@/db/schema/player-stats";
import { matchMvpVotes } from "@/db/schema/mvp-votes";
import { wAvg, sAvg } from "@/lib/utils/stats";

interface PlayerPageProps {
  params: Promise<{ userId: string }>;
}

function pct(n: number, d: number) {
  if (d === 0) return "—";
  return `${Math.round((n / d) * 100)}%`;
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-fg-mid)", letterSpacing: "var(--tracking-label)", textTransform: "uppercase", marginBottom: 12 }}>
      {children}
    </div>
  );
}

function AvatarFallback({ name }: { name: string }) {
  const initials = name.slice(0, 2).toUpperCase();
  return (
    <div className="w-24 h-24 rounded-full bg-[var(--color-panel-hi)] border border-[var(--color-border)] flex items-center justify-center text-2xl font-bold text-[var(--color-fg-mid)]">
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

  // ── 并行：报名记录 / MVP / 个人数据 / Steam 头像 ──────────────────────
  const [registrations, mvpRows, playerStats, avatarUrl] = await Promise.all([
    db
      .select({
        id: seasonRegistrations.id,
        seasonId: seasonRegistrations.seasonId,
        primaryPosition: seasonRegistrations.primaryPosition,
        secondaryPosition: seasonRegistrations.secondaryPosition,
        peakRank: seasonRegistrations.peakRank,
        peakRankSeason: seasonRegistrations.peakRankSeason,
        peakRating: seasonRegistrations.peakRating,
        peakWe: seasonRegistrations.peakWe,
        currentSeasonPeakRank: seasonRegistrations.currentSeasonPeakRank,
        currentRating: seasonRegistrations.currentRating,
        mapPreferences: seasonRegistrations.mapPreferences,
        highlightVideoUrl: seasonRegistrations.highlightVideoUrl,
        gameplayStyle: seasonRegistrations.gameplayStyle,
        notes: seasonRegistrations.notes,
        competitionHistory: seasonRegistrations.competitionHistory,
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
      .orderBy(asc(seasons.createdAt)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(matchMvpVotes)
      .where(eq(matchMvpVotes.playerUserId, userId)),
    db
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
        avgRws: sql<number>`round(avg(${matchPlayerStats.rws})::numeric, 2)`,
        totalKills: sql<number>`sum(${matchPlayerStats.kills})::int`,
        totalDeaths: sql<number>`sum(${matchPlayerStats.deaths})::int`,
        totalFirstKills: sql<number>`sum(${matchPlayerStats.firstKills})::int`,
        totalMultiKills: sql<number>`sum(${matchPlayerStats.multiKills})::int`,
        totalClutches: sql<number>`sum(${matchPlayerStats.clutches})::int`,
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
      .orderBy(asc(seasons.createdAt)),
    resolveAvatarUrl({ avatarUrl: user.avatarUrl, steam64: user.steam64 }),
  ]);
  const mvpRow = mvpRows[0];

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

  // 最新报名的主位置
  const latestReg = registrations[registrations.length - 1];

  // ── 生涯总计预计算 ──────────────────────────────────────────────────
  const totalMaps = playerStats.reduce((s, x) => s + x.maps, 0);
  const totalKillsAll = playerStats.reduce((s, x) => s + x.totalKills, 0);
  const totalDeathsAll = playerStats.reduce((s, x) => s + x.totalDeaths, 0);
  const mvpCount = mvpRow?.count ?? 0;

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl space-y-10">

      {/* 头像 + 基本信息 */}
      <div className="flex items-center gap-6">
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt={getDisplayName(user)}
            width={96}
            height={96}
            className="rounded-full border border-[var(--color-border)] object-cover"
          />
        ) : (
          <AvatarFallback name={getDisplayName(user)} />
        )}

        <div className="space-y-2">
          <h1 className="text-3xl font-black text-[var(--color-fg)]">
            {getDisplayName(user)}
          </h1>
          {user.perfectName && (
            <p className="text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--color-fg-dim)" }}>
              完美平台：{user.perfectName}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {latestReg && (
              <>
                <PosChip pos={POSITION_LABELS[latestReg.primaryPosition as keyof typeof POSITION_LABELS]?.cn ?? latestReg.primaryPosition} />
                <PosChip pos={POSITION_LABELS[latestReg.secondaryPosition as keyof typeof POSITION_LABELS]?.cn ?? latestReg.secondaryPosition} />
              </>
            )}
            {user.steamProfileUrl && (
              <a
                href={user.steamProfileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[var(--color-fg-mid)] hover:text-[var(--color-accent)] transition-colors"
              >
                Steam ↗
              </a>
            )}
          </div>
        </div>
      </div>

      {latestReg && (
        <section className="space-y-3">
          <SectionHeading>地图偏好</SectionHeading>
          <Panel>
            <MapPreferenceChips preferences={latestReg.mapPreferences ?? []} minLevel="basic" />
          </Panel>
        </section>
      )}

      {/* 选手自述 */}
      {latestReg &&
        (latestReg.gameplayStyle?.trim() ||
          latestReg.notes?.trim() ||
          latestReg.competitionHistory?.trim()) && (
          <section className="space-y-3">
            <SectionHeading>选手自述</SectionHeading>
            <Panel pad={16}>
              <div className="space-y-2">
                {PLAYER_INFO_FIELDS
                  .map(({ key, label }) => {
                    const value = latestReg[key as keyof typeof latestReg] as string | null;
                    return { value: value?.trim(), label };
                  })
                  .filter((s) => s.value)
                  .map(({ value, label }) => (
                    <div key={label}>
                      <span
                        className="text-xs font-semibold"
                        style={{
                          fontFamily: "var(--font-mono)",
                          color: "var(--color-fg-mid)",
                        }}
                      >
                        {label}
                      </span>
                      <p className="text-sm text-[var(--color-fg)] mt-0.5">
                        {value}
                      </p>
                    </div>
                  ))}
              </div>
            </Panel>
          </section>
        )}

      {/* 职业生涯战绩 */}
      {played > 0 && (
        <section className="space-y-3">
          <SectionHeading>职业生涯战绩</SectionHeading>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
            <Stat label="出场" value={played} />
            <Stat label="胜" value={totalWins} />
            <Stat label="负" value={totalLosses} />
            <Stat label="胜率" value={pct(totalWins, played)} />
            <Stat label="MVP" value={mvpCount > 0 ? mvpCount : "—"} />
          </div>
          {totalNetRounds !== 0 && (
            <p className="text-xs text-[var(--color-fg-mid)] px-1">
              净胜回合：
              <span style={{ color: totalNetRounds > 0 ? "var(--color-ok)" : "var(--color-danger)" }}>
                {totalNetRounds > 0 ? "+" : ""}{totalNetRounds}
              </span>
            </p>
          )}
        </section>
      )}

      {/* 个人数据 */}
      {playerStats.length > 0 && (
        <section className="space-y-3">
            <SectionHeading>个人数据</SectionHeading>

          {/* 生涯总计 */}
          <Panel label="生涯总计">
            <span className="text-xs text-[var(--color-fg-mid)]">
              {totalMaps} 图
            </span>
            <div className="grid grid-cols-4 sm:grid-cols-5 gap-3 text-center mt-3">
              {[
                { label: "Rating", value: wAvg(playerStats, "avgRating", 2) },
                { label: "ADR", value: wAvg(playerStats, "avgAdr") },
                { label: "RWS", value: wAvg(playerStats, "avgRws", 2) },
                {
                  label: "K/D",
                  value: totalKillsAll > 0 && totalDeathsAll > 0
                    ? (totalKillsAll / totalDeathsAll).toFixed(2)
                    : "—",
                },
                { label: "WE", value: wAvg(playerStats, "avgWe") },
                { label: "场均击杀", value: sAvg(playerStats, "totalKills") },
                { label: "首杀", value: sAvg(playerStats, "totalFirstKills") },
                { label: "多杀", value: sAvg(playerStats, "totalMultiKills") },
                { label: "残局", value: sAvg(playerStats, "totalClutches") },
                {
                  label: "HS%",
                  value: totalMaps > 0
                    ? Math.round(playerStats.reduce((s, x) => s + x.avgHs * x.maps, 0) / totalMaps) + "%"
                    : "—",
                },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-lg font-bold text-[var(--color-fg)]">
                    {value}
                  </p>
                  <p className="text-[10px] text-[var(--color-fg-dim)] mt-0.5">
                    {label}
                  </p>
                </div>
              ))}
            </div>
          </Panel>

          {/* 按赛季分组 */}
          {[...playerStats].reverse().map((ps) => (
            <Panel key={ps.seasonSlug} pad={16}>
              <div className="flex items-center gap-2 mb-2">
                <Link
                  href={`/${ps.seasonSlug}/stats`}
                  className="text-sm font-semibold text-[var(--color-fg)] hover:text-[var(--color-accent)] transition-colors"
                >
                  {ps.seasonName}
                </Link>
                <span className="text-[11px] text-[var(--color-fg-dim)]">
                  {ps.maps} 图 · 场均 {ps.avgKills}-{ps.avgDeaths}-{ps.avgAssists}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-fg-mid)]">
                <span>
                  Rating{" "}
                  <span className="text-[var(--color-accent)] font-semibold">
                    {ps.avgRating}
                  </span>
                </span>
                <span>
                  ADR{" "}
                  <span className="text-[var(--color-fg)]">{ps.avgAdr}</span>
                </span>
                <span>
                  RWS{" "}
                  <span className="text-[var(--color-fg)]">{ps.avgRws}</span>
                </span>
                <span>
                  K/D{" "}
                  <span className="text-[var(--color-fg)]">
                    {ps.avgDeaths > 0
                      ? (ps.totalKills / ps.totalDeaths).toFixed(2)
                      : "—"}
                  </span>
                </span>
                <span>
                  WE{" "}
                  <span className="text-[var(--color-fg)]">{ps.avgWe}</span>
                </span>
                <span>
                  HS{" "}
                  <span className="text-[var(--color-fg)]">{ps.avgHs}%</span>
                </span>
              </div>
            </Panel>
          ))}
        </section>
      )}

      {/* 赛季记录 */}
      {registrations.length > 0 && (
        <section className="space-y-3">
          <SectionHeading>参赛记录</SectionHeading>
          <div className="space-y-2">
            {[...registrations].reverse().map((reg) => {
              const teamInfo = regIdToTeam.get(reg.id);
              const posLabel = POSITION_LABELS[reg.primaryPosition as keyof typeof POSITION_LABELS]?.cn ?? reg.primaryPosition;
              const peakParts = [`${reg.peakRank} (${reg.peakRankSeason})`, `Rating ${reg.peakRating.toFixed(2)}`];
              if (reg.peakWe != null) peakParts.push(`WE ${reg.peakWe.toFixed(1)}`);
              return (
                <Panel key={reg.id} pad={16}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-[var(--color-fg)]">{reg.seasonName}</span>
                        {teamInfo && (
                          <Link
                            href={`/${teamInfo.seasonSlug}/teams/${teamInfo.teamId}`}
                            className="text-xs text-[var(--color-fg-mid)] hover:text-[var(--color-accent)] transition-colors"
                          >
                            {teamInfo.teamName} ↗
                          </Link>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <PosChip pos={posLabel} />
                        <span className="text-xs text-[var(--color-fg-mid)]">
                          {peakParts.join(" · ")}
                        </span>
                      </div>
                    </div>
                    {reg.highlightVideoUrl && (
                      <a
                        href={reg.highlightVideoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-[var(--color-accent)] hover:underline shrink-0"
                      >
                        🎬 高光视频
                      </a>
                    )}
                  </div>
                </Panel>
              );
            })}
          </div>
        </section>
      )}

      {registrations.length === 0 && (
        <Panel pad={32} className="text-center">
          <p className="text-[var(--color-fg-mid)]">暂无参赛记录</p>
        </Panel>
      )}
    </div>
  );
}
