"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

interface SeasonNavProps {
  slug: string;
  hasCaptainVoting: boolean;
  hasDraft: boolean;
  qualifierFormat: string | null;
  playoffFormat: string | null;
}

interface NavItem {
  label: string;
  href: string;
}

export function SeasonNav({
  slug,
  hasCaptainVoting,
  hasDraft,
  qualifierFormat,
  playoffFormat,
}: SeasonNavProps) {
  const pathname = usePathname();

  const items: NavItem[] = [
    { label: "首页", href: `/${slug}` },
    { label: "报名", href: `/${slug}/register` },
    ...(hasCaptainVoting ? [{ label: "队长投票", href: `/${slug}/captains` }] : []),
    ...(hasDraft ? [{ label: "选秀", href: `/${slug}/draft` }] : []),
    { label: "队伍", href: `/${slug}/teams` },
    ...((qualifierFormat || playoffFormat) ? [{ label: "赛程", href: `/${slug}/matches` }] : []),
  ];

  return (
    <nav className="border-b border-[var(--border)]">
      <div className="container mx-auto px-4">
        <ul className="flex overflow-x-auto gap-1">
          {items.map(({ label, href }) => {
            const isHome = href === `/${slug}`;
            const isActive = isHome
              ? pathname === `/${slug}`
              : pathname.startsWith(href);

            return (
              <li key={href} className="shrink-0">
                <Link
                  href={href as never}
                  className={cn(
                    "inline-block px-3 py-3 text-sm font-medium border-b-2 transition-colors",
                    isActive
                      ? "border-[var(--season-primary)] text-[var(--text-primary)]"
                      : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                  )}
                >
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
