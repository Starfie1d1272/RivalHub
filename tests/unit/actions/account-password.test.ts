import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ signIn: vi.fn(), update: vi.fn(), mutate: vi.fn(), destroy: vi.fn() }));
vi.mock("@/db/client", () => ({ db: { query: { users: { findFirst: async () => ({ authId: "fixture-subject" }) } } } }));
vi.mock("@/lib/auth/session-registry", () => ({ beginAuthentication: async () => "proof" }));
vi.mock("@/lib/auth/session", () => ({ requireAuth: async () => ({ userId: "fixture-user", email: "fixture@local.test" }), destroyUserSession: mocks.destroy }));
vi.mock("@/lib/auth/password-mutation", () => ({ mutatePassword: mocks.mutate }));
vi.mock("@/lib/auth/supabase-server", () => ({ createPublicAuthClient: () => ({ auth: { signInWithPassword: mocks.signIn } }), createServiceClient: () => ({ auth: { admin: { updateUserById: mocks.update } } }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
import { changeUserPassword } from "@/actions/account";

beforeEach(() => { vi.clearAllMocks(); });

// Existing login tests cannot protect current-password verification: its
// separate action formerly classified every returned SDK error as bad input.
describe("current password verification returned SDK contract", () => {
  it.each([
    { status: 429 }, { status: 503 }, { status: 0 }, {}, { status: 401 },
    { status: 600 }, { status: "429" }, { status: 400, code: "over_request_rate_limit" },
    { status: 429, code: "invalid_credentials" }, { status: 503, code: "invalid_credentials" },
  ])("preserves provider failures and leaves password mutation untouched: %j", async (error) => {
    const rate = error.status === 429 || error.code === "over_request_rate_limit";
    const write = vi.spyOn(rate ? process.stdout : process.stderr, "write").mockReturnValue(true);
    mocks.signIn.mockResolvedValue({ data: { user: null }, error: { ...error, message: "fixture@local.test Original-Password8! raw-provider-body" } });
    const result = await changeUserPassword("Original-Password8!", "Recovered-Password7!");
    expect(result).toMatchObject({ success: false, error: { code: "INTERNAL_ERROR", requestId: expect.any(String) } });
    if (result.success) throw new Error("expected verification failure");
    expect(result.error.message).not.toContain("原密码错误");
    const log = JSON.parse(String(write.mock.calls[0][0]));
    expect(log).toMatchObject({ operation: "auth.verify_password", errorClass: rate ? "expected" : "dependency", requestId: result.error.requestId });
    expect(result.error.message).toContain(log.requestId);
    expect(JSON.stringify([log, result])).not.toMatch(/fixture@local.test|Original-Password8!|raw-provider-body/);
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.destroy).not.toHaveBeenCalled();
    write.mockRestore();
  });
  it.each([
    ["invalid_credentials", "UNAUTHORIZED", "原密码错误"],
    ["email_not_confirmed", "EMAIL_NOT_CONFIRMED", "邮箱尚未验证"],
  ])("keeps explicit %s rejection", async (code, expectedCode, message) => {
    mocks.signIn.mockResolvedValue({ data: { user: null }, error: { status: 400, code } });
    expect(await changeUserPassword("Original-Password8!", "Recovered-Password7!")).toMatchObject({ success: false, error: { code: expectedCode, message: expect.stringContaining(message) } });
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("requires the verified subject to match the canonical account", async () => {
    mocks.signIn.mockResolvedValue({ data: { user: { id: "other-subject" } }, error: null });
    expect(await changeUserPassword("Original-Password8!", "Recovered-Password7!")).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});
