import React from "react";
import type { Route } from "next";
import type { ReactNode } from "react";
import type { RateCount, TournamentRateSample } from "@cs2dak/tournament";
import { EmptyState, Panel } from "@/components/rivalhub";
import { StatsLeaderboard } from "@/components/matches/StatsLeaderboard";
import { StatsFilters, StatsPagination } from "./StatsFilters";
import { StatsLink } from "./StatsLink";
import { StatsTable, type StatsTableColumn } from "./StatsTable";
import type { TournamentMapDetail, TournamentStats } from "@/lib/stats/tournament-query";
import { defaultStatsSort, STATS_TABS, statsHref, type StatsQuery, type StatsTab } from "@/lib/stats/query-state";
import { sortStatsRows, type StatsSortDirection } from "@/lib/stats/sorting";
import { CS2_MAP_CATALOG } from "@/lib/config/cs2-maps";

const economyLabels = { pistol: "手枪", eco: "经济局", semi: "半起", force: "强起", full: "全起" } as const;
type RateValue = RateCount | TournamentRateSample;

function getMapDisplayName(key: string): string {
  return CS2_MAP_CATALOG.find((map) => map.key === key)?.label ?? key;
}

function Rate({ value, percent = true }: { value: RateValue; percent?: boolean }) {
  const numerator = "wins" in value ? value.wins : value.successes;
  const denominator = "opportunities" in value ? value.opportunities : value.attempts;
  return <span className="tabular-nums" title={`${numerator} / ${denominator}`}>{value.rate === null ? "—" : percent ? `${(value.rate * 100).toFixed(1)}%` : value.rate.toFixed(2)}</span>;
}

function MaybeRate({ value, percent = true }: { value: RateValue | null | undefined; percent?: boolean }) {
  return value == null ? <span className="text-[var(--color-fg-dim)]">—</span> : <Rate value={value} percent={percent} />;
}

function MetricPanel({ title, rows }: { title: string; rows: [string, ReactNode][] }) {
  return <Panel><h3 className="mb-3 font-semibold">{title}</h3><dl className="grid grid-cols-2 gap-x-4 gap-y-3">{rows.map(([label, value]) => <div key={label}><dt className="text-sm text-[var(--color-fg-mid)]">{label}</dt><dd className="text-lg font-semibold tabular-nums">{value}</dd></div>)}</dl></Panel>;
}

function KpiStrip({ rows }: { rows: [string, ReactNode][] }) {
  return <Panel contentClassName="grid grid-cols-2 gap-4 sm:grid-cols-5">{rows.map(([label, value]) => <div key={label}><dt className="text-xs uppercase tracking-wide text-[var(--color-fg-mid)]">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd></div>)}</Panel>;
}

function nullableNumber(value: number | null | undefined): ReactNode {
  return value == null ? <span className="text-[var(--color-fg-dim)]">—</span> : <span className="tabular-nums">{value}</span>;
}

type MapRow = {
  mapName: string;
  played: number | null;
  picks: number | null;
  bans: number | null;
  deciders: number | null;
  rounds: number | null;
  t: RateCount | null;
  ct: RateCount | null;
  pistolT: RateCount | null;
  teams: Array<{ entryId: string; name: string; picks: number; bans: number }>;
};

function mapRowsFor(data: TournamentStats): MapRow[] {
  const selectionByMapName = new Map(data.selection.map((row) => [row.mapName, row]));
  const analyticsByMapName = new Map(data.analytics.maps.map((row) => [row.mapName, row]));
  const names = new Set([...data.selection.map((row) => row.mapName), ...data.analytics.maps.map((row) => row.mapName)]);
  return [...names].map((mapName) => {
    const selection = selectionByMapName.get(mapName);
    const analytics = analyticsByMapName.get(mapName);
    return {
      mapName,
      played: analytics?.mapCount ?? null,
      picks: selection?.picks ?? null,
      bans: selection?.bans ?? null,
      deciders: selection?.deciders ?? null,
      rounds: analytics?.roundCount ?? null,
      t: analytics?.t ?? null,
      ct: analytics?.ct ?? null,
      pistolT: analytics?.pistolT ?? null,
      teams: selection?.teams ?? [],
    };
  });
}

