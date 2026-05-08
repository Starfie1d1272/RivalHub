import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";

// ─── Root 管理员 Session（保留，仅用于紧急登录）───────────────────────────

export interface AdminSessionData {
  isAdmin: boolean;
  adminId?: string;
  adminUsername?: string;
  adminRole?: "super_admin" | "admin";
}

export interface AuthenticatedAdmin extends AdminSessionData {
  isAdmin: true;
  adminId: string;
  adminUsername: string;
  adminRole: "super_admin" | "admin";
}

function adminSessionOptions() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("ADMIN_SESSION_SECRET must be at least 32 characters");
  }
  return {
    password: secret,
    cookieName: "rivalhub-admin",
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax" as const,
      maxAge: 60 * 60 * 8,
    },
  };
}

export async function getAdminSession() {
  return getIronSession<AdminSessionData>(await cookies(), adminSessionOptions());
}

// ─── 统一用户 Session（所有登录用户）────────────────────────────────────────

export interface UserSession {
  userId: string;
  email: string;
  role: "user" | "season_admin" | "super_admin";
  adminSeasonIds: string[];
  authSource: "user" | "root";
  legacyAdminId?: string;
}

function userSessionOptions() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("ADMIN_SESSION_SECRET must be at least 32 characters");
  }
  return {
    password: secret,
    cookieName: "rivalhub-session",
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax" as const,
      maxAge: 60 * 60 * 24 * 30, // 30 天
    },
  };
}

export async function getUserSession(): Promise<UserSession | null> {
  const session = await getIronSession<Partial<UserSession>>(
    await cookies(),
    userSessionOptions(),
  );
  if (!session.userId || !session.email || !session.role) return null;
  return {
    userId: session.userId,
    email: session.email,
    role: session.role,
    adminSeasonIds: session.adminSeasonIds ?? [],
    authSource: session.authSource ?? "user",
    legacyAdminId: session.legacyAdminId,
  };
}

export async function createUserSession(user: UserSession): Promise<void> {
  const session = await getIronSession<Partial<UserSession>>(
    await cookies(),
    userSessionOptions(),
  );
  session.userId = user.userId;
  session.email = user.email;
  session.role = user.role;
  session.adminSeasonIds = user.adminSeasonIds;
  session.authSource = user.authSource;
  session.legacyAdminId = user.legacyAdminId;
  await session.save();
}

export async function destroyUserSession(): Promise<void> {
  const session = await getIronSession<Partial<UserSession>>(
    await cookies(),
    userSessionOptions(),
  );
  session.destroy();
}

export async function destroyAdminSession(): Promise<void> {
  const session = await getAdminSession();
  session.destroy();
}

// ─── 权限保护工具函数────────────────────────────────────────────────────────

/**
 * 将 root 管理员 session 映射为 UserSession 形态，统一下游调用者的字段访问
 */
function rootToUserSession(admin: AuthenticatedAdmin): UserSession {
  return {
    userId: admin.adminId,
    email: admin.adminUsername,
    role: admin.adminRole === "super_admin" ? "super_admin" : "season_admin",
    adminSeasonIds: [],
    authSource: "root",
    legacyAdminId: admin.adminId,
  };
}

export function auditActorId(session: UserSession): string {
  if (session.authSource === "root") {
    return `root:${session.legacyAdminId ?? session.userId}`;
  }
  return session.userId;
}

/** 任意已登录用户（含选手）。未登录则抛 UNAUTHORIZED */
export async function requireAuth(): Promise<UserSession> {
  const session = await getUserSession();
  if (!session) {
    throw new AppError(ErrorCode.UNAUTHORIZED, ERROR_MESSAGES.UNAUTHORIZED);
  }
  return session;
}

/** 任意管理员（season_admin / super_admin / root）。否则抛 UNAUTHORIZED */
export async function requireAdmin(): Promise<UserSession> {
  const userSession = await getUserSession();
  if (userSession && userSession.role !== "user") {
    return userSession;
  }

  // fallback：root 紧急登录
  const adminSession = await getAdminSession();
  if (
    adminSession.isAdmin &&
    adminSession.adminId &&
    adminSession.adminUsername &&
    adminSession.adminRole === "super_admin"
  ) {
    return rootToUserSession(adminSession as AuthenticatedAdmin);
  }

  throw new AppError(ErrorCode.UNAUTHORIZED, ERROR_MESSAGES.UNAUTHORIZED);
}

/** super_admin 或 root。否则抛 UNAUTHORIZED */
export async function requireSuperAdmin(): Promise<UserSession> {
  const userSession = await getUserSession();
  if (userSession && userSession.role === "super_admin") {
    return userSession;
  }

  const adminSession = await getAdminSession();
  if (
    adminSession.isAdmin &&
    adminSession.adminId &&
    adminSession.adminUsername &&
    adminSession.adminRole === "super_admin"
  ) {
    return rootToUserSession(adminSession as AuthenticatedAdmin);
  }

  throw new AppError(ErrorCode.UNAUTHORIZED, ERROR_MESSAGES.UNAUTHORIZED);
}

/** super_admin、持有该赛季权限的 season_admin 或 root。否则抛 UNAUTHORIZED */
export async function requireSeasonAdmin(seasonId: string): Promise<UserSession> {
  const userSession = await getUserSession();
  if (userSession) {
    if (userSession.role === "super_admin") return userSession;
    if (
      userSession.role === "season_admin" &&
      userSession.adminSeasonIds.includes(seasonId)
    ) {
      return userSession;
    }
  }

  const adminSession = await getAdminSession();
  if (
    adminSession.isAdmin &&
    adminSession.adminId &&
    adminSession.adminUsername &&
    adminSession.adminRole === "super_admin"
  ) {
    return rootToUserSession(adminSession as AuthenticatedAdmin);
  }

  throw new AppError(ErrorCode.UNAUTHORIZED, ERROR_MESSAGES.UNAUTHORIZED);
}

/** Server Component 用：检查是否有管理员权限，无则返回 null（调用方自行 redirect）*/
export async function checkAdminSession(): Promise<UserSession | null> {
  try {
    return await requireAdmin();
  } catch {
    return null;
  }
}
