"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { confirmSecondaryEmailIdentity } from "@/actions/identity";
import { Button } from "@/components/ui/button";

export function SecondaryIdentityConfirmationForm({
  tokenHash,
  requestId,
  stateToken,
  otpType,
}: {
  tokenHash: string;
  requestId: string;
  stateToken: string;
  otpType: "email" | "magiclink";
}) {
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);

  function confirm() {
    startTransition(async () => {
      const result = await confirmSecondaryEmailIdentity({ tokenHash, requestId, stateToken, otpType });
      if (!result.success) {
        setFailure(result.error.message);
        return;
      }
      window.location.assign(result.data.redirectTo);
    });
  }

  return failure ? (
    <div className="space-y-3">
      <p className="text-sm text-[var(--color-fg-mid)]">{failure}</p>
      <Link href="/settings/security" className="inline-flex text-sm underline hover:text-[var(--color-accent)]">返回账号与安全</Link>
    </div>
  ) : (
    <Button type="button" className="w-full" onClick={confirm} disabled={pending}>
      {pending ? "验证中…" : "验证并继续"}
    </Button>
  );
}
