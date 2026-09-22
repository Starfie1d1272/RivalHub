import { StatsFilters, StatsPagination } from "./StatsFilters";
import Link from "next/link";
import type { ReactNode } from "react";
import type { RateCount, TournamentRateSample } from "@cs2dak/tournament";
import { Panel } from "@/components/rivalhub";
import { StatsLeaderboard } from "@/components/matches/StatsLeaderboard";
import type { TournamentStats } from "@/lib/stats/tournament-query";
import { STATS_TABS, statsHref, type StatsQuery } from "@/lib/stats/query-state";
import { CS2_MAP_CATALOG } from "@/lib/config/cs2-maps";
const getMapDisplayName = (key: string) => CS2_MAP_CATALOG.find((map) => map.key === key)?.label ?? "其他地图";

function Rate({ value, percent = true }: { value: RateCount | TournamentRateSample; percent?: boolean }) {
  const numerator = "wins" in value ? value.wins : value.successes;
  const denominator = "opportunities" in value ? value.opportunities : value.attempts;
  return <span className="tabular-nums" title={`${numerator} / ${denominator}`}>{value.rate === null ? "—" : percent ? `${(value.rate * 100).toFixed(1)}%` : value.rate.toFixed(2)}</span>;
}
function Metrics({ title, rows }: { title: string; rows: [string, ReactNode][] }) {
  return <Panel><h3 className="mb-3 font-semibold">{title}</h3><dl className="grid grid-cols-2 gap-x-4 gap-y-3">{rows.map(([label, value]) => <div key={label}><dt className="text-sm text-[var(--color-fg-mid)]">{label}</dt><dd className="text-lg font-semibold tabular-nums">{value}</dd></div>)}</dl></Panel>;
}
function Table({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{headers.map((header) => <th key={header} className="p-3 text-left whitespace-nowrap">{header}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i} className="border-t border-[var(--color-border)]">{row.map((cell, j) => <td key={j} className="p-3 tabular-nums">{cell}</td>)}</tr>)}</tbody></table></div>;
}
const economyLabels = { pistol: "手枪", eco: "经济局", semi: "半起", force: "强起", full: "全起" };

