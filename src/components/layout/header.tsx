"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { APP_BRAND } from "@/lib/branding";
import { cn } from "@/lib/utils/cn";
import { SEASON_STATUS_LABELS } from "@/types/season";
import type { SeasonStatus } from "@/types/season";

// Mock seasons — replaced with DB query in Phase 4+
const mockSeasons = [
  { slug: "2026-nju-rivals", name: "2026 NJU Rivals", status: "registration" as const },
];

export function Header() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navLinks = mockSeasons.map((s) => ({
    href: `/${s.slug}`,
    label: s.name,
    badge: SEASON_STATUS_LABELS[s.status as SeasonStatus] ?? s.status,
    active: pathname.startsWith(`/${s.slug}`),
  }));

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--bg-elevated)]/95 backdrop-blur">
      <div className="container mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link
          href="/"
          className="font-bold text-lg text-[var(--text-primary)] hover:text-white transition-colors"
        >
          {APP_BRAND.name}
        </Link>

        {/* Desktop nav */}
        <nav className="hidden sm:flex items-center gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href as never}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors",
                link.active
                  ? "bg-[var(--bg-overlay)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-overlay)]"
              )}
            >
              {link.label}
              <span className="text-xs px-1.5 py-0.5 rounded-sm bg-[var(--bg-base)] text-[var(--text-muted)]">
                {link.badge}
              </span>
            </Link>
          ))}
          <Link
            href="/seasons"
            className={cn(
              "px-3 py-1.5 rounded-md text-sm transition-colors",
              pathname === "/seasons"
                ? "bg-[var(--bg-overlay)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-overlay)]"
            )}
          >
            历史赛季
          </Link>
        </nav>

        {/* Mobile hamburger */}
        <button
          className="sm:hidden p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          onClick={() => setMobileOpen((o) => !o)}
          aria-label="菜单"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="sm:hidden border-t border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-3 flex flex-col gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href as never}
              onClick={() => setMobileOpen(false)}
              className="flex items-center justify-between px-3 py-2 rounded-md text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-overlay)]"
            >
              {link.label}
              <span className="text-xs text-[var(--text-muted)]">{link.badge}</span>
            </Link>
          ))}
          <Link
            href="/seasons"
            onClick={() => setMobileOpen(false)}
            className="px-3 py-2 rounded-md text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-overlay)]"
          >
            历史赛季
          </Link>
        </div>
      )}
    </header>
  );
}