function mapSortValue(row: MapRow, sort: string): number | string | null {
  switch (sort) {
    case "map": return row.mapName;
    case "pick": return row.picks;
    case "ban": return row.bans;
    case "decider": return row.deciders;
    case "rounds": return row.rounds;
    case "t": return row.t?.rate ?? null;
    case "ct": return row.ct?.rate ?? null;
    case "pistol": return row.pistolT?.rate ?? null;
    case "played":
    default: return row.played;
  }
}

function sortedMapRows(rows: MapRow[], sort: string, direction: StatsSortDirection): MapRow[] {
  return sortStatsRows(rows, { getValue: (row) => mapSortValue(row, sort), direction }, [
    { getValue: (row) => row.played, direction: "desc" },
    { getValue: (row) => row.picks, direction: "desc" },
    { getValue: (row) => row.mapName, direction: "asc" },
  ]);
}

function sortMapTeamRows(rows: MapRow["teams"], sort: string, direction: StatsSortDirection) {
  const getter = sort === "mapTeamBan" ? (row: MapRow["teams"][number]) => row.bans : sort === "mapTeam" ? (row: MapRow["teams"][number]) => row.name : (row: MapRow["teams"][number]) => row.picks;
  return sortStatsRows(rows, { getValue: getter, direction }, [
    { getValue: (row) => row.picks, direction: "desc" },
    { getValue: (row) => row.bans, direction: "desc" },
    { getValue: (row) => row.name, direction: "asc" },
  ]);
}

function teamSortValue(
  row: TournamentStats["analytics"]["teams"][number],
  performance: TournamentStats["performance"]["teams"][number] | undefined,
  sort: string,
): number | string | null {
  switch (sort) {
    case "team": return row.team.displayName;
    case "maps": return row.mapCount;
    case "rounds": return row.rounds;
    case "t": return row.t.rate;
    case "ct": return row.ct.rate;
    case "pistol": return row.pistol.rate;
    case "opening": return performance?.slices.overall.opening.successRate.rate ?? null;
    case "rw":
    default: return row.roundWinRate;
  }
}

function sortedTeamRows(
  rows: TournamentStats["analytics"]["teams"],
  performanceByEntityKey: ReadonlyMap<string, TournamentStats["performance"]["teams"][number]>,
  sort: string,
  direction: StatsSortDirection,
) {
  return sortStatsRows(rows, {
    getValue: (row) => teamSortValue(row, performanceByEntityKey.get(row.team.entityKey), sort),
    direction,
  }, [
    { getValue: (row) => row.roundWinRate, direction: "desc" },
    { getValue: (row) => row.mapCount, direction: "desc" },
    { getValue: (row) => row.team.displayName, direction: "asc" },
  ]);
}

function mapColumns(href: (updates: Parameters<typeof statsHref>[2]) => Route): StatsTableColumn<MapRow>[] {
  return [
    { key: "map", label: "Map", sortable: true, render: (row) => <StatsLink href={href({ tab: "maps", map: row.mapName })} className="font-medium hover:text-[var(--color-accent)]">{getMapDisplayName(row.mapName)}</StatsLink> },
    { key: "played", label: "Played", sortable: true, numeric: true, render: (row) => nullableNumber(row.played) },
    { key: "pick", label: "Pick", sortable: true, numeric: true, render: (row) => nullableNumber(row.picks) },
    { key: "ban", label: "Ban", sortable: true, numeric: true, render: (row) => nullableNumber(row.bans) },
    { key: "decider", label: "Decider", sortable: true, numeric: true, render: (row) => nullableNumber(row.deciders) },
    { key: "rounds", label: "Rounds", sortable: true, numeric: true, render: (row) => nullableNumber(row.rounds) },
    { key: "t", label: "T%", sortable: true, numeric: true, render: (row) => <MaybeRate value={row.t} /> },
    { key: "ct", label: "CT%", sortable: true, numeric: true, render: (row) => <MaybeRate value={row.ct} /> },
    { key: "pistol", label: "Pistol T%", sortable: true, numeric: true, render: (row) => <MaybeRate value={row.pistolT} /> },
  ];
}

