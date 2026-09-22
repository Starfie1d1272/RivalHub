import Link from "next/link";
import React, { type AnchorHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface PlayerProfileLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  userId: string;
  children: ReactNode;
}

/** Narrow public-safe identity affordance. Contact details never belong here. */
export function PlayerProfileLink({ userId, children, className, ...props }: PlayerProfileLinkProps) {
  return (
    <Link
      href={`/players/${encodeURIComponent(userId)}`}
      className={cn(
        "transition-colors hover:text-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] focus-visible:ring-offset-2",
        className,
      )}
      {...props}
    >
      {children}
    </Link>
  );
}
