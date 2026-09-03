"use client";

import React, { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveMapPreferences } from "@/actions/competitive-profile";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/rivalhub";
import { MapPreferenceSection } from "@/components/register/MapPreferenceSection";
import { DEFAULT_CS2_MAP_POOL, type MapPreference, type MapPreferenceLevel } from "@/types/season";
import { normalizeMapPreferences, PLAYABLE_MAP_LEVELS } from "@/lib/maps";

export function MapPreferencesForm({ initialPreferences }: { initialPreferences: MapPreference[] }) {
  const [preferences, setPreferences] = useState<MapPreference[]>(() => normalizeMapPreferences(initialPreferences, DEFAULT_CS2_MAP_POOL));
  const [pending, startTransition] = useTransition();

  const playableCount = preferences.filter((preference) => PLAYABLE_MAP_LEVELS.has(preference.level)).length;
  const strongCount = preferences.filter((preference) => preference.level === "strong").length;

  function setMapLevel(map: string, level: MapPreferenceLevel) {
    setPreferences((prev) => prev.map((preference) => (preference.map === map ? { map, level } : preference)));
  }

  return (
    <Panel pad={20}>
      <div className="space-y-5">
        <MapPreferenceSection
          mapPool={[...DEFAULT_CS2_MAP_POOL]}
          mapPreferences={preferences}
          playableCount={playableCount}
          strongCount={strongCount}
          error={null}
          onSetMapLevel={setMapLevel}
        />
        <Button
          type="button"
          disabled={pending}
          onClick={() => startTransition(async () => {
            const result = await saveMapPreferences({ mapPreferences: preferences });
            if (result.success) toast.success("地图熟练度已保存");
            else toast.error(result.error.message);
          })}
        >
          {pending ? "保存中…" : "保存地图熟练度"}
        </Button>
      </div>
    </Panel>
  );
}
