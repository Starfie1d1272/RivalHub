"use client";

import { useState } from "react";
import { CS2_MAP_CATALOG, CURRENT_CS2_ACTIVE_DUTY_MAP_POOL } from "@/types/season";
import { mapLabel } from "@/lib/maps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function MapPoolEditor({ value, disabled, onChange }: { value: string[]; disabled?: boolean; onChange: (value: string[]) => void }) {
  const [custom, setCustom] = useState("");
  const enabled = new Set(value);
  const activeDutyMapSet = new Set<string>(CURRENT_CS2_ACTIVE_DUTY_MAP_POOL);
  const activeDutyMaps = CS2_MAP_CATALOG.filter(({ key }) => activeDutyMapSet.has(key));
  const otherCatalogMaps = CS2_MAP_CATALOG.filter(({ key }) => !activeDutyMapSet.has(key));
  const catalogKeys = new Set<string>(CS2_MAP_CATALOG.map(({ key }) => key));
  const customMaps = value.filter((map) => !catalogKeys.has(map));

  const add = () => {
    const next = custom.trim().toLowerCase();
    if (!/^de_[a-z0-9_]+$/.test(next) || enabled.has(next)) return;
    onChange([...value, next]);
    setCustom("");
  };

  const toggleMap = (map: string) => onChange(
    enabled.has(map) ? value.filter((item) => item !== map) : [...value, map],
  );

  const renderCatalogMap = ({ key, label }: (typeof CS2_MAP_CATALOG)[number]) => (
    <label key={key} className="flex items-center gap-2 rounded border border-[var(--color-border)] px-3 py-2 text-sm">
      <input type="checkbox" checked={enabled.has(key)} disabled={disabled} onChange={() => toggleMap(key)} />
      {label}
    </label>
  );

  return (
    <div className="space-y-3">
      <Label>比赛图池</Label>
      <div className="space-y-2">
        <p className="text-xs text-[var(--color-fg-dim)]">当前 Active Duty（可作为默认候选）</p>
        <div className="flex flex-wrap gap-2">{activeDutyMaps.map(renderCatalogMap)}</div>
        <p className="text-xs text-[var(--color-fg-dim)]">稳定地图目录中的其它地图</p>
        <div className="flex flex-wrap gap-2">{otherCatalogMaps.map(renderCatalogMap)}</div>
      </div>
      {customMaps.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {customMaps.map((map) => (
            <span key={map} className="inline-flex items-center gap-2 rounded border border-[var(--color-border)] px-3 py-1.5 text-sm">
              {mapLabel(map)}
              <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(value.filter((item) => item !== map))}>删除</Button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input aria-label="添加自定义地图" value={custom} disabled={disabled} onChange={(event) => setCustom(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} placeholder="de_custom_map" />
        <Button type="button" variant="outline" disabled={disabled || !/^de_[a-z0-9_]+$/.test(custom.trim().toLowerCase())} onClick={add}>添加</Button>
      </div>
    </div>
  );
}
