import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";

export interface AdminSessionData {
  isAdmin: boolean;
  adminId?: string;
  adminUsername?: string;
  adminRole?: "super_admin" | "admin";
}

function sessionOptions() {
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
      maxAge: 60 * 60 * 8, // 8 小时
    },
  };
}

export async function getAdminSession() {
  return getIronSession<AdminSessionData>(
    await cookies(),
    sessionOptions(),
  );
}

/** Server Action 用：非管理员直接抛 UNAUTHORIZED */
export async function requireAdmin(): Promise<AdminSessionData> {
  const session = await getAdminSession();
  if (!session.isAdmin) {
    throw new AppError(ErrorCode.UNAUTHORIZED, ERROR_MESSAGES.UNAUTHORIZED);
  }
  return session;
}

/** Server Component 用：非管理员返回 null，由调用方 redirect */
export async function checkAdminSession(): Promise<AdminSessionData | null> {
  const session = await getAdminSession();
  if (!session.isAdmin) return null;
  return session;
}
