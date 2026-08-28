"use client";

import React, { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { claimTeamApplicationJoinLink } from "@/actions/team-applications";
import { Button } from "@/components/ui/button";

export function ClaimTeamInviteButton({ token }: { token: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return <Button disabled={isPending} onClick={() => startTransition(async () => {
    const result = await claimTeamApplicationJoinLink(token);
    if (!result.success) { toast.error(result.error.message); return; }
    toast.success(result.data.alreadyMember ? "你已在该报名队伍中" : "已加入待确认名单，请完成个人确认");
    router.push(`/${result.data.seasonSlug}/register`);
    router.refresh();
  })}>{isPending ? "加入中…" : "加入报名队伍"}</Button>;
}
