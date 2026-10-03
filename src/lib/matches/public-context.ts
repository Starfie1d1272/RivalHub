import type { MatchPresentationPhase } from "./presentation-phase";

export interface PublicMatchContext {
  phase: MatchPresentationPhase;
  currentMapId: string | null;
  seriesProgress: { scoreA: number; scoreB: number } | null;
}
