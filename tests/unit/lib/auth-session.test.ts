import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";

const { cookiesMock, getIronSessionMock, userFindFirstMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  getIronSessionMock: vi.fn(),
  userFindFirstMock: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("iron-session", () => ({ getIronSession: getIronSessionMock }));
vi.mock("@/db/client", () => ({
  db: { query: { users: { findFirst: userFindFirstMock } } },
}));

import {
  auditActorId,
  createUserSession,
  checkAdminSession,
  destroyAdminSession,
  destroyUserSession,
  getAdminSession,
  getUserSession,
  requireAdmin,
  requireAuth,
  requireSeasonAdmin,
  requireSuperAdmin,
} from "@/lib/auth/session";

const user = {
  userId: "user-1",
  email: "player@example.test",
  role: "user" as const,
  adminSeasonIds: [],
  authSource: "user" as const,
};

function session(data: Record<string, unknown> = {}) {
  return { ...data, save: vi.fn(), destroy: vi.fn() };
}

describe("auth session guards", () => {
  beforeEach(() => {
    process.env.ADMIN_SESSION_SECRET = "local-test-session-secret-that-is-long-enough";
    vi.clearAllMocks();
    cookiesMock.mockResolvedValue({});
    userFindFirstMock.mockResolvedValue({ role: "user", adminSeasonIds: [] });
  });

  it("reads valid user data, rejects partial data, and persists a user session", async () => {
    getIronSessionMock.mockResolvedValueOnce(session(user));
    await expect(getUserSession()).resolves.toEqual(user);

    getIronSessionMock.mockResolvedValueOnce(session({ userId: "user-1", email: user.email }));
    await expect(getUserSession()).resolves.toBeNull();

    const writable = session();
    getIronSessionMock.mockResolvedValueOnce(writable);
    await createUserSession(user);
    expect(writable).toMatchObject(user);
    expect(writable.save).toHaveBeenCalledOnce();
  });

  it("destroys both cookie types and keeps audit actors stable", async () => {
    const userCookie = session();
    const adminCookie = session();
    getIronSessionMock.mockResolvedValueOnce(userCookie).mockResolvedValueOnce(adminCookie);
    await destroyUserSession();
    await destroyAdminSession();
    expect(userCookie.destroy).toHaveBeenCalledOnce();
    expect(adminCookie.destroy).toHaveBeenCalledOnce();
    expect(auditActorId(user)).toBe("user-1");
    expect(auditActorId({ ...user, authSource: "root", legacyAdminId: "root-1" })).toBe("root:root-1");
  });

  it("requires an authenticated user", async () => {
    getIronSessionMock.mockResolvedValueOnce(session(user));
    await expect(requireAuth()).resolves.toEqual(user);

    getIronSessionMock.mockResolvedValueOnce(session());
    await expect(requireAuth()).rejects.toMatchObject({ code: ErrorCode.UNAUTHORIZED });
  });

  it("allows regular admin, falls back to root, and fails closed otherwise", async () => {
    const seasonAdmin = { ...user, role: "season_admin" as const, adminSeasonIds: ["season-1"] };
    getIronSessionMock.mockResolvedValueOnce(session(seasonAdmin));
    userFindFirstMock.mockResolvedValueOnce({ role: "season_admin", adminSeasonIds: ["season-1"] });
    await expect(requireAdmin()).resolves.toEqual(seasonAdmin);

    getIronSessionMock
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(session({ isAdmin: true, adminId: "root-1", adminUsername: "root", adminRole: "super_admin" }));
    await expect(requireAdmin()).resolves.toMatchObject({ userId: "root-1", authSource: "root", role: "super_admin" });

    getIronSessionMock.mockResolvedValueOnce(session()).mockResolvedValueOnce(session());
    await expect(requireAdmin()).rejects.toMatchObject({ code: ErrorCode.UNAUTHORIZED });
  });

  it("enforces super-admin and season scopes without elevating ordinary users", async () => {
    getIronSessionMock.mockResolvedValueOnce(session({ ...user, role: "super_admin" }));
    userFindFirstMock.mockResolvedValueOnce({ role: "super_admin", adminSeasonIds: [] });
    await expect(requireSuperAdmin()).resolves.toMatchObject({ role: "super_admin" });

    getIronSessionMock.mockResolvedValueOnce(session(user)).mockResolvedValueOnce(session());
    await expect(requireSuperAdmin()).rejects.toMatchObject({ code: ErrorCode.UNAUTHORIZED });

    getIronSessionMock.mockResolvedValueOnce(session({ ...user, role: "season_admin", adminSeasonIds: ["season-1"] }));
    userFindFirstMock.mockResolvedValueOnce({ role: "season_admin", adminSeasonIds: ["season-1"] });
    await expect(requireSeasonAdmin("season-1")).resolves.toMatchObject({ role: "season_admin" });

    getIronSessionMock.mockResolvedValueOnce(session({ ...user, role: "season_admin", adminSeasonIds: ["other-season"] })).mockResolvedValueOnce(session());
    userFindFirstMock.mockResolvedValueOnce({ role: "season_admin", adminSeasonIds: ["other-season"] });
    await expect(requireSeasonAdmin("season-1")).rejects.toMatchObject({ code: ErrorCode.UNAUTHORIZED });
  });

  it("revokes privileged access immediately even when the old session is still valid", async () => {
    const staleSeasonAdmin = { ...user, role: "season_admin" as const, adminSeasonIds: ["season-1"] };
    getIronSessionMock.mockResolvedValueOnce(session(staleSeasonAdmin)).mockResolvedValueOnce(session());
    userFindFirstMock.mockResolvedValueOnce({ role: "user", adminSeasonIds: [] });

    await expect(requireSeasonAdmin("season-1")).rejects.toMatchObject({ code: ErrorCode.UNAUTHORIZED });
  });

  it("reads root-session fields only through the explicit root fallback", async () => {
    getIronSessionMock.mockResolvedValueOnce(session({ isAdmin: true, adminId: "root-1", adminUsername: "root", adminRole: "super_admin" }));
    await expect(getAdminSession()).resolves.toMatchObject({ isAdmin: true, adminId: "root-1" });
  });

  it("returns null rather than leaking an authorization exception to a server component", async () => {
    getIronSessionMock.mockResolvedValueOnce(session()).mockResolvedValueOnce(session());
    await expect(checkAdminSession()).resolves.toBeNull();
  });
});
