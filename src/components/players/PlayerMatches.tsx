import Link from "next/link";
import type { Route } from "next";
import { CS2_MAP_CATALOG } from "@/lib/config/cs2-maps";
import { formatCST } from "@/lib/utils/date";
import { readOptionalPublicStats } from "@/lib/stats/availability";
import { getRecentPublicPlayerMatches, type PublicPlayerMatch } from "@/lib/players/public-matches";
import { playerMatchDetailHref, playerMatchesHref } from "@/lib/players/matches-view-state";

const resultLabels = { win: "胜", loss: "负", unknown: "赛果待补全" };

function Result({ match }: { match: PublicPlayerMatch }) {
  return <span className={`shrink-0 text-xs font-semibold ${match.result === "win" ? "text-[var(--color-accent)]" : "text-[var(--color-fg-mid)]"}`}>
    {match.isForfeit ? "弃权赛果 · " : ""}{resultLabels[match.result]}
  </span>;
}

function dateLabel(date: string | null) {
  return date ? formatCST(date) : "日期待补全";
}

export async function PlayerRecentMatches({ userId, fromStats }: { userId: string; fromStats?: string | null }) {
  const matches = await readOptionalPublicStats("player_recent_matches", () => getRecentPublicPlayerMatches(userId));
  const allHref = playerMatchesHref(userId, { event: "", map: "", page: 1, cursor: "", direction: "older" }, fromStats);
  return <section aria-labelledby="recent-matches-heading" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id="recent-matches-heading" className="text-base font-semibold">近期比赛</h2>
      <Link href={allHref as Route} className="text-sm text-[var(--color-accent)] hover:underline">查看全部比赛 →</Link>
    </div>
    <p className="text-xs text-[var(--color-fg-dim)]">最近 5 场已完成系列赛 · 当场出场阵容</p>
    {matches === null ? <p role="status" className="py-5 text-sm text-[var(--color-fg-mid)]">近期比赛暂时读取失败，请稍后重试。</p>
      : matches.length === 0 ? <p className="py-5 text-sm text-[var(--color-fg-dim)]">尚无公开的已完成比赛出场记录。</p>
      : <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
        {matches.map((match) => <li key={match.id}>
          <Link href={playerMatchDetailHref(match.seasonSlug, match.id, userId, undefined, fromStats) as Route}
            className="grid gap-1.5 py-3 transition-colors hover:bg-[var(--color-panel-low)] sm:grid-cols-[1fr_auto] sm:gap-x-4">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-semibold">{match.teamName}</span><span className="text-[var(--color-fg-dim)]">vs</span><span>{match.opponentName}</span>
            </div>
            <div className="flex items-center gap-3 sm:row-span-2">
              <span className="font-mono text-base tabular-nums">{match.ownScore ?? "—"} : {match.opponentScore ?? "—"}</span><Result match={match} />
            </div>
            <div className="text-xs text-[var(--color-fg-dim)]">{dateLabel(match.date)} · {match.seasonName}</div>
          </Link>
        </li>)}
      </ul>}
  </section>;
}

export function PlayerMatchHistoryTable({ matches, userId, fromStats }: { matches: PublicPlayerMatch[]; userId: string; fromStats?: string | null }) {
  return <div className="max-w-full overflow-x-auto rounded-sm border border-[var(--color-border)]">
    <table className="w-full min-w-[760px] text-left text-sm">
      <thead className="border-b border-[var(--color-border)] bg-[var(--color-panel-low)] text-xs text-[var(--color-fg-mid)]">
        <tr>{["日期", "当时队伍", "对手 / 地图比分", "地图", "K–D", "+/−", "ADR", "Rating"].map((label, index) =>
          <th key={label} scope="col" className={`px-3 py-3 font-medium ${index >= 4 ? "text-right" : ""}`}>{label}</th>)}</tr>
      </thead>
      {matches.map((match) => <tbody key={match.id} className="border-b border-[var(--color-border)] last:border-0">
        <tr className="bg-[var(--color-panel)]"><th colSpan={8} scope="rowgroup" className="px-3 py-3 text-left font-normal">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link href={playerMatchDetailHref(match.seasonSlug, match.id, userId, undefined, fromStats) as Route} className="font-medium hover:text-[var(--color-accent)]">
              {match.seasonName} · {match.teamName} {match.ownScore ?? "—"} : {match.opponentScore ?? "—"} {match.opponentName} <span className="text-xs text-[var(--color-fg-dim)]">（系列赛） →</span>
            </Link>
            <Result match={match} />
          </div>
          {match.confirmedMaps > 0 && match.confirmedMaps < match.completedMaps && <p className="mt-1 text-xs text-[var(--color-fg-dim)]">逐图个人数据不完整：已确认 {match.confirmedMaps} / {match.completedMaps} 张已完成地图。</p>}
        </th></tr>
        {match.maps.length === 0 ? <tr><td colSpan={8} className="px-3 py-4 text-[var(--color-fg-dim)]">{dateLabel(match.date)} · 逐图个人数据暂缺</td></tr>
          : match.maps.map((map) => {
            const difference = map.kills === null || map.deaths === null ? null : map.kills - map.deaths;
            return <tr key={map.id} className="border-t border-[var(--color-border)]">
              <td className="whitespace-nowrap px-3 py-3 text-xs text-[var(--color-fg-dim)]">{dateLabel(match.date)}</td>
              <td className="max-w-40 px-3 py-3"><span className="block truncate" title={match.teamName}>{match.teamName}</span></td>
              <td className="px-3 py-3"><span className="block max-w-44 truncate" title={match.opponentName}>{match.opponentName}</span><span className="font-mono text-xs tabular-nums">{map.ownScore} : {map.opponentScore}</span></td>
              <td className="px-3 py-3"><Link href={playerMatchDetailHref(match.seasonSlug, match.id, userId, map.id, fromStats) as Route} className="whitespace-nowrap text-[var(--color-accent)] hover:underline">{CS2_MAP_CATALOG.find((item) => item.key === map.name)?.label ?? map.name} →</Link></td>
              <td className="whitespace-nowrap px-3 py-3 text-right font-mono tabular-nums">{map.kills ?? "—"}–{map.deaths ?? "—"}</td>
              <td className="px-3 py-3 text-right font-mono tabular-nums">{difference === null ? "—" : difference > 0 ? `+${difference}` : difference}</td>
              <td className="px-3 py-3 text-right font-mono tabular-nums">{map.adr?.toFixed(1) ?? "—"}</td>
              <td className="px-3 py-3 text-right font-mono font-semibold tabular-nums">{map.rating?.toFixed(2) ?? "—"}</td>
            </tr>;
          })}
      </tbody>)}
    </table>
  </div>;
}
