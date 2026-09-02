"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/rivalhub";
import { presentTeamMembershipStatus } from "@/lib/teams/presentation";

type Membership = { id: string; userId: string; name: string; status: "active" | "benched" | "left" };

export function TeamMembershipSection({ captainUserId, memberships, isCaptain, pending, onSetStatus, onTransferCaptain, onKick }: {
  captainUserId: string;
  memberships: Membership[];
  isCaptain: boolean;
  pending: boolean;
  onSetStatus: (userId: string, status: "active" | "benched") => void;
  onTransferCaptain: (userId: string) => void;
  onKick: (userId: string) => void;
}) {
  return <Panel label="当前成员" pad={20}><div className="space-y-3">{memberships.map((member) => {
    const presentation = presentTeamMembershipStatus(member.status);
    return <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3"><div><p className="font-medium">{member.name}{member.userId === captainUserId ? " · 队长" : ""}</p><p className="font-mono text-[11px] text-[var(--color-fg-mid)]">{presentation.label}</p></div>{isCaptain && member.userId !== captainUserId && <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={pending} onClick={() => onSetStatus(member.userId, member.status === "active" ? "benched" : "active")}>{member.status === "active" ? "设为替补" : "恢复为当前成员"}</Button>{member.status === "active" && <Button type="button" variant="outline" disabled={pending} onClick={() => onTransferCaptain(member.userId)}>交接队长</Button>}<Button type="button" variant="outline" disabled={pending} onClick={() => onKick(member.userId)}>移出</Button></div>}</div>;
  })}</div></Panel>;
}
