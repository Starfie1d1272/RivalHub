"use client";

import * as Popover from "@radix-ui/react-popover";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

const LEAVE_DELAY_MS = 160;

export function HelpTooltip({
  label,
  content,
  className,
}: {
  label: string;
  content: ReactNode;
  className?: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hovering = useRef(false);
  const pinned = useRef(false);
  const [open, setOpen] = useState(false);

  function clearCloseTimer() {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }

  function show() {
    clearCloseTimer();
    setOpen(true);
  }

  function dismiss() {
    clearCloseTimer();
    hovering.current = false;
    pinned.current = false;
    setOpen(false);
  }

  function closeAfterLeave() {
    clearCloseTimer();
    if (hovering.current || pinned.current || document.activeElement === trigger.current) return;
    closeTimer.current = setTimeout(dismiss, LEAVE_DELAY_MS);
  }

  useEffect(
    () => () => {
      if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    },
    [],
  );

  return (
    <Popover.Root open={open} onOpenChange={(next) => (next ? show() : dismiss())}>
      <Popover.Trigger asChild aria-haspopup={undefined} aria-controls={open ? id : undefined}>
        <button
          ref={trigger}
          type="button"
          aria-label={label}
          aria-describedby={open ? id : undefined}
          onPointerEnter={(event) => {
            if (event.pointerType === "touch") return;
            hovering.current = true;
            show();
          }}
          onPointerLeave={() => {
            hovering.current = false;
            closeAfterLeave();
          }}
          onFocus={show}
          onBlur={closeAfterLeave}
          onClick={(event) => {
            event.stopPropagation();
            event.preventDefault();
            if (pinned.current) dismiss();
            else {
              pinned.current = true;
              show();
            }
          }}
          className={cn(
            "inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-xs font-medium leading-none text-[var(--color-fg-secondary)] transition-colors hover:text-[var(--color-fg-primary)]",
            className,
          )}
        >
          ?
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          id={id}
          role="tooltip"
          sideOffset={2}
          collisionPadding={12}
          hideWhenDetached
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onPointerEnter={() => {
            hovering.current = true;
            clearCloseTimer();
          }}
          onPointerLeave={() => {
            hovering.current = false;
            closeAfterLeave();
          }}
          className="z-[200] max-h-[var(--radix-popover-content-available-height)] w-72 max-w-[calc(100vw-24px)] overflow-auto rounded-sm border border-[var(--color-border-hi)] bg-[var(--color-surface-floating)] px-3 py-2 text-left text-xs font-normal normal-case leading-5 tracking-normal text-[var(--color-fg-primary)] shadow-lg"
        >
          {content}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
