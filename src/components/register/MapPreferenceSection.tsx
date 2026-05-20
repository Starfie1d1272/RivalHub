import React, { type ReactNode } from "react";
import { MAP_PREFERENCE_LABELS, MAP_PREFERENCE_LEVELS, type MapPreferenceLevel } from "@/types/season";
import { mapLabel } from "@/lib/maps";
import { RegistrationSectionTitle } from "./RegistrationSectionTitle";

interface MapPreferenceSectionProps {
  mapPool: string[];
  mapPreferences: { map: string; level: MapPreferenceLevel }[];
  playableCount: number;
  strongCount: number;
  error: ReactNode;
  onSetMapLevel: (map: string, level: MapPreferenceLevel) => void;
}

export function MapPreferenceSection({
  mapPool,
  mapPreferences,
  playableCount,
  strongCount,
  error,
  onSetMapLevel,
}: MapPreferenceSectionProps) {
  return (
    <section>
      <RegistrationSectionTitle>地图熟练度</RegistrationSectionTitle>
      <div className="mb-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-panel-hi)] px-3 py-2">
          <div className="font-mono text-[var(--color-fg-dim)]">PLAYABLE</div>
          <div className="mt-1 text-sm font-semibold text-[var(--color-fg)]">{playableCount}/3+</div>
        </div>
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-panel-hi)] px-3 py-2">
          <div className="font-mono text-[var(--color-fg-dim)]">STRONG</div>
          <div className="mt-1 text-sm font-semibold text-[var(--color-fg)]">{strongCount}/3</div>
        </div>
        <div className="col-span-2 rounded border border-[var(--color-border)] bg-[var(--color-panel-hi)] px-3 py-2 text-[var(--color-fg-mid)]">
          每张图选择一个档位；至少 3 张达到「能打」，「强图」最多 3 张。
        </div>
      </div>

      <div className="space-y-2">
        {mapPool.map((map) => {
          const currentLevel =
            mapPreferences.find((preference) => preference.map === map)?.level ?? "basic";
          return (
            <div
              key={map}
              className="grid gap-2 rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-2 sm:grid-cols-[96px_1fr]"
            >
              <div className="flex items-center text-sm font-semibold text-[var(--color-fg)]">
                {mapLabel(map)}
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-1">
                {MAP_PREFERENCE_LEVELS.map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => onSetMapLevel(map, level)}
                    className={`min-h-9 rounded border px-1 text-xs font-medium transition-colors ${
                      currentLevel === level
                        ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
                        : "border-[var(--color-border)] bg-[var(--color-panel-hi)] text-[var(--color-fg-mid)] hover:text-[var(--color-fg)]"
                    }`}
                  >
                    {MAP_PREFERENCE_LABELS[level]}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {error}
      </div>
    </section>
  );
}
