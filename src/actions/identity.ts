"use server";

import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { identityLinkRequests } from "@/db/schema";
import { actionError } from "@/lib/action-utils";
import { createPublicAuthClient } from "@/lib/auth/supabase-server";
import { requireAuth } from "@/lib/auth/session";
import {
  completeSecondaryIdentityLinkInTx,
  hashIdentityLinkState,
  revokeSecondaryEmailIdentityInTx,
  type CompleteIdentityLinkOutcome,
} from "@/lib/identity/linking";
import { normalizeEmail } from "@/lib/utils/email";
import { ErrorCode } from "@/lib/errors";
import { fail, ok, type ActionResult } from "@/types/action";

const emailSchema = z.email().max(320);
const uuidSchema = z.uuid();

export async function requestSecondaryEmailIdentity(emailInput: string): Promise<ActionResult<void>> {
  const parsed = emailSchema.safeParse(emailInput.trim());
  if (!parsed.success) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请输入有效的邮箱地址。" });
  try {
    const session = await requireAuth();
    const email = normalizeEmail(parsed.data);
    const stateToken = randomBytes(32).toString("base64url");
    const now = new Date();
    const [request] = await db.transaction(async (tx) => {
      await tx.update(identityLinkRequests).set({ status: "cancelled", completedAt: now }).where(and(
        eq(identityLinkRequests.userId, session.userId),
        eq(identityLinkRequests.normalizedEmail, email),
        eq(identityLinkRequests.status, "pending"),
      ));
      return tx.insert(identityLinkRequests).values({
        userId: session.userId,
        normalizedEmail: email,
        stateTokenHash: hashIdentityLinkState(stateToken),
        expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
      }).returning({ id: identityLinkRequests.id });
    });
    if (!request) throw new Error("无法创建邮箱绑定请求");

    const { error } = await createPublicAuthClient().auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: identityConfirmationUrl(request.id, stateToken),
      },
    });
    if (error) {
      await db.update(identityLinkRequests).set({ status: "cancelled", completedAt: new Date() })
        .where(and(eq(identityLinkRequests.id, request.id), eq(identityLinkRequests.status, "pending")));
      return fail({ code: ErrorCode.INTERNAL_ERROR, message: "验证邮件暂时无法发送，请稍后重试。" });
    }
    return ok(undefined);
  } catch (error) {
    return actionError("requestSecondaryEmailIdentity", error);
  }
}

export async function confirmSecondaryEmailIdentity(input: {
  requestId: string;
  stateToken: string;
  tokenHash: string;
}): Promise<ActionResult<CompleteIdentityLinkOutcome & { redirectTo: string }>> {
  const parsed = z.object({ requestId: uuidSchema, stateToken: z.string().min(20).max(200), tokenHash: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "邮箱绑定链接无效，请重新发起。" });
  try {
    const session = await requireAuth();
    const { data, error } = await createPublicAuthClient().auth.verifyOtp({
      token_hash: parsed.data.tokenHash,
      type: "magiclink",
    });
    if (error || !data.user?.email || !data.user.email_confirmed_at) {
      return fail({ code: ErrorCode.VALIDATION_FAILED, message: "邮箱绑定链接已失效或已被使用，请重新发起。" });
    }
    const outcome = await db.transaction((tx) => completeSecondaryIdentityLinkInTx(tx, {
      requestId: parsed.data.requestId,
      stateToken: parsed.data.stateToken,
      currentUserId: session.userId,
      authId: data.user!.id,
      email: data.user!.email!,
      verifiedAt: new Date(data.user!.email_confirmed_at!),
    }));
    revalidatePath("/settings/education");
    revalidatePath("/settings/security");
    return ok({
      ...outcome,
      redirectTo: outcome.kind === "merge_required"
        ? `/settings/security/merge?authorization=${outcome.authorizationId}`
        : "/settings/education",
    });
  } catch (error) {
    return actionError("confirmSecondaryEmailIdentity", error);
  }
}

export async function revokeSecondaryEmailIdentity(identityId: string): Promise<ActionResult<void>> {
  const parsed = uuidSchema.safeParse(identityId);
  if (!parsed.success) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "credential id 无效。" });
  try {
    const session = await requireAuth();
    await db.transaction((tx) => revokeSecondaryEmailIdentityInTx(tx, { userId: session.userId, identityId: parsed.data }));
    revalidatePath("/settings/security");
    revalidatePath("/settings/education");
    return ok(undefined);
  } catch (error) {
    return actionError("revokeSecondaryEmailIdentity", error);
  }
}

function identityConfirmationUrl(requestId: string, stateToken: string): string {
  const origin = process.env.NEXT_PUBLIC_APP_URL;
  if (!origin) throw new Error("NEXT_PUBLIC_APP_URL 未配置");
  const url = new URL("/auth/confirmation", origin);
  url.searchParams.set("flow", "link_identity");
  url.searchParams.set("request", requestId);
  url.searchParams.set("state", stateToken);
  return url.toString();
}
