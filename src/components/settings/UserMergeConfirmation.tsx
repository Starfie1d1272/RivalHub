"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { executeSelfServiceUserMerge } from "@/actions/user-merge";
import { Button } from "@/components/ui/button";

export function UserMergeConfirmation({
  authorizationId,
  canonicalUserId,
  fingerprint,
  executable,
}: {
  authorizationId: string;
  canonicalUserId: string;
  fingerprint: string;
  executable: boolean;
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
      });
      if (!result.success) {
        toast.error(result.error.message);
        router.refresh();
        return;
      }
      window.location.assign(result.data.redirectTo);
    });
  }

  return <div className="space-y-4">
    <label className="flex cursor-pointer items-start gap-3 text-sm leading-6">
      <input
        type="checkbox"
        className="mt-1 size-4"
        checked={confirmed}
        onChange={(event) => setConfirmed(event.target.checked)}
        disabled={!executable || pending}
      />
      <span>我确认保留所选 canonical 用户。另一个账号会进入 merged 状态，其 credential 与可安全迁移的个人事实会归到 canonical 用户；历史 actor 与 frozen facts 保持原记录。</span>
    </label>
    <Button type="button" onClick={execute} disabled={!executable || !confirmed || pending}>
      {pending ? "归并中…" : executable ? "确认并执行安全归并" : "存在未解决项，无法归并"}
    </Button>
  </div>;
}
