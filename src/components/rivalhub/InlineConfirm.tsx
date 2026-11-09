"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";

interface InlineConfirmProps {
  title: string;
  sub?: string;
  danger?: boolean;
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
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
  const groupRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement>(null);
  const inFlight = useRef(false);
  const [submission, setSubmission] = useState<"pending" | "unconfirmed" | null>(null);
  const busy = pending || submission === "pending";

  useEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== cancelRef.current) opener.current = active;
    cancelRef.current?.focus();
  }, []);

  function cancel() {
    if (busy || inFlight.current) return;
    onCancel();
    requestAnimationFrame(() => {
      const trigger = returnFocusRef?.current;
      const target = trigger?.isConnected ? trigger : opener.current;
      if (target?.isConnected) target.focus();
    });
  }

  function confirm() {
    if (pending || submission || inFlight.current) return;
    const result = onConfirm();
    if (!result) return;

    inFlight.current = true;
    groupRef.current?.focus();
    setSubmission("pending");
    void result
      .then(
        () => setSubmission(null),
        () => setSubmission("unconfirmed"),
      )
      .finally(() => {
        inFlight.current = false;
      });
  }

  const c = danger ? "var(--color-danger)" : "var(--color-warn)";
  return (
    <div
      ref={groupRef}
      tabIndex={-1}
      role="group"
      data-inline-confirm=""
      aria-labelledby={titleId}
      aria-describedby={sub ? descriptionId : undefined}
      aria-busy={busy || undefined}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
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
        {submission === "unconfirmed" && (
          <p role="alert" className="mt-1 text-sm leading-6 text-[var(--color-warn)]">
            操作结果暂未确认。请刷新页面核对后再决定是否重试。
          </p>
        )}
      </div>
      <div className="ml-auto flex flex-wrap gap-1.5">
        <Button
          ref={cancelRef}
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={cancel}
        >
          取消
        </Button>
        <Button
          type="button"
          size="sm"
          variant={danger ? "destructive" : "default"}
          disabled={busy || submission === "unconfirmed"}
          onClick={confirm}
        >
          {busy ? "处理中…" : (confirmLabel ?? "确认")}
        </Button>
      </div>
    </div>
  );
}
