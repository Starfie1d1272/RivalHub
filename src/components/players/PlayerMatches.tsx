import Link from "next/link";
import { PlayerMatchHistoryDensity } from "./PlayerMatchHistoryDensity";
import type { ReactNode } from "react";
import type { Route } from "next";
import { mapLabel } from "@/lib/maps";
import { formatStat } from "@/lib/stats/format";
import { statValueColor } from "@/lib/stats/presentation";
import { formatCST, getCSTDateKey } from "@/lib/utils/date";
import { readOptionalPublicStats } from "@/lib/stats/availability";
import { getRecentPublicPlayerMatches, type PublicPlayerMatch } from "@/lib/players/public-matches";
import { playerMatchDetailHref, playerMatchesHref } from "@/lib/players/matches-view-state";

const resultLabels = { win: "胜", loss: "负", unknown: "赛果待补全" };
const resultColors = {
  win: "var(--color-ok)",
  loss: "var(--color-danger)",
  unknown: "var(--color-data-missing)",
} satisfies Record<PublicPlayerMatch["result"], string>;

function Result({ match }: { match: PublicPlayerMatch }) {
  return (
    <span
      className={`shrink-0 text-xs font-semibold ${match.result === "win" ? "text-[var(--color-accent)]" : "text-[var(--color-fg-mid)]"}`}
    >
      {match.isForfeit ? "弃权赛果 · " : ""}
      {resultLabels[match.result]}
    </span>
  );
}

function dateLabel(date: string | null) {
  return date ? formatCST(date) : "日期待补全";
}

