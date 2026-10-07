import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import React, { type ReactNode } from "react";
import { TeamLogo } from "@/components/teams/TeamLogo";
import type { TournamentView } from "./TournamentFlow";
import styles from "./tournament.module.css";
export function swissResultRecords(policy: { winThreshold: number; lossThreshold: number }) {
  return [
    ...Array.from({ length: policy.lossThreshold }, (_, losses) => ({ wins: policy.winThreshold, losses })),
    ...Array.from({ length: policy.winThreshold }, (_, i) => ({ wins: policy.winThreshold - i - 1, losses: policy.lossThreshold })),
  ];
}
export function SwissRecordGroup({ round, record, heading, children }: { round: number; record: string; heading?: ReactNode; children: ReactNode }) {
  return <div className={styles.recordGroup} data-testid={`record-${round}-${record}`}>
    {heading ? <h4 className={styles.recordHeading}>{heading}</h4> : <span className="sr-only">{record}</span>}
    <div className={styles.groupMatches}>{children}</div>
  </div>;
}
export function TournamentResult({ label, record, tone, teams, view, seasonSlug }: {
  seasonSlug?: string; label: string; record: string; tone: "advance" | "eliminated" | "champion" | "runner-up" | "placement";
  teams: { id: string; name: string; logoUrl?: string | null }[]; view: TournamentView;
}) {
  return <div className={styles.result} data-tone={tone}>
    <h4><span>{label}</span><strong>{record}</strong></h4>
    <div className={view === "flow" ? styles.resultLogos : styles.resultRows}>
      {teams.map(team => <TeamProfileLink key={team.id} entryId={team.id} seasonSlug={seasonSlug} className={styles.resultTeam}>
        <TeamLogo teamName={team.name} logoUrl={team.logoUrl ?? null} className={view === "flow" ? styles.logo : styles.smallLogo} />
        <span title={team.name}>{team.name}</span>
      </TeamProfileLink>)}
      {!teams.length && <span className={styles.waiting}>等待赛果</span>}
    </div>
  </div>;
}
