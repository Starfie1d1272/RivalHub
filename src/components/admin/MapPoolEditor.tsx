"use client";

import { useState } from "react";
import { DEFAULT_CS2_MAP_POOL, MAP_LABELS } from "@/types/season";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function MapPoolEditor({ value, disabled, onChange }: { value: string[]; disabled?: boolean; onChange: (value: string[]) => void }) {
  const [custom, setCustom] = useState("");
  const enabled = new Set(value);
  const add = () => {
    const next = custom.trim().toLowerCase();
    if (!/^de_[a-z0-9_]+$/.test(next) || enabled.has(next)) return;
    onChange([...value, next]);
    setCustom("");
  };
  return <div className="space-y-3"><Label>比赛图池</Label><div className="flex flex-wrap gap-2">
    {DEFAULT_CS2_MAP_POOL.map((map) => <label key={map} className="flex items-center gap-2 rounded border border-[var(--color-border)] px-3 py-2 text-sm"><input type="checkbox" checked={enabled.has(map)} disabled={disabled} onChange={() => onChange(enabled.has(map) ? value.filter((item) => item !== map) : [...value, map])} />{MAP_LABELS[map] ?? map}</label>)}
  </div>{value.filter((map) => !(DEFAULT_CS2_MAP_POOL as readonly string[]).includes(map)).length > 0 && <div className="flex flex-wrap gap-2">{value.filter((map) => !(DEFAULT_CS2_MAP_POOL as readonly string[]).includes(map)).map((map) => <span key={map} className="inline-flex items-center gap-2 rounded border border-[var(--color-border)] px-3 py-1.5 text-sm">{MAP_LABELS[map] ?? map}<Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(value.filter((item) => item !== map))}>删除</Button></span>)}</div>}
    <div className="flex gap-2"><Input aria-label="添加自定义地图" value={custom} disabled={disabled} onChange={(event) => setCustom(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} placeholder="de_custom_map" /><Button type="button" variant="outline" disabled={disabled || !/^de_[a-z0-9_]+$/.test(custom.trim().toLowerCase())} onClick={add}>添加</Button></div>
  </div>;
}
