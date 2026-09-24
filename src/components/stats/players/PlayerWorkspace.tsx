"use client";

import { useState } from "react";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { MetricFamilyTabs } from "@/components/stats/MetricFamilyTabs";
import { MetricValue } from "@/components/stats/MetricValue";
import { MetricSection } from "@/components/stats/MetricSection";
import { StatsDataTable, type StatsDataColumn } from "@/components/stats/StatsDataTable";
import type { TournamentPlayerDetail } from "@/lib/stats/tournament-query";
import { displayWeaponName } from "@/lib/stats/presentation";
import { CS2_MAP_CATALOG } from "@/lib/config/cs2-maps";

type PlayerTab = "overview" | "opening" | "teamplay" | "utility" | "clutch" | "maps" | "weapons";
type Side = "overall" | "t" | "ct";

const tabs = [
  { key: "overview", label: "Overview" },
  { key: "opening", label: "Opening" },
  { key: "teamplay", label: "Teamplay" },
  { key: "utility", label: "Utility" },
  { key: "clutch", label: "Clutch" },
  { key: "maps", label: "Maps" },
  { key: "weapons", label: "Weapons" },
] as const;

function mapLabel(mapName: string) {
  return CS2_MAP_CATALOG.find((map) => map.key === mapName)?.label ?? mapName;
}

