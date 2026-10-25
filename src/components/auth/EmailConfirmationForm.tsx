"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { confirmEmailVerification as telemetry_confirmEmailVerification } from "@/actions/auth-confirmation";
import { Button } from "@/components/ui/button";
import { useTelemetryTask } from "@/components/telemetry/TaskBoundary";
import { observeAction } from "@/lib/telemetry/client";

const confirmEmailVerification = observeAction("auth-confirmation.confirmEmailVerification", telemetry_confirmEmailVerification);

interface Props {
  flow: "signup" | "reverify";
  tokenHash: string;
  next?: string;
}

export function EmailConfirmationForm({ flow, tokenHash, next }: Props) {
  const task = useTelemetryTask("account", "confirm-email");
  const [isPending, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);

  function submit() {
    const taskToken = task.begin("submit");
    startTransition(async () => {
      const result = await confirmEmailVerification(flow, tokenHash, next);
      if (!result.success) {
        setFailure(result.error.message);
        return;
      }
      task.complete(taskToken);
      window.location.assign(result.data.redirectTo);
    });
  }

  if (failure) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-[var(--color-fg-mid)]">{failure}</p>
        <Link href="/login" className="inline-flex text-sm underline hover:text-[var(--color-accent)]">
          返回登录
        </Link>
      </div>
    );
  }

  return (
    <Button type="button" className="w-full" onClick={submit} disabled={isPending}>
      {isPending ? "确认中…" : "确认邮箱"}
    </Button>
  );
}
