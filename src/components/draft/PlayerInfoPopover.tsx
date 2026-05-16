"use client";

import React, { useCallback, useRef, useState } from "react";
import { Info } from "lucide-react";

interface PlayerInfoPopoverProps {
  gameplayStyle: string | null;
  notes: string | null;
  competitionHistory: string | null;
}

export function PlayerInfoPopover({ gameplayStyle, notes, competitionHistory }: PlayerInfoPopoverProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const iconRef = useRef<HTMLButtonElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const sections = [
    { value: gameplayStyle?.trim(), label: "风格" },
    { value: notes?.trim(), label: "备注" },
    { value: competitionHistory?.trim(), label: "经历" },
  ].filter((s) => s.value);

  const show = useCallback(() => {
    clearTimeout(timerRef.current);
    if (iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect();
      setPos({
        top: rect.top - 8,
        left: Math.min(rect.left + rect.width / 2, window.innerWidth - 280),
      });
      setOpen(true);
    }
  }, []);

  const hide = useCallback(() => {
    timerRef.current = setTimeout(() => setOpen(false), 150);
  }, []);

  if (sections.length === 0) return null;

  return (
    <>
      <button
        ref={iconRef}
        type="button"
        className="shrink-0 inline-flex items-center justify-center rounded-full transition-colors"
        style={{ width: 18, height: 18 }}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        aria-label="选手详细信息"
      >
        <Info className="size-3.5 text-[var(--color-fg-dim)] hover:text-[var(--color-accent)]" />
      </button>

      {open && (
        <div
          role="tooltip"
          className="fixed z-[100] w-64 p-3 rounded-md border shadow-lg text-xs leading-relaxed"
          style={{
            top: pos.top,
            left: pos.left,
            transform: "translateY(-100%)",
            background: "var(--color-panel)",
            borderColor: "var(--color-border)",
            color: "var(--color-fg)",
          }}
          onMouseEnter={() => clearTimeout(timerRef.current)}
          onMouseLeave={hide}
        >
          <div className="space-y-2">
            {sections.map(({ value, label }) => (
              <div key={label}>
                <span className="font-semibold text-[var(--color-accent)]">{label} </span>
                <span className="text-[var(--color-fg-mid)]">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
