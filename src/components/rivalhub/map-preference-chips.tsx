import React from "react";
import { mapLabel, mapPreferenceLabel, mapPreferenceWeight } from "@/lib/maps";
import type { MapPreference } from "@/types/season";

interface MapPreferenceChipsProps {
  preferences: MapPreference[];
  compact?: boolean;
  minLevel?: "basic" | "playable";
}

const LEVEL_CLASS: Record<string, string> = {
  none: "border-[var(--color-border)] text-[var(--color-fg-dim)] opacity-55",
  basic: "border-[var(--color-border)] text-[var(--color-fg-mid)]",
  playable: "border-sky-500/35 bg-sky-500/10 text-sky-200",
  proficient: "border-emerald-500/35 bg-emerald-500/10 text-emerald-200",
  strong: "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent)]",
};

export function MapPreferenceChips({
  preferences,
  compact = false,
  minLevel = "basic",
}: MapPreferenceChipsProps) {
  const threshold = mapPreferenceWeight(minLevel);
  const visible = preferences
    .filter((preference) => mapPreferenceWeight(preference.level) >= threshold)
    .sort((a, b) => mapPreferenceWeight(b.level) - mapPreferenceWeight(a.level));

  if (visible.length === 0) {
    return <span className="text-xs text-[var(--color-fg-dim)]">暂无地图偏好</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map((preference) => (
        <span
          key={preference.map}
          className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-medium ${compact ? "text-[10px]" : "text-xs"} ${LEVEL_CLASS[preference.level]}`}
        >
          <span>{mapLabel(preference.map)}</span>
          {!compact && <span className="opacity-75">{mapPreferenceLabel(preference.level)}</span>}
        </span>
      ))}
    </div>
  );
}
