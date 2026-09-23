"use client";
import React from "react";

import { useState } from "react";
import type { ReactNode } from "react";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { Button } from "@/components/ui/button";
import { MetricFamilyTabs } from "@/components/stats/MetricFamilyTabs";
import { MetricPanel, MetricValue } from "@/components/stats/MetricValue";
import { StatsDataTable, type StatsDataColumn } from "@/components/stats/StatsDataTable";
import type { TournamentPlayerDetail } from "@/lib/stats/tournament-query";
import { displayWeaponName } from "@/lib/stats/presentation";
import { CS2_MAP_CATALOG } from "@/lib/config/cs2-maps";

type PlayerTab = "overview" | "opening" | "utility" | "clutch" | "maps";
type Side = "overall" | "t" | "ct";
const tabs = [
  { key: "overview", label: "Overview" },
  { key: "opening", label: "Opening & Teamplay" },
  { key: "utility", label: "Utility" },
  { key: "clutch", label: "Clutch" },
  { key: "maps", label: "Maps & Weapons" },
] as const;

function mapLabel(mapName: string) {
  return CS2_MAP_CATALOG.find((map) => map.key === mapName)?.label ?? mapName;
}

function SampleValue({ title, rows }: { title: string; rows: [string, ReactNode][] }) {
  return <MetricPanel title={title}><dl className="grid grid-cols-2 gap-x-4 gap-y-3">{rows.map(([label, value]) => <div key={label}><dt className="text-xs text-[var(--color-fg-mid)]">{label}</dt><dd className="mt-0.5 font-semibold tabular-nums">{value}</dd></div>)}</dl></MetricPanel>;
}

