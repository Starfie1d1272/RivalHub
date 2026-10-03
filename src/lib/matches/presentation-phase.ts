import type { MatchStatus } from "@/types/match";

/** Public-safe facts only. Source authority and operator tasks belong to admin projections. */
export interface MatchPhaseFacts {
  status: MatchStatus;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  veto: "not_started" | "in_progress" | "completed";
  maps: readonly { id: string; order: number; completedAt: string | null }[];
  /** Validated observation of the current execution, never inferred from in_progress. */
  gameplayMapId: string | null;
}

export type MatchPresentationPhase =
  | "preparation" | "awaiting_veto" | "veto" | "awaiting_gameplay"
  | "gameplay" | "inter_map" | "post" | "cancelled";

/** Pure projection; no persisted phase, credentials, health, or private admin DTO. */
export function projectMatchPresentationPhase(facts: MatchPhaseFacts): MatchPresentationPhase {
  if (facts.status === "cancelled") return "cancelled";
  if (facts.status === "finished") return "post";
  if (facts.veto === "in_progress") return "veto";
  if (facts.veto !== "completed") return facts.scheduledAt ? "awaiting_veto" : "preparation";
  const maps = [...facts.maps].sort((a, b) => a.order - b.order);
  const current = maps.find(map => map.completedAt === null);
  if (current && current.id === facts.gameplayMapId) return "gameplay";
  return maps.some(map => map.completedAt !== null) ? "inter_map" : "awaiting_gameplay";
}
