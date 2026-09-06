import React from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";

export interface PanelProps {
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  hi?: boolean;
  label?: React.ReactNode;
  hoverable?: boolean;
  teamColor?: string;
}

export function Panel({
  children,
  className,
  contentClassName,
  hi,
  label,
  hoverable,
  teamColor,
}: PanelProps) {
  return (
    <Card
      className={cn(
        hoverable && "transition-all duration-[var(--duration-normal)] ease-[var(--ease-tactical)] hover:-translate-y-0.5 hover:border-[var(--color-border-hover)] hover:shadow-[0_4px_20px_color-mix(in_srgb,var(--color-accent)_3%,transparent)]",
        className
      )}
      style={{
        background: hi ? "var(--color-panel-hi)" : "var(--color-panel)",
        ...(teamColor ? { borderTop: `3px solid ${teamColor}` } : {}),
      }}
    >
      {label && (
        <CardHeader
          className="flex flex-row items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)]"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "var(--tracking-label)",
            color: "var(--color-fg-mid)",
            textTransform: "uppercase",
          }}
        >
          {typeof label === "string" ? <span>{label}</span> : label}
        </CardHeader>
      )}
      <div className={cn("p-4", contentClassName)}>{children}</div>
    </Card>
  );
}
