import React, { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

interface ListToolbarProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/** Responsive composition surface for list controls; it owns no filter schema. */
export function ListToolbar({ children, className, ...props }: ListToolbarProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-end gap-3 rounded-sm border border-[var(--color-border)] bg-[var(--color-panel)] p-4",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
