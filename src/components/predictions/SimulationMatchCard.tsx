"use client";
import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import React from "react";
import { TeamLogo } from "@/components/teams/TeamLogo";
import { SIMULATION_SOURCE_LABELS } from "@/lib/predictions/presentation";
import type { Baseline, SimMatch } from "@/lib/predictions/types";
import styles from "@/components/tournament/tournament.module.css";
export function SimulationMatchCard({
  match,
  stageKey,
  teams,
  seeds,
  busy,
  editable,
  compact = false,
  onChoose,
}: {
  match: SimMatch;
  stageKey: string;
  teams: ReadonlyMap<string, Baseline["teams"][number]>;
  seeds: ReadonlyMap<string, number>;
  busy: boolean;
  editable: boolean;
  compact?: boolean;
  onChoose: (match: SimMatch, winner: string) => void;
}) {
  const preview = match.source === "preview";
  const actual = match.source === "official";
  const description = `${SIMULATION_SOURCE_LABELS[match.source]} · ${match.format.toUpperCase()}`;
  const side = (id: string, index: number) => {
    const team = teams.get(id);
    const winning = match.winner === id;
    const score = index === 0 ? match.scoreA : match.scoreB;
    return (
      <div key={id} className="relative min-w-0"><button
        type="button"
        aria-label={`${team?.name ?? "队伍"} 获胜${preview && winning ? " · 系统预览晋级" : ""}`}
        aria-pressed={winning && !preview}
        disabled={busy || !editable}
        onClick={() => onChoose(match, id)}
        data-winning={winning}
        className={`${styles.teamSide} h-full w-full pr-6`}
      >
        {compact && <span className={styles.seed}>{seeds.get(id)}</span>}
        <TeamLogo
          teamName={team?.name ?? "队伍"}
          logoUrl={team?.logoUrl ?? null}
          className={compact ? styles.smallLogo : styles.logo}
        />
        <span className={styles.teamName}>{team?.name ?? "队伍"}</span>
        {compact && (
          <strong className={styles.rowScore}>
            {actual ? (score ?? "—") : winning ? "胜" : "—"}
          </strong>
        )}
      </button><TeamProfileLink entryId={id} variant="dense" className="absolute right-0 top-0 bg-[var(--color-panel)]" aria-label={`查看 ${team?.name ?? "队伍"} 队伍资料`}>↗</TeamProfileLink></div>
    );
  };
  return (
    <div
      data-testid={`sim-match-${stageKey}-${match.key}`}
      data-source={match.source}
      title={description}
      className={`${styles.match} ${compact ? styles.compactMatch : styles.logoMatch}`}
    >
      <span className="sr-only">{description}</span>
      {compact ? (
        <>
          {side(match.a, 0)}
          {side(match.b, 1)}
        </>
      ) : (
        <>
          {side(match.a, 0)}
          <div className={styles.score} aria-hidden="true">
            {actual ? (
              <>
                <strong data-winning={match.winner === match.a}>
                  {match.scoreA ?? "—"}
                </strong>
                <span>:</span>
                <strong data-winning={match.winner === match.b}>
                  {match.scoreB ?? "—"}
                </strong>
              </>
            ) : (
              <>
                <strong>{preview ? "VS" : "✓"}</strong>
                <small>
                  {actual ? match.format : preview ? "高种子" : "我的选择"}
                </small>
              </>
            )}
          </div>
          {side(match.b, 1)}
        </>
      )}
    </div>
  );
}