export function TournamentStatsView({ data, selectedMapData, query, seasonSlug, stages }: { data: TournamentStats; selectedMapData?: TournamentMapDetail; query: StatsQuery; seasonSlug: string; stages: { key: string; name: string }[] }) {
  const { analytics: a, performance: p } = data;
  const href = (updates: Parameters<typeof statsHref>[2]) => statsHref(seasonSlug, query, updates);
  const maps = mapRowsFor(data);
  const mapSort = query.tab === "maps" ? query.sort : "played";
  const visibleMaps = sortedMapRows(maps, mapSort, query.direction);
  const selectedMap = query.map ? maps.find((row) => row.mapName === query.map) : undefined;
  const selectedMapTeams = selectedMap ? sortMapTeamRows(selectedMap.teams, query.sort.startsWith("mapTeam") ? query.sort : "mapTeamPick", query.sort.startsWith("mapTeam") ? query.direction : "desc") : [];
  const performanceByEntityKey = new Map(p.teams.map((row) => [row.team.entityKey, row]));
  const teamRows = sortedTeamRows(a.teams, performanceByEntityKey, query.sort, query.direction);
  const playerRows = p.players.filter((row) => (!query.team || row.teamEntityKeys.includes(query.team)) && row.player.displayName.toLocaleLowerCase().includes(query.q.toLocaleLowerCase()));
  const leaderboardValue = (row: TournamentStats["leaderboard"][number]): number | null => {
    switch (query.sort) {
      case "maps": return row.maps;
      case "adr": return row.avgAdr;
      case "kd": return row.kdRatio;
      case "kpr": return row.kpr;
      case "hs": return row.avgHs;
      case "we": return row.avgWe;
      case "rws": return row.avgRws;
      case "fk": return row.fkpr;
      case "mk": return row.mkpr;
      case "clutch": return row.cpr;
      case "fd": return row.fdpr;
      case "trade": return row.tradeKpr;
      case "kast": return row.kast;
      case "rating":
      default: return row.avgRating;
    }
  };
  const leaderboard = sortStatsRows(data.leaderboard.filter((row) => row.perfectName.toLocaleLowerCase().includes(query.q.toLocaleLowerCase())), { getValue: leaderboardValue, direction: query.direction }, [
    { getValue: (row) => row.perfectName, direction: "asc" },
    { getValue: (row) => row.userId, direction: "asc" },
  ]);
  const totalPages = Math.max(1, Math.ceil(leaderboard.length / 25));
  const page = Math.min(query.page, totalPages);
  const pageRows = leaderboard.slice((page - 1) * 25, page * 25);
  const detailPlayerIds = new Set(pageRows.map((row) => row.userId).filter((id): id is string => Boolean(id)));
  const overviewMaps = sortedMapRows(maps, query.tab === "overview" ? query.sort : "played", query.tab === "overview" ? query.direction : "desc");
  const mapTableColumns = mapColumns(href);
  const tabHref = (tab: StatsTab) => href({ tab, q: "", sort: defaultStatsSort(tab), dir: "desc", view: tab === "players" ? query.view : "core", page: 1 });
  const sortHref = (sort: string, direction: StatsSortDirection) => href({ sort, dir: direction, page: 1 });

  return <div className="min-w-0 space-y-6">
    <nav aria-label="统计维度" className="flex flex-wrap gap-2">{Object.entries(STATS_TABS).map(([tab, label]) => <StatsLink key={tab} href={tabHref(tab as StatsTab)} aria-current={query.tab === tab ? "page" : undefined} className={`rounded-md border px-4 py-2 ${query.tab === tab ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-[var(--color-border)]"}`}>{label}</StatsLink>)}</nav>
    <StatsFilters query={query} stages={stages} maps={data.options.maps} teams={data.options.teams} />
    <p className="text-sm text-[var(--color-fg-mid)]">详细统计已覆盖 {data.coverage.confirmedMaps} / {data.coverage.completedMaps} 张已完成地图。{data.coverage.confirmedMaps === 0 ? "当前范围暂无已确认的详细数据。" : "比率的机会数可在指标提示中查看。"}</p>

    {query.tab === "overview" && (data.coverage.confirmedMaps === 0 ? <Panel><EmptyState title="当前范围暂无已确认 Demo 详细统计" sub="已确认的 Demo 数据进入当前赛事范围后，概览会显示回合、经济和攻守指标。" /></Panel> : <div className="space-y-6">
      <KpiStrip rows={[["Matches", a.totals.matchCount], ["Maps", a.totals.mapCount], ["Rounds", a.totals.roundCount], ["T%", <Rate key="t" value={a.totals.t} />], ["CT%", <Rate key="ct" value={a.totals.ct} />]]} />
      <div className="grid gap-4 md:grid-cols-2"><MetricPanel title="手枪与 R2" rows={[["手枪局 T 胜率", <Rate key="p" value={a.totals.pistolT} />], ["手枪局 CT 胜率", <Rate key="pc" value={a.totals.pistolCt} />], ["R2 转化", <Rate key="r" value={a.totals.round2Conversion} />], ["R2 逆转", <Rate key="b" value={a.totals.round2Break} />]]} /><MetricPanel title="人数优势转化" rows={Object.entries(a.totals.manAdvantage).map(([key, value]) => [key, <Rate key={key} value={value} />])} /></div>
      <section><h2 className="mb-3 font-semibold">地图使用</h2><StatsTable rows={overviewMaps} columns={mapTableColumns} rowKey={(row) => row.mapName} sort={query.sort} direction={query.direction} sortHref={sortHref} /></section>
      <section><h2 className="mb-3 font-semibold">经济对局</h2><StatsTable rows={a.economyMatrix} rowKey={(row) => `${row.lowEconomy}:${row.highEconomy}`} columns={[{ key: "economy", label: "经济组合", render: (row) => `${economyLabels[row.lowEconomy]} / ${economyLabels[row.highEconomy]}` }, { key: "rounds", label: "Rounds", numeric: true, render: (row) => row.rounds }, { key: "rate", label: "较低经济方胜率", numeric: true, render: (row) => <Rate value={{ wins: row.lowEconomyWins, opportunities: row.rounds, rate: row.lowWinRate }} /> }]} /></section>
      <div className="grid gap-4 md:grid-cols-2"><MetricPanel title="队伍表现" rows={a.teams.slice().sort((left, right) => right.roundWins - left.roundWins).slice(0, 3).map((row) => [row.team.displayName, `${row.roundWins} 个获胜回合`])} /><MetricPanel title="选手表现" rows={playerRows.slice().sort((left, right) => right.slices.overall.combat.kills - left.slices.overall.combat.kills).slice(0, 3).map((row) => [row.player.displayName, `${row.slices.overall.combat.kills} 次击杀`])} /></div>
    </div>)}

    {query.tab === "players" && <div className="space-y-6">
      <StatsLeaderboard rows={pageRows} sort={query.sort} direction={query.direction} rankOffset={(page - 1) * 25} seasonSlug={seasonSlug} view={query.view} query={query} />
      <p className="text-sm">共 {leaderboard.length} 条</p><StatsPagination page={page} totalPages={totalPages} />
      <div className="flex gap-3 text-sm" aria-label="详细数据阵营">{(["overall", "t", "ct"] as const).map((side) => <StatsLink key={side} href={href({ side })} aria-current={query.side === side ? "true" : undefined}>{side === "overall" ? "双方" : side.toUpperCase()}</StatsLink>)}</div>
      {data.coverage.confirmedMaps === 0 ? <EmptyState title="暂无 DAK 详细数据" sub="已有的赛事 scoreboard 仍可查看；Opening、KAST、残局和道具面板会在确认 Demo 后出现。" /> : <div className="grid gap-4 md:grid-cols-2">{playerRows.filter((row) => detailPlayerIds.has(row.player.entityKey)).map((row) => { const s = row.slices[query.side]; return <details key={row.player.entityKey} className="rounded border border-[var(--color-border)] p-4"><summary className="cursor-pointer font-semibold">{row.player.displayName} · {s.combat.kills} / {s.combat.deaths} / {s.combat.assists}</summary><p className="my-2 text-sm">{row.mapCount} 张地图 · {s.sample.rounds} 个选手回合</p><MetricPanel title="详细表现" rows={[["Opening", <Rate key="o" value={s.opening.successRate} />], ["开局参与率", <Rate key="a" value={s.opening.attemptRate} />], ["KAST", <Rate key="k" value={s.kast} />], ["存活率", <Rate key="s" value={s.survival} />], ["补枪", s.trade.tradeKills], ["残局成功率", <Rate key="c" value={s.clutch.winRate} />], ["道具伤害／回合", <Rate key="u" value={s.utility.utilityDamagePerRound} percent={false} />], ["闪光致盲／颗", <Rate key="f" value={s.utility.enemyBlindSecondsPerFlash} percent={false} />]]} /><StatsTable rows={row.weapons} rowKey={(weapon) => weapon.weapon} columns={[{ key: "weapon", label: "武器（双方）", render: (weapon) => weapon.weapon }, { key: "kills", label: "击杀", numeric: true, render: (weapon) => weapon.kills }, { key: "hs", label: "爆头率", numeric: true, render: (weapon) => <Rate value={weapon.headshotRate} /> }]} /></details>; })}</div>}
    </div>}

    {query.tab === "teams" && (data.coverage.confirmedMaps === 0 ? <EmptyState title="暂无 DAK 队伍详细统计" sub="当前范围的 BP 和 legacy scoreboard 不依赖 DAK；队伍表现会在确认 Demo 后出现。" /> : <div className="space-y-6">
      <StatsTable
        rows={teamRows}
        rowKey={(row) => row.team.entityKey}
        activeRowKey={query.team}
        sort={query.sort}
        direction={query.direction}
        sortHref={sortHref}
        columns={[
          { key: "team", label: "Team", sortable: true, render: (row) => <StatsLink href={href({ team: row.team.entityKey })} className="font-medium hover:text-[var(--color-accent)]">{row.team.displayName}</StatsLink> },
          { key: "maps", label: "Maps", sortable: true, numeric: true, render: (row) => row.mapCount },
          { key: "rounds", label: "Rounds", sortable: true, numeric: true, render: (row) => row.rounds },
          { key: "rw", label: "RW%", sortable: true, numeric: true, render: (row) => <Rate value={{ wins: row.roundWins, opportunities: row.rounds, rate: row.roundWinRate }} /> },
          { key: "t", label: "T%", sortable: true, numeric: true, render: (row) => <Rate value={row.t} /> },
          { key: "ct", label: "CT%", sortable: true, numeric: true, render: (row) => <Rate value={row.ct} /> },
          { key: "pistol", label: "Pistol%", sortable: true, numeric: true, render: (row) => <Rate value={row.pistol} /> },
          { key: "opening", label: "Opening%", sortable: true, numeric: true, render: (row) => <MaybeRate value={performanceByEntityKey.get(row.team.entityKey)?.slices.overall.opening.successRate} /> },
        ]}
      />
      {query.team ? (() => {
        const row = teamRows.find((item) => item.team.entityKey === query.team);
        const performance = performanceByEntityKey.get(query.team);
        if (!row) return <EmptyState title="没有找到该队伍的统计" />;
        return (
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 18rem), 1fr))" }}>
            <MetricPanel title="基础表现" rows={[["地图／回合", `${row.mapCount} / ${row.rounds}`], ["回合胜率", <Rate key="r" value={{ wins: row.roundWins, opportunities: row.rounds, rate: row.roundWinRate }} />], ["T", <Rate key="t" value={row.t} />], ["CT", <Rate key="ct" value={row.ct} />]]} />
            <MetricPanel title="人数优势" rows={Object.entries(row.manAdvantage).map(([key, value]) => [key, <Rate key={key} value={value} />])} />
            <MetricPanel title="经济" rows={[["手枪", <Rate key="p" value={row.pistol} />], ["R2 转化", <Rate key="r" value={row.round2.conversion} />], ["R2 逆转", <Rate key="b" value={row.round2.break} />], ["经济／半起爆冷", <Rate key="e" value={row.ecoSemiUpset} />]]} />
            {performance && <MetricPanel title="团队协作" rows={[["Opening", <Rate key="o" value={performance.slices.overall.opening.successRate} />], ["补枪", performance.slices.overall.trade.tradeKills], ["道具伤害／回合", <Rate key="u" value={performance.slices.overall.utility.utilityDamagePerRound} percent={false} />], ["闪光助攻", performance.slices.overall.utility.flashAssists]]} />}
          </div>
        );
      })() : <EmptyState title="选择一支队伍查看详情" sub="队伍总表保留全局比较；选择一行后才展开该队的四类详细指标。" />}
    </div>)}

    {query.tab === "maps" && <div className="space-y-6">
      <section><h2 className="mb-3 font-semibold">地图总表</h2>{maps.length ? <StatsTable rows={visibleMaps} columns={mapTableColumns} rowKey={(row) => row.mapName} activeRowKey={query.map} sort={query.sort} direction={query.direction} sortHref={sortHref} /> : <EmptyState title="暂无地图选择或已确认 Demo 数据" />}</section>
      {query.map ? <>
        <section><h2 className="mb-3 font-semibold">{getMapDisplayName(query.map)} · 队伍选择倾向</h2>{selectedMapTeams.length ? <StatsTable rows={selectedMapTeams} rowKey={(row) => row.entryId} sort={query.sort.startsWith("mapTeam") ? query.sort : "mapTeamPick"} direction={query.sort.startsWith("mapTeam") ? query.direction : "desc"} sortHref={sortHref} columns={[{ key: "mapTeam", label: "Team", sortable: true, render: (row) => row.name }, { key: "mapTeamPick", label: "Pick", sortable: true, numeric: true, render: (row) => row.picks }, { key: "mapTeamBan", label: "Ban", sortable: true, numeric: true, render: (row) => row.bans }]} /> : <EmptyState title="该地图暂无队伍 BP 记录" />}</section>
        {selectedMap && selectedMap.played !== null && (selectedMapData?.coverage.confirmedMaps ?? 0) > 0 && <section><h2 className="mb-3 font-semibold">{getMapDisplayName(query.map)} · 武器表现</h2><StatsTable rows={selectedMapData?.performance.weapons ?? []} rowKey={(row) => row.weapon} columns={[{ key: "weapon", label: "武器", render: (row) => row.weapon }, { key: "kills", label: "击杀", numeric: true, render: (row) => row.kills }, { key: "hs", label: "爆头率", numeric: true, render: (row) => <Rate value={row.headshotRate} /> }, { key: "top", label: "最多击杀选手", render: (row) => row.topPlayer?.displayName ?? "—" }]} /></section>}
        <div className="flex flex-wrap gap-4 text-sm"><StatsLink href={href({ tab: "teams" })}>查看本图队伍表现</StatsLink><StatsLink href={href({ tab: "players" })}>查看本图选手表现</StatsLink></div>
      </> : <p className="text-sm text-[var(--color-fg-mid)]">选择一张地图查看队伍 Pick/Ban 倾向和该地图的 DAK 详细表现。</p>}
    </div>}
  </div>;
}
