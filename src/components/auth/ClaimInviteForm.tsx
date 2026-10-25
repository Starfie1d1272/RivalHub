"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { claimInviteCode as telemetry_claimInviteCode } from "@/actions/auth";
import { useTelemetryTask } from "@/components/telemetry/TaskBoundary";
import { observeAction } from "@/lib/telemetry/client";

const claimInviteCode = observeAction("auth.claimInviteCode", telemetry_claimInviteCode);

interface Props {
  initialCode?: string;
}

export function ClaimInviteForm({ initialCode }: Props) {
  const task = useTelemetryTask("account", "claim-invite");
  const [code, setCode] = useState(initialCode ?? "");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const taskToken = task.begin("submit");
    startTransition(async () => {
      const result = await claimInviteCode(code);
      if (result.success) {
        task.complete(taskToken);
        toast.success("权限已提升，欢迎加入管理团队！");
        router.push("/admin");
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <form onInputCapture={() => task.begin()} onInvalidCapture={() => { task.begin(); task.validation("form_invalid"); }} onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="code">邀请码</Label>
        <Input
          id="code"
          placeholder="输入邀请码"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          autoFocus={!initialCode}
        />
      </div>
      <Button type="submit" className="w-full" disabled={isPending || !code.trim()}>
        {isPending ? "验证中…" : "确认使用"}
      </Button>
    </form>
  );
}
