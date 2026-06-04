import { notFound } from "next/navigation";
import { eq, or, and, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, teams, teamMembers, seasonRegistrations, users, matches, playerRatings } from "@/db/schema";
import { Panel, Stat, Marker, PosChip, Btn } from "@/components/rivalhub";
import { MatchCard } from "@/components/matches/MatchCard";
import { MapPreferenceChips } from "@/components/rivalhub/MapPreferenceChips";
import { TeamNameForm } from "@/components/teams/TeamNameForm";
import { TeamLogoUpload } from "@/components/teams/TeamLogoUpload";
import Link from "next/link";
import { POSITION_LABELS } from "@/lib/validators/registration";
import { CS2_POSITIONS, normalizeRegistrationConfig } from "@/types/season";
import { getUserSession, checkAdminSession } from "@/lib/auth/session";
import { getDisplayName } from "@/lib/utils/display-name";
import { getTeamMapWinStats, getTeamBanStats, getTeamPickStats } from "@/lib/teams/data";
import { mapLabel } from "@/lib/maps";
import { getSeasonHexagonScores } from "@/actions/hexagon";
import { computeTeamDimensions } from "@/lib/utils/hexagon";
import type { HexagonScores } from "@/lib/utils/hexagon";
import { PRISM_AXES, buildPrismScores, averagePrismScores, type PrismScores } from "@/lib/stats/prism";
import { getTeamStyleProfile, getTeamHalfSideStats } from "@/actions/team-demo-stats";
import { TeamRadarPanel } from "@/components/teams/TeamRadarPanel";
import { ocrFallbackCte } from "@/lib/stats/sql";
import { TeamHalfSideStats } from "@/components/teams/TeamHalfSideStats";
import { TeamStyleProfile } from "@/components/teams/TeamStyleProfile";

interface TeamDetailPageProps {
  params: Promise<{ seasonSlug: string; teamId: string }>;
}

function pct(n: number, d: number) {
  if (d === 0) return { text: "—", color: "var(--color-fg-dim)" };
  const v = Math.round((n / d) * 100);
  const color = v >= 60 ? "var(--color-ok)" : v <= 40 ? "var(--color-danger)" : "var(--color-fg)";
  return { text: `${v}%`, color };
}

