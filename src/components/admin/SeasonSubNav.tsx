"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ScrollHint } from "@/components/rivalhub";

export function SeasonSubNav({
  seasonSlug,
  registrationMode,
  hasCaptainVoting,
  hasDraft,
  hasCommunityAwards,
  hasMatches,
  showSettings,
}: {
  seasonSlug: string;
  registrationMode: "solo" | "team";
  hasCaptainVoting: boolean;
  hasDraft: boolean;
  hasCommunityAwards: boolean;
  hasMatches: boolean;
  showSettings: boolean;
}) {
  const pathname = usePathname();

  const root = `/admin/${seasonSlug}`;
  const workflowTabs: { label: string; href: string; active?: boolean; title?: string }[] = [
    { label: "总览", href: root },
    { label: "报名", href: `${root}/registrations`, title: registrationMode === "team" ? "队伍报名审核" : "个人报名审核" },
    {
      label: "赛前",
      href: `${root}/prestart`,
      title: [hasCaptainVoting && "队长确认", hasDraft && "选秀"].filter(Boolean).join("、") || "赛事赛前能力",
      active: pathname === `${root}/captains` || pathname.startsWith(`${root}/captains/`) || pathname === `${root}/draft` || pathname.startsWith(`${root}/draft/`),
    },
    ...(hasMatches ? [{ label: "比赛", href: `${root}/matches` }] : []),
    ...(hasCommunityAwards ? [{ label: "社区奖", href: `${root}/community-awards` }] : []),
    { label: "赛后", href: `${root}/post-event` },
  ];
  const governanceTabs = [
    { label: "纪律与处罚", href: `${root}/discipline` },
    { label: "操作日志", href: `${root}/logs` },
  ];
  const settingsTabs = showSettings ? [{ label: "设置", href: `${root}/settings` }] : [];

  const renderTabs = (tabs: { label: string; href: string; active?: boolean; title?: string }[]) => tabs.map((tab) => {
    const active = tab.active || pathname === tab.href || (tab.href !== root && pathname.startsWith(tab.href + "/"));
    return (
      <Link
        key={tab.href}
        href={tab.href as never}
        aria-current={active ? "page" : undefined}
        title={tab.title}
        className="whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2"
        style={{
          padding: "10px 14px",
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
  });

  return (
    <ScrollHint>
      <nav aria-label="赛事工作区导航" className="mb-6 flex gap-4 overflow-x-auto" style={{ borderBottom: "2px solid var(--color-border)" }}>
        <div aria-label="主工作流" className="flex shrink-0 items-end gap-0">
          {renderTabs(workflowTabs)}
        </div>
        <div aria-label="赛事治理" className="flex shrink-0 items-end gap-0 border-l border-[var(--color-border)] pl-2">
          {renderTabs(governanceTabs)}
        </div>
        {settingsTabs.length > 0 && <div aria-label="设置" className="flex shrink-0 items-end gap-0 border-l border-[var(--color-border)] pl-2">
          {renderTabs(settingsTabs)}
        </div>}
      </nav>
    </ScrollHint>
  );
}
