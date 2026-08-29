"use client";

import { useState } from "react";
import { CS2_POSITIONS } from "@/types/season";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PositionEditor({ value, disabled, onChange }: { value: string[]; disabled?: boolean; onChange: (value: string[]) => void }) {
  const [custom, setCustom] = useState("");
  const enabled = new Set(value);
  const add = () => {
    const next = custom.trim().toLowerCase();
    if (!next || enabled.has(next)) return;
    onChange([...value, next]);
    setCustom("");
  };
  return <div className="space-y-3">
    <Label>位置</Label>
    <div className="flex flex-wrap gap-2">
      {CS2_POSITIONS.map((position) => <label key={position} className="flex items-center gap-2 rounded border border-[var(--color-border)] px-3 py-2 text-sm">
        <input type="checkbox" checked={enabled.has(position)} disabled={disabled} onChange={() => onChange(enabled.has(position) ? value.filter((item) => item !== position) : [...value, position])} />
        {position}
      </label>)}
    </div>
    {value.filter((position) => !(CS2_POSITIONS as readonly string[]).includes(position)).length > 0 && <div className="flex flex-wrap gap-2">
      {value.filter((position) => !(CS2_POSITIONS as readonly string[]).includes(position)).map((position) => <span key={position} className="inline-flex items-center gap-2 rounded border border-[var(--color-border)] px-3 py-1.5 text-sm">{position}<Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(value.filter((item) => item !== position))}>删除</Button></span>)}
    </div>}
    <div className="flex gap-2"><Input aria-label="添加自定义位置" value={custom} disabled={disabled} onChange={(event) => setCustom(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} placeholder="添加自定义 position" /><Button type="button" variant="outline" disabled={disabled || !custom.trim()} onClick={add}>添加</Button></div>
  </div>;
}
