import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { cache } from "react";

import { db } from "@/db/client";
import { seasonAdminGrants, users } from "@/db/schema";
import { AppError, ErrorCode, ERROR_MESSAGES, isExpectedAuthFailure } from "@/lib/errors";

export interface UserSession {
  userId: string;
  email: string;
}

/** DB-derived authorization facts. These fields are never persisted in the session cookie. */
export interface CurrentUserAuthorization extends UserSession {
  role: "user" | "super_admin";
  seasonIds: string[];
}

type SessionPayload = Partial<UserSession> & Record<string, unknown>;

function userSessionOptions() {
  const password = process.env.ADMIN_SESSION_SECRET;
  if (!password || password.length < 32) {
    throw new Error("ADMIN_SESSION_SECRET must be at least 32 characters");
  }

  return {
    password,
    cookieName: "rivalhub-session",
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax" as const,
      maxAge: 60 * 60 * 24 * 30,
    },
  };
}

// React cache memoizes this only for the current server render/request. It is
// intentionally not Next's persistent or cross-request cache.
export const getUserSession = cache(async (): Promise<UserSession | null> => {
  const session = await getIronSession<SessionPayload>(await cookies(), userSessionOptions());
  if (!session.userId || !session.email) return null;

  return {
    userId: session.userId,
    email: session.email,
  };
});

export async function createUserSession(user: UserSession): Promise<void> {
  const session = await getIronSession<SessionPayload>(await cookies(), userSessionOptions());

  // Clear any pre-existing payload so an old cookie cannot retain authorization data.
  // Keep iron-session's methods; every other enumerable key is session payload.
  const sessionMethods = new Set(["save", "destroy", "update"]);
  for (const key of Object.keys(session)) {
    if (!sessionMethods.has(key)) delete session[key];
  }
  session.userId = user.userId;
  session.email = user.email;
  await session.save();
}

export async function destroyUserSession(): Promise<void> {
  const session = await getIronSession<SessionPayload>(await cookies(), userSessionOptions());
  session.destroy();
}

export function auditActorId(session: UserSession): string {
  return session.userId;
}

export async function requireAuth(): Promise<UserSession> {
  const session = await getUserSession();
  if (!session) {
    throw new AppError(ErrorCode.UNAUTHORIZED, ERROR_MESSAGES[ErrorCode.UNAUTHORIZED]);
  }
  return session;
}

export async function requireAdmin(): Promise<CurrentUserAuthorization> {
  const authorization = await requireCurrentAuthorization();
  if (authorization.role === "super_admin" || authorization.seasonIds.length > 0) {
    return authorization;
  }
  throw new AppError(ErrorCode.FORBIDDEN, ERROR_MESSAGES[ErrorCode.FORBIDDEN]);
}

export async function requireSuperAdmin(): Promise<CurrentUserAuthorization> {
  const authorization = await requireCurrentAuthorization();
  if (authorization.role === "super_admin") return authorization;
  throw new AppError(ErrorCode.FORBIDDEN, ERROR_MESSAGES[ErrorCode.FORBIDDEN]);
}

export async function requireSeasonAdmin(seasonId: string): Promise<CurrentUserAuthorization> {
  const authorization = await requireCurrentAuthorization();
  if (authorization.role === "super_admin" || authorization.seasonIds.includes(seasonId)) {
    return authorization;
  }
  throw new AppError(ErrorCode.FORBIDDEN, ERROR_MESSAGES[ErrorCode.FORBIDDEN]);
}

// Keep the DB-derived role/grants request-scoped as well, so layout and nested
// privilege gates share one authorization snapshot without sharing it later.
export const getCurrentUserAuthorization = cache(async (): Promise<CurrentUserAuthorization | null> => {
  const session = await getUserSession();
  if (!session) return null;
  return loadCurrentAuthorization(session);
});

async function requireCurrentAuthorization(): Promise<CurrentUserAuthorization> {
  const authorization = await getCurrentUserAuthorization();
  if (!authorization) {
    throw new AppError(ErrorCode.UNAUTHORIZED, ERROR_MESSAGES[ErrorCode.UNAUTHORIZED]);
  }
  return authorization;
}

async function loadCurrentAuthorization(session: UserSession): Promise<CurrentUserAuthorization> {
  const [userRows, grantRows] = await Promise.all([
    db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1),
    db
      .select({ seasonId: seasonAdminGrants.seasonId })
      .from(seasonAdminGrants)
      .where(eq(seasonAdminGrants.userId, session.userId)),
  ]);

  const user = userRows[0];
  if (!user) {
    throw new AppError(ErrorCode.UNAUTHORIZED, ERROR_MESSAGES[ErrorCode.UNAUTHORIZED]);
  }

  return {
    ...session,
    role: user.role,
    seasonIds: grantRows.map((grant) => grant.seasonId),
  };
}

export async function checkAdminSession(): Promise<CurrentUserAuthorization | null> {
  try {
    return await requireAdmin();
  } catch (error) {
    if (isExpectedAuthFailure(error)) return null;
    throw error;
  }
}
