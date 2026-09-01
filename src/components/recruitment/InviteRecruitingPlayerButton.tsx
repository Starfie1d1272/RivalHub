"use client";

import React from "react";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { inviteTeamMemberByUserId } from "@/actions/teams";
import { Button } from "@/components/ui/button";

export function InviteRecruitingPlayerButton({ teamId, userId, recruitmentIntentId, label = "邀请加入" }: { teamId: string; userId: string; recruitmentIntentId?: string; label?: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return <Button size="sm" disabled={pending} onClick={() => startTransition(async () => {
    const result = await inviteTeamMemberByUserId({ teamId, userId, recruitmentIntentId });
    if (result.success) { toast.success("邀请已发送"); router.refresh(); }
    else toast.error(result.error.message);
  })}>{pending ? "邀请中…" : label}</Button>;
}