export function TournamentStatsView({ data, query, seasonSlug, stages }: { data: TournamentStats; query: StatsQuery; seasonSlug: string; stages: { key: string; name: string }[] }) {
  const { analytics: a, performance: p } = data;
  const href = (updates: Parameters<typeof statsHref>[2]) => statsHref(seasonSlug, query, updates);
  const teamRows = a.teams.filter((row) => !query.team || row.team.entityKey === query.team);
  const playerRows = p.players.filter((row) => (!query.team || row.teamEntityKeys.includes(query.team)) && row.player.displayName.toLocaleLowerCase().includes(query.q.toLocaleLowerCase()));
  const sortKeys = { maps: "maps", rating: "avgRating", adr: "avgAdr", kd: "kdRatio", kpr: "kpr", hs: "avgHs", we: "avgWe", rws: "avgRws", fk: "fkpr", mk: "mkpr", clutch: "cpr", fd: "fdpr", trade: "tradeKpr", kast: "kast" } as const;
  const sortKey = sortKeys[query.sort as keyof typeof sortKeys] ?? "avgRating";
  const leaderboard = data.leaderboard.filter((row) => row.perfectName.toLocaleLowerCase().includes(query.q.toLocaleLowerCase())).sort((x, y) => (y[sortKey] ?? -Infinity) - (x[sortKey] ?? -Infinity) || x.perfectName.localeCompare(y.perfectName) || (x.userId ?? "").localeCompare(y.userId ?? ""));
  const totalPages = Math.max(1, Math.ceil(leaderboard.length / 25));
  const page = Math.min(query.page, totalPages);
  return <div className="min-w-0 space-y-6">
    <nav aria-label="统计维度" className="flex flex-wrap gap-2">{Object.entries(STATS_TABS).map(([tab, label]) => <Link key={tab} href={href({ tab, q: "" })} aria-current={query.tab === tab ? "page" : undefined} className={`rounded-md border px-4 py-2 ${query.tab === tab ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-[var(--color-border)]"}`}>{label}</Link>)}</nav>
    <StatsFilters query={query} stages={stages} maps={data.options.maps} teams={data.options.teams} />
    <p className="text-sm text-[var(--color-fg-mid)]">详细统计已覆盖 {data.coverage.confirmedMaps} / {data.coverage.completedMaps} 张已完成地图。{data.coverage.confirmedMaps === 0 ? "当前范围暂无已确认的详细数据。" : "比率的机会数可在指标提示中查看。"}</p>
    {query.tab === "overview" && <>
      <div className="grid gap-4 md:grid-cols-3"><Metrics title="赛事样本" rows={[["比赛", a.totals.matchCount], ["地图", a.totals.mapCount], ["回合", a.totals.roundCount]]} /><Metrics title="攻守与开局" rows={[["T 胜率", <Rate key="t" value={a.totals.t} />], ["CT 胜率", <Rate key="ct" value={a.totals.ct} />], ["手枪局 T 胜率", <Rate key="p" value={a.totals.pistolT} />], ["首杀后回合胜率", <Rate key="o" value={p.totals.opening.conversionRate} />]]} /><Metrics title="经济转化" rows={[["R2 转化", <Rate key="r" value={a.totals.round2Conversion} />], ["R2 逆转", <Rate key="b" value={a.totals.round2Break} />], ["经济／半起爆冷", <Rate key="e" value={a.totals.ecoSemiUpset} />]]} /></div>
      <Metrics title="人数优势转化" rows={Object.entries(a.totals.manAdvantage).map(([key, value]) => [key, <Rate key={key} value={value} />])} />
      <Panel><h2 className="font-semibold">地图使用</h2><Table headers={["地图", "场次", "回合", "T 胜率"]} rows={a.maps.map((map) => [<Link key={map.mapName} href={href({ tab: "maps", map: map.mapName })}>{getMapDisplayName(map.mapName)}</Link>, map.mapCount, map.roundCount, <Rate key="t" value={map.t} />])} /></Panel>
      <Panel><h2 className="font-semibold">经济对局</h2><Table headers={["经济组合", "回合", "较低经济方胜率"]} rows={a.economyMatrix.map((row) => [`${economyLabels[row.lowEconomy]} / ${economyLabels[row.highEconomy]}`, row.rounds, <Rate key="rate" value={{ wins: row.lowEconomyWins, opportunities: row.rounds, rate: row.lowWinRate }} />])} /></Panel>
      <div className="grid gap-4 md:grid-cols-2"><Metrics title="队伍表现" rows={teamRows.slice().sort((x, y) => y.roundWins - x.roundWins).slice(0, 3).map((row) => [row.team.displayName, `${row.roundWins} 个获胜回合`])} /><Metrics title="选手表现" rows={playerRows.slice().sort((x, y) => y.slices.overall.combat.kills - x.slices.overall.combat.kills).slice(0, 3).map((row) => [row.player.displayName, `${row.slices.overall.combat.kills} 次击杀`])} /></div>
    </>}
    {query.tab === "players" && <>
      <StatsLeaderboard rows={leaderboard.slice((page - 1) * 25, page * 25)} sort={query.sort} seasonSlug={seasonSlug} view={query.view} query={query} />
      <p className="text-sm">共 {leaderboard.length} 条</p><StatsPagination page={page} totalPages={totalPages} />
      <div className="flex gap-3 text-sm" aria-label="详细数据阵营">{(["overall", "t", "ct"] as const).map((side) => <Link key={side} href={href({ side })} aria-current={query.side === side ? "true" : undefined}>{side === "overall" ? "双方" : side.toUpperCase()}</Link>)}</div>
      <div className="grid gap-4 md:grid-cols-2">{playerRows.filter((row) => leaderboard.slice((page - 1) * 25, page * 25).some((entry) => entry.userId === row.player.entityKey)).map((row) => { const s = row.slices[query.side]; return <details key={row.player.entityKey} className="rounded border border-[var(--color-border)] p-4"><summary className="cursor-pointer font-semibold">{row.player.displayName} · {s.combat.kills} / {s.combat.deaths} / {s.combat.assists}</summary><p className="my-2 text-sm">{row.mapCount} 张地图 · {s.sample.rounds} 个选手回合</p><Metrics title="详细表现" rows={[["Opening", <Rate key="o" value={s.opening.successRate} />], ["开局参与率", <Rate key="a" value={s.opening.attemptRate} />], ["KAST", <Rate key="k" value={s.kast} />], ["存活率", <Rate key="s" value={s.survival} />], ["补枪", s.trade.tradeKills], ["残局成功率", <Rate key="c" value={s.clutch.winRate} />], ["道具伤害／回合", <Rate key="u" value={s.utility.utilityDamagePerRound} percent={false} />], ["闪光致盲／颗", <Rate key="f" value={s.utility.enemyBlindSecondsPerFlash} percent={false} />]]} /><Table headers={["武器（双方）", "击杀", "爆头率"]} rows={row.weapons.map((weapon) => [weapon.weapon, weapon.kills, <Rate key="h" value={weapon.headshotRate} />])} /></details>; })}</div>
    </>}
    {query.tab === "teams" && <div className="space-y-6">{teamRows.map((row) => { const performance = p.teams.find((item) => item.team.entityKey === row.team.entityKey); return <section key={row.team.entityKey} className="space-y-3"><h2 className="text-xl font-semibold"><Link href={href({ team: row.team.entityKey })}>{row.team.displayName}</Link></h2><div className="grid gap-4 md:grid-cols-2"><Metrics title="基础表现" rows={[["地图／回合", `${row.mapCount} / ${row.rounds}`], ["回合胜率", <Rate key="r" value={{ wins: row.roundWins, opportunities: row.rounds, rate: row.roundWinRate }} />], ["T", <Rate key="t" value={row.t} />], ["CT", <Rate key="ct" value={row.ct} />]]} /><Metrics title="人数优势" rows={Object.entries(row.manAdvantage).map(([key, value]) => [key, <Rate key={key} value={value} />])} /><Metrics title="经济" rows={[["手枪", <Rate key="p" value={row.pistol} />], ["R2 转化", <Rate key="r" value={row.round2.conversion} />], ["R2 逆转", <Rate key="b" value={row.round2.break} />], ["经济／半起爆冷", <Rate key="e" value={row.ecoSemiUpset} />]]} />{performance && <Metrics title="团队协作" rows={[["Opening", <Rate key="o" value={performance.slices.overall.opening.successRate} />], ["补枪", performance.slices.overall.trade.tradeKills], ["道具伤害／回合", <Rate key="u" value={performance.slices.overall.utility.utilityDamagePerRound} percent={false} />], ["闪光助攻", performance.slices.overall.utility.flashAssists]]} />}</div></section>; })}</div>}
    {query.tab === "maps" && <>
      <Panel><h2 className="font-semibold">地图选择</h2><Table headers={["地图", "Pick", "Ban", "Decider"]} rows={data.selection.map((row) => [<Link key={row.mapName} href={href({ map: row.mapName })}>{getMapDisplayName(row.mapName)}</Link>, row.picks, row.bans, row.deciders])} />{data.selection.map((row) => <details key={row.mapName}><summary className="cursor-pointer py-2">{getMapDisplayName(row.mapName)} · 队伍选择倾向</summary><Table headers={["队伍", "Pick", "Ban"]} rows={row.teams.map((team) => [team.name, team.picks, team.bans])} /></details>)}</Panel>
      <Panel><h2 className="font-semibold">地图表现</h2><Table headers={["地图", "地图数", "回合", "T", "CT", "手枪 T"]} rows={a.maps.map((row) => [<Link key={row.mapName} href={href({ map: row.mapName })}>{getMapDisplayName(row.mapName)}</Link>, row.mapCount, row.roundCount, <Rate key="t" value={row.t} />, <Rate key="ct" value={row.ct} />, <Rate key="p" value={row.pistolT} />])} /></Panel>
      {query.map && <div className="flex gap-4"><Link href={href({ tab: "teams" })}>查看本图队伍表现与经济转化</Link><Link href={href({ tab: "players" })}>查看本图选手表现</Link></div>}
      <Panel><h2 className="font-semibold">武器表现</h2><Table headers={["武器", "击杀", "爆头率", "最多击杀选手"]} rows={p.weapons.map((row) => [row.weapon, row.kills, <Rate key="h" value={row.headshotRate} />, row.topPlayer?.displayName ?? "—"])} /></Panel>
    </>}
  </div>;
}
