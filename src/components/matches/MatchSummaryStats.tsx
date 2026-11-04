import Link from "next/link";
import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { HelpTooltip } from "@/components/rivalhub/HelpTooltip";
import { getMatchPlayerDisplayName } from "@/lib/identity/display-name";
import type { MatchStatsRow } from "@/lib/matches/scoreboard-view";
import type { MatchStatsView } from "@/lib/matches/stats-view";

interface MatchSummaryStatsProps {
  players: readonly MatchStatsRow[];
  entryAId: string;
  entryBId: string;
  teamAName: string;
  teamBName: string;
  view: MatchStatsView;
  playerHrefs: Record<string, string>;
  selectedPlayerId: string | null;
}

const number = (value: number | null) => value === null ? "—" : String(value);
const pair = (a: number | null, b: number | null) => `${number(a)}–${number(b)}`;
const detail = (a: number | null, b: number | null) => `${number(a)} (${number(b)})`;
const columns = {
  kd: { label: "K–D", help: "击杀数与死亡数。", value: (p: MatchStatsRow) => pair(p.kills, p.deaths) },
  opening: { label: "Op. K–D", help: "每回合开局首杀与首死，不是总击杀与死亡。", value: (p: MatchStatsRow) => pair(p.firstKills, p.firstDeaths) },
  mk: { label: "MKs", help: "至少两杀的回合数，即 2K、3K、4K 与 5K 回合之和。", value: (p: MatchStatsRow) => number(p.multiKills) },
  kast: { label: "KAST", help: "取得击杀、助攻、存活或被队友补枪的回合占比，按当前数据覆盖的实际回合计算。", value: (p: MatchStatsRow) => p.kast === null ? "—" : `${(p.kast * 100).toFixed(1)}%` },
  clutch: { label: "1vsX", help: "1 对多残局获胜次数，可在个人 Clutch 中查看细分。", value: (p: MatchStatsRow) => number(p.clutches) },
  kills: { label: "K (hs)", help: "总击杀（精确爆头击杀），不从 HS% 反算。", value: (p: MatchStatsRow) => detail(p.kills, p.headshots) },
  assists: { label: "A (f)", help: "总助攻（闪光助攻）。", value: (p: MatchStatsRow) => detail(p.assists, p.flashAssists) },
  deaths: { label: "D (t)", help: "总死亡（被队友补掉的死亡）。t 指 traded，不是 T 阵营。", value: (p: MatchStatsRow) => detail(p.deaths, p.tradedDeaths) },
  adr: { label: "ADR", help: "每回合平均伤害；跨图使用累计伤害与回合数。", value: (p: MatchStatsRow) => p.adr === null ? "—" : p.adr.toFixed(1) },
  rating: { label: "Rating", help: "已核对记分板的 Rating Pro。CT/T 没有独立来源时显示 —。", value: (p: MatchStatsRow) => p.ratingPro === null ? "—" : p.ratingPro.toFixed(2) },
};
const compactColumns = ["kd", "adr", "kast", "rating"] as const;
const detailedColumns = ["opening", "mk", "kast", "clutch", "kills", "assists", "deaths", "adr", "rating"] as const;

export function MatchSummaryStats({ players, entryAId, entryBId, teamAName, teamBName, view, playerHrefs, selectedPlayerId }: MatchSummaryStatsProps) {
  const keys = view === "detailed" ? detailedColumns : compactColumns;
  return <div className="min-w-0 space-y-4">
    {[[entryAId, teamAName], [entryBId, teamBName]].map(([entryId, teamName]) => {
      const teamPlayers = players.filter(player => player.teamId === entryId);
      return <section key={entryId} className="min-w-0 overflow-hidden rounded-sm border border-[var(--color-border)]">
        <h3 className="border-l-3 px-3 py-2.5 text-sm font-semibold" style={{ borderColor: entryId === entryAId ? "var(--color-accent)" : "var(--color-accent-b)" }}>
          <TeamProfileLink entryId={entryId}>{teamName}</TeamProfileLink>
        </h3>
        <div className="overflow-x-auto">
          <table className={`w-full text-sm ${view === "detailed" ? "min-w-[960px]" : "min-w-[460px]"}`}>
            <thead className="border-y border-[var(--color-border)] bg-[var(--color-panel-hi)]">
              <tr>
                <th className="sticky left-0 z-10 w-44 min-w-36 bg-[var(--color-panel-hi)] px-3 py-2 text-left font-medium">选手</th>
                {keys.map(key => <th key={key} className="whitespace-nowrap px-3 py-2 text-right text-xs font-medium text-[var(--color-fg-mid)]">
                  <span className="inline-flex items-center gap-1">{columns[key].label}<HelpTooltip label={`${columns[key].label} 说明`} content={columns[key].help} /></span>
                </th>)}
              </tr>
            </thead>
            <tbody>
              {teamPlayers.map(player => <tr key={player.userId ?? player.perfectName} className="border-b border-[var(--color-border)] last:border-0">
                <td className="sticky left-0 z-10 max-w-44 bg-[var(--color-panel)] px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    {player.userId && playerHrefs[player.userId] ? <Link prefetch={false} href={playerHrefs[player.userId] as never} aria-current={selectedPlayerId === player.userId ? "true" : undefined} title={`${player.perfectName} · 查看当前范围的个人统计`} className="min-w-0 truncate font-medium hover:text-[var(--color-accent)] aria-[current=true]:text-[var(--color-accent)]">
                      {getMatchPlayerDisplayName(player.perfectName, teamName)}
                    </Link> : <span className="min-w-0 truncate">{getMatchPlayerDisplayName(player.perfectName, teamName)}</span>}
                    {player.userId && <PlayerProfileLink userId={player.userId} title="选手主页" aria-label={`${player.perfectName} 的选手主页`} className="shrink-0 text-xs text-[var(--color-fg-dim)]">↗</PlayerProfileLink>}
                  </div>
                </td>
                {keys.map(key => <td key={key} className={`whitespace-nowrap px-3 py-2.5 text-right tabular-nums ${key === "rating" ? "font-semibold" : ""}`}>{columns[key].value(player)}</td>)}
              </tr>)}
              {!teamPlayers.length && <tr><td colSpan={keys.length + 1} className="px-3 py-5 text-sm text-[var(--color-fg-mid)]">暂无已确认出场选手</td></tr>}
            </tbody>
          </table>
        </div>
      </section>;
    })}
  </div>;
}
