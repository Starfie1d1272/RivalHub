"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { executeSelfServiceUserMerge as telemetry_executeSelfServiceUserMerge } from "@/actions/user-merge";
import { Button } from "@/components/ui/button";
import { observeAction } from "@/lib/telemetry/client";

const executeSelfServiceUserMerge = observeAction(
  "user-merge.executeSelfServiceUserMerge",
  telemetry_executeSelfServiceUserMerge,
);

export function UserMergeConfirmation({
  authorizationId,
  canonicalUserId,
  fingerprint,
  executable,
  returnTo,
}: {
  authorizationId: string;
  canonicalUserId: string;
  fingerprint: string;
  executable: boolean;
  returnTo?: string | null;
}) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [pending, startTransition] = useTransition();

  function execute() {
    startTransition(async () => {
      const result = await executeSelfServiceUserMerge({
        authorizationId,
        canonicalUserId,
        expectedFingerprint: fingerprint,
        confirmed,
        returnTo,
      });
      if (!result.success) {
        setConfirmed(false);
        toast.error(result.error.message);
        router.refresh();
        return;
      }
      window.location.assign(result.data.redirectTo);
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-[var(--color-fg-mid)]">
        归并完成后，两个账号在所有设备上的旧登录都会失效。请用保留账号的邮箱重新登录。
      </p>
      <label className="flex cursor-pointer items-start gap-3 text-sm leading-6">
        <input
          type="checkbox"
          className="mt-1 size-4"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          disabled={!executable || pending}
        />
        <span>
          我确认保留所选账号。另一个账号会标记为已归并；可安全迁移的个人事实和登录身份会归到保留账号，历史执行人和冻结赛事事实保持原记录。
        </span>
      </label>
      <Button type="button" onClick={execute} disabled={!executable || !confirmed || pending}>
        {pending ? "归并中…" : executable ? "确认并归并账号" : "存在冲突，暂不能归并"}
      </Button>
    </div>
  );
}
