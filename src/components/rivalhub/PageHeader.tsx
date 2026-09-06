import React, { type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** Semantic page heading with responsive description, status, and actions. */
export function PageHeader({
  title,
  description,
  eyebrow,
  status,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 border-b border-[var(--color-border-static)] pb-5 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && (
          <p className="font-mono text-[11px] font-medium uppercase tracking-[var(--tracking-eyebrow)] text-[var(--color-accent)]">
            {eyebrow}
          </p>
        )}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--color-fg-primary)] sm:text-3xl">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-fg-secondary)]">
            {description}
          </p>
        )}
      </div>
      {(status || actions) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {status}
          {actions}
        </div>
      )}
    </header>
  );
}

export interface SectionHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  level?: "h2" | "h3";
  className?: string;
}

/** Semantic heading for a section; Marker remains available for compact markers. */
export function SectionHeader({
  title,
  description,
  action,
  level = "h2",
  className,
}: SectionHeaderProps) {
  const heading = level === "h3" ? (
    <h3 className="text-base font-semibold text-[var(--color-fg-primary)]">{title}</h3>
  ) : (
    <h2 className="text-lg font-semibold text-[var(--color-fg-primary)]">{title}</h2>
  );

  return (
    <header className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        {heading}
        {description && (
          <p className="mt-1 text-sm leading-6 text-[var(--color-fg-secondary)]">
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
