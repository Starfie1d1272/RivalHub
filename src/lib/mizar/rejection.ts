import "server-only";
import { AppError, type ErrorCode } from "@/lib/errors";

export type ReliableReason = "context_stale" | "sequence_stale" | "generation_fence" | "epoch_fence" | "authority_changed" | "idempotency_conflict" | "invalid_schema";
export type ReliableRecovery = "refresh_context" | "reconcile" | "none";

export class ReliableRejection extends AppError {
  constructor(code: ErrorCode, message: string, public readonly reason: ReliableReason, public readonly details?: { kind: string; scopeHash: string; receivedCursor?: number; storedCursor?: number }) {
    super(code, message);
  }
}

export function reliableRecovery(reason: ReliableReason): ReliableRecovery {
  if (reason === "context_stale") return "refresh_context";
  if (reason === "sequence_stale" || reason === "generation_fence" || reason === "epoch_fence") return "reconcile";
  return "none";
}
