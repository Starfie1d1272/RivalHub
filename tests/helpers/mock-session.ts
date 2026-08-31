import type { UserSession } from "@/lib/auth/session";

export function mockUserSession(
  overrides: Partial<UserSession> & Record<string, unknown> = {},
): UserSession & Record<string, unknown> {
  return {
    userId: "user-1",
    email: "user@test.com",
    ...overrides,
  };
}
