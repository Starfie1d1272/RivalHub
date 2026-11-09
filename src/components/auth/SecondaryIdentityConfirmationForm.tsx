"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { confirmSecondaryEmailIdentity as telemetry_confirmSecondaryEmailIdentity } from "@/actions/identity";
import { Button } from "@/components/ui/button";
import type { SecondaryEmailOtpType } from "@/lib/auth/secondary-email-otp";
import { ErrorCode } from "@/lib/errors";
import { useTelemetryTask } from "@/components/telemetry/TaskBoundary";
import { observeAction } from "@/lib/telemetry/client";
import type { ActionError } from "@/types/action";

const confirmSecondaryEmailIdentity = observeAction(
  "identity.confirmSecondaryEmailIdentity",
  telemetry_confirmSecondaryEmailIdentity,
);

export function SecondaryIdentityConfirmationForm({
  tokenHash,
  requestId,
  stateToken,
  otpType,
}: {
  tokenHash: string;
  requestId: string;
  stateToken: string;
  otpType: SecondaryEmailOtpType;
}) {
  const task = useTelemetryTask("account", "confirm-secondary");
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<ActionError | null>(null);

  function confirm() {
    const taskToken = task.begin("submit");
    startTransition(async () => {
      const result = await confirmSecondaryEmailIdentity({
        tokenHash,
        requestId,
        stateToken,
        otpType,
      });
      if (!result.success) {
        setFailure(result.error);
        return;
      }
      task.complete(taskToken);
      window.location.assign(result.data.redirectTo);
    });
  }

  if (failure) {
    const needsLogin = failure.code === ErrorCode.UNAUTHORIZED;
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-[var(--color-fg-mid)]">
          {needsLogin
            ? "请登录发起绑定的 RivalHub 账号，再从邮件重新打开此链接。"
            : failure.message}
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link href={needsLogin ? "/login" : "/settings/security"} prefetch={false}>
            {needsLogin ? "去登录" : "查看当前账号"}
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <Button type="button" className="w-full" onClick={confirm} disabled={pending}>
      {pending ? "验证中…" : "验证并继续"}
    </Button>
  );
}
