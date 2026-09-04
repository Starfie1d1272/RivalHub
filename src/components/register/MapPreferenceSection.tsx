import React, { type ReactNode } from "react";
import { MAP_PREFERENCE_LABELS, MAP_PREFERENCE_LEVELS, type MapPreferenceDraft, type MapPreferenceLevel } from "@/types/season";
import { mapLabel } from "@/lib/maps";
import { RegistrationSectionTitle } from "./RegistrationSectionTitle";

interface MapPreferenceSectionProps {
  mapPool: readonly string[];
  mapPreferences: readonly MapPreferenceDraft[];
  playableCount?: number;
  strongCount?: number;
  error?: ReactNode;
  onSetMapLevel: (map: string, level: MapPreferenceLevel | null) => void;
  title?: ReactNode;
  showRequirements?: boolean;
}

export function MapPreferenceSection({
  mapPool,
  mapPreferences,
  playableCount = 0,
  strongCount = 0,
  error,
  onSetMapLevel,
  title = "地图熟练度",
  showRequirements = true,
}: MapPreferenceSectionProps) {
  return (
    <section>
      <RegistrationSectionTitle>{title}</RegistrationSectionTitle>
      {showRequirements ? (
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
      ) : (
        <p className="mb-4 rounded border border-[var(--color-border)] bg-[var(--color-panel-hi)] px-3 py-2 text-xs text-[var(--color-fg-mid)]">
          只保存你明确填写的长期事实；「未填写」不会生成资料，「不会」表示明确声明。
        </p>
      )}

      <div className="space-y-2">
        {mapPool.map((map) => {
          const currentLevel = mapPreferences.find((preference) => preference.map === map)?.level ?? null;
          return (
            <div
              key={map}
              className="grid gap-2 rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-2 sm:grid-cols-[96px_1fr]"
            >
              <div className="flex items-center text-sm font-semibold text-[var(--color-fg)]">
                {mapLabel(map)}
              </div>
              <div className="grid grid-cols-3 gap-1 sm:grid-cols-6">
                <button
                  type="button"
                  aria-pressed={currentLevel === null}
                  onClick={() => onSetMapLevel(map, null)}
                  className={`min-h-9 rounded border px-1 text-xs font-medium transition-colors ${
                    currentLevel === null
                      ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                      : "border-[var(--color-border)] bg-[var(--color-panel-hi)] text-[var(--color-fg-mid)] hover:text-[var(--color-fg)]"
                  }`}
                >
                  未填写
                </button>
                {MAP_PREFERENCE_LEVELS.map((level) => (
                  <button
                    key={level}
                    type="button"
                    aria-pressed={currentLevel === level}
                    onClick={() => onSetMapLevel(map, level)}
                    className={`min-h-9 rounded border px-1 text-xs font-medium transition-colors ${
                      currentLevel === level
                        ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
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