export function PlayerWorkspace({ detail }: { detail: TournamentPlayerDetail }) {
  const [tab, setTab] = useState<PlayerTab>("overview");
  const [side, setSide] = useState<Side>("overall");
  const player = detail.performance;
  const slice = player?.slices[side];
  const playerName = player?.player.displayName ?? detail.scoreboard[0]?.perfectName ?? "未知选手";
  const teamColumns: StatsDataColumn<(typeof detail.scoreboard)[number]>[] = [
    { key: "team", label: "Team", render: (row) => row.teamName ?? "—" },
    { key: "maps", label: "Maps", numeric: true, sortable: true, sortValue: (row) => row.maps, render: (row) => row.maps },
    { key: "rounds", label: "Rounds", numeric: true, sortable: true, sortValue: (row) => row.rounds, render: (row) => row.rounds ?? "—" },
    { key: "rating", label: "Rating", numeric: true, sortable: true, sortValue: (row) => row.avgRating, render: (row) => <MetricValue metric="rating" value={row.avgRating} /> },
    { key: "adr", label: "ADR", numeric: true, sortable: true, sortValue: (row) => row.avgAdr, render: (row) => <MetricValue metric="adr" value={row.avgAdr} /> },
    { key: "kd", label: "K/D", numeric: true, sortable: true, sortValue: (row) => row.kdRatio, render: (row) => <MetricValue metric="kd" value={row.kdRatio} /> },
    { key: "kpr", label: "KPR", numeric: true, sortable: true, sortValue: (row) => row.kpr, render: (row) => <MetricValue metric="kpr" value={row.kpr} /> },
  ];
  const mapColumns: StatsDataColumn<(typeof detail.scoreboardMaps)[number]>[] = [
    { key: "map", label: "Map", render: (row) => mapLabel(row.mapName ?? "") },
    { key: "maps", label: "Maps", numeric: true, sortable: true, sortValue: (row) => row.maps, render: (row) => row.maps },
    { key: "rounds", label: "Rounds", numeric: true, sortable: true, sortValue: (row) => row.rounds, render: (row) => row.rounds ?? "—" },
    { key: "rating", label: "Rating", numeric: true, sortable: true, sortValue: (row) => row.avgRating, render: (row) => <MetricValue metric="rating" value={row.avgRating} /> },
    { key: "adr", label: "ADR", numeric: true, sortable: true, sortValue: (row) => row.avgAdr, render: (row) => <MetricValue metric="adr" value={row.avgAdr} /> },
    { key: "kd", label: "K/D", numeric: true, sortable: true, sortValue: (row) => row.kdRatio, render: (row) => <MetricValue metric="kd" value={row.kdRatio} /> },
  ];
  const weaponColumns: StatsDataColumn<NonNullable<typeof player>["weapons"][number]>[] = [
    { key: "weapon", label: "Weapon", render: (row) => displayWeaponName(row.weapon) },
    { key: "kills", label: "Kills", numeric: true, sortable: true, sortValue: (row) => row.kills, render: (row) => row.kills },
    { key: "share", label: "Kill share", numeric: true, sortable: true, sortValue: (row) => row.killShare.rate, render: (row) => <MetricValue metric="killShare" value={row.killShare} /> },
    { key: "perRound", label: "Kills/R", numeric: true, sortable: true, sortValue: (row) => row.killsPerRound.rate, render: (row) => <MetricValue metric="killsPerRound" value={row.killsPerRound} /> },
    { key: "hs", label: "HS%", numeric: true, sortable: true, sortValue: (row) => row.headshotRate.rate, render: (row) => <MetricValue metric="headshot" value={row.headshotRate} /> },
  ];

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-xl font-semibold">{playerName}</h2></div>
        <PlayerProfileLink userId={detail.playerId} className="rounded-sm border border-[var(--color-border)] px-3 py-2 text-sm">打开选手主页</PlayerProfileLink>
      </header>
      <MetricFamilyTabs label="Player workspace" value={tab} options={tabs} onChange={setTab} />
      {tab !== "maps" && <div className="flex flex-wrap items-center gap-2" aria-label="DAK side sample">
        <span className="mr-1 text-xs text-[var(--color-fg-mid)]">Side</span>
        {(["overall", "t", "ct"] as const).map((value) => <Button key={value} type="button" size="sm" variant={side === value ? "outline" : "ghost"} aria-pressed={side === value} onClick={() => setSide(value)}>{value === "overall" ? "Overall" : value.toUpperCase()}</Button>)}
      </div>}

      {tab === "overview" && <div className="space-y-4">
        <MetricPanel title="Performance">
          <StatsDataTable embedded rows={detail.scoreboard} columns={teamColumns} rowKey={(row) => row.teamId ?? row.perfectName} pageSize={10} emptyLabel="暂无已验证 scoreboard 数据" />
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><p className="text-xs text-[var(--color-fg-mid)]">HS%</p><MetricValue metric="hs" value={detail.scoreboard[0]?.avgHs} /></div>
            <div><p className="text-xs text-[var(--color-fg-mid)]">WE</p><MetricValue metric="we" value={detail.scoreboard[0]?.avgWe} /></div>
            <div><p className="text-xs text-[var(--color-fg-mid)]">RWS</p><MetricValue metric="rws" value={detail.scoreboard[0]?.avgRws} /></div>
            <div><p className="text-xs text-[var(--color-fg-mid)]">MK/R</p><MetricValue metric="mk" value={detail.scoreboard[0]?.mkpr} /></div>
          </div>
        </MetricPanel>
        <MetricPanel title="Advanced Stats">
          {slice ? <div className="grid grid-cols-2 gap-3">
            <div><p className="text-xs text-[var(--color-fg-mid)]">Maps</p><p className="font-semibold tabular-nums">{player?.mapCount ?? 0}</p></div>
            <div><p className="text-xs text-[var(--color-fg-mid)]">Player Rounds</p><p className="font-semibold tabular-nums">{slice.sample.rounds}</p></div>
            <div><p className="text-xs text-[var(--color-fg-mid)]">KAST</p><MetricValue metric="kast" value={slice.kast} /></div>
            <div><p className="text-xs text-[var(--color-fg-mid)]">Opening</p><MetricValue metric="openingWin" value={slice.opening.successRate} /></div>
            <div><p className="text-xs text-[var(--color-fg-mid)]">Trade/R</p><MetricValue metric="trade" value={slice.trade.tradeKillsPerRound} /></div>
            <div><p className="text-xs text-[var(--color-fg-mid)]">Util/R</p><MetricValue metric="utility" value={slice.utility.utilityDamagePerRound} /></div>
          </div> : <p className="text-sm text-[var(--color-fg-mid)]">当前范围没有详细回合数据。</p>}
        </MetricPanel>
      </div>}

      {tab === "opening" && slice && <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <SampleValue title="Opening" rows={[
          ["Attempts", slice.opening.attempts],
          ["Attempt%", <MetricValue key="attemptRate" metric="openingAttempt" value={slice.opening.attemptRate} />],
          ["Opening wins", slice.opening.firstKills],
          ["Open Win%", <MetricValue key="openWinRate" metric="openingWin" value={slice.opening.successRate} />],
          ["FK/R", <MetricValue key="firstKillsPerRound" metric="firstKill" value={slice.opening.firstKillsPerRound} />],
          ["FD/R", <MetricValue key="firstDeathsPerRound" metric="firstDeath" value={slice.opening.firstDeathsPerRound} />],
          ["Win after opening win", <MetricValue key="winAfterOpeningWin" metric="roundWin" value={slice.opening.winRateAfterWinningOpeningDuel} />],
          ["Comeback after opening loss", <MetricValue key="comebackAfterOpeningLoss" metric="roundWin" value={slice.opening.comebackRateAfterLosingOpeningDuel} />],
        ]} />
        <SampleValue title="Teamplay" rows={[
          ["KAST", <MetricValue key="kast" metric="kast" value={slice.kast} />],
          ["Survival%", <MetricValue key="survival" metric="survival" value={slice.survival} />],
          ["Trade/R", <MetricValue key="trade" metric="trade" value={slice.trade.tradeKillsPerRound} />],
          ["Traded%", <MetricValue key="traded" metric="traded" value={slice.trade.tradedDeathsPerDeath} />],
        ]} />
      </div>}

      {tab === "utility" && slice && <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <SampleValue title="Utility" rows={[
          ["Util/R", <MetricValue key="utilityDamage" metric="utility" value={slice.utility.utilityDamagePerRound} />],
          ["FA/R", <MetricValue key="flashAssists" metric="flashAssist" value={slice.utility.flashAssistsPerRound} />],
          ["Blind/Flash", <MetricValue key="blindPerFlash" metric="blindPerFlash" value={slice.utility.enemyBlindSecondsPerFlash} />],
          ["Net Blind/Flash", <MetricValue key="netBlindPerFlash" metric="netBlindPerFlash" value={slice.utility.netBlindSecondsPerFlash} />],
          ["Enemy Blind/R", <MetricValue key="enemyBlindPerRound" metric="utility" value={slice.utility.enemyBlindSecondsPerRound} />],
          ["Team Blind/R", <MetricValue key="teamBlindPerRound" metric="utility" value={slice.utility.teamBlindSecondsPerRound} />],
          ["HE Damage/R", <MetricValue key="heDamagePerRound" metric="hePerRound" value={slice.utility.heDamagePerRound} />],
          ["HE Damage/Throw", <MetricValue key="heDamagePerThrow" metric="damagePerRound" value={slice.utility.heDamagePerThrow} sampleLabel="HE throws" />],
          ["Fire Damage/R", <MetricValue key="fireDamagePerRound" metric="firePerRound" value={slice.utility.fireDamagePerRound} />],
          ["Smoke/R", <MetricValue key="smokePerRound" metric="smokePerRound" value={slice.utility.smokesPerRound} />],
          ["Utility kills/R", <MetricValue key="utilityKills" metric="utilityKills" value={slice.utility.utilityKillsPerRound} />],
        ]} />
      </div>}

      {tab === "clutch" && slice && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <SampleValue title="Clutch" rows={[
          ["Attempts", slice.clutch.attempts],
          ["Wins", slice.clutch.wins],
          ["Clutch%", <MetricValue key="clutchWinRate" metric="clutch" value={slice.clutch.winRate} />],
          ["Frequency/R", <MetricValue key="clutchFrequency" metric="clutchFrequency" value={slice.clutch.frequency} />],
          ...(["1", "2", "3", "4", "5"] as const).map((count) => [`1v${count}`, <MetricValue key={count} metric="clutch" value={slice.clutch.byOpponentCount[count]} sampleLabel={`1v${count} attempts`} />] as [string, ReactNode]),
        ]} />
      </div>}

      {tab === "maps" && <div className="space-y-4">
        <MetricPanel title="Map Performance">
          <StatsDataTable embedded rows={detail.scoreboardMaps} columns={mapColumns} rowKey={(row, index) => `${row.mapName ?? "map"}:${row.teamId ?? ""}:${index}`} emptyLabel="暂无按地图拆分的 scoreboard 数据" />
        </MetricPanel>
        <MetricPanel title="Weapons">
          <StatsDataTable embedded rows={player?.weapons ?? []} columns={weaponColumns} rowKey={(row) => row.weapon} initialSortKey="kills" emptyLabel="暂无武器数据" />
        </MetricPanel>
      </div>}

      {!slice && tab !== "overview" && <p className="rounded-sm border border-[var(--color-border)] p-5 text-sm text-[var(--color-fg-mid)]">当前选手没有详细统计。</p>}
    </section>
  );
}
