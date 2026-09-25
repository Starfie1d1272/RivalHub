"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { MapPreferenceChips } from "@/components/rivalhub/MapPreferenceChips";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { MetricFamilyTabs } from "@/components/stats/MetricFamilyTabs";
import { MetricValue } from "@/components/stats/MetricValue";
import { MetricSection } from "@/components/stats/MetricSection";
import { StatsDataTable, type StatsDataColumn } from "@/components/stats/StatsDataTable";
import { mapLabel } from "@/lib/maps";
import type { LongTeamCareerDetail, TournamentStats, TournamentTeamDetail } from "@/lib/stats/tournament-query";
import type { PublicTeamMapProfile } from "@/lib/teams/map-profile";
import { displayWeaponName, formatEconomyLabel, statsRateDenominator } from "@/lib/stats/presentation";

export type TeamPerformanceDetail = LongTeamCareerDetail | TournamentTeamDetail;
type TeamTab = "overview" | "rounds" | "teamplay" | "maps" | "players" | "weapons";

export function TeamRosterMapContext({
  mapProfile,
  hasOwnMaps,
}: {
  mapProfile: PublicTeamMapProfile;
  hasOwnMaps: boolean;
}) {
  const hasExperience = mapProfile.experience.length > 0;
  const hasPreferences = mapProfile.preferences.length > 0;
  if (!hasExperience && !hasPreferences) return null;

  const coverage = mapProfile.experienceCoverage;
  const fullExperience = coverage.rosterMembers > 0 && coverage.experiencedMembers === coverage.rosterMembers;
  const partialExperience = coverage.experiencedMembers > 0 && coverage.experiencedMembers < coverage.rosterMembers;
  const openExperience = !hasOwnMaps && hasExperience && (fullExperience || partialExperience);
  const openPreferences = !hasOwnMaps && hasPreferences && (!hasExperience || partialExperience);

  return (
    <section className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-fg-dim)]">MAP CONTEXT</p>
        <h2 className="mt-1 text-lg font-semibold">阵容地图参考</h2>
      </div>

      {hasExperience && (
        <details open={openExperience} className="border-y border-[var(--color-border)] py-4">
          <summary className="cursor-pointer text-sm font-semibold">阵容成员历史正式地图经验</summary>
          <p className="mt-2 text-xs text-[var(--color-fg-mid)]">已覆盖 {coverage.experiencedMembers}/{coverage.rosterMembers} 名成员。</p>
          <div className="mt-4 space-y-3">
            {mapProfile.experience.map((map) => (
              <div key={map.mapName} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{mapLabel(map.mapName)}</span>
                <span className="text-xs text-[var(--color-fg-mid)]">{map.players} 人 · {map.samples} 次出场 · Rating {map.rating == null ? "—" : map.rating.toFixed(2)} · ADR {map.adr == null ? "—" : map.adr.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {hasPreferences && (
        <details open={openPreferences} className="border-y border-[var(--color-border)] py-4">
          <summary className="cursor-pointer text-sm font-semibold">成员自报地图熟练度</summary>
          <div className="mt-4 space-y-4">
            {mapProfile.preferences.map((member) => (
              <div key={member.userId} className="space-y-2">
                <Link className="text-sm font-medium hover:text-[var(--color-accent)]" href={`/players/${member.userId}`}>{member.name}</Link>
                <MapPreferenceChips preferences={member.preferences} minLevel="none" />
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

const tabs = [
  { key: "overview", label: "Overview" },
  { key: "rounds", label: "Rounds & Economy" },
  { key: "teamplay", label: "Teamplay" },
  { key: "maps", label: "Maps" },
  { key: "players", label: "Players" },
  { key: "weapons", label: "Weapons" },
] as const;

type PlayerRow = {
  userId: string;
  name: string;
  maps: number;
  rating: number | null;
  adr: number | null;
  kd: number | null;
  kast: number | null;
  opening: { rate: number | null; wins?: number; opportunities?: number; successes?: number; attempts?: number } | null;
  trade: { rate: number | null; wins?: number; opportunities?: number; successes?: number; attempts?: number } | null;
  sampleRounds: number | null;
};

export function TeamWorkspace({ detail }: {
  detail: TeamPerformanceDetail;
}) {
  const [tab, setTab] = useState<TeamTab>("overview");
  const analytics = detail.analytics;
  const performance = detail.performance;

  const economyColumns: StatsDataColumn<TournamentStats["analytics"]["economyMatrix"][number]>[] = [
    { key: "combo", label: "Economy", render: (row) => `${formatEconomyLabel(row.lowEconomy)} / ${formatEconomyLabel(row.highEconomy)}` },
    { key: "rounds", label: "Rounds", numeric: true, sortable: true, sortValue: (row) => row.rounds, render: (row) => row.rounds },
    { key: "win", label: "Eco/Semi Win%", metric: "ecoSemi", numeric: true, sortable: true, sortValue: (row) => row.lowWinRate, rankingSample: (row) => row.rounds, render: (row) => <MetricValue metric="ecoSemi" value={{ wins: row.lowEconomyWins, opportunities: row.rounds, rate: row.lowWinRate }} sampleDisplay="compact" /> },
  ];

  const mapRows = useMemo(() => {
    const selection = new Map(detail.selection.map((row) => {
      const teamSelection = row.teams.find((team) => team.entryId === detail.teamId);
      return [row.mapName, teamSelection ? { ...teamSelection, deciders: row.deciders } : { picks: 0, bans: 0, deciders: row.deciders }];
    }));
    return detail.maps.map((row) => {
      const canonicalSelection = selection.get(row.mapName) ?? null;
      return {
        ...row,
        selection: "selection" in row && row.selection
          ? { ...canonicalSelection, ...row.selection }
          : canonicalSelection,
      };
    });
  }, [detail]);

  const mapColumns: StatsDataColumn<(typeof mapRows)[number]>[] = [
    { key: "map", label: "Map", render: (row) => mapLabel(row.mapName) },
    { key: "played", label: "Played", numeric: true, sortable: true, sortValue: (row) => row.results?.played ?? 0, render: (row) => row.results?.played ?? 0 },
    { key: "record", label: "Map W-L", numeric: true, sortable: true, sortValue: (row) => row.results ? row.results.wins - row.results.losses : null, render: (row) => row.results ? `${row.results.wins}-${row.results.losses}` : "—" },
    { key: "rw", label: "RW%", metric: "roundWin", numeric: true, className: "hidden sm:table-cell", sortable: true, sortValue: (row) => row.analytics?.roundWinRate, rankingSample: (row) => row.analytics?.rounds, render: (row) => row.analytics ? <MetricValue metric="roundWin" value={{ wins: row.analytics.roundWins, opportunities: row.analytics.rounds, rate: row.analytics.roundWinRate }} sampleDisplay="hidden" /> : "—" },
    { key: "sides", label: "CT% / T%", numeric: true, className: "hidden lg:table-cell", render: (row) => row.analytics ? <span className="inline-flex gap-2"><MetricValue metric="roundWin" value={row.analytics.ct} sampleDisplay="hidden" /><span aria-hidden>/</span><MetricValue metric="roundWin" value={row.analytics.t} sampleDisplay="hidden" /></span> : "—" },
    { key: "pick", label: "Picks", numeric: true, className: "hidden md:table-cell", sortable: true, sortValue: (row) => row.selection?.picks ?? 0, render: (row) => row.selection?.picks ?? 0 },
    { key: "ban", label: "Bans", numeric: true, className: "hidden md:table-cell", sortable: true, sortValue: (row) => row.selection?.bans ?? 0, render: (row) => row.selection?.bans ?? 0 },
    { key: "decider", label: "Deciders", numeric: true, className: "hidden xl:table-cell", sortable: true, sortValue: (row) => row.selection?.deciders ?? 0, render: (row) => row.selection?.deciders ?? 0 },
    { key: "detail", label: "Detail", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.coverage.detailedMaps, render: (row) => `${row.coverage.detailedMaps}/${row.coverage.completedMaps}` },
  ];

  const playerRows = useMemo<PlayerRow[]>(() => {
    const detailed = new Map(detail.detailedPlayers.map((row) => [row.player.entityKey, row]));
    return detail.scoreboard.flatMap((row) => {
      if (!row.userId) return [];
      const advanced = detailed.get(row.userId);
      return [{
        userId: row.userId,
        name: row.perfectName,
        maps: row.maps,
        rating: row.avgRating,
        adr: row.avgAdr,
        kd: row.kdRatio,
        kast: advanced?.slices.overall.kast.rate ?? null,
        opening: advanced?.slices.overall.opening.successRate ?? null,
        trade: advanced?.slices.overall.trade.tradeKillsPerRound ?? null,
        sampleRounds: advanced?.slices.overall.sample.rounds ?? row.rounds,
      }];
    });
  }, [detail]);

  const playerColumns: StatsDataColumn<PlayerRow>[] = [
    { key: "player", label: "Player", identity: true, render: (row) => <PlayerProfileLink userId={row.userId} title={row.name} className="block max-w-full truncate font-medium">{row.name}</PlayerProfileLink> },
    { key: "maps", label: "Maps", numeric: true, sortable: true, sortValue: (row) => row.maps, render: (row) => row.maps },
    { key: "rating", label: "Rating", metric: "rating", numeric: true, sortable: true, sortValue: (row) => row.rating, rankingSample: (row) => row.sampleRounds, render: (row) => <MetricValue metric="rating" value={row.rating} /> },
    { key: "adr", label: "ADR", metric: "adr", numeric: true, className: "hidden sm:table-cell", sortable: true, sortValue: (row) => row.adr, rankingSample: (row) => row.sampleRounds, render: (row) => <MetricValue metric="adr" value={row.adr} /> },
    { key: "kd", label: "K/D", metric: "kd", numeric: true, className: "hidden sm:table-cell", sortable: true, sortValue: (row) => row.kd, rankingSample: (row) => row.sampleRounds, render: (row) => <MetricValue metric="kd" value={row.kd} /> },
    { key: "kast", label: "KAST", metric: "kast", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.kast, rankingSample: (row) => row.sampleRounds, render: (row) => <MetricValue metric="kast" value={row.kast} /> },
    { key: "opening", label: "Opening", metric: "openingWin", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.opening?.rate, rankingSample: (row) => row.opening ? statsRateDenominator(row.opening) : null, render: (row) => <MetricValue metric="openingWin" value={row.opening} sampleDisplay="compact" /> },
    { key: "trade", label: "Trade/100r", metric: "trade", numeric: true, className: "hidden xl:table-cell", sortable: true, sortValue: (row) => row.trade?.rate, rankingSample: (row) => row.sampleRounds, render: (row) => <MetricValue metric="trade" value={row.trade} sampleDisplay="hidden" /> },
  ];

  const weaponRows = performance?.weapons ?? [];
  const weaponColumns: StatsDataColumn<(typeof weaponRows)[number]>[] = [
    { key: "weapon", label: "Weapon", render: (row) => displayWeaponName(row.weapon) },
    { key: "kills", label: "Kills", numeric: true, sortable: true, sortValue: (row) => row.kills, render: (row) => row.kills },
    { key: "share", label: "Kill share", metric: "killShare", numeric: true, sortable: true, sortValue: (row) => row.killShare.rate, render: (row) => <MetricValue metric="killShare" value={row.killShare} /> },
    { key: "perRound", label: "Kills/r", metric: "killsPerRound", numeric: true, sortable: true, sortValue: (row) => row.killsPerRound.rate, render: (row) => <MetricValue metric="killsPerRound" value={row.killsPerRound} /> },
    { key: "hs", label: "HS%", metric: "headshot", numeric: true, sortable: true, sortValue: (row) => row.headshotRate.rate, render: (row) => <MetricValue metric="headshot" value={row.headshotRate} /> },
  ];

  return (
    <section className="space-y-5">
      <MetricFamilyTabs label="Team performance" value={tab} options={tabs} onChange={setTab} />

      {tab === "overview" && (
        <div className="space-y-6">
          {analytics ? (
            <MetricSection title="Round Profile" items={[
              { label: "Rounds", value: analytics.rounds },
              { label: "CT%", metric: "roundWin", value: <MetricValue metric="roundWin" value={analytics.ct} sampleDisplay="hidden" /> },
              { label: "T%", metric: "roundWin", value: <MetricValue metric="roundWin" value={analytics.t} sampleDisplay="hidden" /> },
              { label: "Pistol", metric: "pistol", value: <MetricValue metric="pistol" value={analytics.pistol} sampleDisplay="hidden" /> },
            ]} />
          ) : <p className="border-y border-[var(--color-border)] py-5 text-sm text-[var(--color-fg-mid)]">当前队伍没有详细回合数据。</p>}
        </div>
      )}

      {tab === "rounds" && (
        <div className="space-y-6">
          {analytics ? <>
            <MetricSection title="Round Conversion" items={[
              { label: "Pistol", metric: "pistol", value: <MetricValue metric="pistol" value={analytics.pistol} /> },
              { label: "R2 Conversion", metric: "conversion", value: <MetricValue metric="conversion" value={analytics.round2.conversion} /> },
              { label: "R2 Break", metric: "break", value: <MetricValue metric="break" value={analytics.round2.break} /> },
            ]} columns={3} />
            <MetricSection title="Man Advantage" items={[
              { label: "5v4", metric: "fiveVFour", value: <MetricValue metric="fiveVFour" value={analytics.manAdvantage["5v4"]} /> },
              { label: "4v5", metric: "fourVFive", value: <MetricValue metric="fourVFive" value={analytics.manAdvantage["4v5"]} /> },
              { label: "5v3", metric: "fiveVThree", value: <MetricValue metric="fiveVThree" value={analytics.manAdvantage["5v3"]} /> },
              { label: "3v5", metric: "threeVFive", value: <MetricValue metric="threeVFive" value={analytics.manAdvantage["3v5"]} /> },
            ]} />
            <MetricSection title="Low Economy" items={[
              { label: "Eco/Semi Win%", metric: "ecoSemi", value: <MetricValue metric="ecoSemi" value={analytics.ecoSemiUpset} /> },
            ]} columns={3} />
          </> : <p className="border-y border-[var(--color-border)] py-5 text-sm text-[var(--color-fg-mid)]">当前队伍没有详细回合数据。</p>}
          <section className="border-t border-[var(--color-border)] pt-4">
            <h3 className="mb-1 text-sm font-semibold">Economy Matchups</h3>
            <StatsDataTable embedded rows={detail.economyMatrix} columns={economyColumns} rowKey={(row) => `${row.lowEconomy}:${row.highEconomy}`} emptyLabel="暂无经济分类样本" />
          </section>
        </div>
      )}

      {tab === "teamplay" && (
        performance ? <div className="space-y-6">
          <MetricSection title="Opening" items={[
            { label: "Success%", metric: "openingWin", value: <MetricValue metric="openingWin" value={performance.slices.overall.opening.successRate} /> },
            { label: "Attempts%", metric: "openingAttempt", value: <MetricValue metric="openingAttempt" value={performance.slices.overall.opening.attemptRate} /> },
            { label: "FK/100r", metric: "firstKill", value: <MetricValue metric="firstKill" value={performance.slices.overall.opening.firstKillsPerRound} /> },
            { label: "FD/100r", metric: "firstDeath", value: <MetricValue metric="firstDeath" value={performance.slices.overall.opening.firstDeathsPerRound} /> },
            { label: "Win after FK", metric: "winAfterOpeningWin", value: <MetricValue metric="winAfterOpeningWin" value={performance.slices.overall.opening.winRateAfterWinningOpeningDuel} /> },
            { label: "Win after FD", metric: "winAfterOpeningLoss", value: <MetricValue metric="winAfterOpeningLoss" value={performance.slices.overall.opening.comebackRateAfterLosingOpeningDuel} /> },
          ]} columns={3} />
          <MetricSection title="Trading" items={[
            { label: "Trade/100r", metric: "trade", value: <MetricValue metric="trade" value={performance.slices.overall.trade.tradeKillsPerRound} /> },
            { label: "Traded%", metric: "traded", value: <MetricValue metric="traded" value={performance.slices.overall.trade.tradedDeathsPerDeath} /> },
            { label: "Opening deaths traded", metric: "tradedOpening", value: <MetricValue metric="tradedOpening" value={performance.slices.overall.trade.tradedOpeningDeaths} /> },
          ]} columns={3} />
          <MetricSection title="Utility" items={[
            { label: "FA/100r", metric: "flashAssist", value: <MetricValue metric="flashAssist" value={performance.slices.overall.utility.flashAssistsPerRound} /> },
            { label: "Blind/Flash", metric: "blindPerFlash", value: <MetricValue metric="blindPerFlash" value={performance.slices.overall.utility.enemyBlindSecondsPerFlash} /> },
            { label: "Enemy Blind/r", metric: "enemyBlindPerRound", value: <MetricValue metric="enemyBlindPerRound" value={performance.slices.overall.utility.enemyBlindSecondsPerRound} /> },
            { label: "Team Blind/r", metric: "teamBlindPerRound", value: <MetricValue metric="teamBlindPerRound" value={performance.slices.overall.utility.teamBlindSecondsPerRound} /> },
            { label: "Util/r", metric: "utility", value: <MetricValue metric="utility" value={performance.slices.overall.utility.utilityDamagePerRound} /> },
            { label: "Utility K/100r", metric: "utilityKills", value: <MetricValue metric="utilityKills" value={performance.slices.overall.utility.utilityKillsPerRound} /> },
          ]} columns={3} />
          <MetricSection title="Objective" items={[
            { label: "Plant conversion", metric: "plantConversion", value: <MetricValue metric="plantConversion" value={performance.slices.overall.objective.plantConversions} /> },
          ]} columns={3} />
        </div> : <p className="border-y border-[var(--color-border)] py-5 text-sm text-[var(--color-fg-mid)]">当前队伍没有详细团队数据。</p>
      )}

      {tab === "maps" && (
        <div className="space-y-5">
          <section className="space-y-3 border-t border-[var(--color-border)] pt-4">
            <h3 className="text-sm font-semibold">正式地图表现</h3>
            <StatsDataTable embedded rows={mapRows} columns={mapColumns} rowKey={(row) => row.mapName} initialSortKey="played" emptyLabel="暂无队伍正式地图样本" />
          </section>
        </div>
      )}

      {tab === "players" && (
        <section className="space-y-3 border-t border-[var(--color-border)] pt-4">
          <h3 className="text-sm font-semibold">Players</h3>
          <StatsDataTable
            embedded
            rows={playerRows}
            rankingBaselineRows={playerRows}
            columns={playerColumns}
            rowKey={(row) => row.userId}
            initialSortKey="rating"
            tableClassName="min-w-[760px] table-fixed"
            emptyLabel="暂无选手统计"
          />
        </section>
      )}

      {tab === "weapons" && (
        <section className="space-y-3 border-t border-[var(--color-border)] pt-4">
          <h3 className="text-sm font-semibold">Weapons</h3>
          <StatsDataTable
            embedded
            rows={weaponRows}
            columns={weaponColumns}
            rowKey={(row) => row.weapon}
            initialSortKey="kills"
            tableClassName="min-w-[560px] table-fixed"
            emptyLabel="暂无武器数据"
          />
        </section>
      )}
    </section>
  );
}
