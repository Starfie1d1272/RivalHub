"use client";

import React from "react";
import { cn } from "@/lib/utils/cn";
import type { ReactNode } from "react";

const SCROLL_EPSILON = 2;

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
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = React.useState(false);
  const [canScrollRight, setCanScrollRight] = React.useState(false);

  const updateScrollState = React.useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;

    const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
    const nextCanScrollLeft = container.scrollLeft > SCROLL_EPSILON;
    const nextCanScrollRight = maxScrollLeft > SCROLL_EPSILON
      && container.scrollLeft < maxScrollLeft - SCROLL_EPSILON;

    setCanScrollLeft((current) => current === nextCanScrollLeft ? current : nextCanScrollLeft);
    setCanScrollRight((current) => current === nextCanScrollRight ? current : nextCanScrollRight);
  }, []);

  React.useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const handleScroll = () => updateScrollState();
    updateScrollState();
    container.addEventListener("scroll", handleScroll, { passive: true });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(updateScrollState);
      resizeObserver.observe(container);
      for (const child of Array.from(container.children)) {
        resizeObserver.observe(child);
      }
    }

    return () => {
      container.removeEventListener("scroll", handleScroll);
      resizeObserver?.disconnect();
    };
  }, [children, updateScrollState]);

  return (
    <div className={cn("relative", className)}>
      {canScrollLeft && (
        <div
          aria-hidden="true"
          data-scroll-hint="left"
          className="pointer-events-none absolute left-0 top-0 bottom-0 z-10 w-6"
          style={{ background: `linear-gradient(to right, ${fromColor}, transparent)` }}
        />
      )}
      {canScrollRight && (
        <div
          aria-hidden="true"
          data-scroll-hint="right"
          className="pointer-events-none absolute right-0 top-0 bottom-0 z-10 w-6"
          style={{ background: `linear-gradient(to left, ${fromColor}, transparent)` }}
        />
      )}
      <div ref={scrollRef} className="overflow-x-auto">{children}</div>
    </div>
  );
}
