"use client";

import { useEffect, useId, useRef, type RefObject } from "react";
import { Button } from "@/components/ui/button";

interface InlineConfirmProps {
  title: string;
  sub?: string;
  danger?: boolean;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  pending?: boolean;
}

export function InlineConfirm({
  title,
  sub,
  danger,
  confirmLabel,
  onConfirm,
  onCancel,
  returnFocusRef,
  pending = false,
}: InlineConfirmProps) {
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  function cancel() {
    onCancel();
    if (returnFocusRef) requestAnimationFrame(() => returnFocusRef.current?.focus());
  }

  const c = danger ? "var(--color-danger)" : "var(--color-warn)";
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      aria-describedby={sub ? descriptionId : undefined}
      aria-busy={pending || undefined}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || pending) return;
        event.stopPropagation();
        cancel();
      }}
      className="flex flex-wrap items-center gap-3 rounded-sm border px-4 py-3"
      style={{
        background: `color-mix(in srgb, ${c} 5%, transparent)`,
        borderColor: `color-mix(in srgb, ${c} 33%, transparent)`,
        borderLeft: `3px solid ${c}`,
      }}
    >
      <div className="min-w-0 flex-[1_1_16rem] break-words">
        <div
          id={titleId}
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
          <p
            id={descriptionId}
            className="mt-1 font-sans text-sm leading-6 text-[var(--color-fg-secondary)]"
          >
            {sub}
          </p>
        )}
      </div>
      <div className="ml-auto flex flex-wrap gap-1.5">
        <Button
          ref={cancelRef}
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={cancel}
        >
          取消
        </Button>
        <Button
          type="button"
          size="sm"
          variant={danger ? "destructive" : "default"}
          disabled={pending}
          onClick={onConfirm}
        >
          {pending ? "处理中…" : (confirmLabel ?? "确认")}
        </Button>
      </div>
    </div>
  );
}
