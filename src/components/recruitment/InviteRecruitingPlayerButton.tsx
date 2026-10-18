"use client";

import React from "react";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { inviteTeamMemberByUserId as telemetry_inviteTeamMemberByUserId } from "@/actions/teams";
import { Button } from "@/components/ui/button";
import { observeAction } from "@/lib/telemetry/client";

const inviteTeamMemberByUserId = observeAction("teams.inviteTeamMemberByUserId", telemetry_inviteTeamMemberByUserId);

export function InviteRecruitingPlayerButton({ teamId, userId, label = "邀请加入" }: { teamId: string; userId: string; label?: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return <Button size="sm" disabled={pending} onClick={() => startTransition(async () => {
    const result = await inviteTeamMemberByUserId({ teamId, userId });
    if (result.success) { toast.success("邀请已发送"); router.refresh(); }
    else toast.error(result.error.message);
  })}>{pending ? "邀请中…" : label}</Button>;
}
