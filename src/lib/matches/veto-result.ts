import type { MatchFormat } from "@/types/match";
import { projectVetoMapPlan } from "./veto-sequence";

export interface OfficialVetoStep { stepOrder: number; actionType: string; mapName: string }
export interface OfficialVetoResult {
  completedAt: Date | null;
  pendingAppeal: boolean;
  mapPoolSnapshot: string[] | null;
  steps: OfficialVetoStep[];
}

/** The completed BP determines the full plan, including an unplayed decider. */
export function completedVetoMaps(format: MatchFormat, entryAId: string, veto?: OfficialVetoResult): string[] | null {
  if (!veto?.completedAt || veto.pendingAppeal || !veto.mapPoolSnapshot) return null;
  const total = Number(format.slice(2));
  const pool = veto.mapPoolSnapshot;
  if (pool.length < total || new Set(pool).size !== pool.length) return null;
  const steps = veto.steps.filter(step => step.actionType === "pick" || step.actionType === "decider").sort((a,b) => a.stepOrder-b.stepOrder);
  if (steps.length !== total || steps.filter(step => step.actionType === "pick").length !== total-1 ||
    steps.at(-1)?.actionType !== "decider" || steps.some(step => !Number.isInteger(step.stepOrder) || step.stepOrder < 1 || !pool.includes(step.mapName)) ||
    new Set(steps.map(step => step.stepOrder)).size !== total || new Set(steps.map(step => step.mapName)).size !== total) return null;
  return projectVetoMapPlan({ format, entryAId, steps: steps.map(step => ({
    turnKey: "", actionType: step.actionType === "pick" ? "pick" : "decider", mapName: step.mapName, entryId: null, side: null,
  })) }).map(map => map.mapName);
}
