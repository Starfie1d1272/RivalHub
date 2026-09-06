"use client";

import { useRef } from "react";
import {
  ClearFilters,
  ListSearchField,
  ListToolbar,
  type ListSearchFieldHandle,
  useListQueryParams,
} from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { CS2_POSITION_VALUES, type Cs2Position } from "@/lib/config/cs2-positions";
import { mapLabel } from "@/lib/maps";
import type { RecruitmentFilters, RecruitmentTeamSize } from "@/lib/recruitment/contract";

const RECRUITMENT_QUERY_DEFAULTS = {
  q: "",
  position: "",
  event: "",
  size: "",
  map: "",
} as const;

const TEAM_SIZE_OPTIONS: Array<{ value: RecruitmentTeamSize; label: string }> = [
  { value: "small", label: "≤ 4 人" },
  { value: "medium", label: "5–6 人" },
  { value: "large", label: "≥ 7 人" },
];

const selectClassName = "h-10 min-w-0 max-w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-panel-low)] px-3 text-sm text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]";
const tabClassName = "min-w-0 flex-1 sm:flex-none";

interface RecruitmentLobbyControlsProps {
  view: "teams" | "players";
  normalizedFilters: RecruitmentFilters;
  targetSeasons: Array<{ id: string; name: string }>;
  mapOptions: string[];
  teamCount: number;
  playerCount: number;
}

function currentPosition(value: string | null, fallback: Cs2Position | undefined): Cs2Position | undefined {
  return CS2_POSITION_VALUES.includes(value as Cs2Position) ? value as Cs2Position : fallback;
}

function currentTeamSize(value: string | null, fallback: RecruitmentTeamSize | undefined): RecruitmentTeamSize | undefined {
  return TEAM_SIZE_OPTIONS.some((option) => option.value === value) ? value as RecruitmentTeamSize : fallback;
}

export function RecruitmentLobbyControls({
  view,
  normalizedFilters,
  targetSeasons,
  mapOptions,
  teamCount,
  playerCount,
}: RecruitmentLobbyControlsProps) {
  const { searchParams, update } = useListQueryParams({ routeBase: "/teams/recruitment", defaults: RECRUITMENT_QUERY_DEFAULTS });
  const searchFieldRef = useRef<ListSearchFieldHandle>(null);
  const position = currentPosition(searchParams.get("position"), normalizedFilters.position);
  const targetSeasonId = targetSeasons.some((season) => season.id === searchParams.get("event"))
    ? searchParams.get("event") ?? undefined
    : normalizedFilters.targetSeasonId;
  const teamSize = currentTeamSize(searchParams.get("size"), normalizedFilters.teamSize);
  const map = mapOptions.includes(searchParams.get("map") ?? "") ? searchParams.get("map") ?? undefined : normalizedFilters.map;

  function switchView(nextView: "teams" | "players") {
    update({ view: nextView, size: undefined, map: undefined });
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-y border-[var(--color-border)] py-3">
        <div className="flex min-w-0 flex-wrap gap-2" role="tablist" aria-label="组队大厅视图">
          <Button type="button" role="tab" aria-selected={view === "teams"} variant={view === "teams" ? "outline" : "ghost"} size="sm" className={tabClassName} onClick={() => switchView("teams")}>
            队伍招募 {teamCount}
          </Button>
          <Button type="button" role="tab" aria-selected={view === "players"} variant={view === "players" ? "outline" : "ghost"} size="sm" className={tabClassName} onClick={() => switchView("players")}>
            选手找队 {playerCount}
          </Button>
        </div>
        <p className="text-xs text-[var(--color-fg-dim)]">最近更新优先</p>
      </div>

      <ListToolbar aria-label="组队大厅搜索与筛选" className="items-start">
        <ListSearchField
          ref={searchFieldRef}
          queryKey="q"
          label={view === "teams" ? "搜索队伍" : "搜索选手"}
          placeholder={view === "teams" ? "队名 / 队长姓名…" : "公开姓名…"}
          value={searchParams.get("q") ?? normalizedFilters.q ?? ""}
          onDebouncedChange={(value) => update({ q: value })}
          className="min-w-0 w-full flex-1 basis-full lg:basis-[28%]"
        />
        <div className="min-w-0 w-full flex-1 basis-full lg:basis-[45%]">
          <span className="mb-1.5 block text-xs text-[var(--color-fg-mid)]">位置</span>
          <div className="flex min-w-0 flex-wrap gap-1.5" role="group" aria-label="招募位置">
            <Button type="button" size="sm" variant={!position ? "outline" : "ghost"} onClick={() => update({ position: undefined })}>全部</Button>
            {CS2_POSITION_VALUES.map((item) => (
              <Button key={item} type="button" size="sm" variant={position === item ? "outline" : "ghost"} onClick={() => update({ position: item })}>
                {item}
              </Button>
            ))}
          </div>
        </div>
        <label className="min-w-0 w-full flex-1 basis-full sm:basis-[calc(50%-0.75rem)] lg:basis-[25%]">
          <span className="mb-1.5 block text-xs text-[var(--color-fg-mid)]">目标赛事</span>
          <select
            aria-label="目标赛事"
            value={targetSeasonId ?? ""}
            onChange={(event) => update({ event: event.target.value, ...(view === "players" ? { map: undefined } : {}) })}
            className={selectClassName}
          >
            <option value="">全部赛事</option>
            {targetSeasons.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}
          </select>
        </label>
        {view === "teams" ? (
          <label className="min-w-0 w-full flex-1 basis-full sm:basis-[calc(50%-0.75rem)] lg:basis-[20%]">
            <span className="mb-1.5 block text-xs text-[var(--color-fg-mid)]">队伍规模</span>
            <select
              aria-label="队伍规模"
              value={teamSize ?? ""}
              onChange={(event) => update({ size: event.target.value })}
              className={selectClassName}
            >
              <option value="">全部规模</option>
              {TEAM_SIZE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        ) : (
          <label className="min-w-0 w-full flex-1 basis-full sm:basis-[calc(50%-0.75rem)] lg:basis-[20%]">
            <span className="mb-1.5 block text-xs text-[var(--color-fg-mid)]">地图熟练度</span>
            <select
              aria-label="地图熟练度"
              value={map ?? ""}
              onChange={(event) => update({ map: event.target.value })}
              className={selectClassName}
            >
              <option value="">全部地图</option>
              {mapOptions.map((item) => <option key={item} value={item}>{mapLabel(item)}</option>)}
            </select>
          </label>
        )}
        <ClearFilters
          defaults={RECRUITMENT_QUERY_DEFAULTS}
          keys={["q", "position", "event", "size", "map"]}
          searchParams={searchParams}
          onClear={(updates) => {
            searchFieldRef.current?.reset();
            update(updates);
          }}
        />
      </ListToolbar>
    </div>
  );
}
