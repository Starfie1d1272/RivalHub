"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils/cn";
import type { HeaderSeason } from "./Header.types";

interface HeaderNavigationProps {
  seasons: Pick<HeaderSeason, "slug">[];
  activeSeason?: Pick<HeaderSeason, "slug" | "name"> | null;
  mobile?: boolean;
}

export function HeaderNavigationFallback({ mobile = false }: { mobile?: boolean }) {
  const links = [
    { href: "/seasons", label: "赛事" },
    { href: "/teams", label: "队伍" },
    { href: "/stats", label: "数据中心" },
  ];

  return (
    <>
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href as never}
          className={mobile
            ? "flex items-center justify-between px-3 py-2 rounded-md text-sm text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] hover:bg-[var(--color-panel-hi)]"
            : "flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--color-fg-mid)] border-b border-transparent rounded-sm hover:text-[var(--color-fg)] font-medium"}
        >
          {link.label}
        </Link>
      ))}
    </>
  );
}

export function HeaderNavigation({ seasons, activeSeason, mobile = false }: HeaderNavigationProps) {
  const pathname = usePathname();
  const within = (path: string) => pathname === path || pathname.startsWith(`${path}/`);
  const withinActiveSeason = Boolean(activeSeason && within(`/${activeSeason.slug}`));
  const navLinks = [
    { href: "/seasons", label: "赛事", active: within("/seasons") || (!withinActiveSeason && seasons.some((season) => within(`/${season.slug}`))) },
    ...(activeSeason ? [{ href: `/${activeSeason.slug}`, label: activeSeason.name, active: withinActiveSeason }] : []),
    { href: "/teams", label: "队伍", active: within("/teams") },
    { href: "/stats", label: "数据中心", active: within("/stats") },
  ];

  return (
    <>
      {navLinks.map((link) => (
        <Link
          key={link.href}
          href={link.href as never}
          aria-current={link.active ? "page" : undefined}
          className={mobile
            ? cn("flex items-center justify-between px-3 py-2 rounded-md text-sm hover:bg-[var(--color-panel-hi)]", link.active ? "bg-[var(--color-panel)] text-[var(--color-fg)] font-semibold" : "text-[var(--color-fg-mid)] hover:text-[var(--color-fg)]")
            : cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors",
                link.active
                  ? "bg-[var(--color-panel)] border-b border-[var(--color-accent)] text-[var(--color-fg)] font-semibold"
                  : "text-[var(--color-fg-mid)] border-b border-transparent hover:text-[var(--color-fg)] font-medium",
                "rounded-sm",
              )}
        >
          <span className={mobile ? "min-w-0 break-words" : "max-w-48 truncate"} title={link.label}>{link.label}</span>

        </Link>
      ))}
    </>
  );
}
