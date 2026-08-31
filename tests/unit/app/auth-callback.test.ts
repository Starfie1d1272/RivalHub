import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  verifyOtpMock,
  exchangeCodeMock,
  createUserSessionMock,
  dbInsertMock,
  dbUpdateMock,
  dbTransactionMock,
  insertValuesMock,
  updateSetMock,
} = vi.hoisted(() => ({
  verifyOtpMock: vi.fn(),
  exchangeCodeMock: vi.fn(),
  createUserSessionMock: vi.fn(),
  dbInsertMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  dbTransactionMock: vi.fn(),
  insertValuesMock: vi.fn(),
  updateSetMock: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { verifyOtp: verifyOtpMock, exchangeCodeForSession: exchangeCodeMock } }),
}));

vi.mock("@/lib/auth/session", () => ({ createUserSession: createUserSessionMock }));

vi.mock("@/db/client", () => ({
  db: { transaction: dbTransactionMock },
}));

import { GET } from "@/app/auth/callback/route";

const userRow = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "player@example.test",
  role: "user",
};

function configureDb(): void {
  dbInsertMock.mockReturnValue({
    values: insertValuesMock.mockReturnValue({
      onConflictDoUpdate: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([userRow]) }),
    }),
  });
  dbUpdateMock.mockReturnValue({
    set: updateSetMock.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
  });
  dbTransactionMock.mockImplementation((callback: (tx: unknown) => unknown) =>
    callback({ insert: dbInsertMock, update: dbUpdateMock }),
  );
}

describe("email confirmation callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "http://127.0.0.1:3000";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "local-anon";
    delete process.env.RIVALHUB_OWNER_EMAIL;
    configureDb();
  });

  it("only a valid signup confirmation records ownership and creates an ordinary user session", async () => {
    verifyOtpMock.mockResolvedValue({
      error: null,
      data: { user: { id: "auth-user-1", email: userRow.email, email_confirmed_at: "2026-08-27T00:00:00.000Z" } },
    });

    const response = await GET(new NextRequest("http://127.0.0.1:3000/auth/callback/signup?token_hash=ok&type=email"));

    expect(response.headers.get("location")).toBe("http://127.0.0.1:3000/");
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({ emailVerificationSource: "signup_confirmation" }));
    expect(createUserSessionMock).toHaveBeenCalledWith({ userId: userRow.id, email: userRow.email });
  });

  it("rejects invalid tokens and unrecognised callback flows without a session or public user write", async () => {
    verifyOtpMock.mockResolvedValue({ error: { message: "invalid" }, data: { user: null } });
    await GET(new NextRequest("http://127.0.0.1:3000/auth/callback/signup?token_hash=bad&type=email"));
    await GET(new NextRequest("http://127.0.0.1:3000/auth/callback/unknown?token_hash=bad&type=email"));

    expect(createUserSessionMock).not.toHaveBeenCalled();
    expect(dbInsertMock).not.toHaveBeenCalled();
  });

  it("reverification updates the existing public account fact and does not grant privilege", async () => {
    verifyOtpMock.mockResolvedValue({
      error: null,
      data: { user: { id: "auth-user-1", email: userRow.email, email_confirmed_at: "2026-08-27T00:00:00.000Z" } },
    });

    await GET(new NextRequest("http://127.0.0.1:3000/auth/callback/reverify?token_hash=ok&type=magiclink"));

    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({ emailVerificationSource: "existing_account_reverification" }));
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({ authId: "auth-user-1", email: userRow.email }));
    expect(createUserSessionMock).toHaveBeenCalledWith({ userId: userRow.id, email: userRow.email });
  });
});
