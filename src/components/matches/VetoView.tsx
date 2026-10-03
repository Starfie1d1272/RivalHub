import { db } from "@/db/client";
import { matchVetoSteps } from "@/db/schema/match-veto-steps";
import { asc, eq } from "drizzle-orm";
import React from "react";
import { HelpTooltip } from "@/components/rivalhub/HelpTooltip";
import { mapLabel } from "@/lib/maps";
import { VETO_ACTION_LABELS } from "@/lib/matches/veto-presentation";
import { Panel } from "@/components/rivalhub";

interface Props {
  matchId: string;
  teamAName: string;
  teamBName: string;
  entryAId: string;
  entryBId: string;
}

const ACTION_COLORS: Record<string, string> = {
  ban: "var(--color-danger)",
  pick: "var(--color-ok)",
  side_pick: "var(--color-accent-b)",
  decider: "var(--color-info)",
};

export async function VetoView({
  matchId,
  teamAName,
  teamBName,
  entryAId,
  entryBId,
}: Props) {
  const steps = await db
    .select()
    .from(matchVetoSteps)
    .where(eq(matchVetoSteps.matchId, matchId))
    .orderBy(asc(matchVetoSteps.stepOrder));

  if (steps.length === 0) return null;

  function formatTeam(entryId: string | null): string {
    if (entryId === entryAId) return teamAName;
    if (entryId === entryBId) return teamBName;
    return "";
  }

  function opponentName(entryId: string | null): string {
    if (entryId === entryAId) return teamBName;
    if (entryId === entryBId) return teamAName;
    return "";
  }

  return (
    <section className="space-y-3" aria-label="BP 流程">
      <Panel contentClassName="p-4">
        <ol className="space-y-2.5">
          {steps.map((step) => {
            const color = ACTION_COLORS[step.actionType] ?? "var(--color-fg-mid)";
            const team = formatTeam(step.entryId);
            const map = mapLabel(step.mapName);
            const side = step.side === "ct" ? "CT" : step.side === "t" ? "T" : null;
            const sideTeam = step.actionType === "pick" ? opponentName(step.entryId) : team;
            return (
              <li key={step.id} className="grid grid-cols-[1rem_4rem_minmax(0,1fr)] items-baseline gap-x-2 text-sm sm:gap-x-3">
                <span className="text-right text-xs tabular-nums text-[var(--color-fg-dim)]">{step.stepOrder}.</span>
                <span className="justify-self-start font-mono text-xs" style={{ color }}>
                  {VETO_ACTION_LABELS[step.actionType as keyof typeof VETO_ACTION_LABELS] ?? "BP"}
                </span>
                <div className="min-w-0 break-words leading-6">
                  {step.actionType === "decider" ? <><span className="font-medium">{map}</span> <span className="text-[var(--color-fg-mid)]">was left over</span></>
                    : step.actionType === "ban" || step.actionType === "pick" ? <><span className="font-semibold">{team || "—"}</span> <span className="text-[var(--color-fg-mid)]">{step.actionType === "ban" ? "removed" : "picked"}</span> <span className="font-medium">{map}</span></>
                    : step.actionType === "side_pick" ? <><span className="font-semibold">{team || "—"}</span> <span className="text-[var(--color-fg-mid)]">chose</span> <span className="font-medium">{side ?? "—"}</span> <span className="text-[var(--color-fg-mid)]">on</span> <span className="font-medium">{map}</span></>
                    : <span className="text-[var(--color-fg-dim)]">记录暂不可用</span>}
                  {side && ["pick", "decider"].includes(step.actionType) && <span className="ml-3 inline-flex items-center gap-1 text-xs text-[var(--color-fg-dim)]">
                    {sideTeam && <span>{sideTeam} ·</span>} {side}
                    <HelpTooltip label={`${map} 起始方说明`} content={`${sideTeam || "该队"}选择以 ${side} 开局。`} />
                  </span>}
                </div>
              </li>
            );
          })}
        </ol>
      </Panel>
    </section>
  );
}
