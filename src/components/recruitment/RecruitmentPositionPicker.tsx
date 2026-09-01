"use client";

import React from "react";
import { CS2_POSITION_VALUES, type Cs2Position } from "@/lib/config/cs2-positions";

export function RecruitmentPositionPicker({ value, onChange, min = 0, max = CS2_POSITION_VALUES.length, label = "位置" }: { value: Cs2Position[]; onChange: (value: Cs2Position[]) => void; min?: number; max?: number; label?: string }) {
  function toggle(position: Cs2Position) {
    const selected = value.includes(position);
    if (selected && value.length <= min) return;
    if (!selected && value.length >= max) return;
    onChange(selected ? value.filter((item) => item !== position) : [...value, position]);
  }
  return <div className="space-y-2"><p className="text-sm font-medium">{label}</p><div className="flex flex-wrap gap-2">{CS2_POSITION_VALUES.map((position) => <button key={position} type="button" aria-pressed={value.includes(position)} onClick={() => toggle(position)} className={value.includes(position) ? "border border-[var(--color-accent-edge)] bg-[var(--color-accent-soft)] px-2.5 py-1 font-mono text-xs text-[var(--color-accent)]" : "border border-[var(--color-border)] px-2.5 py-1 font-mono text-xs text-[var(--color-fg-mid)] hover:border-[var(--color-border-hi)]"}>{position}</button>)}</div></div>;
}
