import { notFound } from "next/navigation";
import { eq, or, and, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, teams, teamMembers, seasonRegistrations, users, matches, matchMaps } from "@/db/schema";
import { matchPlayerStats } from "@/db/schema/player-stats";
import { Panel, Stat, Marker, PosChip } from "@/components/rivalhub";
import Link from "next/link";
import { POSITION_LABELS } from "@/lib/validators/registration";
import { CS2_POSITIONS } from "@/types/season";

interface TeamDetailPageProps {
  params: Promise<{ seasonSlug: string; teamId: string }>;
}

function pct(n: number, d: number) {
  if (d === 0) return "—";
  return `${Math.round((n / d) * 100)}%`;
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

  // ── 阵容 ──────────────────────────────────────────────────────────────
  const roster = await db
    .select({
      registrationId: teamMembers.registrationId,
      isStarter: teamMembers.isStarter,
      primaryPosition: seasonRegistrations.primaryPosition,
      steamName: users.steamName,
    })
    .from(teamMembers)
    .innerJoin(seasonRegistrations, eq(teamMembers.registrationId, seasonRegistrations.id))
    .innerJoin(users, eq(seasonRegistrations.userId, users.id))
    .where(eq(teamMembers.teamId, teamId));

  const starters = roster
    .filter((r) => r.isStarter)
    .sort((a, b) => {
      const ai = CS2_POSITIONS.indexOf(a.primaryPosition as never);
      const bi = CS2_POSITIONS.indexOf(b.primaryPosition as never);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  const subs = roster.filter((r) => !r.isStarter);

  // ── 赛果（已完赛） ─────────────────────────────────────────────────────
  const teamMatches = await db.query.matches.findMany({
    where: and(
      eq(matches.seasonId, season.id),
      eq(matches.status, "finished"),
      or(eq(matches.teamAId, teamId), eq(matches.teamBId, teamId))
    ),
  });

  // 对手队名
  const opponentIds = [
    ...new Set(
      teamMatches.map((m) => (m.teamAId === teamId ? m.teamBId : m.teamAId))
    ),
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

  // ── 地图统计 ──────────────────────────────────────────────────────────
  const matchIds = teamMatches.map((m) => m.id);
  const allMaps = matchIds.length
    ? await db.query.matchMaps.findMany({
        where: and(
          inArray(matchMaps.matchId, matchIds),
          // 只统计有比分的图
        ),
      })
    : [];

  // 每图胜率（需要知道 teamA/B 关系）
  const matchTeamMap = new Map(teamMatches.map((m) => [m.id, m]));
  interface MapStat { wins: number; played: number }
  const mapStats = new Map<string, MapStat>();
  for (const mp of allMaps) {
    if (mp.scoreA === null || mp.scoreB === null) continue;
    const match = matchTeamMap.get(mp.matchId);
    if (!match) continue;
    const isA = match.teamAId === teamId;
    const myScore = isA ? mp.scoreA : mp.scoreB;
    const oppScore = isA ? mp.scoreB : mp.scoreA;
    const prev = mapStats.get(mp.mapName) ?? { wins: 0, played: 0 };
    mapStats.set(mp.mapName, {
      wins: prev.wins + (myScore > oppScore ? 1 : 0),
      played: prev.played + 1,
    });
  }
  const sortedMaps = [...mapStats.entries()].sort((a, b) => b[1].played - a[1].played);

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
  const teamStatRows = roster.length
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
    : [];

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
      <div className="space-y-1">
        <p className="text-xs text-[var(--color-fg-mid)]">
          <Link href={`/${seasonSlug}/teams`} className="hover:underline">参赛队伍</Link>
          {" / "}
          <span className="text-[var(--color-fg)]">#{team.draftOrder}</span>
        </p>
        <Marker>{team.name}</Marker>
      </div>

      {/* 整体战绩 */}
      <div className="grid grid-cols-3 gap-4">
        <Stat label="出场" value={played} />
        <Stat label="胜" value={totalWins} />
        <Stat label="负" value={totalLosses} />
      </div>

      {/* 阵容 */}
      <section>
        <Panel label="阵容" pad={20}>
          <div className="space-y-3">
            {starters.map((p) => (
              <div key={p.registrationId} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {p.registrationId === team.captainRegistrationId && (
                    <PosChip pos="C" small />
                  )}
                  <span className="font-medium text-[var(--color-fg)]">
                    {p.steamName ?? "未知选手"}
                  </span>
                </div>
                <span className="text-sm text-[var(--color-fg-mid)]">
                  {POSITION_LABELS[p.primaryPosition as keyof typeof POSITION_LABELS]?.cn ?? p.primaryPosition}
                </span>
              </div>
            ))}

            {subs.length > 0 && (
              <div className="border-t border-[var(--color-border)] pt-3 space-y-2">
                <p className="text-xs text-[var(--color-fg-mid)] font-medium uppercase tracking-wide">替补</p>
                {subs.map((p) => (
                  <div key={p.registrationId} className="flex items-center justify-between opacity-70">
                    <span className="text-sm text-[var(--color-fg)]">{p.steamName ?? "未知选手"}</span>
                    <span className="text-xs text-[var(--color-fg-mid)]">
                      {POSITION_LABELS[p.primaryPosition as keyof typeof POSITION_LABELS]?.cn ?? p.primaryPosition}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>
      </section>

      {/* 队伍数据 */}
      {teamAvgRating && (
        <section>
          <Panel label="队伍数据" pad={20}>
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-4">
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

      {/* 地图胜率 */}
      {sortedMaps.length > 0 && (
        <section>
          <Panel pad={0} className="overflow-hidden" label="地图胜率">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-[var(--color-fg-mid)] text-xs uppercase tracking-wide">
                  <th className="px-5 py-3 text-left font-medium">地图</th>
                  <th className="px-5 py-3 text-center font-medium">出场</th>
                  <th className="px-5 py-3 text-center font-medium">胜</th>
                  <th className="px-5 py-3 text-center font-medium">负</th>
                  <th className="px-5 py-3 text-right font-medium">胜率</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {sortedMaps.map(([mapName, stat]) => (
                  <tr key={mapName}>
                    <td className="px-5 py-3 font-medium text-[var(--color-fg)]">{mapName}</td>
                    <td className="px-5 py-3 text-center text-[var(--color-fg-mid)]">{stat.played}</td>
                    <td className="px-5 py-3 text-center text-green-500">{stat.wins}</td>
                    <td className="px-5 py-3 text-center text-red-500">{stat.played - stat.wins}</td>
                    <td className="px-5 py-3 text-right font-semibold text-[var(--color-fg)]">
                      {pct(stat.wins, stat.played)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </section>
      )}

      {/* 历史对阵 */}
      {h2hList.length > 0 && (
        <section>
          <Panel pad={0} className="overflow-hidden" label="历史对阵">
            <table className="w-full text-sm">
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
                        {pct(h.wins, h.wins + h.losses)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
