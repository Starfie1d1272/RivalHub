import "server-only";

import { createHash, createHmac } from "node:crypto";
import { AppError, ErrorCode } from "@/lib/errors";

export const PAIRING_TTL_MS = 10 * 60 * 1000;

const START_WINDOW_MS = 60_000;
const STARTS_PER_WINDOW = 30;
const pairingStartSlot = Symbol.for("rivalhub.pairingStartWindow");
const runtime = globalThis as typeof globalThis &
  Record<symbol, { endsAt: number; starts: number } | undefined>;

/** The public start routes share a small budget on the single application process. */
export function pairingStartRetryAfter(now = performance.now()): number | null {
  let pairingStartWindow = runtime[pairingStartSlot];
  if (!pairingStartWindow || now >= pairingStartWindow.endsAt) {
    pairingStartWindow = { endsAt: now + START_WINDOW_MS, starts: 0 };
    runtime[pairingStartSlot] = pairingStartWindow;
  }
  if (pairingStartWindow.starts >= STARTS_PER_WINDOW) {
    return Math.ceil((pairingStartWindow.endsAt - now) / 1000);
  }
  pairingStartWindow.starts++;
  return null;
}

export const hashOpaque = (value: string) => createHash("sha256").update(value).digest("hex");

/** A poll-token hash alone cannot reconstruct either integration's credential. */
export function pairingProof(intentId: string, pollTokenHash: string, domain = "") {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32)
    throw new AppError(ErrorCode.INTERNAL_ERROR, "连接服务未配置安全凭据。");
  const message = domain
    ? `${domain}:${intentId}:${pollTokenHash}`
    : `${intentId}:${pollTokenHash}`;
  return createHmac("sha256", secret).update(message).digest("hex");
}
