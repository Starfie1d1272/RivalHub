"use client";
import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import React, { useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { TeamLogo } from "@/components/teams/TeamLogo";
import { TournamentFlow, type TournamentView } from "@/components/tournament/TournamentFlow";
import { SwissRecordGroup, TournamentResult, swissResultRecords } from "@/components/tournament/SwissPrimitives";
import styles from "@/components/tournament/tournament.module.css";
import { MAJOR_SWISS_WIN_THRESHOLD, MAJOR_SWISS_LOSS_THRESHOLD } from "@/lib/major/swiss";
import { SHORT_SWISS_WIN_THRESHOLD, SHORT_SWISS_LOSS_THRESHOLD } from "@/lib/competition-qualification/policy";
import type { SwissStageReadModel, StageSwissMatchRow } from "@/lib/matches/stage-read-model";
export function OfficialSwissFlow({ data, seasonSlug }: { data: SwissStageReadModel; seasonSlug: string }) {
  const [view, setView] = useState<TournamentView>("flow");
  const policy = data.stageKey === "play-in"
    ? { winThreshold: SHORT_SWISS_WIN_THRESHOLD, lossThreshold: SHORT_SWISS_LOSS_THRESHOLD }
    : { winThreshold: MAJOR_SWISS_WIN_THRESHOLD, lossThreshold: MAJOR_SWISS_LOSS_THRESHOLD };
  const results = swissResultRecords(policy);
  const result = (record: typeof results[number]) => {
    const advanced = record.wins === policy.winThreshold;
    return <TournamentResult seasonSlug={seasonSlug} key={`${record.wins}-${record.losses}`} label={advanced ? "Qualified" : "Eliminated"}
      record={`${record.wins}–${record.losses}`} tone={advanced ? "advance" : "eliminated"} view={view}
      teams={data.competitionEntries.filter(t => t.wins === record.wins && t.losses === record.losses && t.status === (advanced ? "advanced" : "eliminated"))
        .map(t => ({ id: t.entryId, name: t.teamName, logoUrl: t.logoUrl }))} />;
  };
  return <TournamentFlow rounds={data.rounds.map(r => r.round)} view={view} setView={setView}
    initialRound={data.rounds.find(r => r.status === "active")?.round}
    label="Swiss 官方赛程" resultLabel="官方结果" finalResults={results.map(result)}
    renderRound={roundNumber => {
      const round = data.rounds.find(r => r.round === roundNumber)!;
      // Only record paths are generated here; matches and participants always come from persisted facts.
      const paths = Array.from({ length: policy.winThreshold }, (_, i) => policy.winThreshold - i - 1)
        .map(wins => ({ wins, losses: roundNumber - 1 - wins }))
        .filter(r => r.losses >= 0 && r.losses < policy.lossThreshold)
        .map(r => `${r.wins}:${r.losses}`);
      const records = [...new Set([...paths, ...round.groups.map(g => g.record)])];
      return <>
        <p className="text-center text-xs text-[var(--color-fg-mid)]">{round.status === "finished" ? "已结束" : round.status === "active" ? "进行中" : "待开始"}</p>
        {view === "flow" && results.filter(r => r.wins === policy.winThreshold && r.wins + r.losses === roundNumber - 1).map(result)}
        {records.map(record => <SwissRecordGroup key={record} round={roundNumber} record={record.replaceAll(":", "–")} heading={record.replaceAll(":", "–")}>
          {round.groups.find(g => g.record === record)?.matchups.map(match => <OfficialMatch key={match.matchId} match={match} slug={seasonSlug} />)
            ?? <p className="rounded border border-dashed border-[var(--color-border)] p-4 text-center text-xs text-[var(--color-fg-mid)]">待定</p>}
        </SwissRecordGroup>)}
        {view === "flow" && results.filter(r => r.losses === policy.lossThreshold && r.wins + r.losses === roundNumber - 1).map(result)}
      </>;
    }} />;
}
function OfficialMatch({ match, slug }: { match: StageSwissMatchRow; slug: string }) {
  return <div
    className={`${styles.match} ${styles.compactMatch}`}>
    {([{ id: match.entryAId, name: match.teamAName, logo: match.teamALogoUrl, score: match.scoreA, other: match.scoreB },
      { id: match.entryBId, name: match.teamBName, logo: match.teamBLogoUrl, score: match.scoreB, other: match.scoreA }]).map((team, i) =>
      <div key={i} className={styles.teamSide} data-winning={match.status === "finished" && team.score !== null && team.other !== null && team.score > team.other}>
        <TeamProfileLink entryId={team.id} seasonSlug={slug} className="flex min-w-0 flex-1 items-center gap-2"><TeamLogo teamName={team.name} logoUrl={team.logo ?? null} className={styles.smallLogo} />
        <span className={styles.teamName} title={team.name}>{team.name}</span></TeamProfileLink>
        <Link href={`/${slug}/matches/${match.matchId}`} aria-label={`${match.teamAName} 对 ${match.teamBName}${i === 0 ? "" : " · 比分"}`} className={styles.rowScore}>{team.score ?? "—"}</Link>
      </div>)}
    <Link href={`/${slug}/matches/${match.matchId}`} className={styles.matchLink}
      aria-label={`查看 ${match.teamAName} 对 ${match.teamBName} 比赛`} title="查看比赛">
      <ArrowUpRight size={14} aria-hidden="true" />
    </Link>
  </div>;
}
