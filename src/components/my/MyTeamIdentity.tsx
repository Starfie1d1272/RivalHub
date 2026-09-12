import React from "react";
import Link from "next/link";
import { Panel, StatusPill } from "@/components/rivalhub";
import { TeamLogo } from "@/components/teams/TeamLogo";
import type { MyCurrentTeam } from "@/lib/my/team-workspace";

export function MyTeamIdentity({ team }: { team: MyCurrentTeam }) {
  return <Panel label="队伍身份" contentClassName="p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-start"><TeamLogo logoUrl={team.logoUrl} teamName={team.name} size="lg" /><div className="min-w-0 flex-1 space-y-3"><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold">{team.name}</h2><StatusPill label={team.viewerRole === "captain" ? "队长" : "成员"} tone={team.viewerRole === "captain" ? "accent" : "info"} /></div>{team.description && <p className="text-sm leading-6 text-[var(--color-fg-mid)]">{team.description}</p>}<Link className="text-sm text-[var(--color-accent)] hover:underline" href={`/teams/${team.slug}`}>查看队伍主页 →</Link></div></div></Panel>;
}
