import React from "react";
import Link from "next/link";
import { Panel, StatusPill } from "@/components/rivalhub";
import { TeamLogo } from "@/components/teams/TeamLogo";
import { presentTeamStatus } from "@/lib/teams/presentation";

export function TeamDirectoryCard({
  slug,
  name,
  logoUrl,
  description,
  hasOpenRecruitment,
  status,
  captainName,
  memberCount,
}: {
  slug: string;
  name: string;
  logoUrl: string | null;
  description: string | null;
  hasOpenRecruitment: boolean;
  status: "active" | "disbanded";
  captainName: string;
  memberCount: number;
}) {
  return (
    <Link href={`/teams/${slug}`} className="block h-full">
      <Panel className="h-full transition-colors hover:border-[var(--color-border-hi)]" contentClassName="p-5">
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <TeamLogo logoUrl={logoUrl} teamName={name} />
              <h2 className="min-w-0 break-words text-lg font-semibold">{name}</h2>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
              <StatusPill {...presentTeamStatus(status)} />
              {status === "active" && hasOpenRecruitment && <StatusPill label="招募中" tone="accent" />}
            </div>
          </div>
          <p className="line-clamp-2 min-h-10 text-sm text-[var(--color-fg-mid)]">{description ?? "暂无简介"}</p>
          <p className="text-xs text-[var(--color-fg-dim)]">队长 <span className="font-medium text-[var(--color-fg-mid)]">{captainName}</span> · {memberCount} 名当前成员</p>
        </div>
      </Panel>
    </Link>
  );
}
