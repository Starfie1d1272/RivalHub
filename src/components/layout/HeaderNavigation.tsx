"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils/cn";
import { presentSeasonParticipationState } from "@/lib/seasons/presentation";
import type { HeaderSeason } from "./Header.types";

interface HeaderNavigationProps {
  seasons: HeaderSeason[];
  mobile?: boolean;
}

export function HeaderNavigationFallback({ mobile = false }: { mobile?: boolean }) {
  const links = [
    { href: "/seasons", label: "赛事" },
    { href: "/teams", label: "队伍" },
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

export function HeaderNavigation({ seasons, mobile = false }: HeaderNavigationProps) {
  const pathname = usePathname();
  const seasonLinks = seasons.map((season) => ({
    href: `/${season.slug}`,
    label: season.name,
    badge: presentSeasonParticipationState(season).label,
    active: pathname.startsWith(`/${season.slug}`),
  }));
  const navLinks = [
    { href: "/seasons", label: "赛事", badge: null, active: pathname === "/seasons" },
    { href: "/teams", label: "队伍", badge: null, active: pathname.startsWith("/teams") },
    ...seasonLinks,
  ];

  return (
    <>
      {navLinks.map((link) => (
        <Link
          key={link.href}
          href={link.href as never}
          className={mobile
            ? "flex items-center justify-between px-3 py-2 rounded-md text-sm text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] hover:bg-[var(--color-panel-hi)]"
            : cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors",
                link.active
                  ? "bg-[var(--color-panel)] border-b border-[var(--color-accent)] text-[var(--color-fg)] font-semibold"
                  : "text-[var(--color-fg-mid)] border-b border-transparent hover:text-[var(--color-fg)] font-medium",
                "rounded-sm",
              )}
        >
          <span>{link.label}</span>
          {link.badge && (
            <span
              className="text-xs px-1.5 py-0.5 rounded-sm"
              style={{
                background: "var(--color-panel-low)",
                color: "var(--color-fg-dim)",
              }}
            >
              {link.badge}
            </span>
          )}
        </Link>
      ))}
    </>
  );
}
