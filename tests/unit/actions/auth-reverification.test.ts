import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAuthMock, userFindFirstMock, signInWithOtpMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  userFindFirstMock: vi.fn(),
  signInWithOtpMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/db/client", () => ({ db: { query: { users: { findFirst: userFindFirstMock } } } }));
vi.mock("@/lib/auth/supabase", () => ({
  createServiceClient: () => ({ auth: { signInWithOtp: signInWithOtpMock } }),
  createPublicAuthClient: () => ({ auth: {} }),
}));

import { resendCurrentEmailVerification } from "@/actions/auth";

describe("resendCurrentEmailVerification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://staging.example.test";
    requireAuthMock.mockResolvedValue({ userId: "user-1" });
  });

  it("uses the current bound email and cannot create a second Auth user", async () => {
    userFindFirstMock.mockResolvedValue({ id: "user-1", email: "legacy@example.test", emailVerifiedAt: null });
    signInWithOtpMock.mockResolvedValue({ error: null });

    await expect(resendCurrentEmailVerification()).resolves.toMatchObject({ success: true });
    expect(signInWithOtpMock).toHaveBeenCalledWith({
      email: "legacy@example.test",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "https://staging.example.test/auth/callback/reverify",
      },
    });
  });
});
