"use client";
import Link from "next/link";
import { type AnchorHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface PlayerProfileLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  userId: string;
  children: ReactNode;
  variant?: "inherit" | "dense" | "subtle";
  stopPropagation?: boolean;
}

/** Public identity navigation; render beside, never inside, a primary control. */
export function PlayerProfileLink({ userId, children, className, variant = "inherit", stopPropagation = false, onClick, onKeyDown, ...props }: PlayerProfileLinkProps) {
  return <Link href={`/players/${encodeURIComponent(userId)}`} className={cn(
    "transition-colors hover:text-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] focus-visible:ring-offset-2",
    variant === "dense" && "inline-flex min-h-6 min-w-6 items-center justify-center",
    variant === "subtle" && "text-[var(--color-fg-mid)]",
    className,
  )} onClick={event => { if (stopPropagation) event.stopPropagation(); onClick?.(event); }} onKeyDown={event => { if (stopPropagation) event.stopPropagation(); onKeyDown?.(event); }} {...props}>
    {children}
  </Link>;
}
