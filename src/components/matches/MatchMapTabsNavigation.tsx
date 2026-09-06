import React from "react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { mapLabel } from "@/lib/maps";

export interface MatchMapTab {
  id: string;
  mapName: string;
  pickedByEntryId: string | null;
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
            {map.pickedByEntryId && (
              <span
                className="ml-1 text-[10px] font-mono px-1 py-0.5"
                style={{ background: "var(--color-ok-soft)", color: "var(--color-ok)" }}
              >
                {map.pickedByEntryId === teamAId
                  ? teamAName?.slice(0, 3).toUpperCase()
                  : map.pickedByEntryId === teamBId
                    ? teamBName?.slice(0, 3).toUpperCase()
                    : null} {" "}
                PICK
              </span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
    </div>
  );
}
