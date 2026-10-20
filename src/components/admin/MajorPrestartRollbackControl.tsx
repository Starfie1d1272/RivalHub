"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { rollbackMajorPrestartEntrants as telemetry_rollbackMajorPrestartEntrants } from "@/actions/major-prestart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel } from "@/components/rivalhub";
import { observeAction } from "@/lib/telemetry/client";

const rollbackMajorPrestartEntrants = observeAction(
  "major-prestart.rollbackMajorPrestartEntrants",
  telemetry_rollbackMajorPrestartEntrants,
);

export function MajorPrestartRollbackControl({ seasonId }: { seasonId: string }) {
  const [reason, setReason] = useState("");
  const [reopenUntil, setReopenUntil] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return <Panel label="撤回名单冻结">
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-60 space-y-1">
        <Label htmlFor="major-reopen-until">新的名单调整截止（北京时间）</Label>
        <Input id="major-reopen-until" type="datetime-local" value={reopenUntil}
          disabled={pending} onChange={(event) => setReopenUntil(event.target.value)} />
      </div>
      <div className="min-w-60 flex-1 space-y-1">
        <Label htmlFor="major-unlock-reason">原因</Label>
        <Input id="major-unlock-reason" value={reason} maxLength={1000}
          placeholder="如：补正遗漏转会成员"
          disabled={pending} onChange={(event) => setReason(event.target.value)} />
      </div>
      <Button type="button" variant="outline"
        disabled={pending || !reason.trim() || !reopenUntil}
        onClick={() => {
          if (!window.confirm("确认撤回正式名单冻结？原种子参考将作废，需重新冻结后再排序。")) return;
          startTransition(async () => {
            const result = await rollbackMajorPrestartEntrants({ seasonId, reason: reason.trim(), reopenUntil });
            if (!result.success) {
              toast.error(result.error.message);
              return;
            }
            toast.success("名单已恢复为待冻结状态");
            router.refresh();
          });
        }}>撤回冻结</Button>
    </div>
  </Panel>;
}
