"use server";

import { db } from "@/db/client";
import { actionError } from "@/lib/action-utils";
import { createUserSession } from "@/lib/auth/session";
import { createPublicAuthClient } from "@/lib/auth/supabase-server";
import { bootstrapConfiguredOwnerInTx } from "@/lib/auth/owner-bootstrap";
import { safeLocalRedirect } from "@/lib/auth/redirect";
import { ErrorCode } from "@/lib/errors";
import { normalizeEmail } from "@/lib/utils/email";
import { resolveOrCreateCanonicalUserInTx } from "@/lib/identity/canonical";
import { fail, ok } from "@/types/action";
import type { ActionResult } from "@/types/action";
import { traceOperation } from "@/lib/observability/server";

type ConfirmationFlow = "signup" | "reverify";

const CONFIRMATION_FAILURE_MESSAGE = "邮箱验证未完成，链接可能已失效或已被使用。请返回登录后重新发送验证邮件。";

/**
 * Consume an email token only after the person on the confirmation page has
 * explicitly asked to continue. Keeping this in a Server Action means email
 * link prefetchers cannot create verification facts or application sessions.
 */
export async function confirmEmailVerification(
  flow: ConfirmationFlow,
  tokenHash: string,
  next?: string,
): Promise<ActionResult<{ redirectTo: string }>> {
  if (!isConfirmationFlow(flow) || !tokenHash.trim()) {
    return confirmationFailure();
  }

  try {
    const { data, error } = await traceOperation("provider.supabase.auth.verify_email", {
      scope: "provider",
      operation: "auth.verify_email",
      provider: "supabase-auth",
    }, () => createPublicAuthClient().auth.verifyOtp({
      token_hash: tokenHash,
      type: flow === "signup" ? "email" : "magiclink",
    }));
    const confirmedEmail = data.user?.email;
    const confirmedAt = data.user?.email_confirmed_at;
    if (error || !data.user || !confirmedEmail || !confirmedAt) {
      return confirmationFailure();
    }

    const confirmedUser = data.user;
    const email = normalizeEmail(confirmedEmail);
    const authId = confirmedUser.id;
    const source = flow === "signup" ? "signup_confirmation" : "existing_account_reverification";
    const user = await db.transaction(async (tx) => {
      const canonicalUser = await resolveOrCreateCanonicalUserInTx(tx, {
        authId,
        email,
        verifiedAt: new Date(confirmedAt),
        source,
        allowCreate: flow === "signup",
      });
      return bootstrapConfiguredOwnerInTx(tx, canonicalUser);
    });

    await createUserSession({ userId: user.id, email: user.email });
    return ok({
      redirectTo: safeLocalRedirect(next, flow === "reverify" ? "/settings/education" : "/"),
    });
  } catch (error) {
    return actionError("confirmEmailVerification", error);
  }
}

function isConfirmationFlow(flow: string): flow is ConfirmationFlow {
  return flow === "signup" || flow === "reverify";
}

function confirmationFailure(): ActionResult<never> {
  return fail({ code: ErrorCode.VALIDATION_FAILED, message: CONFIRMATION_FAILURE_MESSAGE });
}
