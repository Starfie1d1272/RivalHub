import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { HelpTooltip } from "@/components/rivalhub/HelpTooltip";
import { Panel } from "@/components/rivalhub/Panel";
import { StatsHelpLabel } from "@/components/stats/StatsMetricHelp";
import { getMatchPlayerDisplayName } from "@/lib/identity/display-name";
import { cn } from "@/lib/utils/cn";
import type { MatchStatsRow } from "@/lib/matches/scoreboard-view";
import type { MatchStatsView } from "@/lib/matches/stats-view";
import { formatDisplayValue } from "@/lib/stats/display";
import { formatStat } from "@/lib/stats/format";
import { formatStatsMetric } from "@/lib/stats/presentation";

interface MatchSummaryStatsProps {
  players: readonly MatchStatsRow[];
  entryAId: string;
  entryBId: string;
  teamAName: string;
  teamBName: string;
  view: MatchStatsView;
  showAdvancedCoverage: boolean;
}

const count = (value: number | null) => formatDisplayValue(value, { unit: "count", precision: 0 });
const pair = (a: number | null, b: number | null) => `${count(a)}–${count(b)}`;
const detail = (a: number | null, b: number | null) => `${count(a)} (${count(b)})`;
const columns = {
  kd: { label: "K–D", help: "击杀数与死亡数。", value: (p: MatchStatsRow) => pair(p.kills, p.deaths) },
  difference: { label: "+/−", help: "击杀数减去死亡数。", value: (p: MatchStatsRow) => p.kills === null || p.deaths === null ? "—" : p.kills - p.deaths > 0 ? `+${p.kills - p.deaths}` : String(p.kills - p.deaths) },
  assistsTotal: { label: "A", help: "助攻数。", value: (p: MatchStatsRow) => formatStat("assists", p.assists) },
  opening: { label: "Op. K–D", help: "每回合开局首杀与首死，不是总击杀与死亡。", value: (p: MatchStatsRow) => pair(p.firstKills, p.firstDeaths) },
  mk: { label: "MKs", help: "至少两杀的回合数，即 2K、3K、4K 与 5K 回合之和。", value: (p: MatchStatsRow) => formatStat("multiKills", p.multiKills) },
  kast: { label: "KAST", help: "取得击杀、助攻、存活或被队友补枪的回合占比，按当前数据覆盖的实际回合计算。", value: (p: MatchStatsRow) => formatStatsMetric("kast", p.kast) },
  clutch: { label: "1vsX", help: "1 对多残局获胜次数，可在个人 Clutch 中查看细分。", value: (p: MatchStatsRow) => formatStat("clutches", p.clutches) },
  kills: { label: "K (hs)", help: "总击杀（精确爆头击杀）。Both 的括号值须覆盖全部所选地图，不从 HS% 反算。", value: (p: MatchStatsRow) => detail(p.kills, p.headshots) },
  assists: { label: "A (f)", help: "总助攻（闪光助攻）。Both 的括号值须覆盖全部所选地图。", value: (p: MatchStatsRow) => detail(p.assists, p.flashAssists) },
  deaths: { label: "D (t)", help: "总死亡（被队友补掉的死亡）。Both 的括号值须覆盖全部所选地图；t 指 traded，不是 T 阵营。", value: (p: MatchStatsRow) => detail(p.deaths, p.tradedDeaths) },
  adr: { label: "ADR", help: "每回合平均伤害；跨图按有效回合加权。", value: (p: MatchStatsRow) => formatStat("adr", p.adr) },
  rating: { label: "Rating", help: "已核对记分板的 Rating Pro。CT/T 没有独立来源时显示 —。", value: (p: MatchStatsRow) => formatStat("ratingPro", p.ratingPro) },
};
const compactColumns = ["kd", "difference", "assistsTotal", "adr", "kast", "rating"] as const;
const detailedColumns = ["opening", "mk", "kast", "clutch", "kills", "assists", "deaths", "adr", "rating"] as const;

function byRatingDesc(a: MatchStatsRow, b: MatchStatsRow): number {
  if (a.ratingPro === null && b.ratingPro === null) return 0;
  if (a.ratingPro === null) return 1;
  if (b.ratingPro === null) return -1;
  return b.ratingPro - a.ratingPro;
}

