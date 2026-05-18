import { db } from "@/db/client";
import { matchVetoSteps } from "@/db/schema/match-veto-steps";
import { asc, eq } from "drizzle-orm";
import { SIDE_LABELS } from "@/types/match";
import { mapLabel } from "@/lib/maps";
import { Panel } from "@/components/rivalhub";

interface Props {
  matchId: string;
  teamAName: string;
  teamBName: string;
  teamAId: string;
  teamBId: string;
}

const ACTION_VERBS: Record<string, string> = {
  ban: "removed",
  pick: "picked",
  side_pick: "picked side for",
  decider: "was left over",
};

const ACTION_COLORS: Record<string, string> = {
  ban: "var(--color-danger)",
  pick: "var(--color-ok)",
  side_pick: "#a78bfa",
  decider: "var(--color-info)",
};

export async function VetoView({
  matchId,
  teamAName,
  teamBName,
  teamAId,
  teamBId,
}: Props) {
  const steps = await db
    .select()
    .from(matchVetoSteps)
    .where(eq(matchVetoSteps.matchId, matchId))
    .orderBy(asc(matchVetoSteps.stepOrder));

  if (steps.length === 0) return null;

  function formatTeam(teamId: string | null): string {
    if (teamId === teamAId) return teamAName;
    if (teamId === teamBId) return teamBName;
    return "";
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-[var(--color-fg)]">BP 流程</h2>
      <Panel pad={16}>
        <div className="space-y-2">
          {steps.map((step) => {
            const verb = ACTION_VERBS[step.actionType] ?? step.actionType;
            const color = ACTION_COLORS[step.actionType] ?? "var(--color-fg-mid)";
            const team = formatTeam(step.teamId);

            return (
              <div
                key={step.id}
                className="flex items-center gap-3 text-sm"
              >
                <span className="text-xs text-[var(--color-fg-mid)] w-5 text-right tabular-nums">
                  {step.stepOrder}.
                </span>

                <span
                  className="text-xs font-mono uppercase px-1.5 py-0.5 rounded-sm shrink-0"
                  style={{ background: `${color}20`, color }}
                >
                  {step.actionType}
                </span>

                {team ? (
                  <span
                    className="font-semibold text-[var(--color-fg)] shrink-0"
                    style={{ minWidth: 0 }}
                  >
                    {team}
                  </span>
                ) : null}

                <span className="text-[var(--color-fg-mid)]">{verb}</span>

                <span className="font-medium text-[var(--color-fg)]">
                  {mapLabel(step.mapName)}
                </span>

                {step.side && (
                  <span className="text-xs text-[var(--color-fg-mid)]">
                    ({SIDE_LABELS[step.side] ?? step.side})
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </Panel>
    </section>
  );
}
