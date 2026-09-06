import React from "react";
import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  code?: string;
  title?: string;
  sub?: string;
  onRetry?: () => void;
}

export function ErrorState({
  code = "ERR_500",
  title = "出错了",
  sub,
  onRetry,
}: ErrorStateProps) {
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
      {onRetry && (
        <div className="mt-4.5 flex justify-center gap-2">
          <Button type="button" onClick={onRetry}>
            ↻ 重试
          </Button>
        </div>
      )}
    </div>
  );
}
