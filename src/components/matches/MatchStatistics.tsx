import Link from "next/link";
import { ContentReady } from "@/components/telemetry/ContentReady";
import { PlayerWorkspace } from "@/components/stats/players/PlayerWorkspace";
import { Panel, PosChip } from "@/components/rivalhub";
import { mapLabel } from "@/lib/maps";
import { SIDE_LABELS } from "@/types/match";
import type { MatchMap } from "@/db/schema";
import type { loadMatchScoreboard } from "@/lib/matches/detail-scoreboard";
import type { MatchPerformance } from "@/lib/stats/match-performance-query";
import { matchStatsHref, parseMatchStatsScope, type MatchStatsQuery } from "@/lib/matches/stats-view";
import { projectMatchStatsRows, projectMatchWorkspaceScoreboard, type MatchScoreboardIdentity } from "@/lib/matches/scoreboard-view";
import { MatchSummaryStats } from "./MatchSummaryStats";

interface MatchStatisticsProps {
  seasonSlug: string;
  matchId: string;
  maps: readonly MatchMap[];
  entryAId: string;
  entryBId: string;
  teamAName: string;
  teamBName: string;
  preferredPlayerId: string | null;
  identities: MatchScoreboardIdentity[];
  query: MatchStatsQuery;
  scoreboard: Awaited<ReturnType<typeof loadMatchScoreboard>>;
  performance: MatchPerformance | null;
  unavailable: boolean;
  finished: boolean;
}

const controlClass = "rounded-sm border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] aria-[current=page]:border-[var(--color-accent)] aria-[current=page]:text-[var(--color-fg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]";

