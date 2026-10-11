import React from "react";
import { safeErrorDigest } from "@/lib/observability/error-digest";
import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  code?: string;
  title?: string;
  sub?: string;
  onRetry?: () => void;
  retryLabel?: string;
  errorDigest?: string;
}

export function ErrorState({
  code = "ERR_500",
  title = "出错了",
  sub,
  onRetry,
  retryLabel = "重试",
  errorDigest,
}: ErrorStateProps) {
  const diagnosticId = safeErrorDigest(errorDigest);
  return (
    <div className="py-10 px-6 text-center">
      <div
        className="inline-flex items-center gap-2 px-2.5 py-1 mb-3.5 rounded-sm border"
        style={{
          borderColor: "color-mix(in srgb, var(--color-danger) 33%, transparent)",
          background: "color-mix(in srgb, var(--color-danger) 6%, transparent)",
          color: "var(--color-danger)",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "var(--tracking-label)",
        }}
      >
        ● {code}
      </div>
      <div
        className="font-semibold"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 22,
          color: "var(--color-fg)",
          letterSpacing: "var(--tracking-tight-1)",
        }}
      >
        {title}
      </div>
      {sub && (
        <p className="mx-auto mt-2 max-w-[460px] font-sans text-sm leading-6 text-[var(--color-fg-secondary)]">
          {sub}
        </p>
      )}
      {diagnosticId && (
        <p className="mt-3 break-all text-sm text-[var(--color-fg-secondary)]">
          排查编号：<code>{diagnosticId}</code>
        </p>
      )}
      {onRetry && (
        <div className="mt-4.5 flex justify-center gap-2">
          <Button type="button" onClick={onRetry}>
            ↻ {retryLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
