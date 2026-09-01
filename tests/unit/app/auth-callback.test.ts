import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  verifyOtpMock,
  exchangeCodeMock,
  createUserSessionMock,
  dbInsertMock,
  dbTransactionMock,
} = vi.hoisted(() => ({
  verifyOtpMock: vi.fn(),
  exchangeCodeMock: vi.fn(),
  createUserSessionMock: vi.fn(),
  dbInsertMock: vi.fn(),
  dbTransactionMock: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { verifyOtp: verifyOtpMock, exchangeCodeForSession: exchangeCodeMock } }),
}));
vi.mock("@/lib/auth/session", () => ({ createUserSession: createUserSessionMock }));
vi.mock("@/db/client", () => ({ db: { insert: dbInsertMock, transaction: dbTransactionMock } }));

import { GET } from "@/app/auth/callback/route";

describe("legacy email confirmation callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "http://127.0.0.1:3000";
  });

  it("GET 预取只转交 token 给确认页，不调用 Auth、DB 或 session", async () => {
    const response = await GET(new NextRequest(
      "http://127.0.0.1:3000/auth/callback/signup?token_hash=ok&type=email&next=%2Fseasons%2Fcurrent",
    ));

    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/auth/confirmation?flow=signup&token_hash=ok&next=%2Fseasons%2Fcurrent",
    );
    expect(verifyOtpMock).not.toHaveBeenCalled();
    expect(exchangeCodeMock).not.toHaveBeenCalled();
    expect(dbInsertMock).not.toHaveBeenCalled();
    expect(dbTransactionMock).not.toHaveBeenCalled();
    expect(createUserSessionMock).not.toHaveBeenCalled();
  });

  it("保留 reverify 的兼容重定向，并拒绝不安全 next", async () => {
    const response = await GET(new NextRequest(
      "http://127.0.0.1:3000/auth/callback/reverify?token_hash=ok&type=magiclink&next=https%3A%2F%2Fevil.example",
    ));

    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/auth/confirmation?flow=reverify&token_hash=ok",
    );
    expect(verifyOtpMock).not.toHaveBeenCalled();
    expect(dbTransactionMock).not.toHaveBeenCalled();
    expect(createUserSessionMock).not.toHaveBeenCalled();
  });

  it("缺少 token 或 flow 时进入可操作的失败页，仍无副作用", async () => {
    const missingToken = await GET(new NextRequest("http://127.0.0.1:3000/auth/callback/signup"));
    const invalidFlow = await GET(new NextRequest("http://127.0.0.1:3000/auth/callback/unknown?token_hash=bad"));

    expect(missingToken.headers.get("location")).toBe("http://127.0.0.1:3000/auth/confirmation");
    expect(invalidFlow.headers.get("location")).toBe("http://127.0.0.1:3000/auth/confirmation");
    expect(verifyOtpMock).not.toHaveBeenCalled();
    expect(dbInsertMock).not.toHaveBeenCalled();
    expect(dbTransactionMock).not.toHaveBeenCalled();
    expect(createUserSessionMock).not.toHaveBeenCalled();
  });
});
