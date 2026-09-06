"use client";

import React, { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveMapPreferences } from "@/actions/competitive-profile";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/rivalhub";
import { MapPreferenceSection } from "@/components/register/MapPreferenceSection";
import {
  CS2_MAP_CATALOG,
  CURRENT_CS2_ACTIVE_DUTY_MAP_POOL,
  type MapPreference,
  type MapPreferenceDraft,
  type MapPreferenceLevel,
} from "@/types/season";
import { projectMapPreferences, toMapPreferenceFacts } from "@/lib/maps";

export function MapPreferencesForm({ initialPreferences }: { initialPreferences: MapPreference[] }) {
  const [preferences, setPreferences] = useState<MapPreferenceDraft[]>(() =>
    projectMapPreferences(initialPreferences, CS2_MAP_CATALOG.map(({ key }) => key)),
  );
  const [showOtherMaps, setShowOtherMaps] = useState(false);
  const [pending, startTransition] = useTransition();
  const activeMaps = CURRENT_CS2_ACTIVE_DUTY_MAP_POOL;
  const activeMapSet = useMemo(() => new Set<string>(activeMaps), [activeMaps]);
  const otherMaps = useMemo(
    () => CS2_MAP_CATALOG.map(({ key }) => key).filter((map) => !activeMapSet.has(map)),
    [activeMapSet],
  );
  const filledOtherMaps = useMemo(
    () => otherMaps.filter((map) => preferences.some((preference) => preference.map === map && preference.level !== null)),
    [otherMaps, preferences],
  );
  const visibleOtherMaps = showOtherMaps ? otherMaps : filledOtherMaps;
  const hiddenOtherMapCount = otherMaps.length - filledOtherMaps.length;

  function setMapLevel(map: string, level: MapPreferenceLevel | null) {
    setPreferences((current) => current.map((preference) => (
      preference.map === map ? { map, level } : preference
    )));
  }

  function save() {
    startTransition(async () => {
      const result = await saveMapPreferences({ mapPreferences: toMapPreferenceFacts(preferences) });
      if (result.success) toast.success("地图熟练度已保存");
      else toast.error(result.error.message);
    });
  }

  return (
    <Panel contentClassName="p-5">
      <div className="space-y-5">
        <div>
          <p className="text-sm text-[var(--color-fg-mid)]">
            长期地图资料与赛事无关，只记录你明确填写过的地图；地图轮换不会删除历史熟练度。
          </p>
        </div>
        <MapPreferenceSection
          title="当前 Active Duty"
          mapPool={activeMaps}
          mapPreferences={preferences}
          error={null}
          showRequirements={false}
          onSetMapLevel={setMapLevel}
        />
        {visibleOtherMaps.length > 0 ? (
          <MapPreferenceSection
            title="其它地图"
            mapPool={visibleOtherMaps}
            mapPreferences={preferences}
            error={null}
            showRequirements={false}
            onSetMapLevel={setMapLevel}
          />
        ) : (
          <p className="rounded border border-[var(--color-border)] bg-[var(--color-panel-hi)] px-3 py-2 text-xs text-[var(--color-fg-dim)]">
            其它地图暂未填写；展开后可以补充 Train、Overpass、Vertigo 等历史地图。
          </p>
        )}
        {(showOtherMaps || hiddenOtherMapCount > 0) && (
          <Button type="button" variant="outline" onClick={() => setShowOtherMaps((current) => !current)}>
            {showOtherMaps ? "收起其它地图" : `展开其它地图（${hiddenOtherMapCount}）`}
          </Button>
        )}
        <Button type="button" disabled={pending} onClick={save}>
          {pending ? "保存中…" : "保存地图熟练度"}
        </Button>
      </div>
    </Panel>
  );
}
