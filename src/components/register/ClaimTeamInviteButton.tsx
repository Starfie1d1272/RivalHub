"use client";

import React, { useTransition } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { acceptTeamInvitation } from "@/actions/teams";
import { Button } from "@/components/ui/button";

export function ClaimTeamInviteButton({ token }: { token: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return <Button disabled={isPending} onClick={() => startTransition(async () => {
    const result = await acceptTeamInvitation({ token });
    if (!result.success) { toast.error(result.error.message); return; }
    toast.success("已加入队伍");
    router.push(`/teams/${result.data.slug}` as Route);
    router.refresh();
  })}>{isPending ? "加入中…" : "加入队伍"}</Button>;
}
