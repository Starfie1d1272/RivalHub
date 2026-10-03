"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, userIdentities } from "@/db/schema";
import { actionError, failValidation } from "@/lib/action-utils";
import { destroyUserSession } from "@/lib/auth/session";
import { beginAuthentication } from "@/lib/auth/session-registry";
import { mutatePassword } from "@/lib/auth/password-mutation";
import { createPublicAuthClient, createServiceClient } from "@/lib/auth/supabase-server";
import { isPasswordPolicySatisfied, PASSWORD_POLICY_MESSAGE } from "@/lib/config/auth-config";
import { AppError, ErrorCode } from "@/lib/errors";
import { ok, type ActionResult } from "@/types/action";

/** Recovery has no application cookie: verify the supplied provider token remotely, never decode-and-trust. */
export async function resetUserPassword(accessToken: string, password: string): Promise<ActionResult<void>> {
  if (!accessToken || typeof accessToken !== "string" || accessToken.length > 16384) return failValidation("找回链接已失效，请重新请求。");
  if (typeof password !== "string" || !isPasswordPolicySatisfied(password)) return failValidation(PASSWORD_POLICY_MESSAGE);
  try {
    const startedAt = await beginAuthentication(db);
    const { data, error } = await createPublicAuthClient().auth.getUser(accessToken);
    if (error || !data.user) throw new AppError(ErrorCode.UNAUTHORIZED, "找回链接已失效，请重新请求。");
    const identity = await db.select({ userId: userIdentities.userId }).from(userIdentities)
      .where(and(eq(userIdentities.provider, "supabase_auth"), eq(userIdentities.providerSubject, data.user.id), eq(userIdentities.status, "active"))).limit(1);
    const legacy = identity[0] ? [] : await db.select({ userId: users.id }).from(users)
      .where(and(eq(users.authId, data.user.id), eq(users.status, "active"))).limit(1);
    const userId = identity[0]?.userId ?? legacy[0]?.userId;
    if (!userId) throw new AppError(ErrorCode.UNAUTHORIZED, "该登录方式未绑定有效账号。");
    await mutatePassword(userId, startedAt, "user.reset_password", () =>
      createServiceClient().auth.admin.updateUserById(data.user.id, { password }));
    await destroyUserSession();
    return ok(undefined);
  } catch (error) {
    return actionError("resetUserPassword", error);
  }
}
