import { beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorCode } from "@/lib/errors";

const { cookiesMock, getIronSessionMock, selectMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  getIronSessionMock: vi.fn(),
  selectMock: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("iron-session", () => ({ getIronSession: getIronSessionMock }));
vi.mock("@/db/client", () => ({ db: { select: selectMock } }));

import {
  auditActorId,
  checkAdminSession,
  createUserSession,
  destroyUserSession,
  getUserSession,
  requireAdmin,
  requireAuth,
  requireSeasonAdmin,
  requireSuperAdmin,
} from "@/lib/auth/session";

const identity = { userId: "user-1", email: "player@example.test" };

function session(data: Record<string, unknown> = {}) {
  return { ...data, save: vi.fn(), destroy: vi.fn(), update: vi.fn() };
}

function mockCurrentAuthorization(role: "user" | "super_admin", seasonIds: string[]) {
  selectMock
    .mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([{ role }]) }),
      }),
    })
    .mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(seasonIds.map((seasonId) => ({ seasonId }))),
      }),
    });
}

describe("auth session guards", () => {
  beforeEach(() => {
    process.env.ADMIN_SESSION_SECRET = "local-test-session-secret-that-is-long-enough";
    vi.clearAllMocks();
    cookiesMock.mockResolvedValue({});
  });

  it("session cookie 只读取并保存 userId/email，清除旧授权 payload", async () => {
    getIronSessionMock.mockResolvedValueOnce(
      session({ ...identity, role: "super_admin", seasonIds: ["season-1"], extra: "stale" }),
    );
    await expect(getUserSession()).resolves.toEqual(identity);

    const writable = session({ role: "super_admin", seasonIds: ["season-1"], extra: "stale" });
    getIronSessionMock.mockResolvedValueOnce(writable);
    await createUserSession(identity);

    expect(writable).toMatchObject(identity);
    expect(writable).not.toHaveProperty("role");
    expect(writable).not.toHaveProperty("seasonIds");
    expect(writable).not.toHaveProperty("extra");
    expect(writable.save).toHaveBeenCalledOnce();
  });

  it("只销毁 normal session，audit actor 永远是 session userId", async () => {
    const cookie = session(identity);
    getIronSessionMock.mockResolvedValueOnce(cookie);

    await destroyUserSession();

    expect(cookie.destroy).toHaveBeenCalledOnce();
    expect(auditActorId(identity)).toBe("user-1");
  });

  it("requireAuth rejects missing identity", async () => {
    getIronSessionMock.mockResolvedValueOnce(session());
    await expect(requireAuth()).rejects.toMatchObject({ code: ErrorCode.UNAUTHORIZED });
  });

  it("requireAdmin uses a current season grant even when users.role is user", async () => {
    getIronSessionMock.mockResolvedValueOnce(session(identity));
    mockCurrentAuthorization("user", ["season-1"]);

    await expect(requireAdmin()).resolves.toMatchObject({
      ...identity,
      role: "user",
      seasonIds: ["season-1"],
    });
  });

  it("requireAdmin rejects an ordinary user with FORBIDDEN", async () => {
    getIronSessionMock.mockResolvedValueOnce(session(identity));
    mockCurrentAuthorization("user", []);

    await expect(requireAdmin()).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it("requireSuperAdmin and requireSeasonAdmin use current DB facts", async () => {
    getIronSessionMock.mockResolvedValueOnce(session(identity));
    mockCurrentAuthorization("super_admin", []);
    await expect(requireSuperAdmin()).resolves.toMatchObject({ role: "super_admin" });

    getIronSessionMock.mockResolvedValueOnce(session(identity));
    mockCurrentAuthorization("user", ["season-1"]);
    await expect(requireSeasonAdmin("season-1")).resolves.toMatchObject({ seasonIds: ["season-1"] });

    getIronSessionMock.mockResolvedValueOnce(session(identity));
    mockCurrentAuthorization("user", ["other-season"]);
    await expect(requireSeasonAdmin("season-1")).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

    getIronSessionMock.mockResolvedValueOnce(session(identity));
    mockCurrentAuthorization("user", ["season-1"]);
    await expect(requireSuperAdmin()).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it("revocation takes effect while the identity cookie remains valid", async () => {
    getIronSessionMock.mockResolvedValueOnce(session(identity));
    mockCurrentAuthorization("user", []);

    await expect(requireSeasonAdmin("season-1")).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it("checkAdminSession returns null for an unauthenticated server component", async () => {
    getIronSessionMock.mockResolvedValueOnce(session());
    await expect(checkAdminSession()).resolves.toBeNull();
  });

  it("checkAdminSession returns null for an expected authorization denial", async () => {
    getIronSessionMock.mockResolvedValueOnce(session(identity));
    mockCurrentAuthorization("user", []);

    await expect(checkAdminSession()).resolves.toBeNull();
  });

  it("checkAdminSession rethrows unexpected authorization loader failures", async () => {
    const loaderError = new Error("database unavailable");
    getIronSessionMock.mockResolvedValueOnce(session(identity));
    selectMock.mockImplementationOnce(() => {
      throw loaderError;
    });

    await expect(checkAdminSession()).rejects.toBe(loaderError);
  });

  it("treats a session whose user row disappeared as UNAUTHORIZED", async () => {
    getIronSessionMock.mockResolvedValueOnce(session(identity));
    selectMock
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

    await expect(requireAdmin()).rejects.toMatchObject({ code: ErrorCode.UNAUTHORIZED });
  });
});
