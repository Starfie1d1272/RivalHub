"use client";
import type { ReactNode } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/types/action";
import type { Operation } from "@/lib/telemetry/operations";
import { observeAction } from "@/lib/telemetry/client";

/** Pairing actions return a confirmed result before navigation; redirect exceptions are not success evidence. */
export function ObservedActionForm({ action, operation, children, className }: {
  action: (form: FormData) => Promise<ActionResult<{ redirectTo: string }>>;
  operation: Operation; children: ReactNode; className?: string;
}) {
  return <form className={className} action={async form => {
    const result = await observeAction(operation, action)(form);
    if (result.success) window.location.assign(result.data.redirectTo);
    else toast.error(result.error.message);
  }}>{children}</form>;
}
