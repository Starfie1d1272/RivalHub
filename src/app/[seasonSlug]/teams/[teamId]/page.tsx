import { notFound } from "next/navigation";
import { eq, or, and, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, teams, teamMembers, seasonRegistrations, users, matches } from "@/db/schema";
import { matchPlayerStats } from "@/db/schema/player-stats";
import { Panel, Stat, Marker, PosChip } from "@/components/rivalhub";
import { MatchCard } from "@/components/matches/MatchCard";
import { MapPreferenceChips } from "@/components/rivalhub/map-preference-chips";
import { TeamNameForm } from "@/components/teams/TeamNameForm";
import { TeamLogoUpload } from "@/components/teams/TeamLogoUpload";
import Link from "next/link";
import { POSITION_LABELS } from "@/lib/validators/registration";
import { CS2_POSITIONS, DEFAULT_CS2_MAP_POOL } from "@/types/season";
import { getUserSession } from "@/lib/auth/session";
import { getDisplayName } from "@/lib/utils/display-name";
import { getTeamMapWinStats, getTeamBanStats } from "@/lib/teams/data";
import { mapLabel } from "@/lib/maps";

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

  // 对手队名（包含已完成和即将进行的比赛对手）
  const opponentIds = [
    ...new Set([
      ...teamMatches.map((m) => (m.teamAId === teamId ? m.teamBId : m.teamAId)),
      ...upcomingMatches.map((m) => (m.teamAId === teamId ? m.teamBId : m.teamAId)),
    ]),
  ];
  const opponentTeams = opponentIds.length
    ? await db.query.teams.findMany({
        where: inArray(teams.id, opponentIds),
      })
    : [];
  const teamNameMap = new Map(opponentTeams.map((t) => [t.id, t]));

  // 整体胜负统计
  let totalWins = 0;
  let totalLosses = 0;
  for (const m of teamMatches) {
    const isA = m.teamAId === teamId;
    const myScore = isA ? (m.scoreA ?? 0) : (m.scoreB ?? 0);
    const oppScore = isA ? (m.scoreB ?? 0) : (m.scoreA ?? 0);
    if (myScore > oppScore) totalWins++;
    else totalLosses++;
  }

  // ── 地图表现统计 ──────────────────────────────────────────────────────────
  const matchIds = teamMatches.map((m) => m.id);
  const [mapStats, { banCount, bpMatchCount }] = await Promise.all([
    getTeamMapWinStats(teamId, teamMatches),
    getTeamBanStats(teamId, matchIds),
  ]);

  // ── 历史对阵（按对手分组） ─────────────────────────────────────────────
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

  const played = totalWins + totalLosses;

  // ── 队伍聚合统计 ──────────────────────────────────────────────────
  const teamStatResult = roster.length
    ? await db.execute(sql`
        SELECT
          round(avg(mps.rating_pro)::numeric, 2) as avg_rating,
          round(avg(mps.adr)::numeric, 1) as avg_adr,
          round(avg(mps.kills)::numeric, 1) as avg_kills,
          round(avg(mps.deaths)::numeric, 1) as avg_deaths,
          round(avg(mps.we)::numeric, 1) as avg_we,
          sr.primary_position,
          mps.perfect_name,
          mps.rating_pro
        FROM match_player_stats mps
        JOIN season_registrations sr ON sr.user_id = mps.user_id AND sr.season_id = ${season.id}
        JOIN team_members tm ON tm.registration_id = sr.id
        WHERE tm.team_id = ${teamId}
          AND mps.verified_by_admin IS NOT NULL
        GROUP BY sr.primary_position, mps.perfect_name, mps.rating_pro
      `)
    : null;

  const teamStatRows: Record<string, unknown>[] = teamStatResult?.rows ?? [];

  interface TeamStatRow {
    avg_rating: number;
    avg_adr: number;
    avg_kills: number;
    avg_deaths: number;
    avg_we: number;
    primary_position: string;
    perfect_name: string;
    rating_pro: number;
  }

  const typedStats = teamStatRows as unknown as TeamStatRow[];

  const teamAvgRating =
    typedStats.length > 0
      ? (typedStats.reduce((s, r) => s + Number(r.avg_rating), 0) / typedStats.length).toFixed(2)
      : null;
  const teamAvgAdr =
    typedStats.length > 0
      ? (typedStats.reduce((s, r) => s + Number(r.avg_adr), 0) / typedStats.length).toFixed(1)
      : null;
  const teamAvgKd =
    typedStats.length > 0
      ? (() => {
          const k = typedStats.reduce((s, r) => s + Number(r.avg_kills), 0);
          const d = typedStats.reduce((s, r) => s + Number(r.avg_deaths), 0);
          return d > 0 ? (k / d).toFixed(2) : null;
        })()
      : null;
  const teamAvgWe =
    typedStats.length > 0
      ? (typedStats.reduce((s, r) => s + Number(r.avg_we), 0) / typedStats.length).toFixed(1)
      : null;

  // 每位置最高 Rating 选手
  const positionBest = new Map<string, { name: string; rating: number }>();
  for (const r of typedStats) {
    const pos = r.primary_position;
    const existing = positionBest.get(pos);
    if (!existing || Number(r.rating_pro) > existing.rating) {
      positionBest.set(pos, { name: r.perfect_name, rating: Number(r.rating_pro) });
    }
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl space-y-10">

      {/* 队伍标题 */}
      <div className="flex items-start gap-5">
        <TeamLogoUpload
          teamId={team.id}
          currentLogoUrl={team.logoUrl ?? null}
          teamName={team.name}
          canEdit={canEditTeamName}
        />
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

      {/* 整体战绩 */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <Stat label="出场" value={played} />
        <Stat label="胜" value={totalWins} />
        <Stat label="负" value={totalLosses} />
      </div>

      {/* 阵容 */}
      <section>
        <Panel label="阵容" pad={20}>
          <div className="space-y-3">
            {starters.map((p) => (
              <div key={p.registrationId} className="flex items-center justify-between gap-2 hover:bg-[var(--color-panel-hi)] transition-colors rounded px-2 -mx-2">
                <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                  {p.registrationId === team.captainRegistrationId && (
                    <PosChip pos="C" small />
                  )}
                  <span className="font-medium text-[var(--color-fg)] truncate text-sm sm:text-base">
                    {getDisplayName(p)}
                  </span>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-xs sm:text-sm text-[var(--color-fg-mid)]">
                    {POSITION_LABELS[p.primaryPosition as keyof typeof POSITION_LABELS]?.cn ?? p.primaryPosition}
                  </span>
                  <div className="mt-1 flex justify-end">
                    <MapPreferenceChips preferences={p.mapPreferences ?? []} compact minLevel="playable" />
                  </div>
                </div>
              </div>
            ))}

            {subs.length > 0 && (
              <div className="border-t border-[var(--color-border)] pt-3 space-y-2">
                <p className="text-xs text-[var(--color-fg-mid)] font-medium uppercase tracking-wide">替补</p>
                {subs.map((p) => (
                  <div key={p.registrationId} className="flex items-center justify-between gap-2 opacity-70 hover:bg-[var(--color-panel-hi)] transition-colors rounded px-2 -mx-2">
                    <span className="text-sm text-[var(--color-fg)] truncate">{getDisplayName(p)}</span>
                    <span className="text-xs text-[var(--color-fg-mid)] shrink-0">
                      {POSITION_LABELS[p.primaryPosition as keyof typeof POSITION_LABELS]?.cn ?? p.primaryPosition}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>
      </section>

      {/* 即将进行的比赛 */}
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
                />
              );
            })}
          </div>
        </section>
      )}

      {/* 历史战绩 */}
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
                  />
                );
              })}
          </div>
        </section>
      )}

      {/* 队内联系方式（仅同队成员可见） */}
      {isTeamMember && (
        <section>
          <Panel label="队内联系方式" pad={20}>
            <p className="text-xs text-[var(--color-fg-mid)] mb-4">仅同队成员可见</p>
            <div className="space-y-3">
              {roster.map((p) => (
                <div key={p.registrationId} className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-[var(--color-fg)]">
                    {getDisplayName(p)}
                  </span>
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

      {/* 队伍数据 */}
      {teamAvgRating && (
        <section>
          <Panel label="队伍数据" pad={20}>
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                <Stat label="场均 Rating" value={teamAvgRating ?? "—"} accent />
                <Stat label="场均 ADR" value={teamAvgAdr ?? "—"} accent />
                <Stat label="场均 K/D" value={teamAvgKd ?? "—"} accent />
                <Stat label="场均 WE" value={teamAvgWe ?? "—"} accent />
              </div>
              {positionBest.size > 0 && (
                <div className="text-[11px] text-[var(--color-fg-dim)] border-t border-[var(--color-border)] pt-3">
                  {[...positionBest.entries()]
                    .map(([pos, info]) => {
                      const label =
                        POSITION_LABELS[pos as keyof typeof POSITION_LABELS]?.cn ?? pos;
                      return `${label} ${info.name} (${info.rating.toFixed(2)})`;
                    })
                    .join(" · ")}
                </div>
              )}
            </div>
          </Panel>
        </section>
      )}

      {/* 地图表现 */}
      <section>
        <Panel pad={0} className="overflow-hidden" label="地图表现">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[340px]">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-[var(--color-fg-mid)] text-xs uppercase tracking-wide">
                  <th className="px-5 py-3 text-left font-medium">地图</th>
                  <th className="px-5 py-3 text-center font-medium">胜率</th>
                  <th className="px-5 py-3 text-center font-medium">ban 率</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {DEFAULT_CS2_MAP_POOL.map((mapName) => {
                  const stat = mapStats.get(mapName);
                  const bans = banCount.get(mapName) ?? 0;
                  return (
                    <tr key={mapName}>
                      <td className="px-5 py-3 font-medium text-[var(--color-fg)]">
                        {mapLabel(mapName)}
                      </td>
                      <td className="px-5 py-3 text-center">
                        {stat !== undefined ? (() => {
                          const wr = pct(stat.wins, stat.played);
                          return (
                            <>
                              <div
                                className="font-semibold"
                                style={{ color: wr.color }}
                              >
                                {wr.text}
                              </div>
                              <div className="text-xs text-[var(--color-fg-mid)]">{stat.played} 场</div>
                            </>
                          );
                        })() : (
                          <span className="text-[var(--color-fg-dim)]">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-center">
                        {bpMatchCount > 0 ? (
                          <>
                            <div className="font-semibold text-[var(--color-fg)]">
                              {pct(bans, bpMatchCount).text}
                            </div>
                            <div className="text-xs text-[var(--color-fg-mid)]">{bpMatchCount} 对局</div>
                          </>
                        ) : (
                          <span className="text-[var(--color-fg-dim)]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </section>

      {/* 历史对阵 */}
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
                          <Link
                            href={`/${seasonSlug}/teams/${opp.id}`}
                            className="hover:underline hover:text-[var(--color-accent)]"
                          >
                            {opp.name}
                          </Link>
                        ) : "未知队伍"}
                      </td>
                      <td className="px-5 py-3 text-center text-green-500">{h.wins}</td>
                      <td className="px-5 py-3 text-center text-red-500">{h.losses}</td>
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

      {/* 无赛果时的空态 */}
      {played === 0 && (
        <Panel pad={32} className="text-center text-[var(--color-fg-mid)]">
          暂无比赛记录
        </Panel>
      )}
    </div>
  );
}
