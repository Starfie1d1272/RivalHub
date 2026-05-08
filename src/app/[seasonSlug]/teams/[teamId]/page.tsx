import { notFound } from "next/navigation";
import { eq, or, and, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, teams, teamMembers, seasonRegistrations, users, matches, matchMaps } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import Link from "next/link";

interface TeamDetailPageProps {
  params: Promise<{ seasonSlug: string; teamId: string }>;
}

const POSITION_ORDER = ["igl", "awper", "opener", "closer", "anchor"];
const POSITION_LABELS: Record<string, string> = {
  igl: "IGL",
  awper: "AWP",
  opener: "Opener",
  closer: "Closer",
  anchor: "Anchor",
};

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
      const ai = POSITION_ORDER.indexOf(a.primaryPosition);
      const bi = POSITION_ORDER.indexOf(b.primaryPosition);
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

  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl space-y-10">

      {/* 队伍标题 */}
      <div className="space-y-1">
        <p className="text-xs text-[var(--text-secondary)]">
          <Link href={`/${seasonSlug}/teams`} className="hover:underline">参赛队伍</Link>
          {" / "}
          <span className="text-[var(--text-primary)]">#{team.draftOrder}</span>
        </p>
        <h1 className="text-4xl font-black text-[var(--text-primary)]">{team.name}</h1>
      </div>

      {/* 整体战绩 */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "出场", value: played },
          { label: "胜", value: totalWins },
          { label: "负", value: totalLosses },
        ].map(({ label, value }) => (
          <Card key={label} className="p-4 text-center">
            <p className="text-2xl font-bold text-[var(--text-primary)]">{value}</p>
            <p className="text-xs text-[var(--text-secondary)] mt-1">{label}</p>
          </Card>
        ))}
      </div>

      {/* 阵容 */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">阵容</h2>
        <Card className="p-5 space-y-3">
          {starters.map((p) => (
            <div key={p.registrationId} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {p.registrationId === team.captainRegistrationId && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0 text-[var(--primary)]">C</Badge>
                )}
                <span className="font-medium text-[var(--text-primary)]">
                  {p.steamName ?? "未知选手"}
                </span>
              </div>
              <span className="text-sm text-[var(--text-secondary)]">
                {POSITION_LABELS[p.primaryPosition] ?? p.primaryPosition}
              </span>
            </div>
          ))}

          {subs.length > 0 && (
            <div className="border-t border-[var(--border)] pt-3 space-y-2">
              <p className="text-xs text-[var(--text-secondary)] font-medium uppercase tracking-wide">替补</p>
              {subs.map((p) => (
                <div key={p.registrationId} className="flex items-center justify-between opacity-70">
                  <span className="text-sm text-[var(--text-primary)]">{p.steamName ?? "未知选手"}</span>
                  <span className="text-xs text-[var(--text-secondary)]">
                    {POSITION_LABELS[p.primaryPosition] ?? p.primaryPosition}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>

      {/* 地图胜率 */}
      {sortedMaps.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">地图胜率</h2>
          <Card className="p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--text-secondary)] text-xs uppercase tracking-wide">
                  <th className="px-5 py-3 text-left font-medium">地图</th>
                  <th className="px-5 py-3 text-center font-medium">出场</th>
                  <th className="px-5 py-3 text-center font-medium">胜</th>
                  <th className="px-5 py-3 text-center font-medium">负</th>
                  <th className="px-5 py-3 text-right font-medium">胜率</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {sortedMaps.map(([mapName, stat]) => (
                  <tr key={mapName}>
                    <td className="px-5 py-3 font-medium text-[var(--text-primary)]">{mapName}</td>
                    <td className="px-5 py-3 text-center text-[var(--text-secondary)]">{stat.played}</td>
                    <td className="px-5 py-3 text-center text-green-500">{stat.wins}</td>
                    <td className="px-5 py-3 text-center text-red-500">{stat.played - stat.wins}</td>
                    <td className="px-5 py-3 text-right font-semibold text-[var(--text-primary)]">
                      {pct(stat.wins, stat.played)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      )}

      {/* 历史对阵 */}
      {h2hList.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">历史对阵</h2>
          <Card className="p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--text-secondary)] text-xs uppercase tracking-wide">
                  <th className="px-5 py-3 text-left font-medium">对手</th>
                  <th className="px-5 py-3 text-center font-medium">胜</th>
                  <th className="px-5 py-3 text-center font-medium">负</th>
                  <th className="px-5 py-3 text-right font-medium">胜率</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {h2hList.map((h) => {
                  const opp = teamNameMap.get(h.opponentId);
                  return (
                    <tr key={h.opponentId}>
                      <td className="px-5 py-3 font-medium text-[var(--text-primary)]">
                        {opp ? (
                          <Link
                            href={`/${seasonSlug}/teams/${opp.id}`}
                            className="hover:underline hover:text-[var(--primary)]"
                          >
                            {opp.name}
                          </Link>
                        ) : "未知队伍"}
                      </td>
                      <td className="px-5 py-3 text-center text-green-500">{h.wins}</td>
                      <td className="px-5 py-3 text-center text-red-500">{h.losses}</td>
                      <td className="px-5 py-3 text-right font-semibold text-[var(--text-primary)]">
                        {pct(h.wins, h.wins + h.losses)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </section>
      )}

      {/* 无赛果时的空态 */}
      {played === 0 && (
        <Card className="p-8 text-center text-[var(--text-secondary)]">
          暂无比赛记录
        </Card>
      )}
    </div>
  );
}
