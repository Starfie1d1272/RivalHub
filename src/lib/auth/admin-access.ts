import { redirect } from "next/navigation";

import { ErrorCode, isAppErrorCode } from "@/lib/errors";

/**
 * Resolve a server-rendered admin gate without hiding loader/runtime failures.
 * A null result is reserved for an authenticated user lacking the privilege.
 */
export async function resolveAdminPageAccess<T>(
  guard: () => Promise<T>,
): Promise<T | null> {
  try {
    return await guard();
  } catch (error) {
    if (isAppErrorCode(error, ErrorCode.UNAUTHORIZED)) {
      redirect("/login");
    }
    if (isAppErrorCode(error, ErrorCode.FORBIDDEN)) return null;
    throw error;
  }
}
