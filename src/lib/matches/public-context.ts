import type { MatchPresentationPhase } from "./presentation-phase";

export interface PublicCompletedMap {
  id: string;
  mapName: string;
  scoreA: number;
  scoreB: number;
}

export interface PublicMatchContext {
  phase: MatchPresentationPhase;
  currentMapId: string | null;
  lastCompletedMap?: PublicCompletedMap | null;
  seriesProgress: { scoreA: number; scoreB: number } | null;
}
