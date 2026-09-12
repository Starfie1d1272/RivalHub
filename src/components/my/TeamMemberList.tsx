import React from "react";
import { Panel, StatusPill } from "@/components/rivalhub";
import { presentTeamMembershipStatus } from "@/lib/teams/presentation";
import type { MyTeamMember } from "@/lib/my/team-workspace";

export function TeamMemberList({ members }: { members: MyTeamMember[] }) {
  return <Panel label="当前成员" contentClassName="p-5"><div className="space-y-3">{members.map((member) => { const status = presentTeamMembershipStatus(member.status); return <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3 last:border-b-0 last:pb-0"><span className="font-medium">{member.name}</span><StatusPill label={status.label} tone={status.tone} /></div>; })}</div></Panel>;
}
