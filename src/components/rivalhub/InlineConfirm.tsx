import { Button } from "@/components/ui/button";

import React from "react";

interface InlineConfirmProps {
  title: string;
  sub?: string;
  danger?: boolean;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function InlineConfirm({
  title,
  sub,
  danger,
  confirmLabel,
  onConfirm,
  onCancel,
}: InlineConfirmProps) {
  const c = danger ? "var(--color-danger)" : "var(--color-warn)";
  return (
    <div
      className="grid gap-3 items-center rounded-sm border px-4 py-3"
      style={{
        gridTemplateColumns: "1fr auto",
        background: `color-mix(in srgb, ${c} 5%, transparent)`,
        borderColor: `color-mix(in srgb, ${c} 33%, transparent)`,
        borderLeft: `3px solid ${c}`,
      }}
    >
      <div>
        <div
          className="font-semibold"
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            color: "var(--color-fg)",
          }}
        >
          {title}
        </div>
        {sub && (
          <div
            className="mt-1"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--color-fg-mid)",
            }}
          >
            {sub}
          </div>
        )}
      </div>
      <div className="flex gap-1.5">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          取消
        </Button>
        <Button type="button" size="sm" variant={danger ? "destructive" : "default"} onClick={onConfirm}>
          {confirmLabel ?? (danger ? "确认" : "确认")}
        </Button>
      </div>
    </div>
  );
}
