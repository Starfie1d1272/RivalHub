import "server-only";

import { createHmac } from "node:crypto";
import { sealData, unsealData } from "iron-session";
import { db } from "@/db/client";
import { AppError, ErrorCode } from "@/lib/errors";
import { beginAuthentication } from "./session-registry";

type PasswordRecoveryIntent = { email: string; startedAt: string };

function recoverySealOptions() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("ADMIN_SESSION_SECRET must be at least 32 characters");
  return {
    password: createHmac("sha256", secret).update("rivalhub:password-recovery:v1").digest("hex"),
    ttl: 60 * 60,
  };
}

export async function createPasswordRecoveryUrl(email: string): Promise<string> {
  const url = new URL("/reset-password", process.env.NEXT_PUBLIC_APP_URL);
  const intent: PasswordRecoveryIntent = { email, startedAt: await beginAuthentication(db) };
  url.searchParams.set("token", await sealData(intent, recoverySealOptions()));
  return url.toString();
}

export async function readPasswordRecoveryIntent(token: string): Promise<PasswordRecoveryIntent> {
  const intent = await unsealData<Partial<PasswordRecoveryIntent>>(token, recoverySealOptions());
  if (!intent.email || !intent.startedAt) {
    throw new AppError(ErrorCode.UNAUTHORIZED, "找回链接无效或已过期，请重新请求。");
  }
  return { email: intent.email, startedAt: intent.startedAt };
}
