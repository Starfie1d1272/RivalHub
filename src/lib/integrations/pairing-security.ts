import "server-only";

import { createHash, createHmac } from "node:crypto";
import { AppError, ErrorCode } from "@/lib/errors";

export const PAIRING_TTL_MS = 10 * 60 * 1000;

export const hashOpaque = (value: string) => createHash("sha256").update(value).digest("hex");

/** A poll-token hash alone cannot reconstruct either integration's credential. */
export function pairingProof(intentId: string, pollTokenHash: string, domain = "") {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new AppError(ErrorCode.INTERNAL_ERROR, "连接服务未配置安全凭据。");
  const message = domain ? `${domain}:${intentId}:${pollTokenHash}` : `${intentId}:${pollTokenHash}`;
  return createHmac("sha256", secret).update(message).digest("hex");
}