export function MatchSummaryStats({ players, entryAId, entryBId, teamAName, teamBName, view, showAdvancedCoverage }: MatchSummaryStatsProps) {
  const keys = view === "detailed" ? detailedColumns : compactColumns;
  return <Panel className="min-w-0" contentClassName="space-y-4 p-3">
    {[[entryAId, teamAName], [entryBId, teamBName]].map(([entryId, teamName]) => {
      const teamPlayers = players.filter(player => player.teamId === entryId).sort(byRatingDesc);
      const teamColor = entryId === entryAId ? "var(--color-accent)" : "var(--color-accent-b)";
      const teamBackground = `color-mix(in srgb, ${teamColor} 4%, var(--color-panel))`;
      return <section key={entryId} className="min-w-0 overflow-hidden rounded-sm" style={{ backgroundColor: teamBackground }}>
        <h3 className="border-l-3 px-3 py-2 text-[11px] font-bold tracking-widest uppercase" style={{ borderColor: teamColor }}>
          <TeamProfileLink entryId={entryId}>{teamName}</TeamProfileLink>
        </h3>
        <div className="overflow-x-auto">
          <table className={`w-full table-fixed ${view === "detailed" ? "min-w-[1120px]" : "min-w-[760px]"}`}>
            <colgroup><col className="w-36 sm:w-44" />{keys.map(key => <col key={key} />)}</colgroup>
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="sticky left-0 z-10 whitespace-nowrap py-1 pl-3 pr-1 text-left text-[10px] font-medium text-[var(--color-fg-mid)]" style={{ backgroundColor: teamBackground }}>Player</th>
                {keys.map(key => <th key={key} className="whitespace-nowrap py-1 pl-1.5 pr-6 text-right text-[10px] font-medium text-[var(--color-fg-mid)] [&_button]:text-[var(--color-fg-mid)]">
                  <StatsHelpLabel help={<HelpTooltip label={`${columns[key].label} 说明`} content={columns[key].help} />}>{columns[key].label}</StatsHelpLabel>
                </th>)}
              </tr>
            </thead>
            <tbody>
              {teamPlayers.map(player => <tr key={player.userId ?? player.perfectName} className="border-b border-[var(--color-border)] last:border-0">
                <td className="sticky left-0 z-10 min-w-0 py-1.5 pl-3 pr-1 text-sm" style={{ backgroundColor: teamBackground }}>
                  {player.userId ? <PlayerProfileLink userId={player.userId} title={player.perfectName} className="block truncate font-medium">
                    {getMatchPlayerDisplayName(player.perfectName, teamName)}
                  </PlayerProfileLink> : <span className="block truncate" title={player.perfectName}>{getMatchPlayerDisplayName(player.perfectName, teamName)}</span>}
                  {player.basicCoverage && player.basicCoverage.maps < player.basicCoverage.expectedMaps && <span className="mt-0.5 block text-xs text-[var(--color-fg-dim)]">基础 {player.basicCoverage.maps}/{player.basicCoverage.expectedMaps} 图</span>}
                  {showAdvancedCoverage && player.advancedCoverage.maps < player.advancedCoverage.expectedMaps && <span className="mt-0.5 block text-xs text-[var(--color-fg-dim)]">高级 {player.advancedCoverage.maps}/{player.advancedCoverage.expectedMaps} 图</span>}
                </td>
                {keys.map(key => <td key={key} className={cn(
                  "whitespace-nowrap py-1.5 pl-1.5 pr-6 text-right text-xs tabular-nums",
                  key === "deaths" && "text-[var(--color-fg-mid)]",
                  key === "rating" && player.ratingPro !== null && player.ratingPro >= 1.2 && "font-bold text-[var(--color-accent)]",
                )}>{columns[key].value(player)}</td>)}
              </tr>)}
              {!teamPlayers.length && <tr><td colSpan={keys.length + 1} className="px-3 py-5 text-sm text-[var(--color-fg-mid)]">暂无已确认出场选手</td></tr>}
            </tbody>
          </table>
        </div>
      </section>;
    })}
  </Panel>;
}
