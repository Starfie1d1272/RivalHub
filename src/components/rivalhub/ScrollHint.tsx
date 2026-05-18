"use client";

import { cn } from "@/lib/utils/cn";
import type { ReactNode } from "react";

interface ScrollHintProps {
  children: ReactNode;
  className?: string;
  fromColor?: string;
}

export function ScrollHint({
  children,
  className,
  fromColor = "var(--color-bg)",
}: ScrollHintProps) {
  return (
    <div className={cn("relative", className)}>
      <div
        className="pointer-events-none absolute left-0 top-0 bottom-0 w-6 z-10"
        style={{ background: `linear-gradient(to right, ${fromColor}, transparent)` }}
      />
      <div
        className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 z-10"
        style={{ background: `linear-gradient(to left, ${fromColor}, transparent)` }}
      />
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}
