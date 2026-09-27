"use client";
import { TeamLogo } from "@/components/teams/TeamLogo";
import { SIMULATION_SOURCE_LABELS } from "@/lib/predictions/presentation";
import type { Baseline, SimMatch } from "@/lib/predictions/types";
export function SimulationMatchCard({
  match,
  stageKey,
  teams,
  busy,
  editable,
  onChoose,
}: {
  match: SimMatch;
  stageKey: string;
  teams: Baseline["teams"];
  busy: boolean;
  editable: boolean;
  onChoose: (match: SimMatch, winner: string) => void;
}) {
  const preview = match.source === "preview";
  return (
    <div
      data-testid={`sim-match-${stageKey}-${match.key}`}
      data-source={match.source}
      className={`overflow-hidden border bg-[var(--color-panel-hi)] ${preview ? "border-dashed border-[var(--color-border)]" : match.source === "assumption" ? "border-[var(--color-accent)]" : "border-[var(--color-border)]"}`}
    >
      <div className="grid grid-cols-2 divide-x divide-[var(--color-border)]">
        {[match.a, match.b].map((id, index) => {
          const team = teams.find((t) => t.teamId === id);
          const selected = match.winner === id;
          const score = index === 0 ? match.scoreA : match.scoreB;
          return (
            <button
              key={id}
              type="button"
              aria-label={`${team?.name ?? "队伍"} 获胜`}
              aria-pressed={selected && !preview}
              disabled={busy || !editable}
              onClick={() => onChoose(match, id)}
              className={`flex min-h-24 min-w-0 flex-col items-center justify-center gap-1 px-1 py-2 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-accent)] disabled:cursor-default ${selected && !preview ? "bg-[var(--color-accent)]/15" : "hover:bg-[var(--color-panel)]"}`}
            >
              <TeamLogo
                teamName={team?.name ?? "队伍"}
                logoUrl={team?.logoUrl ?? null}
                className="h-9 w-9"
              />
              <span className="line-clamp-2 break-words font-medium">
                {selected && !preview ? "✓ " : ""}
                {team?.name ?? "队伍"}
              </span>
              {preview && selected && (
                <span className="text-[10px] text-[var(--color-fg-mid)]">
                  预览晋级 →
                </span>
              )}
              {score !== null && score !== undefined && (
                <strong className="text-lg tabular-nums">{score}</strong>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex justify-between gap-1 border-t border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-fg-mid)]">
        <span>
          {SIMULATION_SOURCE_LABELS[match.source]}
          {preview ? " · 仅预览" : ""}
        </span>
        <span>{match.format.toUpperCase()}</span>
      </div>
    </div>
  );
}
