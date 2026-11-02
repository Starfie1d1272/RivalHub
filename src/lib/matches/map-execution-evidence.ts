/** Canonical execution facts and source observations have different authority.
 * Absence of either is not proof that a map did not start. */
export interface MapExecutionEvidence {
  mapId: string;
  canonical: "completed" | "started" | "unrecorded";
  sourceObserved: boolean;
}

export function interpretMapExecutionEvidence(
  maps: readonly { id: string; startedAt: Date | null; completedAt: Date | null }[],
  observedMapIds: ReadonlySet<string>,
): MapExecutionEvidence[] {
  return maps.map(map => ({
    mapId: map.id,
    canonical: map.completedAt ? "completed" : map.startedAt ? "started" : "unrecorded",
    sourceObserved: observedMapIds.has(map.id),
  }));
}
