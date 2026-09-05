import React, { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export type PageLayoutVariant = "narrow" | "standard" | "wide" | "workbench";

const PAGE_LAYOUT_WIDTHS: Record<PageLayoutVariant, string> = {
  narrow: "max-w-3xl",
  standard: "max-w-5xl",
  wide: "max-w-7xl",
  workbench: "max-w-[1600px]",
};

interface PageLayoutProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  variant?: PageLayoutVariant;
  as?: "main" | "div" | "section";
}

/** Shared page gutter and width contract for public and operator workflows. */
export function PageLayout({
  children,
  className,
  variant = "standard",
  as = "main",
  ...props
}: PageLayoutProps) {
  const Component = as;
  return (
    <Component
      className={cn(
        "mx-auto w-full px-4 py-8 sm:px-6 lg:px-8",
        PAGE_LAYOUT_WIDTHS[variant],
        className,
      )}
      data-layout-variant={variant}
      {...props}
    >
      {children}
    </Component>
  );
}

interface SectionProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
}

/** A task-focused section with a predictable vertical rhythm. */
export function Section({ children, className, ...props }: SectionProps) {
  return (
    <section className={cn("space-y-3", className)} {...props}>
      {children}
    </section>
  );
}
