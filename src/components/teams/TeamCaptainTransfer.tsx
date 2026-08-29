"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { transferTeamCaptain } from "@/actions/teams";
import { Button } from "@/components/ui/button";

interface TeamCaptainTransferProps {
  teamId: string;
  captainUserId: string;
  members: Array<{ userId: string; label: string }>;
}

export function TeamCaptainTransfer({ teamId, captainUserId, members }: TeamCaptainTransferProps) {
  const [isPending, startTransition] = useTransition();
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
            onClick={() => {
              if (!confirm(`确认将队长移交给 ${member.label}？移交后你将失去队长管理权限。`)) return;
              startTransition(async () => {
                const result = await transferTeamCaptain({ teamId, toUserId: member.userId });
                if (result.success) toast.success(`已将队长交接给 ${member.label}`);
                else toast.error(result.error.message);
              });
            }}
          >
            交接给 {member.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
