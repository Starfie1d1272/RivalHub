"use client";

import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

const ACTION_STYLE = {
  ban: "border-[var(--color-danger)] bg-[var(--color-danger-soft)] text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)] focus-visible:ring-[var(--color-danger)]",
  pick: "border-[var(--color-ok)] bg-[var(--color-ok-soft)] text-[var(--color-ok)] hover:bg-[var(--color-ok-soft)] hover:text-[var(--color-ok)] focus-visible:ring-[var(--color-ok)]",
};

/** Parent keys this by revision + turn so an old choice cannot cross turns. */
export function VetoMapActions({ action, maps, disabled, onConfirm }: {
  action: "ban" | "pick"; maps: { name: string; label: string }[]; disabled: boolean; onConfirm: (mapName: string) => void;
}) {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const selected = maps.find(map => map.name === selectedName);
  const verb = action === "ban" ? "禁用" : "选取";
  return <div className="space-y-3">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label={`${verb}地图`}>
      {maps.map(map => <Button ref={element => { buttons.current[map.name] = element; }} key={map.name} variant="outline" className={ACTION_STYLE[action]} disabled={disabled} aria-pressed={selectedName === map.name} onClick={() => setSelectedName(map.name)}>{verb} {map.label}</Button>)}
    </div>
    {selected && <div className="min-w-0 space-y-2 rounded border border-[var(--color-border)] p-3" role="group" aria-label={`确认${verb}地图`}>
      <p className="text-sm font-semibold">确认{verb} {selected.label}？</p>
      <p className="text-xs text-[var(--color-fg-mid)]">{action === "ban" ? "该地图将移出本场可选地图池。" : "该地图将作为本场比赛地图。"}</p>
      <div className="flex flex-wrap gap-2">
        <Button autoFocus variant="outline" className={ACTION_STYLE[action]} disabled={disabled} onClick={() => { setSelectedName(null); onConfirm(selected.name); }}>确认{verb} {selected.label}</Button>
        <Button variant="ghost" disabled={disabled} onClick={() => { setSelectedName(null); buttons.current[selected.name]?.focus(); }}>取消</Button>
      </div>
    </div>}
    {disabled && <p role="status" className="text-sm text-[var(--color-fg-mid)]">当前不可操作，等待本轮状态更新。</p>}
  </div>;
}
