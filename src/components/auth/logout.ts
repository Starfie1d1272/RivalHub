import { observeAction } from "@/lib/telemetry/client";
import { logoutUser } from "@/actions/auth";
import { clearPreviousLiveViews } from "@/lib/mizar/live-viewer-cache-reset";

/** Both public and admin exits invalidate the same tab's display/receiver proof. */
export async function logoutAndClearPreviousViews() {
  const result = await observeAction("auth.logoutUser", logoutUser)();
  if (result.success) clearPreviousLiveViews();
  return result;
}
