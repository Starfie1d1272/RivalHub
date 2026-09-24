"use client";
import React, { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const WIDTH = 288;
const EDGE = 12;
const GAP = 8;
const ESTIMATED_HEIGHT = 88;

export function StatsTooltip({
  label,
  content,
  className = "",
}: {
  label: string;
  content: ReactNode;
  className?: string;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; above: boolean } | null>(null);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(WIDTH, Math.max(0, window.innerWidth - EDGE * 2));
    const centered = rect.left + rect.width / 2 - width / 2;
    const left = Math.max(EDGE, Math.min(centered, window.innerWidth - width - EDGE));
    const above = rect.bottom + GAP + ESTIMATED_HEIGHT > window.innerHeight && rect.top > ESTIMATED_HEIGHT + GAP;
    setPosition({ left, top: above ? rect.top - GAP : rect.bottom + GAP, above });
  }, []);

  const show = useCallback(() => {
    place();
    setOpen(true);
  }, [place]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={() => setOpen(false)}
        onFocus={show}
        onBlur={() => setOpen(false)}
        onClick={show}
        className={`inline-flex h-3.5 min-w-2 items-center justify-center text-[10px] font-medium leading-none text-[var(--color-fg-dim)] transition-colors hover:text-[var(--color-fg)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--color-accent)] ${className}`}
      >
        ?
      </button>
      {open && position && typeof document !== "undefined" && createPortal(
        <div
          id={id}
          role="tooltip"
          className="pointer-events-none fixed z-[200] w-72 max-w-[calc(100vw-24px)] border border-[var(--color-border-hi)] bg-[var(--color-panel-hi)] px-3 py-2 text-left text-xs font-normal normal-case leading-5 tracking-normal text-[var(--color-fg)] shadow-lg"
          style={{
            left: position.left,
            top: position.top,
            transform: position.above ? "translateY(-100%)" : undefined,
          }}
        >
          {content}
        </div>,
        document.body,
      )}
    </>
  );
}
