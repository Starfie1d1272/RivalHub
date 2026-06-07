import { notFound } from "next/navigation";
import { buildTeamCohortSummary } from "@cs2dak/presentation";
import { eq, or, and, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, teams, teamMembers, seasonRegistrations, users, matches } from "@/db/schema";
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
import { getCurrentSeasonAnalysis } from "@/actions/dak-analysis";

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
  const [mapStats, { banCount, bpMatchCount: banBpCount }, { pickCount, bpMatchCount: pickBpCount }, analysisResult] = await Promise.all([
    getTeamMapWinStats(teamId, teamMatches),
    getTeamBanStats(teamId, matchIds),
    getTeamPickStats(teamId, matchIds),
    getCurrentSeasonAnalysis(season.id),
  ]);

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

  const cohort = analysisResult.success ? analysisResult.data?.cohort : null;
  const playerKeys = roster
    .map((player) => `user:${player.userId}`)
    .filter((playerKey) => cohort?.players.some((player) => player.playerKey === playerKey));
  const teamSummary = cohort && playerKeys.length > 0
    ? buildTeamCohortSummary(cohort, { teamKey: team.id, name: team.name, playerKeys })
    : null;
  const playerStatsMap = new Map(
    teamSummary?.members.map((member) => [member.playerKey.replace(/^user:/, ""), member]) ?? [],
  );

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
        {teamSummary && (
          <>
            <Stat label="队伍 RR" value={teamSummary.averages.rivalhubRR.toFixed(2)} accent />
            <Stat label="Rating 2.0" value={teamSummary.averages.hltvRating.toFixed(2)} />
            <Stat label="ADR" value={teamSummary.averages.adr.toFixed(1)} accent />
            <Stat label="KAST" value={`${teamSummary.averages.kast.toFixed(1)}%`} />
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
                          <span>{stats.mapCount}图</span>
                          <span className="text-[var(--color-fg-dim)]">·</span>
                          {stats.metrics.rivalhubRR != null && (
                            <>
                              <span style={{ color: "var(--color-accent)" }} className="font-semibold">
                                RR {stats.metrics.rivalhubRR.toFixed(2)}
                              </span>
                              <span className="text-[var(--color-fg-dim)]">·</span>
                            </>
                          )}
                          <span>
                            {stats.metrics.hltvRating?.toFixed(2) ?? "—"} Rating 2.0
                          </span>
                          <span className="text-[var(--color-fg-dim)]">·</span>
                          <span>{stats.metrics.adr?.toFixed(1) ?? "—"} ADR</span>
                          <span className="text-[var(--color-fg-dim)]">·</span>
                          <span>{stats.metrics.kd?.toFixed(2) ?? "—"} K/D</span>
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
                              <span>{stats.mapCount}图</span>
                              <span className="text-[var(--color-fg-dim)]">·</span>
                              <span>
                                {stats.metrics.rivalhubRR?.toFixed(2) ?? "—"} RR
                              </span>
                              <span className="text-[var(--color-fg-dim)]">·</span>
                              <span>{stats.metrics.adr?.toFixed(1) ?? "—"} ADR</span>
                              <span className="text-[var(--color-fg-dim)]">·</span>
                              <span>{stats.metrics.kd?.toFixed(2) ?? "—"} K/D</span>
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

      {teamSummary && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-[var(--color-fg)]">DAK 队伍分析</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Panel label="关键表现">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="OPENING WIN" value={teamSummary.performance.openingDuelWinRate == null ? "—" : `${(teamSummary.performance.openingDuelWinRate * 100).toFixed(1)}%`} />
                <Stat label="CLUTCH WIN" value={teamSummary.performance.clutchWinRate == null ? "—" : `${(teamSummary.performance.clutchWinRate * 100).toFixed(1)}%`} />
              </div>
            </Panel>
            <Panel label="队内领跑">
              <div className="space-y-2 text-sm">
                {teamSummary.leaders.map((leader) => (
                  <div key={leader.metric} className="flex justify-between gap-3">
                    <span className="text-[var(--color-fg-mid)]">{leader.label}</span>
                    <span>{leader.name} · {leader.value.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
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
