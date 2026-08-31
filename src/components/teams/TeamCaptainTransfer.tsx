"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { transferTeamCaptain } from "@/actions/teams";
import { Button } from "@/components/ui/button";
import { InlineConfirm } from "@/components/rivalhub";

interface TeamCaptainTransferProps {
  teamId: string;
  captainUserId: string;
  members: Array<{ userId: string; label: string }>;
}

export function TeamCaptainTransfer({ teamId, captainUserId, members }: TeamCaptainTransferProps) {
  const [isPending, startTransition] = useTransition();
  const [pendingMember, setPendingMember] = useState<{ userId: string; label: string } | null>(null);
  const candidates = members.filter((member) => member.userId !== captainUserId);
  if (candidates.length === 0) return null;
  return (
    <div className="mt-4 border-t border-[var(--color-border)] pt-4">
      <p className="mb-2 text-sm text-[var(--color-fg-mid)]">交接后，原队长继续保留正式队员身份。</p>
      <div className="flex flex-wrap gap-2">
        {candidates.map((member) => (
          <Button
            key={member.userId}
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => setPendingMember(member)}
          >
            交接给 {member.label}
          </Button>
        ))}
      </div>
      {pendingMember && <InlineConfirm title={`确认将队长移交给 ${pendingMember.label}？`} sub="原队长将保留普通队员身份，新队长将获得队伍管理权限。" onCancel={() => setPendingMember(null)} onConfirm={() => { const member = pendingMember; setPendingMember(null); startTransition(async () => { const result = await transferTeamCaptain({ teamId, toUserId: member.userId }); if (result.success) toast.success(`已将队长交接给 ${member.label}`); else toast.error(result.error.message); }); }} />}
    </div>
  );
}