/** One URL scope controls both teams and the selected player's existing workspace. */
export function MatchStatistics({ seasonSlug, matchId, maps, entryAId, entryBId, teamAName, teamBName, preferredPlayerId, identities, query, scoreboard, performance, unavailable, finished }: MatchStatisticsProps) {
  const players = [...new Map([
    ...identities,
    ...scoreboard.summaryPlayers.flatMap(player => player.userId ? [{ userId: player.userId, perfectName: player.perfectName, teamId: player.teamId }] : []),
    ...(performance?.overall ?? []).flatMap(player => {
      const teamId = player.teamEntityKeys.find(id => id === entryAId || id === entryBId);
      return teamId ? [{ userId: player.player.entityKey, perfectName: player.player.displayName, teamId }] : [];
    }),
  ].map(player => [player.userId, player])).values()];
  const scope = parseMatchStatsScope(query, maps, players, preferredPlayerId);
  const selectedMap = maps.find(map => map.id === scope.mapId);
  const scopedMaps = selectedMap ? [selectedMap] : maps;
  const completedMaps = scopedMaps.filter(map => map.completedAt && map.scoreA !== null && map.scoreB !== null);
  const basic = selectedMap ? scoreboard.mapPlayers.get(selectedMap.id) ?? [] : scoreboard.summaryPlayers;
  const scopedPerformance = scope.mapId ? performance?.byMap[scope.mapId] ?? [] : performance?.overall ?? [];
  const rows = projectMatchStatsRows(players, basic, scopedPerformance, scope.side);
  const href = (patch: Parameters<typeof matchStatsHref>[4] = {}, anchor = "match-stats") => matchStatsHref(seasonSlug, matchId, query, scope, patch, anchor);
  const playerHrefs = Object.fromEntries(players.map(player => [player.userId, href({ playerId: player.userId }, "detailed-stats")]));
  const coveredMaps = scopedMaps.filter(map => performance?.byMap[map.id]);
  const coverage = `${coveredMaps.length}/${completedMaps.length} 张已完成地图${coveredMaps.length ? `（${coveredMaps.map(map => mapLabel(map.mapName)).join("、")}）` : ""}`;
  const selectedPerformance = scopedPerformance.find(player => player.player.entityKey === scope.playerId) ?? null;
  const playerScoreboard = scopedMaps.flatMap(map => (scoreboard.mapPlayers.get(map.id) ?? [])
    .filter(player => player.userId === scope.playerId)
    .map(player => ({ ...player, rounds: map.scoreA !== null && map.scoreB !== null ? map.scoreA + map.scoreB : null })));
  const workspaceScoreboard = projectMatchWorkspaceScoreboard(playerScoreboard, selectedPerformance);
  const playerName = players.find(player => player.userId === scope.playerId)?.perfectName;
  const sideHrefs = { overall: href({ side: "overall" }, "detailed-stats"), ct: href({ side: "ct" }, "detailed-stats"), t: href({ side: "t" }, "detailed-stats") };
  const scopeLabel = `${selectedMap ? mapLabel(selectedMap.mapName) : "全场"} · ${scope.side === "overall" ? "Both" : scope.side.toUpperCase()}`;

  return <>
    <section id="match-stats" className="min-w-0 scroll-mt-20 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">比赛统计</h2>
        <nav aria-label="计分板密度" className="flex gap-2">
          {([['compact', '简洁'], ['detailed', '详细']] as const).map(([view, label]) => <Link key={view} prefetch={false} href={href({ view }) as never} aria-current={scope.view === view ? "page" : undefined} className={controlClass}>{label}</Link>)}
        </nav>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="地图范围" className="flex min-w-0 flex-wrap gap-2">
          <Link prefetch={false} href={href({ mapId: null }) as never} aria-current={!scope.mapId ? "page" : undefined} className={controlClass}>全场</Link>
          {maps.map(map => <Link key={map.id} prefetch={false} href={href({ mapId: map.id }) as never} aria-current={scope.mapId === map.id ? "page" : undefined} className={controlClass}>
            {mapLabel(map.mapName)} <span className="ml-1 tabular-nums">{map.scoreA !== null && map.scoreB !== null ? `${map.scoreA}:${map.scoreB}` : "—"}</span>
          </Link>)}
        </nav>
        <nav aria-label="阵营范围" className="flex gap-2">
          {([['overall', 'Both'], ['ct', 'CT'], ['t', 'T']] as const).map(([side, label]) => <Link key={side} prefetch={false} href={href({ side }) as never} aria-current={scope.side === side ? "page" : undefined} className={controlClass}>{label}</Link>)}
        </nav>
      </div>
      {selectedMap && <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>#{selectedMap.mapOrder} · {mapLabel(selectedMap.mapName)}</span>
        <PosChip pos={selectedMap.pickedByEntryId === entryAId ? `${teamAName} Pick` : selectedMap.pickedByEntryId === entryBId ? `${teamBName} Pick` : "决胜图"} />
        {selectedMap.teamAStartSide && <span className="text-[var(--color-fg-mid)]">{teamAName} {SIDE_LABELS[selectedMap.teamAStartSide]}先</span>}
        {!selectedMap.completedAt && <span>{finished ? "本图未进行" : "地图待进行"}</span>}
      </div>}
      <p className="text-sm text-[var(--color-fg-mid)]">{scopeLabel} · 高级数据覆盖 {coverage}</p>
      {unavailable && <p role="status" className="text-sm">高级统计暂时无法加载，请稍后重试。</p>}
      {selectedMap && scoreboard.provisionalMapIds.has(selectedMap.id) && <p className="text-sm text-[var(--color-fg-mid)]">基础数据为临时数据，待核对。</p>}
      <MatchSummaryStats players={rows} entryAId={entryAId} entryBId={entryBId} teamAName={teamAName} teamBName={teamBName} view={scope.view} playerHrefs={playerHrefs} selectedPlayerId={scope.playerId} />
    </section>
    {scope.playerId && <section id="detailed-stats" className="min-w-0 scroll-mt-20 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">个人深挖 · {playerName}</h2>
        <Link prefetch={false} href={href() as never} className="text-sm text-[var(--color-accent)]">返回十人计分板 ↑</Link>
      </div>
      <p className="text-sm text-[var(--color-fg-mid)]">{scopeLabel} · 详细数据覆盖 {coverage}。点击上方选手行切换选手。</p>
      <Panel contentClassName="p-4">
        {!selectedPerformance && <p className="mb-4 text-sm text-[var(--color-fg-mid)]">当前范围暂无该选手的详细统计。</p>}
        <PlayerWorkspace detail={{
          playerId: scope.playerId, performance: selectedPerformance,
          scoreboard: workspaceScoreboard, scoreboardMaps: [],
          teamNames: { [entryAId]: teamAName, [entryBId]: teamBName },
          teamLinks: { [entryAId]: `/${seasonSlug}/teams/${entryAId}`, [entryBId]: `/${seasonSlug}/teams/${entryBId}` },
        }} hideMaps side={scope.side} sideHrefs={sideHrefs} />
      </Panel>
      <ContentReady module="match" phase="advanced" />
    </section>}
  </>;
}
