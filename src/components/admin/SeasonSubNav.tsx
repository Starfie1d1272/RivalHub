"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ScrollHint } from "@/components/rivalhub";

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

  const tabs: { label: string; href: string }[] = [
    { label: "赛事控制台", href: `/admin/${seasonSlug}` },
    { label: "报名审核", href: `/admin/${seasonSlug}/registrations` },
    { label: "纪律处罚", href: `/admin/${seasonSlug}/discipline` },
    { label: "赛事日志", href: `/admin/${seasonSlug}/logs` },
    { label: "社区奖", href: `/admin/${seasonSlug}/community-awards` },
    ...(hasCaptainVoting ? [{ label: "队长确认", href: `/admin/${seasonSlug}/captains` }] : []),
    ...(hasDraft ? [{ label: "选秀控制", href: `/admin/${seasonSlug}/draft` }] : []),
    ...(hasMatches ? [{ label: "赛程管理", href: `/admin/${seasonSlug}/matches` }] : []),
    ...(hasMatches ? [{ label: "赛后与解说", href: `/admin/${seasonSlug}/postmatch` }] : []),
    ...(showSettings ? [{ label: "赛季设置", href: `/admin/${seasonSlug}/settings` }] : []),
  ];

  return (
    <ScrollHint><nav
      className="mb-6 flex gap-0 overflow-x-auto"
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
    </nav></ScrollHint>
  );
}
