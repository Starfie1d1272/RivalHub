import type { IronSession } from "iron-session";

// TODO: 实现 iron-session admin 鉴权
// - 管理员登录：invite code + password 校验后写入 cookie
// - requireAdmin()：验证 session 否则重定向到 /admin/login

export interface AdminSessionData {
  isAdmin: boolean;
  seasonSlug?: string;
}

export async function getAdminSession(): Promise<IronSession<AdminSessionData>> {
  throw new Error("not implemented");
}

export async function requireAdmin(): Promise<AdminSessionData> {
  throw new Error("not implemented");
}
