"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { users, userIdentities } from "@/db/schema";
import { actionError, failValidation } from "@/lib/action-utils";
import { destroyUserSession, getUserSession } from "@/lib/auth/session";
import { assertAuthenticationFence } from "@/lib/auth/session-registry";
import { mutatePassword } from "@/lib/auth/password-mutation";
import { readPasswordRecoveryIntent } from "@/lib/auth/password-recovery-intent";
import { createPublicAuthClient, createServiceClient } from "@/lib/auth/supabase-server";
import { isPasswordPolicySatisfied, PASSWORD_POLICY_MESSAGE } from "@/lib/config/auth-config";
import { AppError, ErrorCode } from "@/lib/errors";
import { normalizeEmail } from "@/lib/utils/email";
import { ok, type ActionResult } from "@/types/action";

const recoveryProofSchema = z.object({
  token: z.string().min(1).max(4096),
  accessToken: z.string().min(1).max(16384),
});

export type PasswordRecoveryProof = z.infer<typeof recoveryProofSchema>;

async function resolvePasswordRecovery(input: PasswordRecoveryProof) {
  const proof = recoveryProofSchema.safeParse(input);
  const invalidLink = "找回链接无效或已过期，请重新请求。";
  if (!proof.success) throw new AppError(ErrorCode.UNAUTHORIZED, invalidLink);

  const intent = await readPasswordRecoveryIntent(proof.data.token);
  const { data, error } = await createPublicAuthClient().auth.getUser(proof.data.accessToken);
  if (
    error &&
    (error.status === undefined ||
      error.status < 400 ||
      error.status === 408 ||
      error.status === 429 ||
      error.status >= 500)
  ) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "账号服务暂时无法核验找回链接。");
  }
  const user = data.user;
  if (
    error ||
    !user?.email ||
    !user.email_confirmed_at ||
    normalizeEmail(user.email) !== intent.email
  )
    throw new AppError(ErrorCode.UNAUTHORIZED, invalidLink);

  const [identity] = await db
    .select({ userId: userIdentities.userId })
    .from(userIdentities)
    .innerJoin(users, eq(users.id, userIdentities.userId))
    .where(
      and(
        eq(userIdentities.provider, "supabase_auth"),
        eq(userIdentities.providerSubject, user.id),
        eq(userIdentities.status, "active"),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  const [legacy] = identity
    ? []
    : await db
        .select({ userId: users.id })
        .from(users)
        .where(and(eq(users.authId, user.id), eq(users.status, "active")))
        .limit(1);
  const userId = identity?.userId ?? legacy?.userId;
  if (!userId) throw new AppError(ErrorCode.UNAUTHORIZED, "该登录方式未绑定有效账号。");

  const session = await getUserSession();
  if (session && session.userId !== userId) {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      "当前登录的账号与找回链接不一致。请退出当前账号，再申请新的找回邮件。",
    );
  }
  await assertAuthenticationFence(db, userId, intent.startedAt);
  return {
    userId,
    authId: user.id,
    email: intent.email,
    startedAt: intent.startedAt,
    signedIn: Boolean(session),
  };
}

export async function verifyPasswordRecovery(
  proof: PasswordRecoveryProof,
): Promise<ActionResult<{ email: string }>> {
  try {
    const { email } = await resolvePasswordRecovery(proof);
    return ok({ email });
  } catch (error) {
    return actionError("verifyPasswordRecovery", error);
  }
}

export async function resetUserPassword(
  proof: PasswordRecoveryProof,
  password: string,
): Promise<ActionResult<void>> {
  if (typeof password !== "string" || !isPasswordPolicySatisfied(password))
    return failValidation(PASSWORD_POLICY_MESSAGE);
  try {
    const recovery = await resolvePasswordRecovery(proof);
    await mutatePassword(recovery.userId, recovery.startedAt, "user.reset_password", () =>
      createServiceClient().auth.admin.updateUserById(recovery.authId, { password }),
    );
    if (recovery.signedIn) {
      try {
        await destroyUserSession();
      } catch (error) {
        // All application sessions were already revoked by the completed mutation.
        actionError("resetUserPassword", error, "after_commit");
      }
    }
    return ok(undefined);
  } catch (error) {
    return actionError("resetUserPassword", error);
  }
}
