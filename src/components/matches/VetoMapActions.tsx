"use client";

import React, { useRef, useState } from "react";
import { Check, Minus, Plus } from "lucide-react";
import { mapThumbnail } from "@/lib/map-thumbnail";
import { Button } from "@/components/ui/button";

const ACTION_STYLE = {
  ban: { ink: "text-[var(--color-danger)]", selected: "border-[var(--color-danger)] ring-1 ring-[var(--color-danger)]", confirm: "border-[var(--color-danger-edge)] text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]" },
  pick: { ink: "text-[var(--color-ok)]", selected: "border-[var(--color-ok)] ring-1 ring-[var(--color-ok)]", confirm: "border-[var(--color-ok-edge)] text-[var(--color-ok)] hover:bg-[var(--color-ok-soft)]" },
};

/** Parent keys this by revision + turn so an old choice cannot cross turns. */
export function VetoMapActions({ action, maps, disabled, onConfirm }: {
  action: "ban" | "pick"; maps: { name: string; label: string }[]; disabled: boolean; onConfirm: (mapName: string) => void;
}) {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const selected = maps.find(map => map.name === selectedName);
  const verb = action === "ban" ? "禁用" : "选取";
  const style = ACTION_STYLE[action];
  const ActionIcon = action === "ban" ? Minus : Plus;
  return <div className="space-y-3">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={`${verb}地图`}>
      {maps.map(map => {
        const chosen = selectedName === map.name;
        const thumbnail = mapThumbnail(map.name);
        return <Button ref={element => { buttons.current[map.name] = element; }} key={map.name} variant="outline"
          aria-label={`${verb} ${map.label}`} disabled={disabled} aria-pressed={chosen} onClick={() => setSelectedName(map.name)}
          className={`group relative h-20 min-w-0 overflow-hidden rounded-sm p-3 text-left text-[var(--color-fg)] hover:text-[var(--color-fg)] ${chosen ? style.selected : "border-[var(--color-border)]"}`}>
          {thumbnail && <span aria-hidden className="absolute inset-0 bg-cover bg-center opacity-40 transition-opacity group-hover:opacity-60" style={{ backgroundImage: `url("${thumbnail}")` }} />}
          <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-[var(--color-bg)] via-[var(--color-panel-low)]/50 to-transparent" />
          <span className="relative flex w-full items-end justify-between gap-2 self-stretch">
            <span className="min-w-0"><span className={`mb-1 flex items-center gap-1 font-mono text-[10px] tracking-widest ${style.ink}`}><ActionIcon aria-hidden className="!size-3" />{action.toUpperCase()}</span><span className="block truncate text-base font-semibold">{map.label}</span></span>
            {chosen && <Check aria-hidden className={style.ink} />}
          </span>
        </Button>;
      })}
    </div>
    {selected && <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-3" role="group" aria-label={`确认${verb}地图`}>
      <p className="text-sm"><span className="text-[var(--color-fg-mid)]">{verb}地图</span><strong className="ml-2">{selected.label}</strong></p>
      <div className="flex gap-2">
        <Button variant="ghost" disabled={disabled} onClick={() => { setSelectedName(null); buttons.current[selected.name]?.focus(); }}>取消</Button>
        <Button autoFocus variant="outline" className={style.confirm} disabled={disabled} onClick={() => { setSelectedName(null); onConfirm(selected.name); }}>确认{verb} {selected.label}</Button>
      </div>
    </div>}
    {disabled && <p role="status" className="text-sm text-[var(--color-fg-mid)]">当前不可操作，等待本轮状态更新。</p>}
  </div>;
}
