import React from "react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { mapLabel } from "@/lib/maps";

export interface MatchMapTab {
  id: string;
  mapName: string;
  pickedByEntryId: string | null;
  scoreA: number | null;
  scoreB: number | null;
}

interface MatchMapTabsNavigationProps {
  maps: readonly MatchMapTab[];
  showSummaryTab: boolean;
  teamAId: string;
  teamBId: string;
  teamAName?: string | null;
  teamBName?: string | null;
}

export function MatchMapTabsNavigation({
  maps,
  showSummaryTab,
  teamAId,
  teamBId,
  teamAName,
  teamBName,
}: MatchMapTabsNavigationProps) {
  return (
    <div className="w-full min-w-0 max-w-full overflow-x-auto">
      <TabsList className="w-max justify-start">
        {showSummaryTab && (
          <TabsTrigger value="summary" className="text-xs">
            整场汇总
          </TabsTrigger>
        )}
        {maps.map((map) => (
          <TabsTrigger key={map.id} value={map.id} className="text-xs">
            {mapLabel(map.mapName)}
            <span className="ml-1 font-mono tabular-nums">
              {map.scoreA !== null && map.scoreB !== null ? `${map.scoreA}:${map.scoreB}` : "—"}
            </span>
            {map.pickedByEntryId && (
              <span
                title={`${map.pickedByEntryId === teamAId ? teamAName : map.pickedByEntryId === teamBId ? teamBName : "队伍"} 选图`}
                className="ml-1 text-[10px] font-mono px-1 py-0.5"
                style={{ background: "var(--color-ok-soft)", color: "var(--color-ok)" }}
              >
                选图
              </span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
    </div>
  );
}
