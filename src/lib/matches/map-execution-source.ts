import { interpretMapExecutionEvidence } from "./map-execution-evidence";

/** Interpret durable Mizar observations conservatively, including display-only events. */
export function mapExecutionEvidenceFromSources(
  maps: readonly { id: string; mapName: string; startedAt: Date | null; completedAt: Date | null }[],
  sessions: readonly { currentMapId: string | null; mapExecutionPhase: string }[],
  history: readonly { action: string; meta: unknown }[],
) {
  const observed = new Set<string>();
  for (const session of sessions) if (session.currentMapId && session.mapExecutionPhase === "gameplay") observed.add(session.currentMapId);
  for (const row of history) {
    const meta = row.meta as Record<string, unknown> | null;
    if (!meta) continue;
    if (row.action === "mizar.reliable.accept" && !["map_started", "map_ended"].includes(String(meta.kind))) continue;
    for (const map of maps) if (meta.mapId === map.id || meta.receivedMapId === map.id || meta.receivedMapName === map.mapName) observed.add(map.id);
  }
  return interpretMapExecutionEvidence(maps, observed);
}