export async function PlayerRecentMatches({
  userId,
  fromStats,
}: {
  userId: string;
  fromStats?: string | null;
}) {
  const matches = await readOptionalPublicStats("player_recent_matches", () =>
    getRecentPublicPlayerMatches(userId),
  );
  const allHref = playerMatchesHref(
    userId,
    { event: "", map: "", page: 1, cursor: "", direction: "older" },
    fromStats,
  );
  return (
    <section aria-labelledby="recent-matches-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="recent-matches-heading" className="text-base font-semibold">
          近期比赛
        </h2>
        <Link
          href={allHref as Route}
          className="text-sm text-[var(--color-accent)] hover:underline"
        >
          查看全部比赛 →
        </Link>
      </div>
      <p className="text-xs text-[var(--color-fg-dim)]">最近 5 场已完成系列赛 · 当场出场阵容</p>
      {matches === null ? (
        <p role="status" className="py-5 text-sm text-[var(--color-fg-mid)]">
          近期比赛暂时读取失败，请稍后重试。
        </p>
      ) : matches.length === 0 ? (
        <p className="py-5 text-sm text-[var(--color-fg-dim)]">尚无公开的已完成比赛出场记录。</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
          {matches.map((match) => (
            <li key={match.id}>
              <Link
                href={
                  playerMatchDetailHref(
                    match.seasonSlug,
                    match.id,
                    userId,
                    undefined,
                    fromStats,
                  ) as Route
                }
                className="grid gap-1.5 py-3 transition-colors hover:bg-[var(--color-panel-low)] sm:grid-cols-[1fr_auto] sm:gap-x-4"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="font-semibold">{match.teamName}</span>
                  <span className="text-[var(--color-fg-dim)]">vs</span>
                  <span>{match.opponentName}</span>
                </div>
                <div className="flex items-center gap-3 sm:row-span-2">
                  <span className="font-mono text-base tabular-nums">
                    {match.ownScore ?? "—"} : {match.opponentScore ?? "—"}
                  </span>
                  <Result match={match} />
                </div>
                <div className="text-xs text-[var(--color-fg-dim)]">
                  {dateLabel(match.date)} · {match.seasonName}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function PlayerMatchHistoryTable({
  matches,
  userId,
  fromStats,
  summary,
  pagination,
}: {
  matches: PublicPlayerMatch[];
  userId: string;
  fromStats?: string | null;
  summary?: ReactNode;
  pagination?: ReactNode;
}) {
  const linkClass =
    "inline-flex min-h-6 items-center hover:text-[var(--color-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]";
  return (
    <PlayerMatchHistoryDensity summary={summary} pagination={pagination}>
      <table className="w-full min-w-[640px] text-left text-sm sm:min-w-[940px]">
        <caption className="sr-only">
          个人比赛记录。同一系列赛的地图连续排列，队伍旁为地图回合比分；右侧绿条表示系列赛获胜，红条表示失利，灰条表示赛果待补全。日期链接提供整场比分和赛果。
        </caption>
        <thead className="border-b border-[var(--color-border)] bg-[var(--color-panel-low)] text-xs text-[var(--color-fg-mid)]">
          <tr>
            <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">
              日期
            </th>
            <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">
              赛事
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              当时队伍
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              对手
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              地图
            </th>
            {["K–D", "+/−", "ADR", "Rating"].map((label) => (
              <th key={label} scope="col" className="px-3 py-2 text-right font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        {matches.map((match, index) => {
          const seriesHref = playerMatchDetailHref(
            match.seasonSlug,
            match.id,
            userId,
            undefined,
            fromStats,
          ) as Route;
          const seriesLabel = `${dateLabel(match.date)} · ${match.seasonName} · ${match.teamName} ${match.ownScore ?? "—"}:${match.opponentScore ?? "—"} ${match.opponentName} · ${match.isForfeit ? "弃权赛果 · " : ""}${resultLabels[match.result]}`;
          const incomplete = match.confirmedMaps > 0 && match.confirmedMaps < match.completedMaps;
          return (
            <tbody
              key={match.id}
              aria-label={seriesLabel}
              title={`系列赛：${seriesLabel}`}
              style={{ borderRightColor: resultColors[match.result] }}
              className={`border-b border-r-4 border-[var(--color-border)] last:border-b-0 ${index % 2 ? "bg-[var(--color-panel-low)]" : "bg-[var(--color-panel)]"}`}
            >
              {(match.maps.length ? match.maps : [null]).map((map, mapIndex) => {
                const difference =
                  map?.kills == null || map.deaths === null ? null : map.kills - map.deaths;
                return (
                  <tr key={map?.id ?? match.id} className="hover:bg-[var(--color-panel-hi)]">
                    <td className="hidden whitespace-nowrap px-3 text-xs sm:table-cell">
                      <Link
                        prefetch={false}
                        href={seriesHref}
                        title={seriesLabel}
                        aria-label={`查看系列赛：${seriesLabel}`}
                        className={linkClass}
                      >
                        {match.date ? (
                          <time dateTime={match.date}>{getCSTDateKey(match.date)}</time>
                        ) : (
                          "日期待补全"
                        )}
                      </Link>
                    </td>
                    <td className="hidden px-3 text-xs text-[var(--color-fg-dim)] sm:table-cell">
                      <span className="block max-w-32 truncate" title={match.seasonName}>
                        {match.seasonName}
                      </span>
                    </td>
                    <td className="px-3">
                      <span className="flex items-center gap-1.5 whitespace-nowrap">
                        <span className="max-w-32 truncate font-medium" title={match.teamName}>
                          {match.teamName}
                        </span>
                        {map && (
                          <span className="font-mono tabular-nums text-[var(--color-fg-mid)]">
                            ({map.ownScore})
                          </span>
                        )}
                      </span>
                      <Link
                        prefetch={false}
                        href={seriesHref}
                        aria-label={`查看系列赛：${seriesLabel}`}
                        className="mt-0.5 block max-w-40 text-xs leading-4 text-[var(--color-fg-dim)] hover:text-[var(--color-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] sm:hidden"
                      >
                        <span className="block">
                          {match.date ? getCSTDateKey(match.date) : "日期待补全"}
                        </span>
                        <span className="block whitespace-normal">{match.seasonName}</span>
                      </Link>
                    </td>
                    <td className="px-3">
                      <span className="flex items-center gap-1.5 whitespace-nowrap">
                        <span className="max-w-32 truncate" title={match.opponentName}>
                          {match.opponentName}
                        </span>
                        {map && (
                          <span className="font-mono tabular-nums text-[var(--color-fg-mid)]">
                            ({map.opponentScore})
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-3">
                      {map ? (
                        <Link
                          prefetch={false}
                          href={
                            playerMatchDetailHref(
                              match.seasonSlug,
                              match.id,
                              userId,
                              map.id,
                              fromStats,
                            ) as Route
                          }
                          aria-label={`查看 ${mapLabel(map.name)}：${match.teamName} ${map.ownScore}:${map.opponentScore} ${match.opponentName}`}
                          className={`${linkClass} whitespace-nowrap text-[var(--color-accent)]`}
                        >
                          {mapLabel(map.name)}
                        </Link>
                      ) : (
                        <Link
                          prefetch={false}
                          href={seriesHref}
                          aria-label={`查看系列赛：${seriesLabel}`}
                          className={`${linkClass} gap-1.5 whitespace-nowrap`}
                        >
                          <span className="text-xs text-[var(--color-fg-dim)]">系列赛</span>
                          <span className="font-mono tabular-nums">
                            {match.ownScore ?? "—"}:{match.opponentScore ?? "—"}
                          </span>
                        </Link>
                      )}
                      {mapIndex === 0 && match.isForfeit && (
                        <span className="ml-2 whitespace-nowrap text-xs text-[var(--color-fg-dim)]">
                          弃权赛果
                        </span>
                      )}
                      {mapIndex === 0 && incomplete && (
                        <span
                          className="ml-2 whitespace-nowrap text-xs text-[var(--color-fg-dim)]"
                          title={`逐图个人数据不完整：已确认 ${match.confirmedMaps} / ${match.completedMaps} 张已完成地图。`}
                        >
                          {match.confirmedMaps}/{match.completedMaps} 图
                        </span>
                      )}
                    </td>
                    {map ? (
                      <>
                        <td className="whitespace-nowrap px-3 text-right font-mono tabular-nums">
                          {formatStat("kills", map.kills)}–{formatStat("deaths", map.deaths)}
                        </td>
                        <td
                          className="px-3 text-right font-mono tabular-nums"
                          style={{ color: statValueColor("difference", difference) }}
                        >
                          {difference === null
                            ? "—"
                            : difference > 0
                              ? `+${difference}`
                              : difference}
                        </td>
                        <td className="px-3 text-right font-mono tabular-nums">
                          {formatStat("adr", map.adr)}
                        </td>
                        <td
                          className="px-3 text-right font-mono font-semibold tabular-nums"
                          style={{ color: statValueColor("rating", map.rating) }}
                        >
                          {formatStat("ratingPro", map.rating)}
                        </td>
                      </>
                    ) : (
                      <>
                        {["kills", "difference", "adr", "rating"].map((metric) => (
                          <td
                            key={metric}
                            className="px-3 text-right font-mono text-[var(--color-fg-dim)]"
                          >
                            —
                          </td>
                        ))}
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          );
        })}
      </table>
    </PlayerMatchHistoryDensity>
  );
}
