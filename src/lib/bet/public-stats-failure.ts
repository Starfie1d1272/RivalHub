import "server-only";
import { unstable_rethrow } from "next/navigation";

// Flight preserves digests across the cache boundary, unlike error causes/codes.
const FILL_FAILURE = "RIVALHUB_BET_PUBLIC_FILL_FAILURE_V1";
export function preserveBetPublicFillFailure(error: unknown): never {
  unstable_rethrow(error);
  if (error instanceof Error && !("digest" in error) && Object.isExtensible(error)) {
    Object.defineProperty(error, "digest", {value:FILL_FAILURE, configurable:true});
    throw error;
  }
  throw Object.assign(new Error("BET public fill failed", {cause:error}), {digest:FILL_FAILURE});
}
export function isBetCacheTransportFailure(error: unknown): boolean {
  unstable_rethrow(error);
  let current: unknown = error;
  let transportFailure = false;
  for (let depth=0; depth<5 && current && typeof current === "object"; depth++) {
    const value = current as {digest?:unknown;code?:unknown;cause?:unknown};
    if (value.digest === FILL_FAILURE) return false;
    if (typeof value.code === "string" && /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT)$/.test(value.code)) transportFailure = true;
    current = value.cause;
  }
  return transportFailure;
}
