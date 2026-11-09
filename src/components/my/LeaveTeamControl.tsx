"use client";

import React, { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { leaveTeam as telemetry_leaveTeam } from "@/actions/teams";
import { InlineConfirm } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { observeAction } from "@/lib/telemetry/client";

const leaveTeam = observeAction("teams.leaveTeam", telemetry_leaveTeam);

export function LeaveTeamControl({ teamId }: { teamId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  async function confirmLeave() {
    const result = await leaveTeam({ teamId });
    if (result.success) {
      setConfirming(false);
      toast.success("已退出队伍");
      router.refresh();
    } else toast.error(result.error.message);
  }

  return (
    <div className="space-y-3 border-t border-[var(--color-border)] pt-5">
      <p className="text-sm leading-6 text-[var(--color-fg-mid)]">
        退出队伍只会结束当前队伍成员关系，不会自动改写已经提交、审核通过或冻结的赛事名单；如需退出某届赛事，请前往该赛事的报名或名单页面处理。
      </p>
      {confirming ? (
        <InlineConfirm
          title="退出队伍？"
          sub="确认后将结束你与这支队伍的当前成员关系。"
          danger
          confirmLabel="确认退出"
          onConfirm={confirmLeave}
          returnFocusRef={triggerRef}
          onCancel={() => setConfirming(false)}
        />
      ) : (
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          onClick={() => setConfirming(true)}
        >
          退出队伍
        </Button>
      )}
    </div>
  );
}
