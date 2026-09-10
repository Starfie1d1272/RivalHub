"use client";
import { Button } from "@/components/ui/button";
import { TeamLogo } from "@/components/teams/TeamLogo";
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
  return (
    <div
      data-testid={`sim-match-${stageKey}-${match.key}`}
      className="rounded border border-[var(--color-border)] bg-[var(--color-panel-hi)] p-2"
    >
      <div className="mb-2 flex justify-between gap-2 text-xs text-[var(--color-fg-mid)]">
        <span>{match.format.toUpperCase()}</span>
        <span>
          {match.source === "official"
            ? "官方结果 · 默认锁定"
            : match.source === "assumption"
              ? "我的假设"
              : "待选择"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1">
        {[match.a, match.b].map((id) => {
          const team = teams.find((t) => t.teamId === id);
          return (
            <Button
              key={id}
              variant={match.winner === id ? "default" : "ghost"}
              aria-label={`${team?.name ?? "队伍"} 获胜`}
              aria-pressed={match.winner === id}
              className="h-auto min-h-16 flex-col whitespace-normal px-1 py-2 text-xs"
              disabled={busy || !editable}
              onClick={() => onChoose(match, id)}
            >
              <TeamLogo
                teamName={team?.name ?? "队伍"}
                logoUrl={team?.logoUrl ?? null}
                className="h-6 w-6"
              />
              <span className="line-clamp-2">
                {match.winner === id ? "✓ " : ""}
                {team?.name ?? "队伍"}
              </span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
