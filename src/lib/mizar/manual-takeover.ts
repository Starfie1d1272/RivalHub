/** A reported collection failure can recover only the first unfinished official map. */
export function canTakeOverReportedMap(
  maps: readonly { id: string; mapOrder: number; completedAt: Date | null }[],
  mapId: string,
  currentMapId: string | null,
): boolean {
  const nextMap = [...maps]
    .sort((a, b) => a.mapOrder - b.mapOrder)
    .find((map) => map.completedAt === null);
  if (nextMap?.id !== mapId) return false;
  if (currentMapId === null || currentMapId === mapId) return true;
  return maps.some(
    (map) => map.id === currentMapId && map.completedAt !== null && map.mapOrder < nextMap.mapOrder,
  );
}
