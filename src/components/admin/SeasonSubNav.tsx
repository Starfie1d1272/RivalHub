"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface Tab {
  label: string;
  href: string;
  show: boolean;
}

export function SeasonSubNav({
  seasonSlug,
  hasCaptainVoting,
  hasDraft,
  hasMatches,
  showSettings,
}: {
  seasonSlug: string;
  hasCaptainVoting: boolean;
  hasDraft: boolean;
  hasMatches: boolean;
  showSettings: boolean;
}) {
  const pathname = usePathname();

  const tabs: Tab[] = [
    { label: "报名审核", href: `/admin/${seasonSlug}/registrations`, show: true },
    { label: "队长确认", href: `/admin/${seasonSlug}/captains`, show: hasCaptainVoting },
    { label: "选秀控制", href: `/admin/${seasonSlug}/draft`, show: hasDraft },
    { label: "赛程管理", href: `/admin/${seasonSlug}/matches`, show: hasMatches },
    { label: "赛季设置", href: `/admin/${seasonSlug}/settings`, show: showSettings },
  ].filter((t) => t.show);

  return (
    <nav
      className="flex gap-0 mb-6"
      style={{ borderBottom: "2px solid var(--color-border)" }}
    >
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.href}
            href={tab.href as never}
            className="transition-colors"
            style={{
              padding: "10px 18px",
              borderBottom: active ? "2px solid var(--color-accent)" : "2px solid transparent",
              marginBottom: "-2px",
              fontWeight: active ? 600 : 500,
              fontSize: 13,
              color: active ? "var(--color-fg)" : "var(--color-fg-mid)",
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
