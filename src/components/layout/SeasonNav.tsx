"use client";

import { Breadcrumb } from "./Breadcrumb";
import { seasonEntries } from "@/lib/seasons/entries";
import { pageAlignmentFrame } from "@/components/rivalhub/Layout";
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import type { SeasonStatus } from "@/types/season";
import { ScrollHint } from "@/components/rivalhub";

interface SeasonNavProps {
  slug: string;
  seasonName?: string;
  status: SeasonStatus;
  hasCaptainVoting: boolean;
  hasDraft: boolean;
  hasCommunityAwards: boolean;
  hasMatches: boolean;
  hasStats: boolean;
  hasPredictions?: boolean;
  participationAction?: React.ReactNode;
}

export function SeasonNav({
  slug,
  seasonName,
  status,
  hasCaptainVoting,
  hasDraft,
  hasCommunityAwards,
  hasMatches,
  hasStats,
  hasPredictions,
  participationAction,
}: SeasonNavProps) {
  const pathname = usePathname();
  const frame = pageAlignmentFrame(pathname === `/${slug}/predictions` || pathname === `/${slug}/draft` || pathname.startsWith(`/${slug}/draft/`) ? "workbench" : "wide");
  const items = seasonEntries({ slug, status, hasCaptainVoting, hasDraft, hasCommunityAwards, hasMatches, hasStats, hasPredictions }).filter(entry => entry.canRead);

  return (
    <>
    {seasonName && <div className={`${frame} pt-5`}><Breadcrumb items={[{ label: "首页", href: "/" }, { label: "赛事", href: "/seasons" }, { label: seasonName }]} /></div>}
    <nav className="border-b border-[var(--color-border)]">
      <div className={`${frame} flex min-w-0 items-center gap-4`}>
        <div className="min-w-0 flex-1"><ScrollHint>
        <ul className="flex gap-1">
          {items.map(({ label, href, matches }) => {
            const isActive = matches(pathname);

            return (
              <li key={href} className="shrink-0">
                <Link
                  href={href as never}
                  aria-current={isActive ? "page" : undefined}
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
        </ScrollHint></div>
        {participationAction && <div className="shrink-0">{participationAction}</div>}
      </div>
    </nav>
    </>
  );
}
