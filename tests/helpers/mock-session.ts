import type { UserSession, AuthenticatedAdmin } from "@/lib/auth/session";

export function mockAdminSession(overrides?: Partial<AuthenticatedAdmin>): AuthenticatedAdmin {
  return {
    isAdmin: true,
    adminId: "admin-1",
    adminUsername: "testadmin",
    adminRole: "super_admin",
    ...overrides,
  };
}

export function mockUserSession(overrides?: Partial<UserSession>): UserSession {
  return {
    userId: "user-1",
    email: "user@test.com",
    role: "user",
    adminSeasonIds: [],
    authSource: "user",
    ...overrides,
  };
}