function ScopeSideTabs({ value, onChange }: { value: Side; onChange: (side: Side) => void }) {
  return (
    <div className="flex justify-end">
      <div className="inline-flex items-center gap-1 border-b border-[var(--color-border)]" aria-label="DAK side sample">
        {(["overall", "t", "ct"] as const).map((side) => {
          const active = value === side;
          return (
            <button
              key={side}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(side)}
              className={[
                "-mb-px border-b-2 px-3 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "border-[var(--color-accent)] text-[var(--color-fg)]"
                  : "border-transparent text-[var(--color-fg-mid)] hover:text-[var(--color-fg)]",
              ].join(" ")}
            >
              {side === "overall" ? "Overall" : side.toUpperCase()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PlayerWorkspace({ detail, compact = false }: { detail: TournamentPlayerDetail; compact?: boolean }) {
  const [tab, setTab] = useState<PlayerTab>("overview");
  const [side, setSide] = useState<Side>("overall");
  const player = detail.performance;
  const slice = player?.slices[side];
  const clutchWinsPerRound = slice
    ? {
        rate: slice.sample.rounds > 0 ? slice.clutch.wins / slice.sample.rounds : null,
        successes: slice.clutch.wins,
        attempts: slice.sample.rounds,
      }
    : null;
  const playerName = player?.player.displayName ?? detail.scoreboard[0]?.perfectName ?? "未知选手";

  const teamColumns: StatsDataColumn<(typeof detail.scoreboard)[number]>[] = [
    { key: "team", label: "Team", render: (row) => row.teamName ?? "—" },
    { key: "maps", label: "Maps", numeric: true, sortable: true, sortValue: (row) => row.maps, render: (row) => row.maps },
    { key: "rounds", label: "Rounds", numeric: true, sortable: true, sortValue: (row) => row.rounds, render: (row) => row.rounds ?? "—" },
    { key: "rating", label: "Rating", metric: "rating", numeric: true, sortable: true, sortValue: (row) => row.avgRating, render: (row) => <MetricValue metric="rating" value={row.avgRating} /> },
    { key: "adr", label: "ADR", metric: "adr", numeric: true, sortable: true, sortValue: (row) => row.avgAdr, render: (row) => <MetricValue metric="adr" value={row.avgAdr} /> },
    { key: "kd", label: "K/D", metric: "kd", numeric: true, sortable: true, sortValue: (row) => row.kdRatio, render: (row) => <MetricValue metric="kd" value={row.kdRatio} /> },
    { key: "kpr", label: "KPR", metric: "kpr", numeric: true, sortable: true, sortValue: (row) => row.kpr, render: (row) => <MetricValue metric="kpr" value={row.kpr} /> },
  ];
  const mapColumns: StatsDataColumn<(typeof detail.scoreboardMaps)[number]>[] = [
    { key: "map", label: "Map", render: (row) => mapLabel(row.mapName ?? "") },
    { key: "maps", label: "Maps", numeric: true, sortable: true, sortValue: (row) => row.maps, render: (row) => row.maps },
    { key: "rounds", label: "Rounds", numeric: true, sortable: true, sortValue: (row) => row.rounds, render: (row) => row.rounds ?? "—" },
    { key: "rating", label: "Rating", metric: "rating", numeric: true, sortable: true, sortValue: (row) => row.avgRating, render: (row) => <MetricValue metric="rating" value={row.avgRating} /> },
    { key: "adr", label: "ADR", metric: "adr", numeric: true, sortable: true, sortValue: (row) => row.avgAdr, render: (row) => <MetricValue metric="adr" value={row.avgAdr} /> },
    { key: "kd", label: "K/D", metric: "kd", numeric: true, sortable: true, sortValue: (row) => row.kdRatio, render: (row) => <MetricValue metric="kd" value={row.kdRatio} /> },
  ];
  const weaponColumns: StatsDataColumn<NonNullable<typeof player>["weapons"][number]>[] = [
    { key: "weapon", label: "Weapon", render: (row) => displayWeaponName(row.weapon) },
    { key: "kills", label: "Kills", numeric: true, sortable: true, sortValue: (row) => row.kills, render: (row) => row.kills },
    { key: "share", label: "Kill share", metric: "killShare", numeric: true, sortable: true, sortValue: (row) => row.killShare.rate, render: (row) => <MetricValue metric="killShare" value={row.killShare} /> },
    { key: "perRound", label: "Kills/r", metric: "killsPerRound", numeric: true, sortable: true, sortValue: (row) => row.killsPerRound.rate, render: (row) => <MetricValue metric="killsPerRound" value={row.killsPerRound} /> },
    { key: "hs", label: "HS%", metric: "headshot", numeric: true, sortable: true, sortValue: (row) => row.headshotRate.rate, render: (row) => <MetricValue metric="headshot" value={row.headshotRate} /> },
  ];

  return (
    <section className="space-y-5">
      {!compact && (
        <header className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-xl font-semibold">{playerName}</h2>
          <PlayerProfileLink userId={detail.playerId} className="rounded-sm border border-[var(--color-border)] px-3 py-2 text-sm">
            打开选手主页
          </PlayerProfileLink>
        </header>
      )}

      <MetricFamilyTabs label="Player workspace" value={tab} options={tabs} onChange={setTab} />
      {tab !== "overview" && tab !== "maps" && tab !== "weapons" && <ScopeSideTabs value={side} onChange={setSide} />}

      {tab === "overview" && (
        <div className="space-y-6">
          {!compact && (
            <StatsDataTable
              embedded
              rows={detail.scoreboard}
              columns={teamColumns}
              rowKey={(row) => row.teamId ?? row.perfectName}
              pageSize={10}
              emptyLabel="暂无已验证 scoreboard 数据"
            />
          )}

          <MetricSection title="Performance" items={[
            { label: "Rating", metric: "rating", value: <MetricValue metric="rating" value={detail.scoreboard[0]?.avgRating} /> },
            { label: "ADR", metric: "adr", value: <MetricValue metric="adr" value={detail.scoreboard[0]?.avgAdr} /> },
            { label: "K/D", metric: "kd", value: <MetricValue metric="kd" value={detail.scoreboard[0]?.kdRatio} /> },
            { label: "KPR", metric: "kpr", value: <MetricValue metric="kpr" value={detail.scoreboard[0]?.kpr} /> },
            { label: "HS%", metric: "hs", value: <MetricValue metric="hs" value={detail.scoreboard[0]?.avgHs == null ? null : detail.scoreboard[0].avgHs / 100} /> },
            { label: "WE", metric: "we", value: <MetricValue metric="we" value={detail.scoreboard[0]?.avgWe} /> },
            { label: "RWS", metric: "rws", value: <MetricValue metric="rws" value={detail.scoreboard[0]?.avgRws} /> },
            { label: "MK/100r", metric: "mk", value: <MetricValue metric="mk" value={detail.scoreboard[0]?.mkpr} /> },
          ]} />

          {slice && (
            <MetricSection title="Advanced" items={[
              { label: "KAST", metric: "kast", value: <MetricValue metric="kast" value={slice.kast} /> },
              { label: "Opening", metric: "openingWin", value: <MetricValue metric="openingWin" value={slice.opening.successRate} /> },
              { label: "Trade/100r", metric: "trade", value: <MetricValue metric="trade" value={slice.trade.tradeKillsPerRound} /> },
              { label: "A/100r", metric: "assist", value: <MetricValue metric="assist" value={slice.combat.assistsPerRound} /> },
              { label: "Util/r", metric: "utility", value: <MetricValue metric="utility" value={slice.utility.utilityDamagePerRound} /> },
              { label: "Clutch%", metric: "clutch", value: <MetricValue metric="clutch" value={slice.clutch.winRate} /> },
            ]} columns={3} />
          )}
        </div>
      )}

      {tab === "opening" && slice && (
        <div className="space-y-6">
          <MetricSection title="Duel frequency" items={[
            { label: "Attempts%", metric: "openingAttempt", value: <MetricValue metric="openingAttempt" value={slice.opening.attemptRate} /> },
            { label: "Attempts", metric: "openingAttempts", value: <MetricValue metric="openingAttempts" value={slice.opening.attempts} /> },
            { label: "FK/100r", metric: "firstKill", value: <MetricValue metric="firstKill" value={slice.opening.firstKillsPerRound} /> },
            { label: "FD/100r", metric: "firstDeath", value: <MetricValue metric="firstDeath" value={slice.opening.firstDeathsPerRound} /> },
          ]} />
          <MetricSection title="Duel outcome" items={[
            { label: "Success%", metric: "openingWin", value: <MetricValue metric="openingWin" value={slice.opening.successRate} /> },
            { label: "Opening wins", metric: "openingWins", value: <MetricValue metric="openingWins" value={slice.opening.firstKills} /> },
            { label: "Win after FK", metric: "winAfterOpeningWin", value: <MetricValue metric="winAfterOpeningWin" value={slice.opening.winRateAfterWinningOpeningDuel} /> },
            { label: "Win after FD", metric: "winAfterOpeningLoss", value: <MetricValue metric="winAfterOpeningLoss" value={slice.opening.comebackRateAfterLosingOpeningDuel} /> },
          ]} />
        </div>
      )}

      {tab === "teamplay" && slice && (
        <div className="space-y-6">
          <MetricSection title="Round contribution" items={[
            { label: "KAST", metric: "kast", value: <MetricValue metric="kast" value={slice.kast} /> },
            { label: "Survival%", metric: "survival", value: <MetricValue metric="survival" value={slice.survival} /> },
            { label: "A/100r", metric: "assist", value: <MetricValue metric="assist" value={slice.combat.assistsPerRound} /> },
          ]} columns={3} />
          <MetricSection title="Trading" items={[
            { label: "Trade/100r", metric: "trade", value: <MetricValue metric="trade" value={slice.trade.tradeKillsPerRound} /> },
            { label: "Traded%", metric: "traded", value: <MetricValue metric="traded" value={slice.trade.tradedDeathsPerDeath} /> },
            { label: "Opening deaths traded", metric: "tradedOpening", value: <MetricValue metric="tradedOpening" value={slice.trade.tradedOpeningDeaths} /> },
          ]} columns={3} />
        </div>
      )}

      {tab === "utility" && slice && (
        <div className="space-y-6">
          <MetricSection title="Flash" items={[
            { label: "FA/100r", metric: "flashAssist", value: <MetricValue metric="flashAssist" value={slice.utility.flashAssistsPerRound} /> },
            { label: "Blind/Flash", metric: "blindPerFlash", value: <MetricValue metric="blindPerFlash" value={slice.utility.enemyBlindSecondsPerFlash} /> },
            { label: "Net Blind/Flash", metric: "netBlindPerFlash", value: <MetricValue metric="netBlindPerFlash" value={slice.utility.netBlindSecondsPerFlash} /> },
            { label: "Enemy Blind/r", metric: "enemyBlindPerRound", value: <MetricValue metric="enemyBlindPerRound" value={slice.utility.enemyBlindSecondsPerRound} /> },
            { label: "Team Blind/r", metric: "teamBlindPerRound", value: <MetricValue metric="teamBlindPerRound" value={slice.utility.teamBlindSecondsPerRound} /> },
          ]} columns={5} />

          <MetricSection title="Damage" items={[
            { label: "Util/r", metric: "utility", value: <MetricValue metric="utility" value={slice.utility.utilityDamagePerRound} /> },
            { label: "HE Damage/r", metric: "hePerRound", value: <MetricValue metric="hePerRound" value={slice.utility.heDamagePerRound} /> },
            { label: "HE Damage/Throw", metric: "hePerThrow", value: <MetricValue metric="hePerThrow" value={slice.utility.heDamagePerThrow} sampleLabel="HE throws" /> },
            { label: "Fire Damage/r", metric: "firePerRound", value: <MetricValue metric="firePerRound" value={slice.utility.fireDamagePerRound} /> },
            { label: "Fire Damage/Throw", metric: "firePerThrow", value: <MetricValue metric="firePerThrow" value={slice.utility.fireDamagePerThrow} sampleLabel="fire throws" /> },
          ]} columns={5} />

          <MetricSection title="Usage" items={[
            { label: "Flashes thrown", metric: "flashesThrown", value: <MetricValue metric="flashesThrown" value={slice.utility.flashesThrown} /> },
            { label: "HE thrown", metric: "heThrows", value: <MetricValue metric="heThrows" value={slice.utility.heThrows} /> },
            { label: "Fire thrown", metric: "fireThrows", value: <MetricValue metric="fireThrows" value={slice.utility.fireThrows} /> },
            { label: "Smokes thrown", metric: "smokesThrown", value: <MetricValue metric="smokesThrown" value={slice.utility.smokesThrown} /> },
            { label: "Smoke/r", metric: "smokePerRound", value: <MetricValue metric="smokePerRound" value={slice.utility.smokesPerRound} /> },
            { label: "Utility K/100r", metric: "utilityKills", value: <MetricValue metric="utilityKills" value={slice.utility.utilityKillsPerRound} /> },
          ]} columns={3} />
        </div>
      )}

      {tab === "clutch" && slice && (
        <div className="space-y-6">
          <MetricSection title="Clutch" items={[
            { label: "Attempts", metric: "clutchAttempts", value: <MetricValue metric="clutchAttempts" value={slice.clutch.attempts} /> },
            { label: "Wins", metric: "clutchWins", value: <MetricValue metric="clutchWins" value={slice.clutch.wins} /> },
            { label: "Clutch%", metric: "clutch", value: <MetricValue metric="clutch" value={slice.clutch.winRate} /> },
            { label: "C/100r", metric: "clutchFrequency", value: <MetricValue metric="clutchFrequency" value={clutchWinsPerRound} /> },
          ]} />
          <MetricSection title="By opponents" items={(["1", "2", "3", "4", "5"] as const).map((count) => ({
            label: `1v${count}`,
            metric: "clutchSplit" as const,
            value: <MetricValue metric="clutchSplit" value={slice.clutch.byOpponentCount[count]} sampleLabel={`1v${count} attempts`} />,
          }))} columns={5} />
        </div>
      )}

      {tab === "maps" && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Map Performance</h3>
          <StatsDataTable
            embedded
            rows={detail.scoreboardMaps}
            columns={mapColumns}
            rowKey={(row, index) => `${row.mapName ?? "map"}:${row.teamId ?? ""}:${index}`}
            initialSortKey="rating"
            tableClassName="min-w-[620px] table-fixed"
            emptyLabel="暂无按地图拆分的 scoreboard 数据"
          />
        </section>
      )}

      {tab === "weapons" && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Weapons</h3>
          <StatsDataTable
            embedded
            rows={player?.weapons ?? []}
            columns={weaponColumns}
            rowKey={(row) => row.weapon}
            initialSortKey="kills"
            tableClassName="min-w-[560px] table-fixed"
            emptyLabel="暂无武器数据"
          />
        </section>
      )}

      {!slice && tab !== "overview" && tab !== "maps" && tab !== "weapons" && (
        <p className="border-y border-[var(--color-border)] py-5 text-sm text-[var(--color-fg-mid)]">当前选手没有详细统计。</p>
      )}
    </section>
  );
}