export default async function TeamDetailPage({ params }: TeamDetailPageProps) {
  const { seasonSlug, teamId } = await params;

  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  if (!season) notFound();

  const team = await db.query.teams.findFirst({
    where: and(eq(teams.id, teamId), eq(teams.seasonId, season.id)),
  });
  if (!team) notFound();

  const session = await getUserSession();
  const isAdmin = session ? session.role !== "user" : !!(await checkAdminSession());
  const currentUserRegistration = session
    ? await db.query.seasonRegistrations.findFirst({
        where: and(
          eq(seasonRegistrations.seasonId, season.id),
          eq(seasonRegistrations.userId, session.userId),
        ),
      })
    : null;
  const canEditTeamName = currentUserRegistration?.id === team.captainRegistrationId;

  // ── 阵容 + 赛果 + 即将进行的比赛（并行） ─────────────────────────────────
  const [roster, teamMatches, upcomingMatches] = await Promise.all([
    db
      .select({
        registrationId: teamMembers.registrationId,
        isStarter: teamMembers.isStarter,
        primaryPosition: seasonRegistrations.primaryPosition,
        mapPreferences: seasonRegistrations.mapPreferences,
        steamName: users.steamName,
        perfectName: users.perfectName,
        email: users.email,
        qq: users.qq,
        userId: users.id,
      })
      .from(teamMembers)
      .innerJoin(seasonRegistrations, eq(teamMembers.registrationId, seasonRegistrations.id))
      .innerJoin(users, eq(seasonRegistrations.userId, users.id))
      .where(eq(teamMembers.teamId, teamId)),
    db.query.matches.findMany({
      where: and(
        eq(matches.seasonId, season.id),
        eq(matches.status, "finished"),
        or(eq(matches.teamAId, teamId), eq(matches.teamBId, teamId)),
      ),
    }),
    db.query.matches.findMany({
      where: and(
        eq(matches.seasonId, season.id),
        or(eq(matches.teamAId, teamId), eq(matches.teamBId, teamId)),
        inArray(matches.status, ["scheduled", "in_progress"]),
      ),
    }),
  ]);

  const isTeamMember = currentUserRegistration
    ? roster.some((r) => r.registrationId === currentUserRegistration.id)
    : false;

  const starters = roster
    .filter((r) => r.isStarter)
    .sort((a, b) => {
      const ai = CS2_POSITIONS.indexOf(a.primaryPosition as never);
      const bi = CS2_POSITIONS.indexOf(b.primaryPosition as never);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  const subs = roster.filter((r) => !r.isStarter);

  // 对手队名
  const opponentIds = [
    ...new Set([
      ...teamMatches.map((m) => (m.teamAId === teamId ? m.teamBId : m.teamAId)),
      ...upcomingMatches.map((m) => (m.teamAId === teamId ? m.teamBId : m.teamAId)),
    ]),
  ];
  const opponentTeams = opponentIds.length
    ? await db.query.teams.findMany({ where: inArray(teams.id, opponentIds) })
    : [];
  const teamNameMap = new Map(opponentTeams.map((t) => [t.id, t]));

  // 整体胜负
  let totalWins = 0;
  let totalLosses = 0;
  for (const m of teamMatches) {
    const isA = m.teamAId === teamId;
    const myScore = isA ? (m.scoreA ?? 0) : (m.scoreB ?? 0);
    const oppScore = isA ? (m.scoreB ?? 0) : (m.scoreA ?? 0);
    if (myScore > oppScore) totalWins++;
    else totalLosses++;
  }
  const played = totalWins + totalLosses;
  const winRate = played > 0 ? `${Math.round((totalWins / played) * 100)}%` : "—";

  const seasonMapPool = normalizeRegistrationConfig(season.registrationConfig).mapPool;

  // 地图表现统计
  const matchIds = teamMatches.map((m) => m.id);
  const [mapStats, { banCount, bpMatchCount: banBpCount }, { pickCount, bpMatchCount: pickBpCount }, styleResult, halfSideResult] = await Promise.all([
    getTeamMapWinStats(teamId, teamMatches),
    getTeamBanStats(teamId, matchIds),
    getTeamPickStats(teamId, matchIds),
    getTeamStyleProfile(teamId, season.id),
    getTeamHalfSideStats(teamId, season.id),
  ]);

  // 赛季风格分析（demo 来源，可能为空）
  const styleProfile = styleResult.success ? styleResult.data : null;
  const halfSide = halfSideResult.success ? halfSideResult.data : null;
  const hasHalfSide = halfSide != null && Object.keys(halfSide).length > 0;

  // 历史对阵（按对手分组）
  interface HeadToHead { opponentId: string; wins: number; losses: number }
  const h2hMap = new Map<string, HeadToHead>();
  for (const m of teamMatches) {
    const oppId = m.teamAId === teamId ? m.teamBId : m.teamAId;
    const isA = m.teamAId === teamId;
    const myScore = isA ? (m.scoreA ?? 0) : (m.scoreB ?? 0);
    const oppScore = isA ? (m.scoreB ?? 0) : (m.scoreA ?? 0);
    const prev = h2hMap.get(oppId) ?? { opponentId: oppId, wins: 0, losses: 0 };
    h2hMap.set(oppId, {
      opponentId: oppId,
      wins: prev.wins + (myScore > oppScore ? 1 : 0),
      losses: prev.losses + (myScore <= oppScore ? 1 : 0),
    });
  }
  const h2hList = [...h2hMap.values()].sort((a, b) => b.wins + b.losses - (a.wins + a.losses));

  // 队伍 + 选手统计（每人聚合，用于阵容内联和队伍均值）
  // ADR 改为回合加权（JOIN match_maps mm2），修复原来 avg(mps.adr) 简单均值失真问题
  const teamStatResult = roster.length
    ? await db.execute(sql`
        WITH ocr_avg AS (${ocrFallbackCte(sql`${season.id}`)})
        SELECT
          mps.user_id,
          count(distinct mps.map_id)::int                                                            AS maps,
          min(ocr.avg_rating_ocr)                                                                    AS avg_rating,
          round(
            CASE WHEN sum(mm2.score_a + mm2.score_b) > 0
              THEN sum(mps.adr * (mm2.score_a + mm2.score_b))::numeric / sum(mm2.score_a + mm2.score_b)
              ELSE NULL END
          ::numeric, 1)                                                                              AS avg_adr,
          min(ocr.avg_we_ocr)                                                                        AS avg_we,
          sum(mps.kills)::int                                                                        AS total_kills,
          sum(mps.deaths)::int                                                                       AS total_deaths,
          sum(mm2.score_a + mm2.score_b)::int                                                        AS total_rounds,
          CASE WHEN sum(mps.deaths) > 0
            THEN round(sum(mps.kills)::numeric / sum(mps.deaths), 2)
            ELSE NULL END                                                                            AS kd_ratio
        FROM match_player_stats mps
        JOIN match_maps mm2 ON mm2.id = mps.map_id
        JOIN season_registrations sr ON sr.user_id = mps.user_id AND sr.season_id = ${season.id}
        JOIN team_members tm ON tm.registration_id = sr.id
        LEFT JOIN ocr_avg ocr ON ocr.user_id = mps.user_id
        WHERE tm.team_id = ${teamId}
          AND mps.verified_by_admin IS NOT NULL
          AND mps.source = COALESCE(mm2.active_stat_source, 'manual_ocr'::stat_source)
        GROUP BY mps.user_id
      `)
    : null;

  interface TeamStatRow {
    user_id: string | null;
    maps: number;
    avg_rating: number;
    avg_adr: number;
    avg_we: number;
    total_kills: number;
    total_deaths: number;
    total_rounds: number;
    kd_ratio: number | null;
  }
  const typedStats = (teamStatResult?.rows ?? []) as unknown as TeamStatRow[];

  // RR + PRISM 八维评分（from player_ratings，本赛季）
  const teamRrRows = roster.length ? await db
    .select({
      userId: playerRatings.userId,
      rrScore: playerRatings.rrScore,
      prismFirepower: playerRatings.prismFirepower,
      prismOpening: playerRatings.prismOpening,
      prismClutch: playerRatings.prismClutch,
      prismSniping: playerRatings.prismSniping,
      prismSurvival: playerRatings.prismSurvival,
      prismUtility: playerRatings.prismUtility,
      prismTrading: playerRatings.prismTrading,
      prismEntry: playerRatings.prismEntry,
    })
    .from(playerRatings)
    .where(
      and(
        eq(playerRatings.seasonId, season.id),
        inArray(playerRatings.userId, roster.map((p) => p.userId).filter(Boolean) as string[]),
      ),
    ) : [];
  const rrMap = new Map(teamRrRows.map((r) => [r.userId!, r.rrScore != null ? Number(r.rrScore) : null]));
  const prismByPlayer = new Map<string, PrismScores>();
  for (const r of teamRrRows) {
    if (r.userId) {
      const s = buildPrismScores(r as unknown as Record<string, unknown>);
      if (s) prismByPlayer.set(r.userId, s);
    }
  }

  // 选手数据 map（用于阵容内联显示）
  interface PlayerStats { maps: number; avgRating: number; avgAdr: number; kdRatio: number | null; rrScore: number | null }
  const playerStatsMap = new Map<string, PlayerStats>();
  for (const r of typedStats) {
    if (r.user_id) {
      playerStatsMap.set(r.user_id as string, {
        maps: Number(r.maps),
        avgRating: Number(r.avg_rating),
        avgAdr: Number(r.avg_adr),
        kdRatio: r.kd_ratio != null ? Number(r.kd_ratio) : null,
        rrScore: rrMap.get(r.user_id as string) ?? null,
      });
    }
  }

  // 六维雷达图数据（上场最多的前 5 人）
  const top5UserIds = [...typedStats]
    .sort((a, b) => Number(b.maps) - Number(a.maps))
    .slice(0, 5)
    .map((r) => r.user_id)
    .filter(Boolean) as string[];
  const hexagonByPlayer = new Map<string, HexagonScores>();
  if (top5UserIds.length > 0) {
    const seasonScores = await getSeasonHexagonScores(season.id);
    for (const uid of top5UserIds) {
      const s = seasonScores.get(uid);
      if (s) hexagonByPlayer.set(uid, s);
    }
  }
  const teamScores = hexagonByPlayer.size > 0
    ? computeTeamDimensions([...hexagonByPlayer.values()])
    : null;

  // 八维 PRISM：上场最多前 5 人中有 prism 数据者求均值（与选手页口径一致）
  const teamPrism: PrismScores | null = averagePrismScores(
    top5UserIds.map((uid) => prismByPlayer.get(uid)).filter((p): p is PrismScores => p != null),
  );

  // 雷达图成员数据
  const radarMembers = top5UserIds.map((uid) => {
    const player = roster.find((r) => r.userId === uid);
    return {
      userId: uid,
      name: player ? (player.perfectName ?? player.steamName ?? "未知") : uid,
      hex: hexagonByPlayer.get(uid) ?? null,
      prism: prismByPlayer.get(uid) ?? null,
    };
  });

  // 队伍均值：K/D 用总杀/总死；Rating/ADR/WE 用 total_rounds 加权，避免出场图数不同导致的失真
  const hasStats = typedStats.length > 0;
  const totalRoundsSum = typedStats.reduce((s, r) => s + Number(r.total_rounds), 0);
  const teamAvgRating = hasStats && totalRoundsSum > 0
    ? (typedStats.reduce((s, r) => s + Number(r.avg_rating) * Number(r.total_rounds), 0) / totalRoundsSum).toFixed(2)
    : null;
  const teamAvgAdr = hasStats && totalRoundsSum > 0
    ? (typedStats.reduce((s, r) => s + Number(r.avg_adr) * Number(r.total_rounds), 0) / totalRoundsSum).toFixed(1)
    : null;
  const totalK = typedStats.reduce((s, r) => s + Number(r.total_kills), 0);
  const totalD = typedStats.reduce((s, r) => s + Number(r.total_deaths), 0);
  const teamAvgKd = totalD > 0 ? (totalK / totalD).toFixed(2) : null;
  const teamAvgWe = hasStats && totalRoundsSum > 0
    ? (typedStats.reduce((s, r) => s + Number(r.avg_we) * Number(r.total_rounds), 0) / totalRoundsSum).toFixed(1)
    : null;
  const teamRrValues = [...playerStatsMap.values()].map((s) => s.rrScore).filter((v): v is number => v != null);
  const teamAvgRr = teamRrValues.length > 0
    ? (teamRrValues.reduce((s, v) => s + v, 0) / teamRrValues.length).toFixed(2)
    : null;

  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl space-y-10">

      {/* 1. 队伍标题 */}
      <div className="flex items-start gap-5">
        <div className="flex flex-col items-center gap-2">
          <TeamLogoUpload
            teamId={team.id}
            currentLogoUrl={team.logoUrl ?? null}
            teamName={team.name}
            canEdit={canEditTeamName}
          />
          {isAdmin && team.logoUrl && (
            <Btn small ghost asChild>
              <a href={team.logoUrl} target="_blank" rel="noopener noreferrer">下载头像</a>
            </Btn>
          )}
        </div>
        <div className="space-y-1 min-w-0">
          <p className="text-xs text-[var(--color-fg-mid)]">
            <Link href={`/${seasonSlug}/teams`} className="hover:underline">参赛队伍</Link>
            {" / "}
            <span className="text-[var(--color-fg)]">#{team.draftOrder}</span>
          </p>
          <Marker>{team.name}</Marker>
          {canEditTeamName && (
            <div className="max-w-md pt-3">
              <TeamNameForm teamId={team.id} initialName={team.name} />
            </div>
          )}
        </div>
      </div>

      {/* 2. 综合数据：战绩 + 均值合并为 2×4 grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <Stat label="出场" value={played} />
        <Stat label="胜" value={totalWins} />
        <Stat label="负" value={totalLosses} />
        <Stat label="胜率" value={winRate} />
        {teamAvgRating && (
          <>
            <Stat label="场均 RR" value={teamAvgRr ?? "—"} accent />
            <Stat label="场均 Rating Pro" value={teamAvgRating} />
            <Stat label="场均 ADR" value={teamAvgAdr ?? "—"} accent />
            <Stat label="场均 K/D" value={teamAvgKd ?? "—"} />
          </>
        )}
      </div>

      {/* 3. 阵容（首发 + 替补，均显示数据和地图偏好） */}
      <section>
        <Panel label="阵容" pad={20}>
          <div className="divide-y divide-[var(--color-border)]">
            {starters.map((p) => {
              const stats = p.userId ? playerStatsMap.get(p.userId) : undefined;
              return (
                <div key={p.registrationId} className="py-2.5 px-2 -mx-2 hover:bg-[var(--color-panel-hi)] transition-colors rounded">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1.5 sm:gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {p.registrationId === team.captainRegistrationId && <PosChip pos="C" small />}
                        {p.userId ? (
                          <Link href={`/players/${p.userId}`} className="font-medium text-sm sm:text-base text-[var(--color-fg)] truncate hover:text-[var(--color-accent)] transition-colors">
                            {getDisplayName(p)}
                          </Link>
                        ) : (
                          <span className="font-medium text-sm sm:text-base text-[var(--color-fg)] truncate">
                            {getDisplayName(p)}
                          </span>
                        )}
                      </div>
                      {stats && (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[11px] text-[var(--color-fg-mid)] tabular-nums">
                          <span>{stats.maps}图</span>
                          <span className="text-[var(--color-fg-dim)]">·</span>
                          {stats.rrScore != null && (
                            <>
                              <span style={{ color: "var(--color-accent)" }} className="font-semibold">
                                RR {stats.rrScore.toFixed(2)}
                              </span>
                              <span className="text-[var(--color-fg-dim)]">·</span>
                            </>
                          )}
                          <span>
                            {stats.avgRating.toFixed(2)} Rating Pro
                          </span>
                          <span className="text-[var(--color-fg-dim)]">·</span>
                          <span>{stats.avgAdr.toFixed(1)} ADR</span>
                          <span className="text-[var(--color-fg-dim)]">·</span>
                          <span>{stats.kdRatio != null ? stats.kdRatio.toFixed(2) : "—"} K/D</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-start gap-2 sm:flex-col sm:items-end sm:shrink-0">
                      <span className="text-xs text-[var(--color-fg-mid)] whitespace-nowrap shrink-0">
                        {POSITION_LABELS[p.primaryPosition as keyof typeof POSITION_LABELS]?.cn ?? p.primaryPosition}
                      </span>
                      <MapPreferenceChips preferences={p.mapPreferences ?? []} compact minLevel="playable" />
                    </div>
                  </div>
                </div>
              );
            })}

            {subs.length > 0 && (
              <>
                <div className="pt-3 pb-1">
                  <p className="text-xs text-[var(--color-fg-mid)] font-medium uppercase tracking-wide">替补</p>
                </div>
                {subs.map((p) => {
                  const stats = p.userId ? playerStatsMap.get(p.userId) : undefined;
                  return (
                    <div key={p.registrationId} className="py-2.5 px-2 -mx-2 opacity-70 hover:bg-[var(--color-panel-hi)] transition-colors rounded">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1.5 sm:gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            {p.userId ? (
                              <Link href={`/players/${p.userId}`} className="text-sm text-[var(--color-fg)] truncate hover:text-[var(--color-accent)] transition-colors">
                                {getDisplayName(p)}
                              </Link>
                            ) : (
                              <span className="text-sm text-[var(--color-fg)] truncate">{getDisplayName(p)}</span>
                            )}
                          </div>
                          {stats && (
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[11px] text-[var(--color-fg-mid)] tabular-nums">
                              <span>{stats.maps}图</span>
                              <span className="text-[var(--color-fg-dim)]">·</span>
                              <span style={stats.avgRating >= 1.2 ? { color: "var(--color-accent)" } : undefined}>
                                {stats.avgRating.toFixed(2)} RT
                              </span>
                              <span className="text-[var(--color-fg-dim)]">·</span>
                              <span>{stats.avgAdr.toFixed(1)} ADR</span>
                              <span className="text-[var(--color-fg-dim)]">·</span>
                              <span>{stats.kdRatio != null ? stats.kdRatio.toFixed(2) : "—"} K/D</span>
                            </div>
                          )}
                        </div>
                        <div className="flex items-start gap-2 sm:flex-col sm:items-end sm:shrink-0">
                          <span className="text-xs text-[var(--color-fg-mid)] whitespace-nowrap shrink-0">
                            {POSITION_LABELS[p.primaryPosition as keyof typeof POSITION_LABELS]?.cn ?? p.primaryPosition}
                          </span>
                          <MapPreferenceChips preferences={p.mapPreferences ?? []} compact minLevel="playable" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </Panel>
      </section>

      {/* 4. 地图表现 */}
      <section>
        <Panel pad={0} className="overflow-hidden" label="地图表现">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[440px]">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-[var(--color-fg-mid)] text-xs uppercase tracking-wide">
                  <th className="px-5 py-3 text-left font-medium">地图</th>
                  <th className="px-5 py-3 text-center font-medium">胜率</th>
                  <th className="px-5 py-3 text-center font-medium">pick 率</th>
                  <th className="px-5 py-3 text-center font-medium">ban 率</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {seasonMapPool.map((mapName) => {
                  const stat = mapStats.get(mapName);
                  const picks = pickCount.get(mapName) ?? 0;
                  const bans = banCount.get(mapName) ?? 0;
                  return (
                    <tr key={mapName}>
                      <td className="px-5 py-3 font-medium text-[var(--color-fg)]">{mapLabel(mapName)}</td>
                      <td className="px-5 py-3 text-center">
                        {stat !== undefined ? (() => {
                          const wr = pct(stat.wins, stat.played);
                          return (
                            <>
                              <div className="font-semibold" style={{ color: wr.color }}>{wr.text}</div>
                              <div className="text-xs text-[var(--color-fg-mid)]">{stat.played} 场</div>
                            </>
                          );
                        })() : <span className="text-[var(--color-fg-dim)]">—</span>}
                      </td>
                      <td className="px-5 py-3 text-center">
                        {pickBpCount > 0 ? (
                          <>
                            <div className="font-semibold text-[var(--color-fg)]">{pct(picks, pickBpCount).text}</div>
                            <div className="text-xs text-[var(--color-fg-mid)]">{pickBpCount} 对局</div>
                          </>
                        ) : <span className="text-[var(--color-fg-dim)]">—</span>}
                      </td>
                      <td className="px-5 py-3 text-center">
                        {banBpCount > 0 ? (
                          <>
                            <div className="font-semibold text-[var(--color-fg)]">{pct(bans, banBpCount).text}</div>
                            <div className="text-xs text-[var(--color-fg-mid)]">{banBpCount} 对局</div>
                          </>
                        ) : <span className="text-[var(--color-fg-dim)]">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </section>

      {/* 5. 队伍能力图 */}
      {(teamPrism || (teamScores && hexagonByPlayer.size > 0)) && (
        <section className="space-y-3">
          <TeamRadarPanel
            members={radarMembers}
            teamScores={teamScores}
            teamPrism={teamPrism}
          />
        </section>
      )}

      {/* 5.5 赛季风格分析（demo 来源） */}
      {(hasHalfSide || styleProfile) && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-[var(--color-fg)]">赛季风格分析</h2>
          {hasHalfSide && halfSide && (
            <TeamHalfSideStats stats={halfSide} teamName={team.name} />
          )}
          {styleProfile && <TeamStyleProfile profile={styleProfile} />}
        </section>
      )}

      {/* 6. 历史对阵 */}
      {h2hList.length > 0 && (
        <section>
          <Panel pad={0} className="overflow-hidden" label="历史对阵">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[320px]">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-[var(--color-fg-mid)] text-xs uppercase tracking-wide">
                    <th className="px-5 py-3 text-left font-medium">对手</th>
                    <th className="px-5 py-3 text-center font-medium">胜</th>
                    <th className="px-5 py-3 text-center font-medium">负</th>
                    <th className="px-5 py-3 text-right font-medium">胜率</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {h2hList.map((h) => {
                    const opp = teamNameMap.get(h.opponentId);
                    return (
                      <tr key={h.opponentId}>
                        <td className="px-5 py-3 font-medium text-[var(--color-fg)]">
                          {opp ? (
                            <Link href={`/${seasonSlug}/teams/${opp.id}`} className="hover:underline hover:text-[var(--color-accent)]">
                              {opp.name}
                            </Link>
                          ) : "未知队伍"}
                        </td>
                        <td className="px-5 py-3 text-center text-[var(--color-ok)]">{h.wins}</td>
                        <td className="px-5 py-3 text-center text-[var(--color-danger)]">{h.losses}</td>
                        <td className="px-5 py-3 text-right font-semibold text-[var(--color-fg)]">
                          {pct(h.wins, h.wins + h.losses).text}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </section>
      )}

      {/* 7. 即将进行的比赛 */}
      {upcomingMatches.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--color-fg)]">即将进行的比赛</h2>
          <div className="space-y-2">
            {upcomingMatches.map((m) => {
              const oppId = m.teamAId === teamId ? m.teamBId : m.teamAId;
              const oppTeam = teamNameMap.get(oppId);
              return (
                <MatchCard
                  key={m.id}
                  matchId={m.id}
                  seasonSlug={seasonSlug}
                  teamAName={m.teamAId === teamId ? team.name : (oppTeam?.name ?? "TBD")}
                  teamBName={m.teamBId === teamId ? team.name : (oppTeam?.name ?? "TBD")}
                  scoreA={m.scoreA}
                  scoreB={m.scoreB}
                  stage={m.stage}
                  format={m.format as "bo1" | "bo3" | "bo5"}
                  status={m.status as "scheduled" | "in_progress" | "finished" | "cancelled"}
                  scheduledAt={m.scheduledAt}
                  isForfeit={m.isForfeit}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* 8. 历史战绩 */}
      {teamMatches.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--color-fg)]">历史战绩</h2>
          <div className="space-y-2">
            {[...teamMatches]
              .sort((a, b) => {
                const aTime = a.scheduledAt?.getTime() ?? a.createdAt.getTime();
                const bTime = b.scheduledAt?.getTime() ?? b.createdAt.getTime();
                return bTime - aTime;
              })
              .map((m) => {
                const oppId = m.teamAId === teamId ? m.teamBId : m.teamAId;
                const oppTeam = teamNameMap.get(oppId);
                return (
                  <MatchCard
                    key={m.id}
                    matchId={m.id}
                    seasonSlug={seasonSlug}
                    teamAName={m.teamAId === teamId ? team.name : (oppTeam?.name ?? "TBD")}
                    teamBName={m.teamBId === teamId ? team.name : (oppTeam?.name ?? "TBD")}
                    scoreA={m.scoreA}
                    scoreB={m.scoreB}
                    stage={m.stage}
                    format={m.format as "bo1" | "bo3" | "bo5"}
                    status={m.status as "scheduled" | "in_progress" | "finished" | "cancelled"}
                    scheduledAt={m.scheduledAt}
                    isForfeit={m.isForfeit}
                  />
                );
              })}
          </div>
        </section>
      )}

      {/* 9. 队内联系方式（仅同队成员可见） */}
      {isTeamMember && (
        <section>
          <Panel label="队内联系方式" pad={20}>
            <p className="text-xs text-[var(--color-fg-mid)] mb-4">仅同队成员可见</p>
            <div className="space-y-3">
              {roster.map((p) => (
                <div key={p.registrationId} className="flex items-center justify-between gap-2">
                  {p.userId ? (
                    <Link href={`/players/${p.userId}`} className="text-sm font-medium text-[var(--color-fg)] hover:text-[var(--color-accent)] transition-colors">
                      {getDisplayName(p)}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium text-[var(--color-fg)]">{getDisplayName(p)}</span>
                  )}
                  <div className="flex items-center gap-4 text-sm text-[var(--color-fg-mid)]">
                    {p.qq && <span>QQ: {p.qq}</span>}
                    {p.email && <span>邮箱: {p.email}</span>}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </section>
      )}

      {/* 无赛果空态 */}
      {played === 0 && (
        <Panel pad={32} className="text-center text-[var(--color-fg-mid)]">
          暂无比赛记录
        </Panel>
      )}
    </div>
  );
}
