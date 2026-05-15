"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { ScrollHint } from "@/components/rivalhub";

interface SeasonNavProps {
  slug: string;
  hasCaptainVoting: boolean;
  hasDraft: boolean;
  hasMatches: boolean;
  hasStats: boolean;
  /** 是否有已审核通过的选手，控制「选手」导航项的显示 */
  hasPlayers: boolean;
}

interface NavItem {
  label: string;
  href: string;
}

export function SeasonNav({
  slug,
  hasCaptainVoting,
  hasDraft,
  hasMatches,
  hasStats,
  hasPlayers,
}: SeasonNavProps) {
  const pathname = usePathname();

  const items: NavItem[] = [
    { label: "首页", href: `/${slug}` },
    { label: "报名", href: `/${slug}/register` },
    ...(hasPlayers ? [{ label: "选手", href: `/${slug}/players` }] : []),
    ...(hasCaptainVoting ? [{ label: "队长投票", href: `/${slug}/captains` }] : []),
    ...(hasDraft ? [{ label: "选秀", href: `/${slug}/draft` }] : []),
    { label: "队伍", href: `/${slug}/teams` },
    ...(hasMatches ? [{ label: "赛程", href: `/${slug}/matches` }] : []),
    ...(hasStats ? [{ label: "数据统计", href: `/${slug}/stats` }] : []),
  ];

  return (
    <nav className="border-b border-[var(--color-border)]">
      <div className="container mx-auto px-4">
        <ScrollHint>
        <ul className="flex gap-1">
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
                      ? "border-[var(--color-accent)] text-[var(--color-fg)]"
                      : "border-transparent text-[var(--color-fg-mid)] hover:text-[var(--color-fg)]",
                  )}
                >
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
        </ScrollHint>
      </div>
    </nav>
  );
}
