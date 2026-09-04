import React from "react";
import { mapLabel, mapPreferenceLabel, mapPreferenceWeight } from "@/lib/maps";
import type { MapPreferenceDraft } from "@/types/season";

interface MapPreferenceChipsProps {
  preferences: readonly MapPreferenceDraft[];
  compact?: boolean;
  minLevel?: "none" | "basic" | "playable";
  showUnfilled?: boolean;
}

const LEVEL_CLASS: Record<string, string> = {
  none: "border-[var(--color-border)] text-[var(--color-fg-dim)] opacity-55",
  basic: "border-[var(--color-border)] text-[var(--color-fg-mid)]",
  playable: "border-[var(--color-info-edge)] bg-[var(--color-info-soft)] text-[var(--color-info)]",
  proficient: "border-[var(--color-ok-edge)] bg-[var(--color-ok-soft)] text-[var(--color-ok)]",
  strong: "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent)]",
};

export function MapPreferenceChips({
  preferences,
  compact = false,
  minLevel = "basic",
  showUnfilled = false,
}: MapPreferenceChipsProps) {
  const threshold = mapPreferenceWeight(minLevel);
  const visible = preferences
    .filter((preference) => preference.level !== null && mapPreferenceWeight(preference.level) >= threshold)
    .sort((a, b) => mapPreferenceWeight(b.level ?? "none") - mapPreferenceWeight(a.level ?? "none"));
  const unfilledCount = preferences.filter((preference) => preference.level === null).length;

  if (visible.length === 0) {
    return (
      <span className="text-xs text-[var(--color-fg-dim)]">
        {showUnfilled && (unfilledCount > 0 || preferences.length === 0)
          ? "未填写地图熟练度"
          : "暂无地图偏好"}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map((preference) => (
        <span
          key={preference.map}
          className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-medium ${compact ? "text-[10px]" : "text-xs"} ${LEVEL_CLASS[preference.level ?? "none"]}`}
        >
          <span>{mapLabel(preference.map)}</span>
          {!compact && <span className="opacity-75">{mapPreferenceLabel(preference.level ?? "none")}</span>}
        </span>
      ))}
      {showUnfilled && unfilledCount > 0 && (
        <span className="inline-flex items-center rounded border border-dashed border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-fg-dim)]">
          未填写 {unfilledCount} 张
        </span>
      )}
    </div>
  );
}
